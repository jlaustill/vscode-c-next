export function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
}

export function extractTrailingWord(str: string): string | null {
  let end = str.length;
  while (end > 0 && isWordChar(str.codePointAt(end - 1)!)) {
    end--;
  }
  if (end === str.length) return null;
  return str.substring(end);
}

export function parseMemberAccessChain(
  linePrefix: string,
): { chain: string; partial: string } | null {
  let pos = linePrefix.length;

  // Step 1: Extract trailing partial word (may be empty if line ends with '.')
  let partial = "";
  const wordEnd = pos;
  while (pos > 0 && isWordChar(linePrefix.codePointAt(pos - 1)!)) {
    pos--;
  }
  if (pos < wordEnd) {
    partial = linePrefix.substring(pos, wordEnd);
  }

  // Step 2: Skip optional whitespace between chain and partial
  while (
    pos > 0 &&
    (linePrefix[pos - 1] === " " || linePrefix[pos - 1] === "\t")
  ) {
    pos--;
  }

  // Step 3: Walk backwards through word.word. chain
  // Must end with at least one "word." segment
  let chainEnd = pos;
  let dotCount = 0;

  while (pos > 0) {
    // Expect a dot
    if (linePrefix[pos - 1] !== ".") break;
    pos--;
    dotCount++;

    // Expect a word before the dot
    const segEnd = pos;
    while (pos > 0 && isWordChar(linePrefix.codePointAt(pos - 1)!)) {
      pos--;
    }
    if (pos === segEnd) {
      // No word before the dot — not a valid chain
      break;
    }
  }

  if (dotCount === 0) return null;

  const chain = linePrefix.substring(pos, chainEnd);
  return { chain, partial };
}

export function stripComments(line: string): string {
  // Remove block comments (/* ... */) first
  let result = line;
  let startIdx = result.indexOf("/*");
  while (startIdx !== -1) {
    const endIdx = result.indexOf("*/", startIdx + 2);
    if (endIdx === -1) break;
    result = result.substring(0, startIdx) + result.substring(endIdx + 2);
    startIdx = result.indexOf("/*");
  }

  // Remove line comments (//)
  const lineCommentIdx = result.indexOf("//");
  if (lineCommentIdx !== -1) {
    result = result.substring(0, lineCommentIdx);
  }

  return result;
}

export function isCommentLine(trimmedLine: string): boolean {
  return (
    trimmedLine.startsWith("//") ||
    trimmedLine.startsWith("/*") ||
    trimmedLine.startsWith("*")
  );
}

export function countBraceChange(text: string): number {
  let delta = 0;
  for (const ch of text) {
    if (ch === "{") delta++;
    if (ch === "}") delta--;
  }
  return delta;
}

export interface BraceState {
  depth: number;
  closedToDepth: number | null; // Lowest depth we closed to, or null if only opened
}

export function trackBraces(text: string, startDepth: number): BraceState {
  let depth = startDepth;
  let closedToDepth: number | null = null;

  for (const ch of text) {
    if (ch === "{") {
      depth++;
    }
    if (ch === "}") {
      depth--;
      if (closedToDepth === null || depth < closedToDepth) {
        closedToDepth = depth;
      }
    }
  }

  return { depth, closedToDepth };
}

export interface IMinimalSymbol {
  name: string;
  fullName: string;
  kind: string;
  type?: string;
  parent?: string;
}

export function findSymbolByName<T extends IMinimalSymbol>(
  symbols: T[],
  name: string,
  parent?: string | null,
): T | undefined {
  if (parent === undefined) {
    // No parent constraint - find any match
    return symbols.find((s) => s.name === name);
  }
  if (parent === null || parent === "") {
    // Explicitly looking for top-level symbol
    return symbols.find((s) => s.name === name && !s.parent);
  }
  // Looking for symbol with specific parent
  return symbols.find((s) => s.name === name && s.parent === parent);
}

export function findSymbolByFullName<T extends IMinimalSymbol>(
  symbols: T[],
  fullName: string,
): T | undefined {
  return symbols.find((s) => s.fullName === fullName);
}

export function findSymbolWithFallback<T extends IMinimalSymbol>(
  symbols: T[],
  name: string,
  parent?: string,
): T | undefined {
  if (parent) {
    const withParent = findSymbolByName(symbols, name, parent);
    if (withParent) return withParent;
  }

  const topLevel = findSymbolByName(symbols, name, null);
  if (topLevel) return topLevel;

  const byFullName = findSymbolByFullName(symbols, name);
  if (byFullName) return byFullName;

  return findSymbolByName(symbols, name);
}

export function concatParentName(parent: string, member: string): string {
  return parent ? `${parent}_${member}` : member;
}

export function buildQualifiedName(
  parent: string | undefined,
  name: string,
): string {
  return parent ? `${parent}_${name}` : name;
}

export function resolveChainStart(
  firstElement: string,
  currentScope: string | null,
): { parent: string; startIndex: number } | null {
  if (firstElement === "this") {
    if (!currentScope) return null;
    return { parent: currentScope, startIndex: 1 };
  }
  if (firstElement === "global") {
    return { parent: "", startIndex: 1 };
  }
  return { parent: firstElement, startIndex: 0 };
}

export function resolveNextParent<T extends IMinimalSymbol>(
  symbol: T,
  currentParent: string,
  memberName: string,
  currentScope: string | null,
  symbols: T[],
): string {
  // For registers/namespaces or symbols without type info, use underscore concatenation
  if (
    symbol.kind === "register" ||
    symbol.kind === "namespace" ||
    !symbol.type
  ) {
    return concatParentName(currentParent, memberName);
  }

  // If symbol has fullName and there are children using it as parent, use fullName
  if (symbol.fullName && symbols.some((s) => s.parent === symbol.fullName)) {
    return symbol.fullName;
  }

  // For typed members, look up the type
  const typeName = symbol.type;
  const scopedTypeName = currentScope
    ? `${currentScope}_${typeName}`
    : typeName;

  // Find the type symbol
  const typeSymbol = symbols.find(
    (s) => s.name === scopedTypeName || s.name === typeName,
  );

  if (typeSymbol) {
    // Use fully qualified name
    return typeSymbol.parent
      ? `${typeSymbol.parent}_${typeSymbol.name}`
      : typeSymbol.name;
  }

  // Type not found, use scoped type name
  return scopedTypeName;
}
