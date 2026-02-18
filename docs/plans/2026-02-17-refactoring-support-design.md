# Refactoring Support Design

**Date:** 2026-02-17
**Status:** Exploratory

## Context

The VS Code C-Next extension currently provides 3 IDE providers (Completion, Hover, Definition) backed by a centralized `SymbolResolver`. The extension can find where symbols are _defined_ but not where they are _used_. Adding refactoring support requires reference-finding as the foundational capability.

## Current Architecture

```
CompletionProvider ─┐
HoverProvider      ─┼─→ SymbolResolver ──→ WorkspaceIndex ──→ cnext --serve
DefinitionProvider ─┘         │                  │
                        ScopeTracker        SymbolCache
```

### Existing Capabilities

- `SymbolResolver.resolveAtPosition()` — resolve any symbol at cursor (dot-access, this/global, cross-file)
- `SymbolResolver.resolveChain()` — walk dot-chains (e.g., `this.GPIO7.DataRegister`)
- `SymbolResolver.findMembers()` — find all symbols with matching parent
- `WorkspaceIndex` — cross-file symbol lookup with include awareness
- `IncludeResolver` — resolve `#include` to file paths, track dependencies
- `ScopeTracker` — determine current scope at a line

### Key Gaps

- No column information in server response (line only)
- No reference/usage location finding
- No scope hierarchy metadata
- No rename validation or conflict detection

## Feature Landscape

Ordered by dependency chain:

| Feature             | VS Code API               | Depends On                 | User Value                |
| ------------------- | ------------------------- | -------------------------- | ------------------------- |
| Document Symbols    | `DocumentSymbolProvider`  | Existing parseSymbols      | Outline view, breadcrumbs |
| Workspace Symbols   | `WorkspaceSymbolProvider` | Existing WorkspaceIndex    | Ctrl+T search             |
| Find All References | `ReferenceProvider`       | **New: reference finding** | Shift+F12                 |
| Rename Symbol       | `RenameProvider`          | Find All References        | F2 rename                 |
| Code Actions        | `CodeActionProvider`      | Various                    | Lightbulb quick fixes     |
| Extract Function    | CodeAction                | Find References + AST      | Select, extract           |

## Approach A: Server-Side (cnext enhancement)

Add new RPC methods to `cnext --serve`:

```
findReferences(symbolName, filePath, line) → ReferenceLocation[]
getRanges(filePath) → SymbolRange[]
getDocumentSymbols(filePath) → SymbolTree[]
```

The ANTLR parser already builds a full AST. Adding reference tracking means walking the AST and recording every identifier token's position and what it resolves to.

### Trade-offs

| Pro                                          | Con                                      |
| -------------------------------------------- | ---------------------------------------- |
| Most accurate — uses real AST                | Requires transpiler changes (Rust/ANTLR) |
| Handles shadowing, scope visibility          | Couples extension to server version      |
| Column + range info comes from parser tokens | Server must track cross-file resolution  |
| One round-trip per operation                 | `cnext` required for refactoring to work |
| Foundation for future features               | Slower iteration cycle                   |

### Effort

~1-2 weeks for `findReferences` + `getRanges` in transpiler, ~3-5 days for extension providers.

## Approach B: Extension-Side (TypeScript only)

Build reference-finding in the extension using existing symbol index + document text scanning.

### Algorithm

```
1. User hits F2 on `toggle` inside `scope LED`
2. Resolve symbol via SymbolResolver → LED.toggle, kind=function
3. Scan relevant files (current + dependents via IncludeResolver)
4. For each file, find lines matching symbol name
5. Validate context (dot-access parent, scope context, not in comment/string)
6. Build WorkspaceEdit with all rename locations
```

### Trade-offs

| Pro                               | Con                                         |
| --------------------------------- | ------------------------------------------- |
| No transpiler changes needed      | Text scanning is fragile                    |
| Ships immediately                 | Can't handle complex scoping perfectly      |
| Independent of `cnext` version    | Must re-parse files for each operation      |
| Easier to iterate on (TypeScript) | False positives/negatives at edges          |
| Works without transpiler          | `stripComments()` adds cognitive complexity |

### Effort

~1 week for Rename + Find References, ~2-3 days for Document/Workspace Symbols.

## Approach C: Hybrid (Recommended)

Start extension-side for quick wins. Design the interface so it can delegate to the server later.

```
                    ┌─────────────────────┐
                    │  ReferenceProvider   │
                    │  RenameProvider      │
                    │  DocumentSymbolProv  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  ReferenceResolver  │  ← new service (interface)
                    └──────┬────────┬─────┘
                           │        │
              ┌────────────▼─┐  ┌───▼────────────┐
              │ TextScanner  │  │ ServerResolver  │
              │ (extension)  │  │ (cnext RPC)     │
              └──────────────┘  └─────────────────┘
              ships now          ships when server
                                 adds findReferences
```

### Phase 1 — Extension-side (no transpiler changes)

- `DocumentSymbolProvider` — existing `parseSymbols()` formatted as tree
- `WorkspaceSymbolProvider` — wraps `WorkspaceIndex.getAllSymbols()`
- `ReferenceProvider` — text scanning with context validation
- `RenameProvider` — builds on ReferenceProvider

### Phase 2 — Server enhancement

- Add `findReferences()` RPC method
- Add column/range data to `parseSymbols` response
- Swap in `ServerResolver` behind same interface
- Higher accuracy, no behavior change for users

## Feature Details

### Document Symbols (easiest)

- Call `parseSymbols()` on the current document
- Convert flat `ISymbolInfo[]` to hierarchical `vscode.DocumentSymbol[]` using `parent` field
- Provides Outline panel + breadcrumbs

### Workspace Symbols (easy)

- Wrap `WorkspaceIndex.getAllSymbols()`
- Filter by user query string
- Return as `vscode.SymbolInformation[]`

### Find All References (medium — core challenge)

- Scan files that could reference a symbol (scoped via include dependencies)
- Validate each match is not inside comment/string and has correct parent context
- Handle `this.member` references where `this` resolves to the right scope
- Word-boundary validation to prevent `indexOf("on")` matching `button`

### Rename Symbol (medium — builds on references)

- Call Find All References
- Validate new name is a legal C-Next identifier
- Check for conflicts (does `newName` already exist in scope?)
- Build `WorkspaceEdit` with all text replacements
- `prepareRename()` to confirm symbol is renameable

### Code Actions (varies)

- "Add missing `#include`" — detect undefined symbol, suggest include
- "Extract to variable" — select expression, create named variable
- Each is standalone with its own complexity

## Design Constraints

- SonarCloud cognitive complexity limit: 15 per function
- ReDoS safety: no nested quantifiers in regexes (use `src/state/utils.ts` utilities)
- New-code coverage threshold: 80%
- Extension must degrade gracefully without transpiler
