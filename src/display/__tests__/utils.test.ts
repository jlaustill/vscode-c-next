import { describe, it, expect } from "vitest";
import {
  escapeRegex,
  findWordInSource,
  getAccessDescription,
  getCompletionLabel,
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

describe("findWordInSource", () => {
  it("finds a word in source code", () => {
    const source = "int counter = 0;\nvoid reset() {}";
    const pos = findWordInSource(source, "counter");
    expect(pos).toEqual({ line: 0, character: 4 });
  });

  it("returns null when word is not found", () => {
    const source = "int x = 0;";
    const pos = findWordInSource(source, "counter");
    expect(pos).toBeNull();
  });

  it("skips matches inside line comments", () => {
    const source = [
      "// Centralized sensor value storage",
      "SensorValues_current[i].value = 0.0;",
    ].join("\n");
    const pos = findWordInSource(source, "value");
    // Should find "value" in the code (line 1), not in the comment (line 0)
    expect(pos).not.toBeNull();
    expect(pos!.line).toBe(1);
  });

  it("skips matches inside block comments", () => {
    const source = ["/* set the value here */", "current.value = 0.0;"].join(
      "\n",
    );
    const pos = findWordInSource(source, "value");
    expect(pos).not.toBeNull();
    expect(pos!.line).toBe(1);
  });

  it("finds word in code portion after inline comment is stripped", () => {
    const source = "x.value = 1; // set value";
    const pos = findWordInSource(source, "value");
    expect(pos).not.toBeNull();
    expect(pos!.character).toBe(2); // "value" after "x."
  });

  it("uses word boundaries to avoid partial matches", () => {
    const source = "TSensorValue x;\nx.value = 0;";
    const pos = findWordInSource(source, "value");
    // "value" in "TSensorValue" should NOT match (word boundary)
    // Should find "value" on line 1
    expect(pos).not.toBeNull();
    expect(pos!.line).toBe(1);
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
