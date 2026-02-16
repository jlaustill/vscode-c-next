# Architecture Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize `src/` into `server/`, `state/`, `display/`, and `constants/` layers with a new SymbolResolver service that unifies symbol resolution across all providers.

**Architecture:** Three-layer separation: `server/` (transpiler communication), `state/` (symbol indexing, caching, resolution), `display/` (VS Code providers, UI). A new `SymbolResolver` class in `state/` encapsulates all symbol resolution logic — dot extraction, `this`/`global`, full chain resolution, cross-file lookup — so providers become thin formatting wrappers. WorkspaceIndex splits into WorkspaceScanner (indexing) + WorkspaceIndex (facade) + SymbolResolver (queries).

**Tech Stack:** TypeScript, VS Code Extension API, vitest, ts-morph MCP (for file moves + import updates), esbuild

**Design doc:** `docs/plans/architecture.md`

---

## Phase 1: Move files into new folders (no logic changes)

All moves use ts-morph `rename_filesystem_entry_by_tsmorph` to auto-update import paths. tsconfig is at `/home/linux/code/vscode-c-next/tsconfig.json`.

### Task 1: Move workspace/ to state/

**Files:**
- Move: `src/workspace/WorkspaceIndex.ts` → `src/state/WorkspaceIndex.ts`
- Move: `src/workspace/SymbolCache.ts` → `src/state/SymbolCache.ts`
- Move: `src/workspace/IncludeResolver.ts` → `src/state/IncludeResolver.ts`
- Move: `src/workspace/types.ts` → `src/state/types.ts`

**Step 1: Create state/ directory**

Run: `mkdir -p src/state`

**Step 2: Move all 4 files with ts-morph**

Use `rename_filesystem_entry_by_tsmorph` with all 4 renames in a single call:
- `src/workspace/WorkspaceIndex.ts` → `src/state/WorkspaceIndex.ts`
- `src/workspace/SymbolCache.ts` → `src/state/SymbolCache.ts`
- `src/workspace/IncludeResolver.ts` → `src/state/IncludeResolver.ts`
- `src/workspace/types.ts` → `src/state/types.ts`

This auto-updates imports in: `extension.ts`, `completionProvider.ts`, integration test helpers, etc.

**Step 3: Remove empty workspace/ directory**

Run: `rmdir src/workspace`

**Step 4: Verify**

Run: `npm run compile && npm test`
Expected: All pass, no import errors.

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: move workspace/ to state/ layer"
```

---

### Task 2: Move ScopeTracker into state/

**Files:**
- Move: `src/scopeTracker.ts` → `src/state/ScopeTracker.ts`

**Step 1: Move with ts-morph**

Use `rename_filesystem_entry_by_tsmorph`:
- `src/scopeTracker.ts` → `src/state/ScopeTracker.ts`

Auto-updates imports in: `completionProvider.ts`, `hoverProvider.ts`, `scopeTracker.test.ts`.

**Step 2: Verify**

Run: `npm run compile && npm test`

**Step 3: Commit**

```bash
git add -A && git commit -m "refactor: move ScopeTracker into state/ layer"
```

---

### Task 3: Move providers into display/

**Files:**
- Move: `src/completionProvider.ts` → `src/display/CompletionProvider.ts`
- Move: `src/hoverProvider.ts` → `src/display/HoverProvider.ts`
- Move: `src/definitionProvider.ts` → `src/display/DefinitionProvider.ts`
- Move: `src/previewProvider.ts` → `src/display/PreviewProvider.ts`

**Step 1: Create display/ directory**

Run: `mkdir -p src/display`

**Step 2: Move all 4 files with ts-morph**

Use `rename_filesystem_entry_by_tsmorph` with all 4 renames:
- `src/completionProvider.ts` → `src/display/CompletionProvider.ts`
- `src/hoverProvider.ts` → `src/display/HoverProvider.ts`
- `src/definitionProvider.ts` → `src/display/DefinitionProvider.ts`
- `src/previewProvider.ts` → `src/display/PreviewProvider.ts`

Auto-updates imports in: `extension.ts`, all test files.

**Step 3: Verify**

Run: `npm run compile && npm test`

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: move providers into display/ layer"
```

---

### Task 4: Split utils.ts into state/utils.ts + display/utils.ts

This cannot use ts-morph file rename because we're splitting one file into two. Use `move_symbol_to_file_by_tsmorph` for each symbol, or manual creation + import fixup.

**Files:**
- Create: `src/state/utils.ts` — symbol resolution primitives
- Create: `src/display/utils.ts` — display/formatting helpers
- Delete: `src/utils.ts` (after all symbols moved)

**Step 1: Create state/utils.ts with symbol-related exports**

Use `move_symbol_to_file_by_tsmorph` to move each symbol from `src/utils.ts` to `src/state/utils.ts`, one at a time. Move these symbols in order:

1. `isWordChar` (FunctionDeclaration)
2. `extractTrailingWord` (FunctionDeclaration)
3. `parseMemberAccessChain` (FunctionDeclaration)
4. `stripComments` (FunctionDeclaration)
5. `isCommentLine` (FunctionDeclaration)
6. `countBraceChange` (FunctionDeclaration)
7. `BraceState` (InterfaceDeclaration)
8. `trackBraces` (FunctionDeclaration)
9. `IMinimalSymbol` (InterfaceDeclaration)
10. `findSymbolByName` (FunctionDeclaration)
11. `findSymbolByFullName` (FunctionDeclaration)
12. `findSymbolWithFallback` (FunctionDeclaration)
13. `concatParentName` (FunctionDeclaration)
14. `buildQualifiedName` (FunctionDeclaration)
15. `resolveChainStart` (FunctionDeclaration)
16. `resolveNextParent` (FunctionDeclaration)

**Step 2: Create display/utils.ts with display-related exports**

Use `move_symbol_to_file_by_tsmorph` to move remaining symbols from `src/utils.ts` to `src/display/utils.ts`:

1. `getAccessDescription` (FunctionDeclaration)
2. `getCompletionLabel` (FunctionDeclaration)
3. `escapeRegex` (FunctionDeclaration)
4. `findOutputPath` (FunctionDeclaration) — note: this uses `import * as fs from "node:fs"`, ensure the import moves too
5. `C_FUNCTION_DECLARATION_PATTERN` (VariableStatement)
6. `INDENTED_LINE_PATTERN` (VariableStatement)
7. `INDENTATION_PATTERN` (VariableStatement)

**Step 3: Delete src/utils.ts**

After all symbols are moved, `src/utils.ts` should be empty (except possibly the `fs` import). Delete it.

Run: `rm src/utils.ts`

**Step 4: Verify no remaining imports of old utils**

Run: `grep -r 'from.*["\']\.\/utils' src/ --include='*.ts'` — should return nothing (or only from `state/` and `display/` internal references).

**Step 5: Verify**

Run: `npm run compile && npm test`

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor: split utils.ts into state/utils.ts + display/utils.ts"
```

---

### Task 5: Extract constants into src/constants/

**Files:**
- Create: `src/constants/diagnosticDebounceMs.ts`
- Create: `src/constants/editorSwitchDebounceMs.ts`
- Create: `src/constants/cacheCleanupIntervalMs.ts`
- Create: `src/constants/maxGlobalCompletionItems.ts`
- Create: `src/constants/minPrefixLengthForCppQuery.ts`
- Create: `src/constants/cFunctionDeclarationPattern.ts`
- Create: `src/constants/indentedLinePattern.ts`
- Create: `src/constants/indentationPattern.ts`

Note: By this point, constants live in either `state/utils.ts` or `display/utils.ts` after the split in Task 4. The timing constants (`DIAGNOSTIC_DEBOUNCE_MS`, `EDITOR_SWITCH_DEBOUNCE_MS`) were imported directly by `extension.ts` from the old `utils.ts` — after Task 4, check where they ended up and move them from there.

**Step 1: Create constants/ directory**

Run: `mkdir -p src/constants`

**Step 2: Move each constant using move_symbol_to_file_by_tsmorph**

Move each constant (VariableStatement) from its current file to the appropriate constants file. The 5 numeric constants that were in the original utils.ts need to be located first — they may be in `display/utils.ts` or `state/utils.ts` after the split. The 3 regex pattern constants are in `display/utils.ts`.

Constants to move:
1. `DIAGNOSTIC_DEBOUNCE_MS` → `src/constants/diagnosticDebounceMs.ts`
2. `EDITOR_SWITCH_DEBOUNCE_MS` → `src/constants/editorSwitchDebounceMs.ts`
3. `CACHE_CLEANUP_INTERVAL_MS` → `src/constants/cacheCleanupIntervalMs.ts`
4. `MAX_GLOBAL_COMPLETION_ITEMS` → `src/constants/maxGlobalCompletionItems.ts`
5. `MIN_PREFIX_LENGTH_FOR_CPP_QUERY` → `src/constants/minPrefixLengthForCppQuery.ts`
6. `C_FUNCTION_DECLARATION_PATTERN` → `src/constants/cFunctionDeclarationPattern.ts`
7. `INDENTED_LINE_PATTERN` → `src/constants/indentedLinePattern.ts`
8. `INDENTATION_PATTERN` → `src/constants/indentationPattern.ts`

**Step 3: Verify**

Run: `npm run compile && npm test`

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: extract constants into src/constants/ one-per-file"
```

---

### Task 6: Move tests to colocated __tests__/ folders

**Files:**
- Move: `src/__tests__/scopeTracker.test.ts` → `src/state/__tests__/scopeTracker.test.ts`
- Move: `src/__tests__/workspaceIndex.test.ts` → `src/state/__tests__/workspaceIndex.test.ts`
- Move: `src/__tests__/includeResolver.test.ts` → `src/state/__tests__/includeResolver.test.ts`
- Move: `src/__tests__/utils.test.ts` → needs splitting (see below)
- Move: `src/__tests__/completionProvider.test.ts` → `src/display/__tests__/completionProvider.test.ts`
- Move: `src/__tests__/hoverProvider.test.ts` → `src/display/__tests__/hoverProvider.test.ts`
- Move: `src/__tests__/previewHighlight.test.ts` → `src/display/__tests__/previewHighlight.test.ts`
- Move: `src/__tests__/integration/serverClient.integration.test.ts` → `src/server/__tests__/serverClient.integration.test.ts`
- Move: `src/__tests__/integration/workspaceIndex.integration.test.ts` → `src/state/__tests__/workspaceIndex.integration.test.ts`
- Move: `src/__tests__/integration/completionFlow.integration.test.ts` → `src/display/__tests__/completionFlow.integration.test.ts`
- Move: `src/__tests__/integration/helpers.ts` → `src/__tests__/helpers.ts` (shared, stays at root)
- Keep: `src/__tests__/integration/fixtures/` → `src/__tests__/fixtures/` (shared fixtures)

**Step 1: Create __tests__/ directories**

Run: `mkdir -p src/state/__tests__ src/display/__tests__ src/server/__tests__`

**Step 2: Move test files with ts-morph**

Use `rename_filesystem_entry_by_tsmorph` in batches. Tests import from source files, so ts-morph will update the relative paths.

Batch 1 — state tests:
- `src/__tests__/scopeTracker.test.ts` → `src/state/__tests__/scopeTracker.test.ts`
- `src/__tests__/workspaceIndex.test.ts` → `src/state/__tests__/workspaceIndex.test.ts`
- `src/__tests__/includeResolver.test.ts` → `src/state/__tests__/includeResolver.test.ts`
- `src/__tests__/integration/workspaceIndex.integration.test.ts` → `src/state/__tests__/workspaceIndex.integration.test.ts`

Batch 2 — display tests:
- `src/__tests__/completionProvider.test.ts` → `src/display/__tests__/completionProvider.test.ts`
- `src/__tests__/hoverProvider.test.ts` → `src/display/__tests__/hoverProvider.test.ts`
- `src/__tests__/previewHighlight.test.ts` → `src/display/__tests__/previewHighlight.test.ts`
- `src/__tests__/integration/completionFlow.integration.test.ts` → `src/display/__tests__/completionFlow.integration.test.ts`

Batch 3 — server tests:
- `src/__tests__/integration/serverClient.integration.test.ts` → `src/server/__tests__/serverClient.integration.test.ts`

Batch 4 — shared test infra:
- `src/__tests__/integration/helpers.ts` → `src/__tests__/helpers.ts`
- Move `src/__tests__/integration/fixtures/` → `src/__tests__/fixtures/`

**Step 3: Split utils.test.ts**

Read `src/__tests__/utils.test.ts` and split tests based on which utils file they now test:
- Tests for `findSymbolByName`, `extractTrailingWord`, `parseMemberAccessChain`, `stripComments`, `resolveChainStart`, etc. → `src/state/__tests__/utils.test.ts`
- Tests for `getAccessDescription`, `getCompletionLabel`, `escapeRegex`, `findOutputPath`, etc. → `src/display/__tests__/utils.test.ts`

Update import paths in each split file to import from `../utils`.

**Step 4: Clean up empty directories**

Run: `rm -rf src/__tests__/integration` (should be empty after all moves)

**Step 5: Update sonar-project.properties**

The test pattern `sonar.tests=src/__tests__` is no longer valid since tests are now colocated. Update:

```properties
sonar.tests=src
sonar.test.inclusions=**/__tests__/**
```

The `sonar.test.inclusions` pattern already uses `**/__tests__/**` which matches colocated tests.

**Step 6: Verify vitest still discovers all tests**

The vitest config pattern `src/**/*.test.ts` already matches colocated tests — no change needed.

Run: `npm test`
Expected: All tests discovered and passing. Same count as before.

**Step 7: Commit**

```bash
git add -A && git commit -m "refactor: colocate tests with source in __tests__/ folders"
```

---

## Phase 2: Extract WorkspaceScanner and StatusBar

### Task 7: Extract WorkspaceScanner from WorkspaceIndex

**Files:**
- Create: `src/state/WorkspaceScanner.ts`
- Modify: `src/state/WorkspaceIndex.ts`

**Step 1: Create WorkspaceScanner with extracted methods**

Create `src/state/WorkspaceScanner.ts`. Move the following methods out of WorkspaceIndex using `move_symbol_to_file_by_tsmorph` or manual extraction (since these are class methods, manual is likely needed):

Methods to extract:
- `indexWorkspace()` (lines 118-142)
- `indexFolder()` (lines 147-168)
- `indexFile()` (lines 174-253)
- `indexHeaderFile()` (lines 258-295)
- `isExcluded()` (lines 300-311)
- `invalidateDependentFiles()` (lines 454-460)
- `processPendingChanges()` (lines 465-484)

Properties to move:
- `includeDependencies: Map<string, string[]>`
- `indexing: boolean`
- `fileChangeTimer: NodeJS.Timeout | null`
- `pendingChanges: Set<string>`

Constructor params: `cache: SymbolCache`, `headerCache: SymbolCache`, `includeResolver: IncludeResolver`, `serverClient: CNextServerClient | null`

```typescript
// src/state/WorkspaceScanner.ts
import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import SymbolCache from "./SymbolCache";
import IncludeResolver from "./IncludeResolver";
import { IWorkspaceConfig, ISymbolInfo } from "./types";
import CNextServerClient from "../server/CNextServerClient";

export default class WorkspaceScanner {
  private indexing = false;
  private fileChangeTimer: NodeJS.Timeout | null = null;
  private readonly pendingChanges = new Set<string>();
  readonly includeDependencies = new Map<string, string[]>();

  constructor(
    private readonly cache: SymbolCache,
    private readonly headerCache: SymbolCache,
    private readonly includeResolver: IncludeResolver,
    private readonly config: IWorkspaceConfig,
    private serverClient: CNextServerClient | null,
  ) {}

  setServerClient(client: CNextServerClient): void {
    this.serverClient = client;
  }

  // ... all extracted methods (indexWorkspace, indexFolder, indexFile,
  //     indexHeaderFile, isExcluded, invalidateDependentFiles,
  //     processPendingChanges, onFileChanged, onFileCreated, onFileDeleted)
}
```

**Step 2: Update WorkspaceIndex to delegate to WorkspaceScanner**

WorkspaceIndex constructor creates a WorkspaceScanner. Public methods delegate:
- `initialize()` → calls `scanner.indexWorkspace()` (via `scanner.scanFolders(folders)`)
- `onFileChanged/Created/Deleted()` → `scanner.onFileChanged/Created/Deleted()`
- `reindex()` → clears caches, calls `scanner.scanFolders()`

WorkspaceIndex retains:
- Singleton pattern (`getInstance()`)
- Cache references (passed to scanner + resolver)
- Query methods (`findDefinition`, `getAllSymbols`, `getIncludedSymbols`, etc.)
- `dispose()`

**Step 3: Verify**

Run: `npm run compile && npm test`

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: extract WorkspaceScanner from WorkspaceIndex"
```

---

### Task 8: Extract StatusBar into display/

**Files:**
- Create: `src/display/StatusBar.ts`
- Modify: `src/state/WorkspaceIndex.ts`
- Modify: `src/extension.ts`

**Step 1: Create StatusBar class**

```typescript
// src/display/StatusBar.ts
import * as vscode from "vscode";

export default class StatusBar {
  private statusBarItem: vscode.StatusBarItem | null = null;

  setStatusBarItem(item: vscode.StatusBarItem): void {
    this.statusBarItem = item;
  }

  update(text: string): void {
    if (this.statusBarItem) {
      this.statusBarItem.text = text;
    }
  }
}
```

**Step 2: Update WorkspaceIndex**

Remove `statusBarItem` property, `setStatusBarItem()`, and `updateStatusBar()` from WorkspaceIndex. Instead, accept a `StatusBar` instance or a callback `(text: string) => void` in the constructor/initialize, and call it where `updateStatusBar()` was called.

**Step 3: Update extension.ts**

Where `workspaceIndex.setStatusBarItem(statusBarItem)` is called, create a `StatusBar` instance and pass it to WorkspaceIndex instead.

**Step 4: Verify**

Run: `npm run compile && npm test`

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: extract StatusBar into display/ layer"
```

---

## Phase 3: Create SymbolResolver

### Task 9: Write SymbolResolver with TDD — resolveAtPosition (single-level dot access)

**Files:**
- Create: `src/state/SymbolResolver.ts`
- Create: `src/state/__tests__/symbolResolver.test.ts`

**Step 1: Write the failing test for basic symbol resolution**

```typescript
// src/state/__tests__/symbolResolver.test.ts
import { describe, it, expect, vi } from "vitest";
import SymbolResolver from "../SymbolResolver";
import type { ISymbolInfo } from "../types";

function makeSymbol(overrides: Partial<ISymbolInfo> & { name: string }): ISymbolInfo {
  return {
    fullName: overrides.name,
    kind: "function",
    line: 1,
    ...overrides,
  };
}

describe("SymbolResolver", () => {
  describe("resolveAtPosition", () => {
    it("resolves a top-level symbol from local symbols", () => {
      const symbols: ISymbolInfo[] = [
        makeSymbol({ name: "setup", fullName: "setup", kind: "function", line: 7 }),
      ];
      const resolver = new SymbolResolver(null as any);
      const result = resolver.resolveAtPosition(
        "    setup();",          // lineText
        "setup",                 // word
        { startCharacter: 4 },   // wordRange
        "",                      // documentSource
        7,                       // cursorLine
        symbols,                 // localSymbols
        { fsPath: "/test.cnx" } as any, // documentUri
      );
      expect(result).toBeDefined();
      expect(result!.name).toBe("setup");
      expect(result!.source).toBe("local");
    });

    it("resolves a member access like Ossm.setup", () => {
      const symbols: ISymbolInfo[] = [
        makeSymbol({ name: "Ossm", kind: "namespace", line: 1 }),
        makeSymbol({ name: "setup", parent: "Ossm", fullName: "Ossm_setup", kind: "function", line: 5 }),
      ];
      const resolver = new SymbolResolver(null as any);
      const result = resolver.resolveAtPosition(
        "    Ossm.setup();",
        "setup",
        { startCharacter: 9 },
        "",
        8,
        symbols,
        { fsPath: "/test.cnx" } as any,
      );
      expect(result).toBeDefined();
      expect(result!.name).toBe("setup");
      expect(result!.parent).toBe("Ossm");
      expect(result!.source).toBe("local");
    });

    it("resolves a scope name before the dot like Ossm in Ossm.setup", () => {
      const symbols: ISymbolInfo[] = [
        makeSymbol({ name: "Ossm", kind: "namespace", line: 1 }),
        makeSymbol({ name: "setup", parent: "Ossm", fullName: "Ossm_setup", kind: "function", line: 5 }),
      ];
      const resolver = new SymbolResolver(null as any);
      const result = resolver.resolveAtPosition(
        "    Ossm.setup();",
        "Ossm",
        { startCharacter: 4 },
        "",
        8,
        symbols,
        { fsPath: "/test.cnx" } as any,
      );
      expect(result).toBeDefined();
      expect(result!.name).toBe("Ossm");
      expect(result!.kind).toBe("namespace");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/state/__tests__/symbolResolver.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal SymbolResolver implementation**

```typescript
// src/state/SymbolResolver.ts
import * as vscode from "vscode";
import type { ISymbolInfo } from "./types";
import { extractTrailingWord, findSymbolByName, findSymbolWithFallback } from "./utils";
import type WorkspaceIndex from "./WorkspaceIndex";

export interface IResolvedSymbol extends ISymbolInfo {
  source: "local" | "workspace";
}

export default class SymbolResolver {
  constructor(private readonly workspaceIndex: WorkspaceIndex) {}

  resolveAtPosition(
    lineText: string,
    word: string,
    wordRange: { startCharacter: number },
    documentSource: string,
    cursorLine: number,
    localSymbols: ISymbolInfo[],
    documentUri: vscode.Uri,
  ): IResolvedSymbol | undefined {
    // Extract parent from dot access
    const charBefore =
      wordRange.startCharacter > 0
        ? lineText.charAt(wordRange.startCharacter - 1)
        : "";

    let parentName: string | undefined;
    if (charBefore === ".") {
      const beforeDot = lineText.substring(0, wordRange.startCharacter - 1);
      const trailingWord = extractTrailingWord(beforeDot);
      if (trailingWord) {
        parentName = trailingWord;
      }
    }

    // Search local symbols
    let symbol: ISymbolInfo | undefined;
    if (parentName) {
      symbol = findSymbolByName(localSymbols, word, parentName);
    } else {
      symbol = findSymbolWithFallback(localSymbols, word);
    }

    if (symbol) {
      return { ...symbol, source: "local" };
    }

    return undefined;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/state/__tests__/symbolResolver.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add SymbolResolver with basic local symbol resolution"
```

---

### Task 10: Add this/global resolution to SymbolResolver

**Files:**
- Modify: `src/state/__tests__/symbolResolver.test.ts`
- Modify: `src/state/SymbolResolver.ts`

**Step 1: Write failing tests**

Add to `symbolResolver.test.ts`:

```typescript
it("resolves this.foo to current scope member", () => {
  const source = "scope MyScope {\n  void foo() {\n    this.bar();\n  }\n}";
  const symbols: ISymbolInfo[] = [
    makeSymbol({ name: "MyScope", kind: "namespace", line: 1 }),
    makeSymbol({ name: "bar", parent: "MyScope", fullName: "MyScope_bar", kind: "function", line: 3 }),
  ];
  const resolver = new SymbolResolver(null as any);
  const result = resolver.resolveAtPosition(
    "    this.bar();",
    "bar",
    { startCharacter: 9 },
    source,
    3,
    symbols,
    { fsPath: "/test.cnx" } as any,
  );
  expect(result).toBeDefined();
  expect(result!.name).toBe("bar");
  expect(result!.parent).toBe("MyScope");
});

it("resolves global.Foo to top-level symbol", () => {
  const symbols: ISymbolInfo[] = [
    makeSymbol({ name: "Foo", kind: "namespace", line: 1 }),
  ];
  const resolver = new SymbolResolver(null as any);
  const result = resolver.resolveAtPosition(
    "    global.Foo.bar();",
    "Foo",
    { startCharacter: 11 },
    "scope Inner {\n  global.Foo.bar();\n}",
    2,
    symbols,
    { fsPath: "/test.cnx" } as any,
  );
  expect(result).toBeDefined();
  expect(result!.name).toBe("Foo");
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/__tests__/symbolResolver.test.ts`
Expected: FAIL — `this` not resolved to scope

**Step 3: Add this/global resolution**

In `resolveAtPosition`, after extracting `parentName`, add:

```typescript
import ScopeTracker from "./ScopeTracker";

// Resolve this/global
if (parentName === "this") {
  const enclosingScope = ScopeTracker.getCurrentScope(documentSource, cursorLine);
  if (enclosingScope) {
    parentName = enclosingScope;
  }
} else if (parentName === "global") {
  parentName = undefined;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state/__tests__/symbolResolver.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add this/global resolution to SymbolResolver"
```

---

### Task 11: Add cross-file resolution to SymbolResolver

**Files:**
- Modify: `src/state/__tests__/symbolResolver.test.ts`
- Modify: `src/state/SymbolResolver.ts`

**Step 1: Write failing tests**

```typescript
it("falls back to workspace for cross-file symbol", () => {
  const mockWorkspaceIndex = {
    findDefinition: vi.fn().mockReturnValue(
      makeSymbol({ name: "Motor", kind: "namespace", line: 5, sourceFile: "/other.cnx" }),
    ),
    getAllSymbols: vi.fn().mockReturnValue([]),
  };
  const resolver = new SymbolResolver(mockWorkspaceIndex as any);
  const result = resolver.resolveAtPosition(
    "    Motor.start();",
    "Motor",
    { startCharacter: 4 },
    "",
    1,
    [], // no local symbols
    { fsPath: "/main.cnx" } as any,
  );
  expect(result).toBeDefined();
  expect(result!.name).toBe("Motor");
  expect(result!.source).toBe("workspace");
});

it("resolves cross-file member access with parent", () => {
  const motorSetup = makeSymbol({
    name: "setup", parent: "Motor", fullName: "Motor_setup",
    kind: "function", line: 10, sourceFile: "/motor.cnx",
  });
  const mockWorkspaceIndex = {
    findDefinition: vi.fn().mockReturnValue(undefined),
    getAllSymbols: vi.fn().mockReturnValue([motorSetup]),
  };
  const resolver = new SymbolResolver(mockWorkspaceIndex as any);
  const result = resolver.resolveAtPosition(
    "    Motor.setup();",
    "setup",
    { startCharacter: 10 },
    "",
    1,
    [],
    { fsPath: "/main.cnx" } as any,
  );
  expect(result).toBeDefined();
  expect(result!.name).toBe("setup");
  expect(result!.parent).toBe("Motor");
  expect(result!.source).toBe("workspace");
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/state/__tests__/symbolResolver.test.ts`

**Step 3: Add cross-file resolution**

After local symbol search, add workspace fallback:

```typescript
// Cross-file: search workspace with parent awareness
if (this.workspaceIndex) {
  if (parentName) {
    const wsSymbol = findSymbolByName(
      this.workspaceIndex.getAllSymbols(), word, parentName
    );
    if (wsSymbol) return { ...wsSymbol, source: "workspace" };
  }

  const wsSymbol = this.workspaceIndex.findDefinition(word, documentUri);
  if (wsSymbol) return { ...wsSymbol, source: "workspace" };
}
```

**Step 4: Run tests**

Run: `npx vitest run src/state/__tests__/symbolResolver.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add cross-file resolution to SymbolResolver"
```

---

### Task 12: Add full chain resolution to SymbolResolver

**Files:**
- Modify: `src/state/__tests__/symbolResolver.test.ts`
- Modify: `src/state/SymbolResolver.ts`

**Step 1: Write failing tests for resolveChain and findMembers**

```typescript
describe("resolveChain", () => {
  it("resolves this.GPIO7.DataRegister chain", () => {
    const symbols: ISymbolInfo[] = [
      makeSymbol({ name: "MyScope", kind: "namespace", line: 1 }),
      makeSymbol({ name: "GPIO7", parent: "MyScope", kind: "register", fullName: "MyScope_GPIO7", line: 2 }),
      makeSymbol({ name: "DataRegister", parent: "MyScope_GPIO7", kind: "register", fullName: "MyScope_GPIO7_DataRegister", line: 3 }),
      makeSymbol({ name: "SET", parent: "MyScope_GPIO7_DataRegister", kind: "field", fullName: "MyScope_GPIO7_DataRegister_SET", line: 4 }),
    ];
    const resolver = new SymbolResolver(null as any);
    const result = resolver.resolveChain(
      ["this", "GPIO7", "DataRegister"],
      "scope MyScope {\n  this.GPIO7.DataRegister.SET;\n}",
      2,
      symbols,
      { fsPath: "/test.cnx" } as any,
    );
    expect(result).toBe("MyScope_GPIO7_DataRegister");
  });
});

describe("findMembers", () => {
  it("returns all symbols with matching parent", () => {
    const symbols: ISymbolInfo[] = [
      makeSymbol({ name: "setup", parent: "Ossm", line: 1 }),
      makeSymbol({ name: "loop", parent: "Ossm", line: 2 }),
      makeSymbol({ name: "main", line: 3 }),
    ];
    const mockWorkspaceIndex = {
      getAllSymbols: vi.fn().mockReturnValue([]),
      getIncludedSymbols: vi.fn().mockReturnValue([]),
    };
    const resolver = new SymbolResolver(mockWorkspaceIndex as any);
    const result = resolver.findMembers(
      "Ossm", symbols, { fsPath: "/test.cnx" } as any,
    );
    expect(result).toHaveLength(2);
    expect(result.map(s => s.name)).toEqual(["setup", "loop"]);
  });
});
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/state/__tests__/symbolResolver.test.ts`

**Step 3: Implement resolveChain and findMembers**

Port the chain resolution logic from CompletionProvider's `resolveChainedAccess()` (lines 476-533). Use the existing `resolveChainStart()` and `resolveNextParent()` utilities from `state/utils.ts`.

```typescript
resolveChain(
  chain: string[],
  documentSource: string,
  cursorLine: number,
  localSymbols: ISymbolInfo[],
  documentUri: vscode.Uri,
): string | undefined {
  if (chain.length === 0) return undefined;

  const currentScope = ScopeTracker.getCurrentScope(documentSource, cursorLine);
  const start = resolveChainStart(chain[0], currentScope);
  if (!start) return undefined;

  const allSymbols = this.mergeSymbols(localSymbols, documentUri);
  let parent = start.parent;

  for (let i = start.startIndex; i < chain.length; i++) {
    const member = chain[i];
    const symbol = findSymbolByName(allSymbols, member, parent || undefined);
    if (!symbol) {
      parent = concatParentName(parent, member);
      continue;
    }
    parent = resolveNextParent(symbol, parent, member, currentScope, allSymbols);
  }

  return parent || undefined;
}

findMembers(
  parentName: string,
  localSymbols: ISymbolInfo[],
  documentUri: vscode.Uri,
): ISymbolInfo[] {
  const allSymbols = this.mergeSymbols(localSymbols, documentUri);
  return allSymbols.filter((s) => s.parent === parentName);
}

private mergeSymbols(localSymbols: ISymbolInfo[], documentUri: vscode.Uri): ISymbolInfo[] {
  if (!this.workspaceIndex) return localSymbols;
  const workspaceSymbols = this.workspaceIndex.getAllSymbols();
  const includedSymbols = this.workspaceIndex.getIncludedSymbols(documentUri);
  return [...localSymbols, ...workspaceSymbols, ...includedSymbols];
}
```

**Step 4: Run tests**

Run: `npx vitest run src/state/__tests__/symbolResolver.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add chain resolution and findMembers to SymbolResolver"
```

---

## Phase 4: Refactor providers to use SymbolResolver

### Task 13: Refactor DefinitionProvider to use SymbolResolver

**Files:**
- Modify: `src/display/DefinitionProvider.ts`
- Create: `src/display/__tests__/definitionProvider.test.ts`

**Step 1: Write failing test for the fixed behavior**

```typescript
// src/display/__tests__/definitionProvider.test.ts
import { describe, it, expect, vi } from "vitest";
import CNextDefinitionProvider from "../DefinitionProvider";

// Test that Ossm.setup() resolves to the cross-file definition
describe("CNextDefinitionProvider", () => {
  it("resolves member access to cross-file definition", async () => {
    // ... mock document with "    Ossm.setup();" at position
    // ... mock resolver.resolveAtPosition returning symbol with sourceFile
    // ... verify provideDefinition returns Location pointing to sourceFile
  });
});
```

The exact test implementation depends on the vscode mock structure. Reference `src/__mocks__/vscode.ts` and existing `hoverProvider.test.ts` for patterns.

**Step 2: Refactor DefinitionProvider**

Replace the inline resolution logic with a call to `SymbolResolver.resolveAtPosition()`. The provider simplifies to:

1. Get word and wordRange at position
2. Call `serverClient.parseSymbols()` for local symbols
3. Call `resolver.resolveAtPosition(lineText, word, wordRange, source, line, symbols, uri)`
4. Convert `IResolvedSymbol` to `vscode.Location`

Remove: `findLocalSymbol()` method (logic now in SymbolResolver).
Keep: `createLocation()`, `createLocationFromFile()` (formatting concern).

Update constructor to accept `SymbolResolver`:

```typescript
constructor(
  private readonly resolver: SymbolResolver,
  private readonly extensionContext?: CNextExtensionContext,
) {}
```

**Step 3: Update extension.ts**

Where DefinitionProvider is constructed, pass the SymbolResolver instance:

```typescript
const resolver = new SymbolResolver(workspaceIndex);
const definitionProvider = vscode.languages.registerDefinitionProvider(
  "cnext",
  new CNextDefinitionProvider(resolver, extensionContext),
);
```

**Step 4: Verify**

Run: `npm run compile && npm test`

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: DefinitionProvider uses SymbolResolver for all resolution"
```

---

### Task 14: Refactor HoverProvider to use SymbolResolver

**Files:**
- Modify: `src/display/HoverProvider.ts`
- Modify: `src/display/__tests__/hoverProvider.test.ts`

**Step 1: Replace resolution block with SymbolResolver**

In `provideHover()`, replace lines that do:
- Dot extraction (charBefore, extractTrailingWord)
- `this`/`global` resolution (ScopeTracker calls)
- `findSymbolByName(symbols, word, parentName)`
- `findSymbolByName(workspaceIndex.getAllSymbols(), word, parentName)`
- `findSymbolWithFallback(symbols, word)`
- `workspaceIndex.findDefinition(word, document.uri)`

With a single call:

```typescript
const resolved = this.resolver.resolveAtPosition(
  lineText, word, { startCharacter: wordRange.start.character },
  source, position.line, symbols, document.uri,
);
```

Keep all hover formatting logic (`buildSymbolHover`, `resolveDisplayParent`, etc.).

Update constructor to accept `SymbolResolver`.

**Step 2: Update extension.ts**

Pass the same `SymbolResolver` instance to HoverProvider.

**Step 3: Run existing hover tests**

Run: `npx vitest run src/display/__tests__/hoverProvider.test.ts`
Expected: PASS — behavior unchanged

**Step 4: Verify full suite**

Run: `npm run compile && npm test`

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: HoverProvider uses SymbolResolver for resolution"
```

---

### Task 15: Refactor CompletionProvider to use SymbolResolver

**Files:**
- Modify: `src/display/CompletionProvider.ts`
- Modify: `src/display/__tests__/completionProvider.test.ts`

**Step 1: Replace chain resolution with SymbolResolver**

In CompletionProvider, replace:
- `resolveChainedAccess()` method (lines 476-533) with `resolver.resolveChain()`
- Member symbol filtering with `resolver.findMembers()`
- Direct `ScopeTracker.getCurrentScope()` calls for `this`/`global` (handled by resolver)

Keep:
- `getMemberCompletions()` structure (it formats CompletionItems)
- `getGlobalCompletions()` (top-level completions, different concern)
- All CompletionItem creation/sorting logic

Update constructor to accept `SymbolResolver`.

**Step 2: Update extension.ts**

Pass the same `SymbolResolver` instance to CompletionProvider.

**Step 3: Run existing completion tests**

Run: `npx vitest run src/display/__tests__/completionProvider.test.ts`
Expected: PASS

**Step 4: Run integration tests**

Run: `npm test`
Expected: All pass

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: CompletionProvider uses SymbolResolver for chain resolution"
```

---

### Task 16: Final cleanup and verification

**Step 1: Remove dead code**

Check for any orphaned imports or unused functions in providers that were replaced by SymbolResolver calls. Run:

Run: `npm run lint`

Fix any unused import warnings.

**Step 2: Run full verification**

Run: `npm run compile && npm run lint && npm run prettier:check && npm test`

**Step 3: Verify the original bug is fixed**

The original issue — Ctrl+Click on `Ossm.setup()` not working — should now be resolved because:
- DefinitionProvider calls `resolver.resolveAtPosition()` which handles parent-aware cross-file lookup
- `resolveAtPosition` detects `parentName = "Ossm"`, searches workspace symbols for `name === "setup" && parent === "Ossm"`
- Returns the symbol from `ossm.cnx` with `sourceFile` set

**Step 4: Final commit**

```bash
git add -A && git commit -m "refactor: clean up dead code after SymbolResolver migration"
```
