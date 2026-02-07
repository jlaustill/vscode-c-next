import * as fs from "node:fs";

export function getAccessDescription(access: string): string {
  switch (access) {
    case "rw":
      return "read-write";
    case "ro":
      return "read-only";
    case "wo":
      return "write-only";
    case "w1c":
      return "write-1-to-clear";
    case "w1s":
      return "write-1-to-set";
    default:
      return access;
  }
}

export function getCompletionLabel(
  label: string | { label: string; description?: string },
): string {
  return typeof label === "string" ? label : label.label;
}

export function escapeRegex(str: string): string {
  return str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function findOutputPath(
  cnxFsPath: string,
  uriString: string,
  outputPathCache: Map<string, string>,
): string | null {
  const cppPath = cnxFsPath.replace(/\.cnx$/, ".cpp");
  if (fs.existsSync(cppPath)) return cppPath;
  const cPath = cnxFsPath.replace(/\.cnx$/, ".c");
  if (fs.existsSync(cPath)) return cPath;
  const cachedPath = outputPathCache.get(uriString);
  if (cachedPath && fs.existsSync(cachedPath)) return cachedPath;
  return null;
}

// ============================================================================
// Regex Patterns
// ============================================================================

/** Pattern to match C function declarations */
export const C_FUNCTION_DECLARATION_PATTERN =
  /^(void|int|bool|char|float|double|uint\d+_t|int\d+_t)\s+\w+\s*\([^)]*\)\s*\{?$/;

/** Pattern to match indented lines (4+ spaces) */
export const INDENTED_LINE_PATTERN = /^\s{4,}/;

/** Pattern to extract indentation */
export const INDENTATION_PATTERN = /^(\s+)/;

export const DIAGNOSTIC_DEBOUNCE_MS = 300;
export const EDITOR_SWITCH_DEBOUNCE_MS = 150;
export const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_GLOBAL_COMPLETION_ITEMS = 30;
export const MIN_PREFIX_LENGTH_FOR_CPP_QUERY = 2;

// ============================================================================
// Brace/Block Tracking Utilities
// ============================================================================

/**
 * Strip comments from a line of code
 * Removes both line comments (//) and block comments (/* ... *​/)
 */
export function stripComments(line: string): string {
  return line.replace(/\/\/.*$/, "").replaceAll(/\/\*.*?\*\//g, "");
}

/**
 * Check if a line is a comment line (starts with //, /*, or *)
 */
export function isCommentLine(trimmedLine: string): boolean {
  return (
    trimmedLine.startsWith("//") ||
    trimmedLine.startsWith("/*") ||
    trimmedLine.startsWith("*")
  );
}

/**
 * Count brace changes in a string
 * Returns the net change in brace depth (positive for more opens, negative for more closes)
 */
export function countBraceChange(text: string): number {
  let delta = 0;
  for (const ch of text) {
    if (ch === "{") delta++;
    if (ch === "}") delta--;
  }
  return delta;
}

/**
 * Track brace depth through a string, returning both final depth and intermediate states
 */
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

// ============================================================================
// Symbol Lookup Utilities
// ============================================================================

/**
 * Minimal symbol interface for utility functions
 * Works with both server and workspace ISymbolInfo types
 */
export interface IMinimalSymbol {
  name: string;
  fullName: string;
  kind: string;
  type?: string;
  parent?: string;
}

/**
 * Find a symbol by name with optional parent constraint
 */
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

/**
 * Find a symbol by fullName
 */
export function findSymbolByFullName<T extends IMinimalSymbol>(
  symbols: T[],
  fullName: string,
): T | undefined {
  return symbols.find((s) => s.fullName === fullName);
}

/**
 * Find symbol with fallback chain: exact parent match → fullName → any match
 */
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

// ============================================================================
// Parent Name Utilities
// ============================================================================

/**
 * Concatenate parent and member name with underscore separator
 * Handles empty parent case (returns just member)
 */
export function concatParentName(parent: string, member: string): string {
  return parent ? `${parent}_${member}` : member;
}

/**
 * Build fully qualified name from parent and member
 */
export function buildQualifiedName(
  parent: string | undefined,
  name: string,
): string {
  return parent ? `${parent}_${name}` : name;
}

// ============================================================================
// Chain Resolution Utilities
// ============================================================================

/**
 * Resolve the starting parent for a chain access
 * Handles special cases: "this" → currentScope, "global" → empty, regular → as-is
 */
export function resolveChainStart(
  firstElement: string,
  currentScope: string | null,
): { parent: string; startIndex: number } | null {
  if (firstElement === "this") {
    if (!currentScope) return null;
    return { parent: currentScope, startIndex: 0 };
  }
  if (firstElement === "global") {
    return { parent: "", startIndex: 1 };
  }
  return { parent: firstElement, startIndex: 0 };
}

/**
 * Resolve the next parent in a chain based on symbol type
 * Returns the qualified parent name to use for finding children
 */
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
