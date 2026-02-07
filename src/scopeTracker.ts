import { isCommentLine, stripComments, trackBraces } from "./utils";

export default class ScopeTracker {
  /**
   * Get the name of a context (scope or function) at the given cursor position
   * Uses pattern matching to identify context boundaries and brace tracking for scope
   */
  private static getContext(
    source: string,
    cursorLine: number,
    pattern: RegExp,
  ): string | null {
    const lines = source.split("\n");
    let currentName: string | null = null;
    let braceDepth = 0;
    let blockStartDepth = 0;

    for (
      let lineNum = 0;
      lineNum <= cursorLine && lineNum < lines.length;
      lineNum++
    ) {
      const line = lines[lineNum];
      const trimmed = line.trim();

      // Skip comment lines
      if (isCommentLine(trimmed)) continue;

      // Remove inline comments
      const clean = stripComments(line);

      // Check for context start (scope/function declaration)
      const match = pattern.exec(clean);
      if (match) {
        currentName = match[1];
        blockStartDepth = braceDepth;
        braceDepth++;
        continue;
      }

      // Track braces and detect context exit
      const braceState = trackBraces(clean, braceDepth);
      braceDepth = braceState.depth;

      // If we closed below the block start depth, we've exited the context
      if (
        currentName &&
        braceState.closedToDepth !== null &&
        braceState.closedToDepth <= blockStartDepth
      ) {
        currentName = null;
        blockStartDepth = 0;
      }
    }

    return currentName;
  }

  static getCurrentScope(source: string, cursorLine: number): string | null {
    return ScopeTracker.getContext(source, cursorLine, /\bscope\s+(\w+)\s*\{/);
  }

  static getCurrentFunction(source: string, cursorLine: number): string | null {
    return ScopeTracker.getContext(
      source,
      cursorLine,
      /(?:public\s+)?(?:\w+)\s+(\w+)\s*\([^)]*\)\s*\{/,
    );
  }
}
