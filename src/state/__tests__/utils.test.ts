import { describe, it, expect } from "vitest";
import { isWordChar } from "../utils";
import { extractTrailingWord } from "../utils";
import { extractStructFields } from "../utils";
import { parseMemberAccessChain } from "../utils";
import { stripComments } from "../utils";
import { isCommentLine } from "../utils";
import { countBraceChange } from "../utils";
import { trackBraces } from "../utils";
import { IMinimalSymbol } from "../utils";
import { findSymbolByName } from "../utils";
import { findSymbolByFullName } from "../utils";
import { findSymbolWithFallback } from "../utils";
import { concatParentName } from "../utils";
import { buildQualifiedName } from "../utils";
import { resolveChainStart } from "../utils";
import { resolveNextParent } from "../utils";

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
  { name: "LED", fullName: "LED", id: "LED", kind: "scope" },
  { name: "toggle", fullName: "LED_toggle", id: "LED.toggle", parentId: "LED", kind: "function", parent: "LED" },
  { name: "on", fullName: "LED_on", id: "LED.on", parentId: "LED", kind: "function", parent: "LED" },
  { name: "GPIO", fullName: "GPIO", id: "GPIO", kind: "register" },
  {
    name: "DR",
    fullName: "GPIO_DR",
    id: "GPIO.DR",
    parentId: "GPIO",
    kind: "registerMember",
    parent: "GPIO",
    type: "u32",
  },
  { name: "counter", fullName: "counter", id: "counter", kind: "variable", type: "u32" },
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
      id: "GPIO",
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
      id: "Sub",
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
      id: "field",
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
      id: "GPIO.Pins",
      parentId: "GPIO",
      kind: "bitmap",
      type: "u8",
    };
    const symbols: IMinimalSymbol[] = [
      symbol,
      {
        name: "bit0",
        fullName: "GPIO_Pins_bit0",
        id: "GPIO.Pins.bit0",
        parentId: "GPIO.Pins",
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
      id: "reg.pins",
      parentId: "reg",
      kind: "field",
      type: "PinType",
    };
    const typeSymbol: IMinimalSymbol = {
      name: "PinType",
      fullName: "PinType",
      id: "PinType",
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
      id: "reg.pins",
      parentId: "reg",
      kind: "field",
      type: "PinType",
    };
    const typeSymbol: IMinimalSymbol = {
      name: "PinType",
      fullName: "Scope_PinType",
      id: "Scope.PinType",
      parentId: "Scope",
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
      id: "reg.pins",
      parentId: "reg",
      kind: "field",
      type: "UnknownType",
    };
    expect(resolveNextParent(symbol, "reg", "pins", "Scope", [])).toBe(
      "Scope_UnknownType",
    );
  });
});

// ============================================================================
// String Parsing Utilities (ReDoS-safe)
// ============================================================================

describe("isWordChar", () => {
  it("returns true for letters", () => {
    expect(isWordChar("a".charCodeAt(0))).toBe(true);
    expect(isWordChar("z".charCodeAt(0))).toBe(true);
    expect(isWordChar("A".charCodeAt(0))).toBe(true);
    expect(isWordChar("Z".charCodeAt(0))).toBe(true);
  });

  it("returns true for digits", () => {
    expect(isWordChar("0".charCodeAt(0))).toBe(true);
    expect(isWordChar("9".charCodeAt(0))).toBe(true);
  });

  it("returns true for underscore", () => {
    expect(isWordChar("_".charCodeAt(0))).toBe(true);
  });

  it("returns false for non-word characters", () => {
    expect(isWordChar(".".charCodeAt(0))).toBe(false);
    expect(isWordChar(" ".charCodeAt(0))).toBe(false);
    expect(isWordChar("-".charCodeAt(0))).toBe(false);
    expect(isWordChar("(".charCodeAt(0))).toBe(false);
    expect(isWordChar("+".charCodeAt(0))).toBe(false);
  });
});

describe("extractTrailingWord", () => {
  it("extracts trailing word from string", () => {
    expect(extractTrailingWord("hello.world")).toBe("world");
    expect(extractTrailingWord("  myVar")).toBe("myVar");
    expect(extractTrailingWord("x = counter")).toBe("counter");
  });

  it("returns the entire string if all word chars", () => {
    expect(extractTrailingWord("myVariable")).toBe("myVariable");
    expect(extractTrailingWord("_private")).toBe("_private");
  });

  it("returns null if string does not end with a word char", () => {
    expect(extractTrailingWord("hello.")).toBeNull();
    expect(extractTrailingWord("  ")).toBeNull();
    expect(extractTrailingWord("")).toBeNull();
    expect(extractTrailingWord("foo(")).toBeNull();
  });

  it("handles underscores and digits", () => {
    expect(extractTrailingWord("x.my_var2")).toBe("my_var2");
    expect(extractTrailingWord("prefix_123")).toBe("prefix_123");
  });
});

describe("parseMemberAccessChain", () => {
  it("parses simple member access", () => {
    const result = parseMemberAccessChain("this.");
    expect(result).toEqual({ chain: "this.", partial: "" });
  });

  it("parses member access with partial", () => {
    const result = parseMemberAccessChain("this.pi");
    expect(result).toEqual({ chain: "this.", partial: "pi" });
  });

  it("parses chained access", () => {
    const result = parseMemberAccessChain("this.GPIO7.");
    expect(result).toEqual({ chain: "this.GPIO7.", partial: "" });
  });

  it("parses chained access with partial", () => {
    const result = parseMemberAccessChain("this.GPIO7.pi");
    expect(result).toEqual({ chain: "this.GPIO7.", partial: "pi" });
  });

  it("parses named scope access", () => {
    const result = parseMemberAccessChain("LED.toggle");
    expect(result).toEqual({ chain: "LED.", partial: "toggle" });
  });

  it("returns null when no dots found", () => {
    expect(parseMemberAccessChain("hello")).toBeNull();
    expect(parseMemberAccessChain("")).toBeNull();
    expect(parseMemberAccessChain("  x")).toBeNull();
  });

  it("handles prefix before chain", () => {
    const result = parseMemberAccessChain("  x = this.field");
    expect(result).toEqual({ chain: "this.", partial: "field" });
  });

  it("handles whitespace between chain and partial", () => {
    const result = parseMemberAccessChain("this.GPIO7. pi");
    expect(result).toEqual({ chain: "this.GPIO7.", partial: "pi" });
  });

  it("handles leading dot without word before it", () => {
    // The dot is counted but has no word segment — chain is just "."
    const result = parseMemberAccessChain(".field");
    expect(result).toEqual({ chain: ".", partial: "field" });
  });

  it("parses array-indexed access: current[i].", () => {
    const result = parseMemberAccessChain("current[i].");
    expect(result).toEqual({ chain: "current.", partial: "" });
  });

  it("parses array-indexed access with numeric index: current[0].", () => {
    const result = parseMemberAccessChain("current[0].");
    expect(result).toEqual({ chain: "current.", partial: "" });
  });

  it("parses array-indexed access with partial: current[i].val", () => {
    const result = parseMemberAccessChain("current[i].val");
    expect(result).toEqual({ chain: "current.", partial: "val" });
  });

  it("parses array-indexed access with expression: arr[i + 1].", () => {
    const result = parseMemberAccessChain("arr[i + 1].");
    expect(result).toEqual({ chain: "arr.", partial: "" });
  });

  it("parses chained array access: this.current[i].", () => {
    const result = parseMemberAccessChain("this.current[i].");
    expect(result).toEqual({ chain: "this.current.", partial: "" });
  });

  it("parses prefix before array access: x = current[i].val", () => {
    const result = parseMemberAccessChain("  x = current[i].val");
    expect(result).toEqual({ chain: "current.", partial: "val" });
  });
});

// ============================================================================
// Struct Field Extraction
// ============================================================================

describe("extractStructFields", () => {
  it("extracts fields from a simple struct", () => {
    const source = [
      "struct TSensorValue {",
      "    f32 value;",
      "    bool hasHardware;",
      "}",
    ].join("\n");

    const fields = extractStructFields(source);
    expect(fields).toHaveLength(2);

    const value = fields.find((f) => f.name === "value");
    expect(value).toBeDefined();
    expect(value!.type).toBe("f32");
    expect(value!.parent).toBe("TSensorValue");
    expect(value!.kind).toBe("field");
    expect(value!.fullName).toBe("TSensorValue_value");

    const hw = fields.find((f) => f.name === "hasHardware");
    expect(hw).toBeDefined();
    expect(hw!.type).toBe("bool");
    expect(hw!.parent).toBe("TSensorValue");
  });

  it("extracts fields from multiple structs", () => {
    const source = [
      "struct Point {",
      "    f32 x;",
      "    f32 y;",
      "}",
      "struct Color {",
      "    u8 r;",
      "    u8 g;",
      "    u8 b;",
      "}",
    ].join("\n");

    const fields = extractStructFields(source);
    expect(fields).toHaveLength(5);
    expect(fields.filter((f) => f.parent === "Point")).toHaveLength(2);
    expect(fields.filter((f) => f.parent === "Color")).toHaveLength(3);
  });

  it("returns empty array when no structs found", () => {
    const source = "scope LED {\n  u8 pin;\n}";
    const fields = extractStructFields(source);
    expect(fields).toHaveLength(0);
  });

  it("handles struct with custom type fields", () => {
    const source = [
      "struct Config {",
      "    TSensorValue sensor;",
      "    u16 interval;",
      "}",
    ].join("\n");

    const fields = extractStructFields(source);
    expect(fields).toHaveLength(2);

    const sensor = fields.find((f) => f.name === "sensor");
    expect(sensor!.type).toBe("TSensorValue");
  });

  it("ignores comment lines inside struct", () => {
    const source = [
      "struct Data {",
      "    // counter field",
      "    u32 counter;",
      "}",
    ].join("\n");

    const fields = extractStructFields(source);
    expect(fields).toHaveLength(1);
    expect(fields[0].name).toBe("counter");
  });
});
