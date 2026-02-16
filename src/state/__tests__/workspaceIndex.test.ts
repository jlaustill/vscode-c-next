import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import WorkspaceIndex from "../WorkspaceIndex";
import type { ISymbolInfo } from "../types";

/**
 * Helper to access private members for test setup.
 * WorkspaceIndex is a singleton with private caches, so we cast to any
 * to populate internal state without needing a running server client.
 */
function getInternals(index: WorkspaceIndex) {
  const raw = index as unknown as {
    cache: {
      set: (
        uri: vscode.Uri,
        symbols: ISymbolInfo[],
        mtime: number,
        hasErrors: boolean,
      ) => void;
      has: (uri: vscode.Uri) => boolean;
    };
    headerCache: {
      set: (
        uri: vscode.Uri,
        symbols: ISymbolInfo[],
        mtime: number,
        hasErrors: boolean,
      ) => void;
      has: (uri: vscode.Uri) => boolean;
    };
    includeDependencies: Map<string, string[]>;
  };
  return raw;
}

function makeSymbol(
  overrides: Partial<ISymbolInfo> & { name: string },
): ISymbolInfo {
  return {
    fullName: overrides.name,
    kind: "function",
    line: 1,
    ...overrides,
  };
}

describe("WorkspaceIndex", () => {
  let index: WorkspaceIndex;

  beforeEach(() => {
    // Reset singleton between tests
    const existing = WorkspaceIndex.getInstance();
    existing.dispose();
    index = WorkspaceIndex.getInstance();
  });

  afterEach(() => {
    index.dispose();
  });

  describe("getIncludedSymbols", () => {
    it("returns symbols from headerCache for .h includes", () => {
      const internals = getInternals(index);
      const mainUri = vscode.Uri.file("/project/main.cnx");
      const headerUri = vscode.Uri.file("/project/utils.h");

      const headerSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "helper_func",
          kind: "function",
          sourceFile: "/project/utils.h",
        }),
      ];

      internals.headerCache.set(headerUri, headerSymbols, Date.now(), false);
      internals.includeDependencies.set(mainUri.fsPath, ["/project/utils.h"]);

      const result = index.getIncludedSymbols(mainUri);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("helper_func");
    });

    it("returns symbols from main cache for .cnx includes", () => {
      const internals = getInternals(index);
      const mainUri = vscode.Uri.file("/project/main.cnx");
      const includedUri = vscode.Uri.file("/project/other.cnx");

      const cnxSymbols: ISymbolInfo[] = [
        makeSymbol({
          name: "LED",
          kind: "scope",
          sourceFile: "/project/other.cnx",
        }),
        makeSymbol({
          name: "toggle",
          kind: "function",
          parent: "LED",
          sourceFile: "/project/other.cnx",
        }),
      ];

      internals.cache.set(includedUri, cnxSymbols, Date.now(), false);
      internals.includeDependencies.set(mainUri.fsPath, ["/project/other.cnx"]);

      const result = index.getIncludedSymbols(mainUri);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("LED");
      expect(result[1].name).toBe("toggle");
    });

    it("returns symbols from both caches for mixed includes", () => {
      const internals = getInternals(index);
      const mainUri = vscode.Uri.file("/project/main.cnx");
      const cnxUri = vscode.Uri.file("/project/driver.cnx");
      const headerUri = vscode.Uri.file("/project/hal.h");

      internals.cache.set(
        cnxUri,
        [
          makeSymbol({
            name: "Driver",
            kind: "scope",
            sourceFile: "/project/driver.cnx",
          }),
        ],
        Date.now(),
        false,
      );
      internals.headerCache.set(
        headerUri,
        [
          makeSymbol({
            name: "HAL_Init",
            kind: "function",
            sourceFile: "/project/hal.h",
          }),
        ],
        Date.now(),
        false,
      );
      internals.includeDependencies.set(mainUri.fsPath, [
        "/project/driver.cnx",
        "/project/hal.h",
      ]);

      const result = index.getIncludedSymbols(mainUri);
      expect(result).toHaveLength(2);

      const names = result.map((s) => s.name);
      expect(names).toContain("Driver");
      expect(names).toContain("HAL_Init");
    });

    it("returns empty array when no includes exist", () => {
      const mainUri = vscode.Uri.file("/project/main.cnx");
      const result = index.getIncludedSymbols(mainUri);
      expect(result).toHaveLength(0);
    });

    it("skips missing cache entries gracefully", () => {
      const internals = getInternals(index);
      const mainUri = vscode.Uri.file("/project/main.cnx");

      // Include a .cnx that isn't in the cache
      internals.includeDependencies.set(mainUri.fsPath, [
        "/project/missing.cnx",
        "/project/missing.h",
      ]);

      const result = index.getIncludedSymbols(mainUri);
      expect(result).toHaveLength(0);
    });

    it("does not return .cnx symbols from headerCache", () => {
      const internals = getInternals(index);
      const mainUri = vscode.Uri.file("/project/main.cnx");
      const cnxUri = vscode.Uri.file("/project/other.cnx");

      // Mistakenly put .cnx symbols in headerCache (should not be found)
      internals.headerCache.set(
        cnxUri,
        [makeSymbol({ name: "WrongCache", kind: "scope" })],
        Date.now(),
        false,
      );
      internals.includeDependencies.set(mainUri.fsPath, ["/project/other.cnx"]);

      const result = index.getIncludedSymbols(mainUri);
      expect(result).toHaveLength(0);
    });
  });

  describe("onFileDeleted", () => {
    it("invalidates cache for deleted .cnx file", () => {
      const internals = getInternals(index);
      const fileUri = vscode.Uri.file("/project/deleted.cnx");

      internals.cache.set(
        fileUri,
        [makeSymbol({ name: "Foo", kind: "scope" })],
        Date.now(),
        false,
      );
      expect(internals.cache.has(fileUri)).toBe(true);

      index.onFileDeleted(fileUri);
      expect(internals.cache.has(fileUri)).toBe(false);
    });

    it("invalidates dependent files when a .cnx include is deleted", () => {
      const internals = getInternals(index);
      const parentUri = vscode.Uri.file("/project/parent.cnx");
      const childUri = vscode.Uri.file("/project/child.cnx");

      // Set up: parent includes child
      internals.cache.set(
        parentUri,
        [makeSymbol({ name: "Parent", kind: "scope" })],
        Date.now(),
        false,
      );
      internals.cache.set(
        childUri,
        [makeSymbol({ name: "Child", kind: "scope" })],
        Date.now(),
        false,
      );
      internals.includeDependencies.set(parentUri.fsPath, [childUri.fsPath]);

      // Delete child — parent should be invalidated
      index.onFileDeleted(childUri);
      expect(internals.cache.has(childUri)).toBe(false);
      expect(internals.cache.has(parentUri)).toBe(false);
    });

    it("invalidates dependent files when a .h header is deleted", () => {
      const internals = getInternals(index);
      const cnxUri = vscode.Uri.file("/project/main.cnx");
      const headerUri = vscode.Uri.file("/project/driver.h");

      internals.cache.set(
        cnxUri,
        [makeSymbol({ name: "Main", kind: "scope" })],
        Date.now(),
        false,
      );
      internals.headerCache.set(
        headerUri,
        [makeSymbol({ name: "driver_init", kind: "function" })],
        Date.now(),
        false,
      );
      internals.includeDependencies.set(cnxUri.fsPath, [headerUri.fsPath]);

      index.onFileDeleted(headerUri);
      expect(internals.headerCache.has(headerUri)).toBe(false);
      // Parent .cnx should also be invalidated
      expect(internals.cache.has(cnxUri)).toBe(false);
    });

    it("removes includeDependencies entry for deleted .cnx file", () => {
      const internals = getInternals(index);
      const fileUri = vscode.Uri.file("/project/deleted.cnx");

      internals.includeDependencies.set(fileUri.fsPath, ["/project/other.h"]);
      index.onFileDeleted(fileUri);
      expect(internals.includeDependencies.has(fileUri.fsPath)).toBe(false);
    });
  });

  describe("findDefinition", () => {
    it("finds symbols from included .cnx files via getIncludedSymbols", () => {
      const internals = getInternals(index);
      const mainUri = vscode.Uri.file("/project/main.cnx");
      const otherUri = vscode.Uri.file("/project/other.cnx");

      // other.cnx has a scope "Motor"
      internals.cache.set(
        otherUri,
        [
          makeSymbol({
            name: "Motor",
            kind: "scope",
            sourceFile: "/project/other.cnx",
          }),
        ],
        Date.now(),
        false,
      );
      internals.includeDependencies.set(mainUri.fsPath, ["/project/other.cnx"]);

      // findDefinition with fromFile should find Motor
      const result = index.findDefinition("Motor", mainUri);
      expect(result).toBeDefined();
      expect(result?.name).toBe("Motor");
      expect(result?.sourceFile).toBe("/project/other.cnx");
    });
  });
});
