# Symbol ID Migration: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all symbol matching from `name`/`parent`/`fullName` strings to `id`/`parentId` dot-path identifiers.

**Architecture:** The c-next server (v0.2.1+) now returns `id` (dot-path like `"LED.toggle"`) and `parentId` (like `"LED"`) alongside existing fields. The extension will switch all resolution logic to match on `parentId` instead of `parent`, and dedup on `id` instead of `fullName`. Existing `fullName`/`parent` fields stay for backward compat and display.

**Tech Stack:** TypeScript, Vitest, cnext v0.2.1+

**Design doc:** `docs/plans/2026-02-17-symbol-id-design.md`

---

### Task 1: Add id/parentId to type definitions

**Files:**

- Modify: `src/state/types.ts` (ISymbolInfo)
- Modify: `src/server/CNextServerClient.ts` (server ISymbolInfo)
- Modify: `src/state/utils.ts` (IMinimalSymbol)

**Step 1: Add fields to state ISymbolInfo**

In `src/state/types.ts`, add after `fullName`:

```typescript
/** Dot-path unique identifier (e.g. "LED.toggle") */
id?: string;
/** Dot-path parent identifier (e.g. "LED") */
parentId?: string;
```

**Step 2: Add fields to server ISymbolInfo**

In `src/server/CNextServerClient.ts`, add after `fullName`:

```typescript
id?: string;
parentId?: string;
```

**Step 3: Add fields to IMinimalSymbol**

In `src/state/utils.ts`, add to `IMinimalSymbol`:

```typescript
id?: string;
parentId?: string;
```

**Step 4: Run tests — all should still pass (fields are optional)**

Run: `npx vitest run`
Expected: All 221+ tests pass (no behavior change yet)

**Step 5: Commit**

```
feat: add id and parentId fields to symbol types
```

---

### Task 2: Update test helpers to emit id/parentId

All test helpers that create mock symbols need to generate `id` and `parentId` from existing data so subsequent tasks can rely on them.

**Files:**

- Modify: `src/state/__tests__/symbolResolver.test.ts` (makeSymbol helper)
- Modify: `src/state/__tests__/workspaceIndex.test.ts` (makeSymbol helper)
- Modify: `src/state/__tests__/utils.test.ts` (inline test data)
- Modify: `src/display/__tests__/completionProvider.test.ts` (mock symbols)
- Modify: `src/display/__tests__/hoverProvider.test.ts` (mock symbols)
- Modify: `src/display/__tests__/definitionProvider.test.ts` (mock symbols)

**Step 1: Update makeSymbol in symbolResolver.test.ts**

```typescript
function makeSymbol(
  overrides: Partial<ISymbolInfo> & { name: string },
): ISymbolInfo {
  const id =
    overrides.id ??
    (overrides.parent
      ? `${overrides.parent}.${overrides.name}`
      : overrides.name);
  return {
    fullName: overrides.fullName ?? overrides.name,
    kind: overrides.kind ?? "variable",
    line: overrides.line ?? 1,
    id,
    parentId: overrides.parentId ?? overrides.parent,
    ...overrides,
  };
}
```

**Step 2: Apply same pattern to makeSymbol in workspaceIndex.test.ts**

Same logic: derive `id` from `parent.name` or just `name`, set `parentId` from `parent`.

**Step 3: Add id/parentId to all inline mock symbols in utils.test.ts**

Every `{ name: "foo", fullName: "Bar_foo", parent: "Bar" }` gains `id: "Bar.foo", parentId: "Bar"`.

**Step 4: Add id/parentId to mock symbols in completionProvider.test.ts, hoverProvider.test.ts, definitionProvider.test.ts**

Same pattern for all provider test fixtures.

**Step 5: Run tests — all should still pass**

Run: `npx vitest run`
Expected: All tests pass (id/parentId exist but aren't used yet)

**Step 6: Commit**

```
test: add id/parentId to all mock symbol fixtures
```

---

### Task 3: Migrate core matching functions in utils.ts

**Files:**

- Test: `src/state/__tests__/utils.test.ts`
- Modify: `src/state/utils.ts`

**Step 1: Write failing test for findSymbolByName with parentId**

Add test case:

```typescript
it("matches by parentId instead of parent", () => {
  const symbols = [
    {
      id: "A.B",
      name: "B",
      fullName: "A_B",
      kind: "function",
      parent: "A",
      parentId: "A",
    },
    { id: "B", name: "B", fullName: "B", kind: "namespace" },
  ];
  const result = findSymbolByName(symbols, "B", "A");
  expect(result?.id).toBe("A.B");
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/state/__tests__/utils.test.ts`

**Step 3: Update findSymbolByName to match on parentId**

```typescript
export function findSymbolByName<T extends IMinimalSymbol>(
  symbols: T[],
  name: string,
  parent?: string | null,
): T | undefined {
  if (parent === undefined) {
    return symbols.find((s) => s.name === name);
  }
  if (parent === null || parent === "") {
    return symbols.find((s) => s.name === name && !s.parentId);
  }
  return symbols.find((s) => s.name === name && s.parentId === parent);
}
```

**Step 4: Update extractStructFields to emit id/parentId**

```typescript
fields.push({
  id: `${currentStruct}.${name}`,
  name,
  fullName: `${currentStruct}_${name}`,
  kind: "field",
  type,
  parent: currentStruct,
  parentId: currentStruct,
});
```

**Step 5: Update resolveNextParent** — line 339:

```typescript
// Old: s.parent === symbol.fullName
// New:
if (symbol.id && symbols.some((s) => s.parentId === symbol.id)) {
  return symbol.id;
}
```

And lines 354-358:

```typescript
// Old: return typeSymbol.parent ? `${typeSymbol.parent}_${typeSymbol.name}` : typeSymbol.name
// New:
if (typeSymbol) {
  return typeSymbol.id ?? typeSymbol.name;
}
```

**Step 6: Update remaining utils.test.ts assertions for parentId matching**

Update any test that checks `!s.parent` to check `!s.parentId`, and tests that pass `parent` to `findSymbolByName` to verify they match via `parentId`.

**Step 7: Run tests**

Run: `npx vitest run src/state/__tests__/utils.test.ts`
Expected: All pass

**Step 8: Commit**

```
refactor: migrate utils.ts matching from parent to parentId
```

---

### Task 4: Migrate SymbolResolver

**Files:**

- Test: `src/state/__tests__/symbolResolver.test.ts`
- Modify: `src/state/SymbolResolver.ts`

**Step 1: Update findMembers — dedup on id, filter on parentId**

Line 221: `seen.has(sym.fullName)` → `seen.has(sym.id ?? sym.fullName)`
Lines 228, 236, 243: `sym.parent === parentName` → `sym.parentId === parentName`

**Step 2: Update resolveVariableType**

Line 274: `s.parent === symbol.type` →

```typescript
const typeSymbol = allSymbols.find((s) => s.name === symbol.type);
const typeId = typeSymbol?.id ?? symbol.type;
const hasMembers = allSymbols.some((s) => s.parentId === typeId);
```

**Step 3: Run symbolResolver tests**

Run: `npx vitest run src/state/__tests__/symbolResolver.test.ts`
Expected: All pass

**Step 4: Commit**

```
refactor: migrate SymbolResolver from parent to parentId
```

---

### Task 5: Migrate WorkspaceIndex.findDefinition

**Files:**

- Test: `src/state/__tests__/workspaceIndex.test.ts`
- Modify: `src/state/WorkspaceIndex.ts`

**Step 1: Rename parameter from parent to parentId**

Line 129: `parent?: string` → `parentId?: string`

**Step 2: Update matchesParent closure**

Line 132-133:

```typescript
const matchesParent = (s: ISymbolInfo): boolean =>
  parentId ? s.parentId === parentId : true;
```

**Step 3: Update SymbolResolver.ts call site**

Line 110: pass `parentName` as `parentId` parameter (already correct from our earlier fix — the parameter name in WorkspaceIndex just changes).

**Step 4: Run tests**

Run: `npx vitest run src/state/__tests__/workspaceIndex.test.ts src/state/__tests__/symbolResolver.test.ts`
Expected: All pass

**Step 5: Commit**

```
refactor: migrate WorkspaceIndex.findDefinition to parentId
```

---

### Task 6: Migrate CompletionProvider

**Files:**

- Test: `src/display/__tests__/completionProvider.test.ts`
- Modify: `src/display/CompletionProvider.ts`

**Step 1: Update getThisCompletions (line 578)**

`s.parent === currentScope` → `s.parentId === currentScope`

Note: `currentScope` comes from `ScopeTracker.getCurrentScope()` which returns a bare name. For single-level scopes, the name equals the id, so this works. For nested scopes, ScopeTracker would need updating (out of scope for this task).

**Step 2: Update getGlobalDotCompletions (line 601)**

`!s.parent` → `!s.parentId`

**Step 3: Update getNamedMemberCompletions (line 622)**

`s.parent === parentName` → `s.parentId === parentName`

**Step 4: Update type-based member lookup (line 639)**

`s.parent === variable.type` → resolve type to id first:

```typescript
const typeSymbol = symbols.find((s) => s.name === variable.type);
const typeId = typeSymbol?.id ?? variable.type;
members = symbols.filter((s) => s.parentId === typeId);
```

**Step 5: Update getGlobalCompletions (line 783)**

`!s.parent` → `!s.parentId`

**Step 6: Run completion tests**

Run: `npx vitest run src/display/__tests__/completionProvider.test.ts`
Expected: All pass

**Step 7: Commit**

```
refactor: migrate CompletionProvider from parent to parentId
```

---

### Task 7: Migrate HoverProvider

**Files:**

- Test: `src/display/__tests__/hoverProvider.test.ts`
- Modify: `src/display/HoverProvider.ts`

**Step 1: Update resolveDisplayParent**

- Line 330: `s.fullName === parent` → `s.id === parentId` (rename param too)
- Line 337: `parentSymbol?.parent` → `parentSymbol?.parentId`
- Line 339: `parentSymbol.parent` → `parentSymbol.parentId`

**Step 2: Update buildSymbolHover call (lines 554-556)**

`symbol.parent ? resolveDisplayParent(symbol.parent, ...)` →
`symbol.parentId ? resolveDisplayParent(symbol.parentId, ...)`

**Step 3: Update buildVariableHover (line 416)**

`symbol.parent ? "field" : "variable"` → `symbol.parentId ? "field" : "variable"`

**Step 4: Run hover tests**

Run: `npx vitest run src/display/__tests__/hoverProvider.test.ts`
Expected: All pass

**Step 5: Commit**

```
refactor: migrate HoverProvider from parent/fullName to parentId/id
```

---

### Task 8: Update WorkspaceScanner to pass through id/parentId

**Files:**

- Modify: `src/state/WorkspaceScanner.ts`

**Step 1: Add id/parentId to symbol mapping (line 147-158)**

```typescript
const symbolsWithFile: ISymbolInfo[] = result.symbols.map((s) => ({
  id: s.id, // NEW
  parentId: s.parentId, // NEW
  name: s.name,
  fullName: s.fullName,
  kind: s.kind,
  type: s.type,
  parent: s.parent,
  signature: s.signature,
  accessModifier: s.accessModifier,
  line: s.line ?? 0,
  size: s.size,
  sourceFile: uri.fsPath,
}));
```

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All pass

**Step 3: Commit**

```
feat: pass through id/parentId from server in WorkspaceScanner
```

---

### Task 9: Update integration tests for new server fields

**Files:**

- Modify: `src/server/__tests__/serverClient.integration.test.ts`

**Step 1: Add assertions for id/parentId in existing tests**

In "parses scope with fields and methods":

```typescript
expect(led!.id).toBe("LED");
expect(pin!.id).toBe("LED.pin");
expect(pin!.parentId).toBe("LED");
```

In "preserves parent relationships":

```typescript
expect(init!.id).toBe("Driver.init");
expect(init!.parentId).toBe("Driver");
```

In "parses enum with members":

```typescript
const red = members.find((m) => m.name === "Red");
expect(red!.id).toBe("Color.Red");
expect(red!.parentId).toBe("Color");
```

**Step 2: Run integration tests**

Run: `npx vitest run src/server/__tests__/serverClient.integration.test.ts`
Expected: All pass (requires cnext v0.2.1+)

**Step 3: Commit**

```
test: assert id/parentId in server integration tests
```

---

### Task 10: Final verification and cleanup

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Run linter and formatter**

Run: `npm run lint && npm run prettier:check`
Expected: Clean

**Step 3: Update design doc status**

In `docs/plans/2026-02-17-symbol-id-design.md`, change status from "Waiting on c-next transpiler changes" to "Implemented".

**Step 4: Commit**

```
docs: mark symbol ID migration as implemented
```
