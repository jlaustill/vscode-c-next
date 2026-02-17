# Symbol ID Design: Dot-Path IDs for Unambiguous Resolution

**Date:** 2026-02-17
**Status:** Implemented
**Implemented:** 2026-02-17 (c-next v0.2.1 + vscode extension feat/symbol-id-migration branch)

## Problem

The current symbol system uses `name` + `parent` string matching to resolve symbols. This has two issues:

1. **Ambiguous parent references.** If scope `A` has a method named `B`, and a separate scope is also named `B`, both produce symbols with `name: "B"`. The resolver can't distinguish them — `findSymbolByName(symbols, "B")` returns whichever comes first.

2. **Underscore-concatenated fullName leaks C convention.** `fullName: "LED_toggle"` is the generated C name, not a C-Next concept. The extension shouldn't depend on transpiler output naming.

3. **Fallback drops parent constraint.** When parent-constrained lookup fails, `findDefinition(word)` drops the parent and returns the first name match from any scope — navigating to the wrong file.

## Solution

### New fields in parseSymbols response

Add `id` and `parentId` alongside existing fields:

```json
{
  "name": "toggle",
  "fullName": "LED_toggle",
  "kind": "function",
  "type": "void",
  "parent": "LED",
  "id": "LED.toggle",
  "parentId": "LED",
  "line": 6
}
```

### ID construction rules

| Symbol             | id                             | parentId          |
| ------------------ | ------------------------------ | ----------------- |
| Top-level scope    | `"LED"`                        | `undefined`       |
| Scope field        | `"LED.pin"`                    | `"LED"`           |
| Scope method       | `"LED.toggle"`                 | `"LED"`           |
| Nested register    | `"Teensy4.GPIO7.DataRegister"` | `"Teensy4.GPIO7"` |
| Enum definition    | `"Color"`                      | `undefined`       |
| Enum member        | `"Color.Red"`                  | `"Color"`         |
| Top-level function | `"setup"`                      | `undefined`       |
| Top-level variable | `"counter"`                    | `undefined`       |

The dot path is the natural C-Next namespace hierarchy. Duplicates cannot exist because C-Next enforces unique names within a scope.

### Matching rule

All symbol lookups match on **id + type** exactly. No bare-name fallbacks, no underscore construction.

When resolving `B.LEDs`:

1. Find `B` where `kind: "namespace"` (not `kind: "function"`)
2. Find `LEDs` where `parentId` equals the matched scope's `id`

### Backward compatibility

Existing `fullName` and `parent` fields remain unchanged in the protocol. They are still needed for:

- C code generation (underscore naming)
- Display in hover tooltips (until migrated to use `id`)
- Old extension versions that haven't updated yet

## Extension changes (after transpiler ships)

### Types

Add optional fields to both `ISymbolInfo` interfaces:

```typescript
// src/state/types.ts and src/server/CNextServerClient.ts
id?: string;
parentId?: string;
```

Also add to `IMinimalSymbol` in `src/state/utils.ts`.

### Resolution logic

| Current                                                     | New                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `findSymbolByName(symbols, name, parent)`                   | `findSymbolById(symbols, id, type)` or match on `parentId` + `name` + `type` |
| `findSymbolByFullName(symbols, fullName)`                   | `findSymbolById(symbols, id)`                                                |
| `findSymbolWithFallback` cascading search                   | Direct `id` lookup, no fallback chain needed                                 |
| `concatParentName(parent, member)`                          | Not needed — `parentId` is already the full dot path                         |
| `resolveNextParent` checking `s.parent === symbol.fullName` | `s.parentId === symbol.id`                                                   |
| `findMembers` dedup on `fullName`                           | Dedup on `id`                                                                |

### Files that change

| File                                | Change                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/state/types.ts`                | Add `id?`, `parentId?` to `ISymbolInfo`                                                      |
| `src/server/CNextServerClient.ts`   | Add `id?`, `parentId?` to server `ISymbolInfo`                                               |
| `src/state/utils.ts`                | `IMinimalSymbol` + all `findSymbol*` functions + `resolveNextParent` + `extractStructFields` |
| `src/state/SymbolResolver.ts`       | `findMembers` dedup, parent filters, `resolveVariableType`                                   |
| `src/state/WorkspaceIndex.ts`       | `findDefinition` filters on `parentId`                                                       |
| `src/display/CompletionProvider.ts` | 7 `s.parent ===` filter sites                                                                |
| `src/display/HoverProvider.ts`      | `resolveDisplayParent` walks `parentId` chain                                                |
| All test files                      | Mock symbol data gains `id`/`parentId`                                                       |

### Files that don't change

- `src/display/DefinitionProvider.ts` — delegates to SymbolResolver
- `src/state/SymbolCache.ts` — opaque storage
- `src/state/WorkspaceScanner.ts` — pass-through
- `src/state/IncludeResolver.ts` — no symbol field access

## Interim fix (already shipped)

While waiting for the transpiler, the fallback in `SymbolResolver.resolveAtPosition` now passes `parentName` through to `findDefinition`, preventing wrong-scope navigation. This fix uses `name` + `parent` matching — the same fields, just correctly propagated.

## c-next issue

Tracked at: https://github.com/jlaustill/c-next/issues/823
