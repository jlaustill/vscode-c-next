import { describe, it, expect } from "vitest";
import {
  highlightLineComments,
  highlightQuotedStrings,
  highlightPreprocessor,
} from "../PreviewProvider";

describe("highlightLineComments", () => {
  it("wraps line comments in a span", () => {
    expect(highlightLineComments("int x; // comment")).toBe(
      'int x; <span class="comment">// comment</span>',
    );
  });

  it("handles multiple lines", () => {
    const input = "a;\n// full line\nb; // inline";
    const expected = [
      "a;",
      '<span class="comment">// full line</span>',
      'b; <span class="comment">// inline</span>',
    ].join("\n");
    expect(highlightLineComments(input)).toBe(expected);
  });

  it("returns line unchanged when no comment", () => {
    expect(highlightLineComments("int x = 5;")).toBe("int x = 5;");
  });

  it("handles comment at start of line", () => {
    expect(highlightLineComments("// entire line")).toBe(
      '<span class="comment">// entire line</span>',
    );
  });
});

describe("highlightQuotedStrings", () => {
  it("wraps double-quoted strings", () => {
    const result = highlightQuotedStrings('x = "hello";', '"', "string");
    expect(result).toBe('x = <span class="string">"hello"</span>;');
  });

  it("wraps single-quoted char literals", () => {
    const result = highlightQuotedStrings("c = 'A';", "'", "string");
    expect(result).toBe("c = <span class=\"string\">'A'</span>;");
  });

  it("handles escaped quotes inside string", () => {
    const result = highlightQuotedStrings('x = "say \\"hi\\"";', '"', "string");
    expect(result).toBe('x = <span class="string">"say \\"hi\\""</span>;');
  });

  it("handles multiple strings on one line", () => {
    const result = highlightQuotedStrings('"a" + "b"', '"', "string");
    expect(result).toBe(
      '<span class="string">"a"</span> + <span class="string">"b"</span>',
    );
  });

  it("returns text unchanged when no quotes", () => {
    expect(highlightQuotedStrings("int x = 5;", '"', "string")).toBe(
      "int x = 5;",
    );
  });

  it("handles unterminated string at end of input", () => {
    const result = highlightQuotedStrings('x = "unterminated', '"', "string");
    expect(result).toBe('x = <span class="string">"unterminated</span>');
  });

  it("uses the className parameter", () => {
    const result = highlightQuotedStrings("'c'", "'", "char-literal");
    expect(result).toBe("<span class=\"char-literal\">'c'</span>");
  });
});

describe("highlightPreprocessor", () => {
  it("wraps preprocessor directives", () => {
    expect(highlightPreprocessor("#include <stdio.h>")).toBe(
      '<span class="preprocessor">#include</span> <stdio.h>',
    );
  });

  it("handles indented directives", () => {
    expect(highlightPreprocessor("  #define MAX 100")).toBe(
      '<span class="preprocessor">  #define</span> MAX 100',
    );
  });

  it("handles # with space before directive", () => {
    expect(highlightPreprocessor("# include <file.h>")).toBe(
      '<span class="preprocessor"># include</span> <file.h>',
    );
  });

  it("returns non-directive lines unchanged", () => {
    expect(highlightPreprocessor("int x = 5;")).toBe("int x = 5;");
  });

  it("handles multiple lines with mixed content", () => {
    const input = "#include <stdio.h>\nint main() {\n#define X 1\n}";
    const expected = [
      '<span class="preprocessor">#include</span> <stdio.h>',
      "int main() {",
      '<span class="preprocessor">#define</span> X 1',
      "}",
    ].join("\n");
    expect(highlightPreprocessor(input)).toBe(expected);
  });

  it("handles bare # without directive word", () => {
    // # followed by a non-alpha character
    expect(highlightPreprocessor("# 123")).toBe("# 123");
  });
});
