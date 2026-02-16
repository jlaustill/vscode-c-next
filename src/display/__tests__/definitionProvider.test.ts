import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import CNextDefinitionProvider from "../DefinitionProvider";
import SymbolResolver from "../../state/SymbolResolver";
import type CNextExtensionContext from "../../ExtensionContext";
import type { ISymbolInfo } from "../../state/types";

/**
 * Create a mock extension context with a parseSymbols stub
 */
function createMockExtensionContext(
  parseSymbolsFn: (...args: unknown[]) => unknown,
): CNextExtensionContext {
  return {
    outputChannel: vscode.createMockOutputChannel("Test"),
    lastGoodOutputPath: new Map(),
    serverClient: {
      parseSymbols: vi.fn(parseSymbolsFn),
      isRunning: () => true,
    },
    debug: () => {},
    setServerClient: () => {},
  } as unknown as CNextExtensionContext;
}

/**
 * Helper: build a simple SymbolResolver with a mock WorkspaceIndex
 */
function createResolver(workspaceSymbols: ISymbolInfo[] = []): SymbolResolver {
  const mockWorkspaceIndex = {
    findDefinition: vi.fn((name: string) => {
      return workspaceSymbols.find(
        (s) => s.name === name || s.fullName === name,
      );
    }),
    getAllSymbols: vi.fn(() => workspaceSymbols),
    getIncludedSymbols: vi.fn(() => []),
  };

  return new SymbolResolver(
    mockWorkspaceIndex as unknown as import("../../state/WorkspaceIndex").default,
  );
}

describe("CNextDefinitionProvider", () => {
  describe("top-level symbol resolution", () => {
    it("resolves a top-level symbol to a Location in the current document", async () => {
      const source = ["void setup() {", "  setup();", "}"].join("\n");

      const symbols: ISymbolInfo[] = [
        {
          name: "setup",
          fullName: "setup",
          kind: "function",
          type: "void",
          signature: "void setup()",
          line: 1,
        },
      ];

      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols,
      }));

      const resolver = createResolver();
      const provider = new CNextDefinitionProvider(resolver, mockCtx);

      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/test/main.cnx"),
        fileName: "/test/main.cnx",
      });

      // Cursor on "setup" in "  setup();" (line 1, character 2)
      const position = new vscode.Position(1, 2);
      const token = vscode.createMockCancellationToken();

      const result = await provider.provideDefinition(
        document,
        position,
        token,
      );

      expect(result).not.toBeNull();
      const location = result as vscode.Location;
      expect(location.uri.fsPath).toBe("/test/main.cnx");
      // Symbol is on line 0 (0-based), "void setup() {" — "setup" starts at index 5
      expect(location.range).toBeDefined();
      const range = location.range as vscode.Range;
      expect(range.start.line).toBe(0);
      expect(range.start.character).toBe(5);
      expect(range.end.character).toBe(10); // "setup" is 5 chars
    });
  });

  describe("member access resolution", () => {
    it("resolves Ossm.setup to a cross-file Location", async () => {
      const source = ["void main() {", "  Ossm.setup();", "}"].join("\n");

      const localSymbols: ISymbolInfo[] = [
        {
          name: "main",
          fullName: "main",
          kind: "function",
          type: "void",
          line: 1,
        },
      ];

      const workspaceSymbols: ISymbolInfo[] = [
        {
          name: "Ossm",
          fullName: "Ossm",
          kind: "namespace",
          line: 1,
          sourceFile: "/project/ossm.cnx",
        },
        {
          name: "setup",
          fullName: "Ossm_setup",
          kind: "function",
          type: "void",
          parent: "Ossm",
          signature: "void Ossm_setup()",
          line: 3,
          sourceFile: "/project/ossm.cnx",
        },
      ];

      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols: localSymbols,
      }));

      const resolver = createResolver(workspaceSymbols);
      const provider = new CNextDefinitionProvider(resolver, mockCtx);

      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/project/main.cnx"),
        fileName: "/project/main.cnx",
      });

      // Cursor on "setup" in "  Ossm.setup();" — line 1, character 7
      const position = new vscode.Position(1, 7);
      const token = vscode.createMockCancellationToken();

      const result = await provider.provideDefinition(
        document,
        position,
        token,
      );

      expect(result).not.toBeNull();
      const location = result as vscode.Location;
      // Cross-file: should point to ossm.cnx
      expect(location.uri.fsPath).toBe("/project/ossm.cnx");
    });
  });

  describe("null results", () => {
    it("returns null when symbol is not found", async () => {
      const source = "void main() {\n  unknown();\n}";

      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols: [
          {
            name: "main",
            fullName: "main",
            kind: "function",
            type: "void",
            line: 1,
          },
        ],
      }));

      const resolver = createResolver();
      const provider = new CNextDefinitionProvider(resolver, mockCtx);

      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/test/main.cnx"),
        fileName: "/test/main.cnx",
      });

      // Cursor on "unknown" — line 1, character 2
      const position = new vscode.Position(1, 2);
      const token = vscode.createMockCancellationToken();

      const result = await provider.provideDefinition(
        document,
        position,
        token,
      );
      expect(result).toBeNull();
    });

    it("returns null for a cancelled request", async () => {
      const resolver = createResolver();
      const provider = new CNextDefinitionProvider(resolver);

      const document = vscode.createMockTextDocument({
        content: "void main() {}",
        uri: vscode.Uri.file("/test/main.cnx"),
      });

      const position = new vscode.Position(0, 5);
      const token = vscode.createMockCancellationToken(true); // cancelled

      const result = await provider.provideDefinition(
        document,
        position,
        token,
      );
      expect(result).toBeNull();
    });

    it("returns null when cursor is on whitespace (no word range)", async () => {
      const resolver = createResolver();
      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols: [],
      }));

      const provider = new CNextDefinitionProvider(resolver, mockCtx);

      const document = vscode.createMockTextDocument({
        content: "  \n  ",
        uri: vscode.Uri.file("/test/empty.cnx"),
      });

      // Cursor on whitespace — line 0, character 0
      const position = new vscode.Position(0, 0);
      const token = vscode.createMockCancellationToken();

      const result = await provider.provideDefinition(
        document,
        position,
        token,
      );
      expect(result).toBeNull();
    });
  });

  describe("server unavailable", () => {
    it("still resolves via workspace when server returns no symbols", async () => {
      const source = "void main() {\n  setup();\n}";

      const workspaceSymbols: ISymbolInfo[] = [
        {
          name: "setup",
          fullName: "setup",
          kind: "function",
          type: "void",
          line: 5,
          sourceFile: "/project/other.cnx",
        },
      ];

      // Server returns no symbols (unavailable)
      const mockCtx = createMockExtensionContext(() => null);
      const resolver = createResolver(workspaceSymbols);
      const provider = new CNextDefinitionProvider(resolver, mockCtx);

      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/project/main.cnx"),
        fileName: "/project/main.cnx",
      });

      // Cursor on "setup" — line 1, character 2
      const position = new vscode.Position(1, 2);
      const token = vscode.createMockCancellationToken();

      const result = await provider.provideDefinition(
        document,
        position,
        token,
      );

      expect(result).not.toBeNull();
      const location = result as vscode.Location;
      expect(location.uri.fsPath).toBe("/project/other.cnx");
    });
  });
});
