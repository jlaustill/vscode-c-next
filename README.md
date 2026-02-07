# C-Next for VS Code

VS Code extension for [C-Next](https://github.com/jlaustill/c-next), a safer C for embedded systems.

## Features

- **Syntax Highlighting** - Full syntax highlighting for `.cnx` files
- **Live C Preview** - See transpiled C code in real-time as you type
- **IntelliSense** - Autocomplete for keywords, types, scopes, and symbols
- **Go to Definition** - Jump to symbol definitions (Ctrl+Click or F12)
- **Hover Information** - See type info and documentation on hover
- **Error Diagnostics** - Real-time error detection and reporting
- **Snippets** - Common code patterns for quick insertion

## Requirements

This extension requires the C-Next transpiler to be installed:

```bash
npm install -g @jlaustill/cnext
```

Or install it locally in your project:

```bash
npm install --save-dev @jlaustill/cnext
```

## Extension Settings

| Setting                          | Default                       | Description                                          |
| -------------------------------- | ----------------------------- | ---------------------------------------------------- |
| `cnext.serverPath`               | `""`                          | Custom path to cnext binary (auto-detected if empty) |
| `cnext.serverTimeout`            | `30000`                       | Request timeout in milliseconds                      |
| `cnext.transpile.generateCFile`  | `true`                        | Auto-generate .c file alongside .cnx                 |
| `cnext.transpile.updateDelay`    | `500`                         | Delay before updating generated .c file              |
| `cnext.preview.updateDelay`      | `300`                         | Delay before updating preview                        |
| `cnext.preview.showLineNumbers`  | `true`                        | Show line numbers in preview                         |
| `cnext.includePaths`             | `[]`                          | Additional include paths for headers                 |
| `cnext.sdkIncludePaths`          | `[]`                          | SDK include paths (e.g., Teensy, STM32)              |
| `cnext.indexing.excludePatterns` | `["**/node_modules/**", ...]` | Patterns to exclude from indexing                    |

## Commands

| Command                          | Keybinding     | Description                      |
| -------------------------------- | -------------- | -------------------------------- |
| C-Next: Open Preview             | `Ctrl+Shift+V` | Open C preview in current editor |
| C-Next: Open Preview to the Side | `Ctrl+K V`     | Open C preview in split view     |

## Architecture

This extension communicates with the C-Next transpiler via a JSON-RPC server (`cnext --serve`). This provides:

- **Crash Isolation** - Transpiler crashes don't affect VS Code
- **Memory Isolation** - Transpiler memory is tracked separately
- **Small Bundle** - Extension is ~100KB (no parser bundled)

## Graceful Degradation

If the transpiler is not installed, the extension still provides:

- Syntax highlighting
- Snippets
- Language configuration (brackets, comments)

A warning will prompt you to install the transpiler for full functionality.

## Contributing

1. Clone this repository
2. Run `npm install`
3. Open in VS Code and press F5 to debug
4. Make changes and test

## License

MIT - See [LICENSE](LICENSE) for details.

## Related

- [C-Next Transpiler](https://github.com/jlaustill/c-next) - The C-Next language and transpiler
- [C-Next Documentation](https://github.com/jlaustill/c-next/blob/main/docs/learn-cnext-in-y-minutes.md) - Learn C-Next syntax
