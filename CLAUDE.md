# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code extension for C-Next, a safer C for embedded systems. Provides syntax highlighting, live C preview, IntelliSense, and error diagnostics for `.cnx` files. The extension communicates with the C-Next transpiler via JSON-RPC (`cnext --serve`).

## Commands

```bash
npm run compile       # Bundle TypeScript with esbuild
npm run watch         # Watch mode for development
npm run lint          # Run ESLint
npm run lint:fix      # Auto-fix linting issues
npm run prettier:check # Check formatting
npm run prettier:fix  # Auto-format code
npm test              # Run Vitest tests
npm run package       # Create .vsix package
```

To debug: Open in VS Code and press F5.

## Architecture

### Extension Activation Flow

1. Start `CNextServerClient` (JSON-RPC to `cnext --serve` binary)
2. Initialize `WorkspaceIndex` for cross-file symbol lookup
3. Register IDE providers (completion, hover, definition, preview)
4. Set up file watchers and event handlers

### Key Components

| Component          | File                               | Purpose                                                  |
| ------------------ | ---------------------------------- | -------------------------------------------------------- |
| CNextServerClient  | `src/server/CNextServerClient.ts`  | JSON-RPC client to transpiler; spawns `cnext --serve`    |
| WorkspaceIndex     | `src/workspace/WorkspaceIndex.ts`  | Singleton for workspace-wide symbol indexing             |
| SymbolCache        | `src/workspace/SymbolCache.ts`     | Per-file symbol caching with staleness detection         |
| IncludeResolver    | `src/workspace/IncludeResolver.ts` | Resolves `#include` to file paths; blocks path traversal |
| CompletionProvider | `src/completionProvider.ts`        | IntelliSense for keywords, types, symbols                |
| HoverProvider      | `src/hoverProvider.ts`             | Tooltips with type info and documentation                |
| DefinitionProvider | `src/definitionProvider.ts`        | Go-to-definition (Ctrl+Click, F12)                       |
| PreviewProvider    | `src/previewProvider.ts`           | Live C preview webview with scroll sync                  |

### Dependency Injection

- `ExtensionContext` (`src/ExtensionContext.ts`) provides shared access to server client
- `WorkspaceIndex` is a singleton with `setServerClient()` for late binding
- Providers receive context for server access

### Document Processing

- **Validation**: `serverClient.transpile()` on open + debounced on change → diagnostics
- **Transpilation**: Debounced 500ms → writes `.c`/`.cpp` output file
- **Indexing**: `serverClient.parseSymbols()` → stores in SymbolCache
- **Preview**: Debounced 300ms → shows transpiled C in webview

### Graceful Degradation

Without transpiler: syntax highlighting + snippets still work. Server crash: auto-restart once.

## Testing

Tests are in `src/__tests__/*.test.ts`. Run single test file:

```bash
npx vitest run src/__tests__/utils.test.ts
```

## C-Next Transpiler

The extension requires the C-Next transpiler:

```bash
npm install -g @jlaustill/cnext       # global
npm install --save-dev @jlaustill/cnext  # local
```

Server discovery order: custom path setting → workspace `node_modules` → global PATH.

## File Structure

```
src/
├── extension.ts          # Main entry, orchestration, event handlers
├── ExtensionContext.ts   # Shared context/DI
├── server/               # JSON-RPC client
├── workspace/            # Indexing, caching, include resolution
├── *Provider.ts          # IDE feature providers
└── __tests__/            # Vitest tests
syntaxes/                 # TextMate grammar
snippets/                 # Code snippets
```
