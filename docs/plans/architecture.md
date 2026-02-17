# Architecture Refactor: Layered Separation of Concerns

## Problem

The `src/` folder has no clear separation of concerns. Symbol resolution logic is duplicated across three providers (DefinitionProvider, HoverProvider, CompletionProvider) with varying levels of completeness. WorkspaceIndex bundles 6 responsibilities. The DefinitionProvider is missing parent-aware cross-file lookup, `this`/`global` resolution, and chain support — causing Ctrl+Click to fail on member access like `Ossm.setup()`.

## Design Decisions

- **Three layers**: `server/` (transpiler communication), `state/` (symbol indexing, caching, resolution), `display/` (VS Code providers, UI)
- **SymbolResolver service**: New class in `state/` that encapsulates all resolution logic. Providers delegate to it instead of reimplementing.
- **Resolution only**: SymbolResolver takes symbol arrays as input. Providers still own the `parseSymbols()` call.
- **Full chain resolution**: SymbolResolver supports `this.GPIO7.DataRegister.` style chains, ported from CompletionProvider.
- **Constants directory**: `src/constants/` with one file per constant for clean imports.
- **Colocated tests**: Each layer has its own `__tests__/` folder next to the source files.

## Target Structure

```
src/
├── extension.ts              # Activation, wiring, event handlers
├── ExtensionContext.ts        # DI container
├── server/
│   ├── CNextServerClient.ts
│   └── __tests__/
│       └── serverClient.integration.test.ts
├── constants/
│   ├── diagnosticDebounceMs.ts
│   ├── editorSwitchDebounceMs.ts
│   ├── cacheCleanupIntervalMs.ts
│   ├── maxGlobalCompletionItems.ts
│   ├── minPrefixLengthForCppQuery.ts
│   ├── cFunctionDeclarationPattern.ts
│   ├── indentedLinePattern.ts
│   └── indentationPattern.ts
├── state/
│   ├── types.ts              # ISymbolInfo, ICacheEntry, IWorkspaceConfig
│   ├── SymbolCache.ts        # Per-file symbol caching
│   ├── IncludeResolver.ts    # Include path resolution
│   ├── WorkspaceScanner.ts   # File discovery, indexing, file-change handling
│   ├── WorkspaceIndex.ts     # Thin facade: scanner + cache + resolver
│   ├── SymbolResolver.ts     # All resolution logic (chain, this/global, cross-file)
│   ├── ScopeTracker.ts       # Cursor scope detection
│   ├── utils.ts              # Symbol lookup primitives
│   └── __tests__/
│       ├── utils.test.ts
│       ├── scopeTracker.test.ts
│       ├── workspaceIndex.test.ts
│       ├── workspaceScanner.test.ts
│       ├── workspaceIndex.integration.test.ts
│       ├── includeResolver.test.ts
│       └── symbolResolver.test.ts
├── display/
│   ├── CompletionProvider.ts
│   ├── HoverProvider.ts
│   ├── DefinitionProvider.ts
│   ├── PreviewProvider.ts
│   ├── StatusBar.ts          # Extracted from WorkspaceIndex
│   ├── utils.ts              # Display helpers (findOutputPath, escapeRegex, etc.)
│   └── __tests__/
│       ├── utils.test.ts
│       ├── completionProvider.test.ts
│       ├── hoverProvider.test.ts
│       ├── definitionProvider.test.ts
│       ├── previewHighlight.test.ts
│       ├── statusBar.test.ts
│       └── completionFlow.integration.test.ts
└── __mocks__/
    └── vscode.ts
```

## Component Responsibilities

### state/SymbolResolver

Central symbol resolution service. All providers delegate to it.

**API:**

- `resolveAtPosition(lineText, word, wordRange, documentSource, cursorLine, localSymbols, documentUri)` — Resolve the symbol at a cursor position. Handles dot access, `this`/`global`, full chain resolution, cross-file lookup. Used by DefinitionProvider, HoverProvider.
- `resolveChain(chain, documentSource, cursorLine, localSymbols, documentUri)` — Resolve a dot chain to its final parent name (e.g., `this.GPIO7.DataRegister.` -> `"DataRegister"`). Used by CompletionProvider for member completions.
- `findMembers(parentName, localSymbols, documentUri)` — Find all symbols matching a parent constraint. Used by CompletionProvider to list members after a dot.

**Internal flow of `resolveAtPosition`:**

1. Extract dot context from `lineText` (charBefore, `parseMemberAccessChain`)
2. Resolve `this` -> `ScopeTracker.getCurrentScope()`, `global` -> top-level
3. If chain detected, walk it with type-aware resolution
4. Search local symbols first with parent constraint (`findSymbolByName`)
5. Fall back to workspace symbols with same parent constraint
6. Fall back to `workspaceIndex.findDefinition()` for unqualified names

### state/WorkspaceScanner (extracted from WorkspaceIndex)

Owns file discovery and indexing:

- `indexWorkspace()` — recursive workspace scan
- `indexFolder()` — single folder scan
- `indexFile()` — parse single .cnx file via server, store in SymbolCache
- `indexHeaderFile()` — parse C/C++ header via server
- `isExcluded()` — glob pattern filtering
- `includeDependencies` Map — the dependency graph
- Circular include protection via `indexingStack`

Constructor params: `SymbolCache` (x2), `IncludeResolver`, `CNextServerClient`.

### state/WorkspaceIndex (slimmed facade)

Composes WorkspaceScanner, SymbolCache (x2), and SymbolResolver:

- `initialize()` — delegates to scanner
- `onFileChanged/Created/Deleted()` — delegates to scanner for re-indexing
- `reindex()` — clears caches, delegates to scanner
- `getStats()` — aggregates from caches
- `dispose()` — tears down everything
- Query methods (`findDefinition`, `getAllSymbols`, `getIncludedSymbols`) delegate to SymbolResolver for resolution logic

### display/StatusBar (extracted from WorkspaceIndex)

- `setStatusBarItem()`, `updateStatusBar()`
- WorkspaceIndex calls a callback or the StatusBar listens for events

## utils.ts Split

### state/utils.ts — Symbol resolution primitives

- `IMinimalSymbol` interface
- `findSymbolByName()`, `findSymbolByFullName()`, `findSymbolWithFallback()`
- `concatParentName()`, `buildQualifiedName()`
- `resolveChainStart()`, `resolveNextParent()`
- `isWordChar()`, `extractTrailingWord()`, `parseMemberAccessChain()`
- `stripComments()`, `isCommentLine()`
- `countBraceChange()`, `BraceState`, `trackBraces()`

### display/utils.ts — Display/formatting helpers

- `getAccessDescription()` — hover tooltip formatting
- `getCompletionLabel()` — completion item labels
- `escapeRegex()` — used in hover C output lookup
- `findOutputPath()` — output file resolution for preview/hover
- `C_FUNCTION_DECLARATION_PATTERN`, `INDENTED_LINE_PATTERN`, `INDENTATION_PATTERN`

## Provider Refactoring

### DefinitionProvider (biggest change)

Before: 180 lines with incomplete resolution, no `this`/`global`, no chain support.
After: Calls `resolver.resolveAtPosition()`, converts result to `vscode.Location`. ~80 lines.

### HoverProvider

Before: Inline `this`/`global` resolution, inline parent-aware workspace search.
After: Replace resolution block (lines 618-748) with `resolver.resolveAtPosition()`. Hover formatting logic stays.

### CompletionProvider

Before: Has its own `resolveChainedAccess()` and `resolveChainStart` calls.
After: Delegates chain resolution to `resolver.resolveChain()` and member listing to `resolver.findMembers()`. Completion item creation, sorting, filtering stays.

### PreviewProvider

No symbol resolution. Moves to `display/` with no logic changes.

### Division of responsibility

Providers keep ownership of:

- Calling `parseSymbols()` (parsing)
- Formatting results into VS Code API types (Location, Hover, CompletionItem)
- Provider-specific UX (debouncing, cancellation tokens, C++ extension fallback)

Providers delegate to SymbolResolver for:

- All symbol lookup logic
- `this`/`global`/chain resolution
- Local vs cross-file search ordering

## Migration Phases

Each phase is a separate commit with green tests.

### Phase 1: Move files into new folders (no logic changes)

- Create `state/`, `display/`, `constants/` directories
- Move existing files with ts-morph `rename_filesystem_entry` to auto-update imports
- Rename `workspace/` -> `state/` (files move as-is)
- Move providers + PreviewProvider into `display/`
- Move ScopeTracker into `state/`
- Split `utils.ts` into `state/utils.ts` + `display/utils.ts`
- Extract constants into `constants/` one-per-file
- Move tests to colocated `__tests__/` folders
- Verify: `npm run compile && npm test` passes

### Phase 2: Extract WorkspaceScanner from WorkspaceIndex

- Move indexing/scanning/file-watching methods into `state/WorkspaceScanner.ts`
- WorkspaceIndex becomes thin facade
- Extract StatusBar into `display/StatusBar.ts`
- Verify: `npm run compile && npm test` passes

### Phase 3: Create SymbolResolver

- Build `state/SymbolResolver.ts` with `resolveAtPosition()`, `resolveChain()`, `findMembers()`
- Port chain resolution logic from CompletionProvider
- Port `this`/`global` resolution from HoverProvider
- Write `state/__tests__/symbolResolver.test.ts`
- Verify: `npm run compile && npm test` passes

### Phase 4: Refactor providers to use SymbolResolver

- DefinitionProvider: replace inline resolution with `resolver.resolveAtPosition()`
- HoverProvider: replace resolution block with resolver calls
- CompletionProvider: replace `resolveChainedAccess()` with `resolver.resolveChain()` + `resolver.findMembers()`
- Write `display/__tests__/definitionProvider.test.ts` (currently zero tests)
- Verify: `npm run compile && npm test` passes
