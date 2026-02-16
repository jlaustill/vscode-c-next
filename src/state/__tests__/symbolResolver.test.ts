import { describe, it, expect, vi } from "vitest";
import { Uri } from "vscode";
import SymbolResolver from "../SymbolResolver";
import { ISymbolInfo } from "../types";
import type WorkspaceIndex from "../WorkspaceIndex";

// ============================================================================
// Helpers
// ============================================================================

function makeSymbol(
  overrides: Partial<ISymbolInfo> & { name: string },
): ISymbolInfo {
  return {
    fullName: overrides.fullName ?? overrides.name,
    kind: overrides.kind ?? "variable",
    line: overrides.line ?? 1,
    ...overrides,
  };
}

function makeMockWorkspaceIndex(
  overrides: Partial<{
    getAllSymbols: () => ISymbolInfo[];
    findDefinition: (name: string, fromFile?: Uri) => ISymbolInfo | undefined;
    getIncludedSymbols: (uri: Uri) => ISymbolInfo[];
  }> = {},
): WorkspaceIndex {
  return {
    getAllSymbols: overrides.getAllSymbols ?? (() => []),
    findDefinition: overrides.findDefinition ?? (() => undefined),
    getIncludedSymbols: overrides.getIncludedSymbols ?? (() => []),
  } as unknown as WorkspaceIndex;
}

// ============================================================================
// resolveAtPosition — basic
// ============================================================================

describe("SymbolResolver", () => {
  describe("resolveAtPosition — basic", () => {
    it("resolves a top-level symbol from local symbols", () => {
      const resolver = new SymbolResolver(null);
      const localSymbols: ISymbolInfo[] = [
        makeSymbol({ name: "counter", kind: "variable", type: "u32", line: 5 }),
      ];

      const result = resolver.resolveAtPosition(
        "  u32 counter <- 0;",
        "counter",
        { startCharacter: 6 },
        "",
        4,
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      expect(result).toBeDefined();
      expect(result!.name).toBe("counter");
      expect(result!.source).toBe("local");
    });

    it("resolves a member access like Ossm.setup (word='setup', charBefore='.')", () => {
      const resolver = new SymbolResolver(null);
      const localSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "Ossm",
          fullName: "Ossm",
          kind: "namespace",
          line: 1,
        }),
        makeSymbol({
          name: "setup",
          fullName: "Ossm_setup",
          kind: "function",
          parent: "Ossm",
          line: 3,
        }),
      ];

      // lineText: "  Ossm.setup();"
      // word: "setup", wordRange starts at char 7 => charBefore is '.'
      const result = resolver.resolveAtPosition(
        "  Ossm.setup();",
        "setup",
        { startCharacter: 7 },
        "",
        0,
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      expect(result).toBeDefined();
      expect(result!.name).toBe("setup");
      expect(result!.parent).toBe("Ossm");
      expect(result!.source).toBe("local");
    });

    it("resolves the scope name in Ossm.setup (word='Ossm', no dot)", () => {
      const resolver = new SymbolResolver(null);
      const localSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "Ossm",
          fullName: "Ossm",
          kind: "namespace",
          line: 1,
        }),
        makeSymbol({
          name: "setup",
          fullName: "Ossm_setup",
          kind: "function",
          parent: "Ossm",
          line: 3,
        }),
      ];

      const result = resolver.resolveAtPosition(
        "  Ossm.setup();",
        "Ossm",
        { startCharacter: 2 },
        "",
        0,
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      expect(result).toBeDefined();
      expect(result!.name).toBe("Ossm");
      expect(result!.kind).toBe("namespace");
      expect(result!.source).toBe("local");
    });

    it("returns undefined when symbol not found locally and no workspace", () => {
      const resolver = new SymbolResolver(null);
      const localSymbols: ISymbolInfo[] = [];

      const result = resolver.resolveAtPosition(
        "  unknown();",
        "unknown",
        { startCharacter: 2 },
        "",
        0,
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      expect(result).toBeUndefined();
    });
  });

  // ============================================================================
  // resolveAtPosition — this/global
  // ============================================================================

  describe("resolveAtPosition — this/global", () => {
    it("resolves this.foo to current scope member", () => {
      const resolver = new SymbolResolver(null);
      const source = [
        "scope LED {",
        "  public void toggle() {",
        "    this.on();",
        "  }",
        "  public void on() {}",
        "}",
      ].join("\n");

      const localSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "LED",
          fullName: "LED",
          kind: "namespace",
          line: 1,
        }),
        makeSymbol({
          name: "toggle",
          fullName: "LED_toggle",
          kind: "function",
          parent: "LED",
          line: 2,
        }),
        makeSymbol({
          name: "on",
          fullName: "LED_on",
          kind: "function",
          parent: "LED",
          line: 5,
        }),
      ];

      // "    this.on();" — cursor on "on" at line 2 (0-based), char 9
      const result = resolver.resolveAtPosition(
        "    this.on();",
        "on",
        { startCharacter: 9 },
        source,
        2,
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      expect(result).toBeDefined();
      expect(result!.name).toBe("on");
      expect(result!.parent).toBe("LED");
      expect(result!.source).toBe("local");
    });

    it("resolves global.Foo to top-level symbol", () => {
      const resolver = new SymbolResolver(null);
      const source = [
        "scope LED {",
        "  public void toggle() {",
        "    global.Foo();",
        "  }",
        "}",
      ].join("\n");

      const localSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "Foo",
          fullName: "Foo",
          kind: "namespace",
          line: 10,
        }),
      ];

      // "    global.Foo();" — cursor on "Foo" at line 2, char 11
      const result = resolver.resolveAtPosition(
        "    global.Foo();",
        "Foo",
        { startCharacter: 11 },
        source,
        2,
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      expect(result).toBeDefined();
      expect(result!.name).toBe("Foo");
      expect(result!.source).toBe("local");
    });
  });

  // ============================================================================
  // resolveAtPosition — cross-file
  // ============================================================================

  describe("resolveAtPosition — cross-file", () => {
    it("falls back to workspace for unknown symbol", () => {
      const workspaceSymbol = makeSymbol({
        name: "RemoteScope",
        fullName: "RemoteScope",
        kind: "namespace",
        line: 1,
        sourceFile: "/other/file.cnx",
      });

      const mockWI = makeMockWorkspaceIndex({
        findDefinition: vi.fn().mockReturnValue(workspaceSymbol),
      });
      const resolver = new SymbolResolver(mockWI);

      const result = resolver.resolveAtPosition(
        "  RemoteScope.init();",
        "RemoteScope",
        { startCharacter: 2 },
        "",
        0,
        [],
        Uri.file("/test/file.cnx"),
      );

      expect(result).toBeDefined();
      expect(result!.name).toBe("RemoteScope");
      expect(result!.source).toBe("workspace");
      expect(mockWI.findDefinition).toHaveBeenCalledWith(
        "RemoteScope",
        expect.anything(),
      );
    });

    it("resolves cross-file member access with parent awareness", () => {
      const memberSymbol = makeSymbol({
        name: "init",
        fullName: "RemoteScope_init",
        kind: "function",
        parent: "RemoteScope",
        line: 5,
        sourceFile: "/other/file.cnx",
      });

      const mockWI = makeMockWorkspaceIndex({
        getAllSymbols: vi.fn().mockReturnValue([memberSymbol]),
      });
      const resolver = new SymbolResolver(mockWI);

      // "  RemoteScope.init();" — word is "init", charBefore is '.'
      const result = resolver.resolveAtPosition(
        "  RemoteScope.init();",
        "init",
        { startCharacter: 14 },
        "",
        0,
        [],
        Uri.file("/test/file.cnx"),
      );

      expect(result).toBeDefined();
      expect(result!.name).toBe("init");
      expect(result!.parent).toBe("RemoteScope");
      expect(result!.source).toBe("workspace");
    });
  });

  // ============================================================================
  // resolveChain
  // ============================================================================

  describe("resolveChain", () => {
    it("resolves simple chain: ['Ossm'] → 'Ossm'", () => {
      const resolver = new SymbolResolver(null);
      const localSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "Ossm",
          fullName: "Ossm",
          kind: "namespace",
          line: 1,
        }),
      ];

      const result = resolver.resolveChain(
        ["Ossm"],
        "",
        0,
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      expect(result).toBe("Ossm");
    });

    it("resolves this chain: ['this', 'GPIO7'] with currentScope → scope_member parent", () => {
      const source = [
        "scope Teensy4 {",
        "  register GPIO7 {}",
        "  public void init() {",
        "    this.GPIO7.DataRegister;",
        "  }",
        "}",
      ].join("\n");

      const localSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "Teensy4",
          fullName: "Teensy4",
          kind: "namespace",
          line: 1,
        }),
        makeSymbol({
          name: "GPIO7",
          fullName: "Teensy4_GPIO7",
          kind: "register",
          parent: "Teensy4",
          line: 2,
        }),
      ];

      const resolver = new SymbolResolver(null);

      const result = resolver.resolveChain(
        ["this", "GPIO7"],
        source,
        3,
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      // "this" resolves to "Teensy4", then GPIO7 is a register under Teensy4
      // resolveNextParent for registers uses underscore concatenation: "Teensy4_GPIO7"
      expect(result).toBe("Teensy4_GPIO7");
    });

    it("resolves deep chain: ['this', 'GPIO7', 'DataRegister'] using resolveNextParent", () => {
      const source = [
        "scope Teensy4 {",
        "  register GPIO7 {",
        "    register DataRegister {}",
        "  }",
        "  public void init() {",
        "    this.GPIO7.DataRegister.field;",
        "  }",
        "}",
      ].join("\n");

      const localSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "Teensy4",
          fullName: "Teensy4",
          kind: "namespace",
          line: 1,
        }),
        makeSymbol({
          name: "GPIO7",
          fullName: "Teensy4_GPIO7",
          kind: "register",
          parent: "Teensy4",
          line: 2,
        }),
        makeSymbol({
          name: "DataRegister",
          fullName: "Teensy4_GPIO7_DataRegister",
          kind: "register",
          parent: "Teensy4_GPIO7",
          line: 3,
        }),
      ];

      const resolver = new SymbolResolver(null);

      const result = resolver.resolveChain(
        ["this", "GPIO7", "DataRegister"],
        source,
        5,
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      expect(result).toBe("Teensy4_GPIO7_DataRegister");
    });

    it("returns null for empty chain", () => {
      const resolver = new SymbolResolver(null);
      const result = resolver.resolveChain(
        [],
        "",
        0,
        [],
        Uri.file("/test/file.cnx"),
      );
      expect(result).toBeNull();
    });

    it("returns null when 'this' used outside a scope", () => {
      const resolver = new SymbolResolver(null);
      const result = resolver.resolveChain(
        ["this", "foo"],
        "// no scope here",
        0,
        [],
        Uri.file("/test/file.cnx"),
      );
      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // findMembers
  // ============================================================================

  describe("findMembers", () => {
    it("returns all symbols with matching parent from local symbols", () => {
      const resolver = new SymbolResolver(null);
      const localSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "LED",
          fullName: "LED",
          kind: "namespace",
          line: 1,
        }),
        makeSymbol({
          name: "on",
          fullName: "LED_on",
          kind: "function",
          parent: "LED",
          line: 2,
        }),
        makeSymbol({
          name: "off",
          fullName: "LED_off",
          kind: "function",
          parent: "LED",
          line: 3,
        }),
        makeSymbol({
          name: "unrelated",
          fullName: "unrelated",
          kind: "variable",
          line: 4,
        }),
      ];

      const result = resolver.findMembers(
        "LED",
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name).sort()).toEqual(["off", "on"]);
    });

    it("merges local + workspace symbols", () => {
      const workspaceMembers: ISymbolInfo[] = [
        makeSymbol({
          name: "remoteMethod",
          fullName: "Scope_remoteMethod",
          kind: "function",
          parent: "Scope",
          line: 10,
          sourceFile: "/other/file.cnx",
        }),
      ];

      const mockWI = makeMockWorkspaceIndex({
        getAllSymbols: vi.fn().mockReturnValue(workspaceMembers),
        getIncludedSymbols: vi.fn().mockReturnValue([]),
      });
      const resolver = new SymbolResolver(mockWI);

      const localSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "localMethod",
          fullName: "Scope_localMethod",
          kind: "function",
          parent: "Scope",
          line: 2,
        }),
      ];

      const result = resolver.findMembers(
        "Scope",
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      expect(result).toHaveLength(2);
      const names = result.map((s) => s.name).sort();
      expect(names).toEqual(["localMethod", "remoteMethod"]);
    });

    it("returns empty array when no matches", () => {
      const resolver = new SymbolResolver(null);
      const result = resolver.findMembers(
        "NonExistent",
        [],
        Uri.file("/test/file.cnx"),
      );
      expect(result).toEqual([]);
    });

    it("includes symbols from included files", () => {
      const includedSymbol = makeSymbol({
        name: "includedFn",
        fullName: "Scope_includedFn",
        kind: "function",
        parent: "Scope",
        line: 5,
        sourceFile: "/included/header.h",
      });

      const mockWI = makeMockWorkspaceIndex({
        getAllSymbols: vi.fn().mockReturnValue([]),
        getIncludedSymbols: vi.fn().mockReturnValue([includedSymbol]),
      });
      const resolver = new SymbolResolver(mockWI);

      const result = resolver.findMembers(
        "Scope",
        [],
        Uri.file("/test/file.cnx"),
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("includedFn");
    });

    it("deduplicates symbols that appear in both local and workspace", () => {
      const sharedSymbol = makeSymbol({
        name: "toggle",
        fullName: "LED_toggle",
        kind: "function",
        parent: "LED",
        line: 5,
      });

      const workspaceVersion = makeSymbol({
        name: "toggle",
        fullName: "LED_toggle",
        kind: "function",
        parent: "LED",
        line: 5,
        sourceFile: "/test/file.cnx",
      });

      const mockWI = makeMockWorkspaceIndex({
        getAllSymbols: vi.fn().mockReturnValue([workspaceVersion]),
        getIncludedSymbols: vi.fn().mockReturnValue([]),
      });
      const resolver = new SymbolResolver(mockWI);

      const result = resolver.findMembers(
        "LED",
        [sharedSymbol],
        Uri.file("/test/file.cnx"),
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("toggle");
    });
  });
});
