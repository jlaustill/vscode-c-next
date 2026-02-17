import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as vscode from "vscode";
import CNextCompletionProvider, {
  mapToCompletionKind,
  type TSymbolKind,
} from "../CompletionProvider";
import type { ISymbolInfo } from "../../server/CNextServerClient";
import WorkspaceIndex from "../../state/WorkspaceIndex";
import SymbolResolver from "../../state/SymbolResolver";

describe("CNextCompletionProvider", () => {
  it("should not write debug files to /tmp", () => {
    const source = fs.readFileSync(
      new URL("../CompletionProvider.ts", import.meta.url),
      "utf-8",
    );
    expect(source).not.toContain("/tmp/cnext-completions.txt");
    expect(source).not.toContain("/tmp/cnext-workspace-symbols.txt");
  });
});

describe("mapToCompletionKind", () => {
  it("maps namespace to Module", () => {
    expect(mapToCompletionKind("namespace")).toBe(
      vscode.CompletionItemKind.Module,
    );
  });

  it("maps scope to Module", () => {
    expect(mapToCompletionKind("scope")).toBe(vscode.CompletionItemKind.Module);
  });

  it("maps class to Module", () => {
    expect(mapToCompletionKind("class")).toBe(vscode.CompletionItemKind.Module);
  });

  it("maps struct to Struct", () => {
    expect(mapToCompletionKind("struct")).toBe(
      vscode.CompletionItemKind.Struct,
    );
  });

  it("maps register to Module", () => {
    expect(mapToCompletionKind("register")).toBe(
      vscode.CompletionItemKind.Module,
    );
  });

  it("maps function to Function", () => {
    expect(mapToCompletionKind("function")).toBe(
      vscode.CompletionItemKind.Function,
    );
  });

  it("maps method to Function", () => {
    expect(mapToCompletionKind("method")).toBe(
      vscode.CompletionItemKind.Function,
    );
  });

  it("maps variable to Variable", () => {
    expect(mapToCompletionKind("variable")).toBe(
      vscode.CompletionItemKind.Variable,
    );
  });

  it("maps field to Variable", () => {
    expect(mapToCompletionKind("field")).toBe(
      vscode.CompletionItemKind.Variable,
    );
  });

  it("maps enum to Enum", () => {
    expect(mapToCompletionKind("enum")).toBe(vscode.CompletionItemKind.Enum);
  });

  it("maps enumMember to EnumMember", () => {
    expect(mapToCompletionKind("enumMember")).toBe(
      vscode.CompletionItemKind.EnumMember,
    );
  });

  it("maps bitmap to Struct", () => {
    expect(mapToCompletionKind("bitmap")).toBe(
      vscode.CompletionItemKind.Struct,
    );
  });

  it("maps bitmapField to Field", () => {
    expect(mapToCompletionKind("bitmapField")).toBe(
      vscode.CompletionItemKind.Field,
    );
  });

  it("maps registerMember to Field", () => {
    expect(mapToCompletionKind("registerMember")).toBe(
      vscode.CompletionItemKind.Field,
    );
  });

  it("maps callback to Function", () => {
    expect(mapToCompletionKind("callback")).toBe(
      vscode.CompletionItemKind.Function,
    );
  });

  it("maps unknown kind to Text", () => {
    expect(mapToCompletionKind("unknown" as TSymbolKind)).toBe(
      vscode.CompletionItemKind.Text,
    );
  });
});

// Helper to access private getMemberCompletions
function callGetMemberCompletions(
  provider: CNextCompletionProvider,
  symbols: ISymbolInfo[],
  chain: string[],
  currentScope: string | null,
  currentFunction: string | null,
): vscode.CompletionItem[] {
  return (
    provider as unknown as {
      getMemberCompletions: (
        symbols: ISymbolInfo[],
        chain: string[],
        currentScope: string | null,
        currentFunction: string | null,
      ) => vscode.CompletionItem[];
    }
  ).getMemberCompletions(symbols, chain, currentScope, currentFunction);
}

function names(items: vscode.CompletionItem[]): string[] {
  return items.map((i) =>
    typeof i.label === "string" ? i.label : i.label.label,
  );
}

describe("getMemberCompletions", () => {
  const resolver = new SymbolResolver(null);
  const provider = new CNextCompletionProvider(resolver);

  const scopeSymbols: ISymbolInfo[] = [
    { name: "LED", fullName: "LED", id: "LED", kind: "namespace" },
    {
      name: "pin",
      fullName: "LED.pin",
      id: "LED.pin",
      parentId: "LED",
      kind: "variable",
      parent: "LED",
    },
    {
      name: "state",
      fullName: "LED.state",
      id: "LED.state",
      parentId: "LED",
      kind: "variable",
      parent: "LED",
    },
    {
      name: "on",
      fullName: "LED.on",
      id: "LED.on",
      parentId: "LED",
      kind: "function",
      parent: "LED",
    },
    {
      name: "off",
      fullName: "LED.off",
      id: "LED.off",
      parentId: "LED",
      kind: "function",
      parent: "LED",
    },
    {
      name: "toggle",
      fullName: "LED.toggle",
      id: "LED.toggle",
      parentId: "LED",
      kind: "function",
      parent: "LED",
    },
  ];

  const enumSymbols: ISymbolInfo[] = [
    { name: "Color", fullName: "Color", id: "Color", kind: "enum" },
    {
      name: "Red",
      fullName: "Color.Red",
      id: "Color.Red",
      parentId: "Color",
      kind: "enumMember",
      parent: "Color",
    },
    {
      name: "Green",
      fullName: "Color.Green",
      id: "Color.Green",
      parentId: "Color",
      kind: "enumMember",
      parent: "Color",
    },
    {
      name: "Blue",
      fullName: "Color.Blue",
      id: "Color.Blue",
      parentId: "Color",
      kind: "enumMember",
      parent: "Color",
    },
    { name: "Display", fullName: "Display", id: "Display", kind: "namespace" },
    {
      name: "currentColor",
      fullName: "Display.currentColor",
      id: "Display.currentColor",
      parentId: "Display",
      kind: "variable",
      parent: "Display",
      type: "Color",
    },
    {
      name: "setColor",
      fullName: "Display.setColor",
      id: "Display.setColor",
      parentId: "Display",
      kind: "function",
      parent: "Display",
    },
  ];

  const globalSymbols: ISymbolInfo[] = [
    { name: "Driver", fullName: "Driver", id: "Driver", kind: "namespace" },
    {
      name: "init",
      fullName: "Driver.init",
      id: "Driver.init",
      parentId: "Driver",
      kind: "function",
      parent: "Driver",
    },
    {
      name: "driverVersion",
      fullName: "driverVersion",
      id: "driverVersion",
      kind: "variable",
    },
    {
      name: "driverHelper",
      fullName: "driverHelper",
      id: "driverHelper",
      kind: "function",
    },
  ];

  it("returns empty for empty chain", () => {
    const items = callGetMemberCompletions(
      provider,
      scopeSymbols,
      [],
      null,
      null,
    );
    expect(items).toHaveLength(0);
  });

  describe("this. completions", () => {
    it("shows scope members for this.", () => {
      const items = callGetMemberCompletions(
        provider,
        scopeSymbols,
        ["this"],
        "LED",
        "toggle",
      );
      const n = names(items);
      expect(n).toContain("pin");
      expect(n).toContain("state");
      expect(n).toContain("on");
      expect(n).toContain("off");
      expect(n).not.toContain("toggle"); // current function filtered
    });

    it("returns empty outside a scope", () => {
      const items = callGetMemberCompletions(
        provider,
        scopeSymbols,
        ["this"],
        null,
        null,
      );
      expect(items).toHaveLength(0);
    });

    it("resolves this.field. chain via type", () => {
      const items = callGetMemberCompletions(
        provider,
        enumSymbols,
        ["this", "currentColor"],
        "Display",
        "setColor",
      );
      const n = names(items);
      expect(n).toContain("Red");
      expect(n).toContain("Green");
      expect(n).toContain("Blue");
    });
  });

  describe("ScopeName. completions", () => {
    it("shows members for named scope", () => {
      const items = callGetMemberCompletions(
        provider,
        scopeSymbols,
        ["LED"],
        null,
        null,
      );
      const n = names(items);
      expect(n).toContain("pin");
      expect(n).toContain("on");
      expect(n).toContain("toggle");
    });

    it("shows enum members for enum name", () => {
      const items = callGetMemberCompletions(
        provider,
        enumSymbols,
        ["Color"],
        null,
        null,
      );
      const n = names(items);
      expect(n).toContain("Red");
      expect(n).toContain("Green");
      expect(n).toContain("Blue");
    });

    it("returns empty for unknown parent", () => {
      const items = callGetMemberCompletions(
        provider,
        scopeSymbols,
        ["Unknown"],
        null,
        null,
      );
      expect(items).toHaveLength(0);
    });
  });

  describe("global. completions", () => {
    it("shows top-level symbols", () => {
      const items = callGetMemberCompletions(
        provider,
        globalSymbols,
        ["global"],
        "Driver",
        "init",
      );
      const n = names(items);
      expect(n).toContain("driverVersion");
      expect(n).toContain("driverHelper");
      expect(n).not.toContain("Driver"); // namespace excluded
    });

    it("filters out current function at global level", () => {
      const items = callGetMemberCompletions(
        provider,
        globalSymbols,
        ["global"],
        null,
        "driverHelper",
      );
      const n = names(items);
      expect(n).toContain("driverVersion");
      expect(n).not.toContain("driverHelper");
    });
  });

  describe("cross-file include merge", () => {
    it("merges included symbols from WorkspaceIndex", () => {
      // Set up a WorkspaceIndex with cached included symbols
      const existing = WorkspaceIndex.getInstance();
      existing.dispose();
      const index = WorkspaceIndex.getInstance();

      const mainUri = vscode.Uri.file("/project/main.cnx");
      const driverUri = vscode.Uri.file("/project/driver.cnx");

      // Populate cache and include dependencies
      const raw = index as unknown as {
        cache: {
          set: (
            uri: typeof vscode.Uri.prototype,
            symbols: ISymbolInfo[],
            mtime: number,
            hasErrors: boolean,
          ) => void;
        };
        scanner: {
          includeDependencies: Map<string, string[]>;
        };
      };
      const internals = {
        cache: raw.cache,
        includeDependencies: raw.scanner.includeDependencies,
      };

      internals.cache.set(
        driverUri,
        [
          {
            name: "Motor",
            fullName: "Motor",
            id: "Motor",
            kind: "namespace",
            parent: undefined,
          },
          {
            name: "spin",
            fullName: "Motor.spin",
            id: "Motor.spin",
            parentId: "Motor",
            kind: "function",
            parent: "Motor",
          },
        ],
        Date.now(),
        false,
      );
      internals.includeDependencies.set(mainUri.fsPath, [driverUri.fsPath]);

      // Create provider with the workspaceIndex
      const resolverWithIndex = new SymbolResolver(index);
      const providerWithIndex = new CNextCompletionProvider(
        resolverWithIndex,
        index,
      );

      // Call getMemberCompletions with documentUri — should merge included symbols
      const items = (
        providerWithIndex as unknown as {
          getMemberCompletions: (
            symbols: ISymbolInfo[],
            chain: string[],
            currentScope: string | null,
            currentFunction: string | null,
            documentUri?: typeof vscode.Uri.prototype,
          ) => vscode.CompletionItem[];
        }
      ).getMemberCompletions([], ["Motor"], null, null, mainUri);

      const n = names(items);
      expect(n).toContain("spin");

      index.dispose();
    });
  });
});
