import { describe, it, expect, vi } from "vitest";
import * as vscode from "vscode";
import CNextHoverProvider from "../HoverProvider";
import SymbolResolver from "../../state/SymbolResolver";
import type CNextExtensionContext from "../../ExtensionContext";

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

describe("CNextHoverProvider", () => {
  describe("this. qualifier resolution", () => {
    it("resolves this.field to enclosing scope via ScopeTracker", async () => {
      // Source: scope LED with a "pin" field, cursor on "pin" in "this.pin"
      const source = [
        "scope LED {",
        "  u8 pin;",
        "  public void on() {",
        "    this.pin;",
        "  }",
        "}",
      ].join("\n");

      const symbols = [
        {
          name: "LED",
          fullName: "LED",
          id: "LED",
          kind: "namespace",
          line: 1,
        },
        {
          name: "pin",
          fullName: "LED_pin",
          id: "LED.pin",
          parentId: "LED",
          kind: "field",
          type: "u8",
          parent: "LED",
          line: 2,
        },
        {
          name: "on",
          fullName: "LED_on",
          id: "LED.on",
          parentId: "LED",
          kind: "function",
          type: "void",
          parent: "LED",
          signature: "void LED_on()",
          line: 3,
        },
      ];

      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols,
      }));

      const provider = new CNextHoverProvider(
        new SymbolResolver(null),
        undefined,
        mockCtx,
      );

      // Cursor on "pin" in "    this.pin;" (line 3, character 9 = 'p' of pin)
      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/test/led.cnx"),
        fileName: "/test/led.cnx",
      });
      const position = new vscode.Position(3, 9);
      const token = vscode.createMockCancellationToken();

      const hover = await provider.provideHover(document, position, token);

      expect(hover).not.toBeNull();
      // The hover should be for LED.pin (field), not just "pin"
      const md = hover!.contents as vscode.MarkdownString;
      expect(md.value).toContain("field");
      expect(md.value).toContain("pin");
      expect(md.value).toContain("u8");
    });

    it("does not resolve this.field when outside any scope", async () => {
      // Source: this.something at global level (no enclosing scope)
      const source = "this.something;";

      // Only a scope member exists — no global "something"
      const symbols = [
        {
          name: "LED",
          fullName: "LED",
          id: "LED",
          kind: "namespace",
          line: 1,
        },
        {
          name: "something",
          fullName: "LED_something",
          id: "LED.something",
          parentId: "LED",
          kind: "field",
          type: "u8",
          parent: "LED",
          line: 2,
        },
      ];

      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols,
      }));

      const provider = new CNextHoverProvider(
        new SymbolResolver(null),
        undefined,
        mockCtx,
      );

      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/test/global.cnx"),
        fileName: "/test/global.cnx",
      });
      // Cursor on "something" in "this.something;" (line 0, character 5)
      const position = new vscode.Position(0, 5);
      const token = vscode.createMockCancellationToken();

      const hover = await provider.provideHover(document, position, token);

      // ScopeTracker returns null → parentName stays "this" →
      // findSymbolByName looks for parent="this" → no match →
      // falls through to C/C++ fallback → returns null (no output file)
      expect(hover).toBeNull();
    });

    it("resolves global.X to top-level scope", async () => {
      const source = "global.counter;";

      const symbols = [
        {
          name: "counter",
          fullName: "counter",
          kind: "variable",
          type: "u32",
          line: 1,
        },
      ];

      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols,
      }));

      const provider = new CNextHoverProvider(
        new SymbolResolver(null),
        undefined,
        mockCtx,
      );

      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/test/global.cnx"),
        fileName: "/test/global.cnx",
      });
      // Cursor on "counter" in "global.counter;" (line 0, character 7)
      const position = new vscode.Position(0, 7);
      const token = vscode.createMockCancellationToken();

      const hover = await provider.provideHover(document, position, token);

      expect(hover).not.toBeNull();
      const md = hover!.contents as vscode.MarkdownString;
      expect(md.value).toContain("counter");
      expect(md.value).toContain("u32");
    });
  });

  describe("keyword hover", () => {
    it("returns hover for C-Next keywords", async () => {
      const source = "scope LED {";

      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols: [],
      }));

      const provider = new CNextHoverProvider(
        new SymbolResolver(null),
        undefined,
        mockCtx,
      );

      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/test/test.cnx"),
        fileName: "/test/test.cnx",
      });
      // Cursor on "scope" (line 0, character 0)
      const position = new vscode.Position(0, 0);
      const token = vscode.createMockCancellationToken();

      const hover = await provider.provideHover(document, position, token);

      expect(hover).not.toBeNull();
      const md = hover!.contents as vscode.MarkdownString;
      expect(md.value).toContain("keyword");
      expect(md.value).toContain("scope");
    });
  });

  describe("type hover", () => {
    it("returns hover for primitive types", async () => {
      const source = "u32 counter;";

      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols: [],
      }));

      const provider = new CNextHoverProvider(
        new SymbolResolver(null),
        undefined,
        mockCtx,
      );

      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/test/test.cnx"),
        fileName: "/test/test.cnx",
      });
      // Cursor on "u32" (line 0, character 0)
      const position = new vscode.Position(0, 0);
      const token = vscode.createMockCancellationToken();

      const hover = await provider.provideHover(document, position, token);

      expect(hover).not.toBeNull();
      const md = hover!.contents as vscode.MarkdownString;
      expect(md.value).toContain("type");
      expect(md.value).toContain("u32");
      expect(md.value).toContain("32");
    });
  });

  describe("C library function hover", () => {
    it("returns hover for C library functions like fgets", async () => {
      const source = "fgets(buf, 10, stream);";

      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols: [],
      }));

      const provider = new CNextHoverProvider(
        new SymbolResolver(null),
        undefined,
        mockCtx,
      );

      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/test/test.cnx"),
        fileName: "/test/test.cnx",
      });
      const position = new vscode.Position(0, 0);
      const token = vscode.createMockCancellationToken();

      const hover = await provider.provideHover(document, position, token);

      expect(hover).not.toBeNull();
      const md = hover!.contents as vscode.MarkdownString;
      expect(md.value).toContain("fgets");
    });
  });

  describe("forbidden C function hover", () => {
    it("returns hover warning for forbidden functions like malloc", async () => {
      const source = "malloc(64);";

      const mockCtx = createMockExtensionContext(() => ({
        success: true,
        errors: [],
        symbols: [],
      }));

      const provider = new CNextHoverProvider(
        new SymbolResolver(null),
        undefined,
        mockCtx,
      );

      const document = vscode.createMockTextDocument({
        content: source,
        uri: vscode.Uri.file("/test/test.cnx"),
        fileName: "/test/test.cnx",
      });
      const position = new vscode.Position(0, 0);
      const token = vscode.createMockCancellationToken();

      const hover = await provider.provideHover(document, position, token);

      expect(hover).not.toBeNull();
      const md = hover!.contents as vscode.MarkdownString;
      expect(md.value).toContain("malloc");
      expect(md.value).toContain("forbidden");
    });
  });

  describe("cancellation", () => {
    it("returns null when token is cancelled", async () => {
      const provider = new CNextHoverProvider(new SymbolResolver(null));

      const document = vscode.createMockTextDocument({
        content: "u32 x;",
      });
      const position = new vscode.Position(0, 0);
      const token = vscode.createMockCancellationToken(true);

      const hover = await provider.provideHover(document, position, token);
      expect(hover).toBeNull();
    });
  });
});
