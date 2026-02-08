import { describe, it, expect } from "vitest";
import {
  getAccessDescription,
  getCompletionLabel,
  escapeRegex,
  stripComments,
  isCommentLine,
  countBraceChange,
  trackBraces,
  findSymbolByName,
  findSymbolByFullName,
  findSymbolWithFallback,
  concatParentName,
  buildQualifiedName,
  resolveChainStart,
  resolveNextParent,
  type IMinimalSymbol,
} from "../utils";

describe("getAccessDescription", () => {
  it("returns read-write for rw", () => {
    expect(getAccessDescription("rw")).toBe("read-write");
  });

  it("returns read-only for ro", () => {
    expect(getAccessDescription("ro")).toBe("read-only");
  });

  it("returns write-only for wo", () => {
    expect(getAccessDescription("wo")).toBe("write-only");
  });

  it("returns write-1-to-clear for w1c", () => {
    expect(getAccessDescription("w1c")).toBe("write-1-to-clear");
  });

  it("returns write-1-to-set for w1s", () => {
    expect(getAccessDescription("w1s")).toBe("write-1-to-set");
  });

  it("returns the input for unknown access types", () => {
    expect(getAccessDescription("custom")).toBe("custom");
  });
});

describe("getCompletionLabel", () => {
  it("returns a plain string label as-is", () => {
    expect(getCompletionLabel("myLabel")).toBe("myLabel");
  });

  it("extracts label from an object", () => {
    expect(getCompletionLabel({ label: "myLabel", description: "desc" })).toBe(
      "myLabel",
    );
  });

  it("extracts label from an object without description", () => {
    expect(getCompletionLabel({ label: "onlyLabel" })).toBe("onlyLabel");
  });
});

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    expect(escapeRegex("hello.world")).toBe("hello\\.world");
    expect(escapeRegex("a+b*c?d")).toBe("a\\+b\\*c\\?d");
    expect(escapeRegex("foo[bar]")).toBe("foo\\[bar\\]");
    expect(escapeRegex("a^b$c")).toBe("a\\^b\\$c");
    expect(escapeRegex("a{b}c")).toBe("a\\{b\\}c");
    expect(escapeRegex("a|b")).toBe("a\\|b");
    expect(escapeRegex("a(b)c")).toBe("a\\(b\\)c");
    expect(escapeRegex("a\\b")).toBe("a\\\\b");
  });

  it("leaves plain strings unchanged", () => {
    expect(escapeRegex("hello")).toBe("hello");
    expect(escapeRegex("Serial")).toBe("Serial");
  });
});

// ============================================================================
// Comment Utilities
// ============================================================================

describe("stripComments", () => {
  it("removes line comments", () => {
    expect(stripComments("int x = 5; // comment")).toBe("int x = 5; ");
    expect(stripComments("// full line comment")).toBe("");
  });

  it("removes block comments", () => {
    expect(stripComments("int /* inline */ x")).toBe("int  x");
    expect(stripComments("a /* b */ c /* d */ e")).toBe("a  c  e");
  });

  it("leaves code without comments unchanged", () => {
    expect(stripComments("int x = 5;")).toBe("int x = 5;");
  });
});

describe("isCommentLine", () => {
  it("returns true for line comments", () => {
    expect(isCommentLine("// comment")).toBe(true);
    expect(isCommentLine("//comment")).toBe(true);
  });

  it("returns true for block comment starts", () => {
    expect(isCommentLine("/* block")).toBe(true);
    expect(isCommentLine("/*")).toBe(true);
  });

  it("returns true for doc comment continuations", () => {
    expect(isCommentLine("* continuation")).toBe(true);
    expect(isCommentLine("*/")).toBe(true); // starts with *
  });

  it("returns false for code lines", () => {
    expect(isCommentLine("int x = 5;")).toBe(false);
    expect(isCommentLine("")).toBe(false);
  });
});

// ============================================================================
// Brace Tracking Utilities
// ============================================================================

describe("countBraceChange", () => {
  it("counts opening braces", () => {
    expect(countBraceChange("{")).toBe(1);
    expect(countBraceChange("{{")).toBe(2);
    expect(countBraceChange("if (x) {")).toBe(1);
  });

  it("counts closing braces", () => {
    expect(countBraceChange("}")).toBe(-1);
    expect(countBraceChange("}}")).toBe(-2);
  });

  it("calculates net change", () => {
    expect(countBraceChange("{ }")).toBe(0);
    expect(countBraceChange("{ { }")).toBe(1);
    expect(countBraceChange("} }")).toBe(-2);
  });

  it("returns 0 for no braces", () => {
    expect(countBraceChange("int x = 5;")).toBe(0);
    expect(countBraceChange("")).toBe(0);
  });
});

describe("trackBraces", () => {
  it("tracks depth correctly", () => {
    expect(trackBraces("{", 0)).toEqual({ depth: 1, closedToDepth: null });
    expect(trackBraces("}", 1)).toEqual({ depth: 0, closedToDepth: 0 });
  });

  it("tracks closedToDepth for multiple closes", () => {
    expect(trackBraces("}}", 2)).toEqual({ depth: 0, closedToDepth: 0 });
    expect(trackBraces("} }", 3)).toEqual({ depth: 1, closedToDepth: 1 });
  });

  it("handles mixed braces", () => {
    expect(trackBraces("{ }", 0)).toEqual({ depth: 0, closedToDepth: 0 });
    expect(trackBraces("{ { }", 0)).toEqual({ depth: 1, closedToDepth: 1 });
  });

  it("preserves starting depth", () => {
    expect(trackBraces("{", 5)).toEqual({ depth: 6, closedToDepth: null });
    expect(trackBraces("}", 5)).toEqual({ depth: 4, closedToDepth: 4 });
  });
});

// ============================================================================
// Symbol Lookup Utilities
// ============================================================================

const testSymbols: IMinimalSymbol[] = [
  { name: "LED", fullName: "LED", kind: "scope" },
  { name: "toggle", fullName: "LED_toggle", kind: "function", parent: "LED" },
  { name: "on", fullName: "LED_on", kind: "function", parent: "LED" },
  { name: "GPIO", fullName: "GPIO", kind: "register" },
  {
    name: "DR",
    fullName: "GPIO_DR",
    kind: "registerMember",
    parent: "GPIO",
    type: "u32",
  },
  { name: "counter", fullName: "counter", kind: "variable", type: "u32" },
];

describe("findSymbolByName", () => {
  it("finds symbol by name without parent constraint", () => {
    const result = findSymbolByName(testSymbols, "toggle");
    expect(result?.fullName).toBe("LED_toggle");
  });

  it("finds symbol with specific parent", () => {
    const result = findSymbolByName(testSymbols, "toggle", "LED");
    expect(result?.fullName).toBe("LED_toggle");
  });

  it("finds top-level symbol with null parent", () => {
    const result = findSymbolByName(testSymbols, "LED", null);
    expect(result?.fullName).toBe("LED");
  });

  it("finds top-level symbol with empty string parent", () => {
    const result = findSymbolByName(testSymbols, "counter", "");
    expect(result?.fullName).toBe("counter");
  });

  it("returns undefined when not found", () => {
    expect(findSymbolByName(testSymbols, "notexist")).toBeUndefined();
    expect(findSymbolByName(testSymbols, "toggle", "Wrong")).toBeUndefined();
  });
});

describe("findSymbolByFullName", () => {
  it("finds symbol by fullName", () => {
    const result = findSymbolByFullName(testSymbols, "LED_toggle");
    expect(result?.name).toBe("toggle");
  });

  it("returns undefined when not found", () => {
    expect(findSymbolByFullName(testSymbols, "notexist")).toBeUndefined();
  });
});

describe("findSymbolWithFallback", () => {
  it("finds symbol with parent first", () => {
    const result = findSymbolWithFallback(testSymbols, "toggle", "LED");
    expect(result?.fullName).toBe("LED_toggle");
  });

  it("falls back to top-level symbol", () => {
    const result = findSymbolWithFallback(testSymbols, "LED");
    expect(result?.fullName).toBe("LED");
  });

  it("falls back to fullName match", () => {
    const result = findSymbolWithFallback(testSymbols, "LED_toggle");
    expect(result?.name).toBe("toggle");
  });

  it("falls back to any name match", () => {
    const result = findSymbolWithFallback(testSymbols, "DR");
    expect(result?.fullName).toBe("GPIO_DR");
  });

  it("returns undefined when not found", () => {
    expect(findSymbolWithFallback(testSymbols, "notexist")).toBeUndefined();
  });
});

// ============================================================================
// Parent Name Utilities
// ============================================================================

describe("concatParentName", () => {
  it("concatenates parent and member with underscore", () => {
    expect(concatParentName("LED", "toggle")).toBe("LED_toggle");
    expect(concatParentName("Scope_Sub", "method")).toBe("Scope_Sub_method");
  });

  it("returns just member when parent is empty", () => {
    expect(concatParentName("", "toggle")).toBe("toggle");
  });
});

describe("buildQualifiedName", () => {
  it("builds qualified name with parent", () => {
    expect(buildQualifiedName("LED", "toggle")).toBe("LED_toggle");
  });

  it("returns just name when parent is undefined", () => {
    expect(buildQualifiedName(undefined, "toggle")).toBe("toggle");
  });
});

// ============================================================================
// Chain Resolution Utilities
// ============================================================================

describe("resolveChainStart", () => {
  it("resolves 'this' to current scope", () => {
    const result = resolveChainStart("this", "LED");
    expect(result).toEqual({ parent: "LED", startIndex: 1 });
  });

  it("returns null for 'this' without scope", () => {
    expect(resolveChainStart("this", null)).toBeNull();
  });

  it("resolves 'global' to empty parent with startIndex 1", () => {
    const result = resolveChainStart("global", "LED");
    expect(result).toEqual({ parent: "", startIndex: 1 });
  });

  it("resolves regular identifier as-is", () => {
    const result = resolveChainStart("LED", null);
    expect(result).toEqual({ parent: "LED", startIndex: 0 });
  });
});

describe("resolveNextParent", () => {
  it("uses underscore concatenation for registers", () => {
    const symbol: IMinimalSymbol = {
      name: "GPIO",
      fullName: "GPIO",
      kind: "register",
    };
    expect(resolveNextParent(symbol, "Scope", "GPIO", null, [])).toBe(
      "Scope_GPIO",
    );
  });

  it("uses underscore concatenation for namespaces", () => {
    const symbol: IMinimalSymbol = {
      name: "Sub",
      fullName: "Sub",
      kind: "namespace",
    };
    expect(resolveNextParent(symbol, "Parent", "Sub", null, [])).toBe(
      "Parent_Sub",
    );
  });

  it("uses underscore concatenation when no type", () => {
    const symbol: IMinimalSymbol = {
      name: "field",
      fullName: "field",
      kind: "field",
    };
    expect(resolveNextParent(symbol, "Struct", "field", null, [])).toBe(
      "Struct_field",
    );
  });

  it("uses fullName when children exist with that parent", () => {
    const symbol: IMinimalSymbol = {
      name: "Pins",
      fullName: "GPIO_Pins",
      kind: "bitmap",
      type: "u8",
    };
    const symbols: IMinimalSymbol[] = [
      symbol,
      {
        name: "bit0",
        fullName: "GPIO_Pins_bit0",
        kind: "bitmapField",
        parent: "GPIO_Pins",
      },
    ];
    expect(resolveNextParent(symbol, "GPIO", "Pins", null, symbols)).toBe(
      "GPIO_Pins",
    );
  });

  it("looks up type symbol for typed members", () => {
    const symbol: IMinimalSymbol = {
      name: "pins",
      fullName: "reg_pins",
      kind: "field",
      type: "PinType",
    };
    const typeSymbol: IMinimalSymbol = {
      name: "PinType",
      fullName: "PinType",
      kind: "bitmap",
    };
    const symbols = [symbol, typeSymbol];
    expect(resolveNextParent(symbol, "reg", "pins", null, symbols)).toBe(
      "PinType",
    );
  });

  it("uses scoped type name when type symbol has parent", () => {
    const symbol: IMinimalSymbol = {
      name: "pins",
      fullName: "reg_pins",
      kind: "field",
      type: "PinType",
    };
    const typeSymbol: IMinimalSymbol = {
      name: "PinType",
      fullName: "Scope_PinType",
      kind: "bitmap",
      parent: "Scope",
    };
    const symbols = [symbol, typeSymbol];
    expect(resolveNextParent(symbol, "reg", "pins", "Scope", symbols)).toBe(
      "Scope_PinType",
    );
  });

  it("falls back to scoped type name when type not found", () => {
    const symbol: IMinimalSymbol = {
      name: "pins",
      fullName: "reg_pins",
      kind: "field",
      type: "UnknownType",
    };
    expect(resolveNextParent(symbol, "reg", "pins", "Scope", [])).toBe(
      "Scope_UnknownType",
    );
  });
});
