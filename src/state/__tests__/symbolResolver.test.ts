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
  const id = overrides.id ?? (overrides.parent
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

function makeMockWorkspaceIndex(
  overrides: Partial<{
    getAllSymbols: () => ISymbolInfo[];
    findDefinition: (
      name: string,
      fromFile?: Uri,
      parent?: string,
    ) => ISymbolInfo | undefined;
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

    it("does not resolve to wrong scope when multiple scopes share method name", () => {
      // Bug reproduction: SensorProcessor.initialize() was resolving to
      // TimingDebugHandler.initialize() because the fallback dropped the
      // parent constraint and returned the first name match.
      const timingInit = makeSymbol({
        name: "initialize",
        fullName: "TimingDebugHandler_initialize",
        kind: "function",
        parent: "TimingDebugHandler",
        line: 22,
        sourceFile: "/project/TimingDebugHandler.cnx",
      });

      const mockWI = makeMockWorkspaceIndex({
        // Only TimingDebugHandler's symbols are indexed —
        // SensorProcessor's are missing (simulates indexing gap)
        getAllSymbols: vi.fn().mockReturnValue([timingInit]),
        findDefinition: vi.fn(
          (name: string, _fromFile?: unknown, parent?: string) => {
            // Real findDefinition: filters by parent when provided
            const all = [timingInit];
            return all.find(
              (s) => s.name === name && (parent ? s.parent === parent : true),
            );
          },
        ),
      });
      const resolver = new SymbolResolver(mockWI);

      // "  SensorProcessor.initialize();" — word is "initialize", charBefore is '.'
      const result = resolver.resolveAtPosition(
        "        SensorProcessor.initialize();",
        "initialize",
        { startCharacter: 24 },
        "",
        0,
        [],
        Uri.file("/project/ossm.cnx"),
      );

      // Must NOT resolve to TimingDebugHandler's initialize
      // Returning undefined is correct; returning wrong scope is a bug
      if (result) {
        expect(result.parent).toBe("SensorProcessor");
        expect(result.sourceFile).not.toBe("/project/TimingDebugHandler.cnx");
      }
    });

    it("fallback passes parent to findDefinition for correct scope resolution", () => {
      // When getAllSymbols misses the symbol but findDefinition
      // can find it via name + parent matching
      const sensorInit = makeSymbol({
        name: "initialize",
        fullName: "SensorProcessor_initialize",
        kind: "function",
        parent: "SensorProcessor",
        line: 104,
        sourceFile: "/project/SensorProcessor.cnx",
      });

      const mockWI = makeMockWorkspaceIndex({
        // getAllSymbols returns nothing (simulates indexing gap)
        getAllSymbols: vi.fn().mockReturnValue([]),
        findDefinition: vi.fn(
          (name: string, _fromFile?: unknown, parent?: string) => {
            const all = [sensorInit];
            return all.find(
              (s) => s.name === name && (parent ? s.parent === parent : true),
            );
          },
        ),
      });
      const resolver = new SymbolResolver(mockWI);

      const result = resolver.resolveAtPosition(
        "        SensorProcessor.initialize();",
        "initialize",
        { startCharacter: 24 },
        "",
        0,
        [],
        Uri.file("/project/ossm.cnx"),
      );

      expect(result).toBeDefined();
      expect(result!.name).toBe("initialize");
      expect(result!.parent).toBe("SensorProcessor");
      expect(result!.sourceFile).toBe("/project/SensorProcessor.cnx");
      expect(result!.source).toBe("workspace");
      expect(mockWI.findDefinition).toHaveBeenCalledWith(
        "initialize",
        expect.anything(),
        "SensorProcessor",
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

    it("resolves typed variable chain: ['current'] → type name for struct member lookup", () => {
      const resolver = new SymbolResolver(null);
      const source = [
        "scope SensorValues {",
        "  public TSensorValue current;",
        "  public void init() {",
        "    current.value;",
        "  }",
        "}",
      ].join("\n");

      const localSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "SensorValues",
          fullName: "SensorValues",
          kind: "namespace",
          line: 1,
        }),
        makeSymbol({
          name: "current",
          fullName: "SensorValues_current",
          kind: "variable",
          type: "TSensorValue",
          parent: "SensorValues",
          line: 2,
        }),
        // Struct fields (extracted from source by caller)
        makeSymbol({
          name: "value",
          fullName: "TSensorValue_value",
          kind: "field",
          type: "f32",
          parent: "TSensorValue",
          line: 10,
        }),
      ];

      const result = resolver.resolveChain(
        ["current"],
        source,
        3,
        localSymbols,
        Uri.file("/test/file.cnx"),
      );

      // Should resolve "current" → look up type → "TSensorValue"
      expect(result).toBe("TSensorValue");
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
