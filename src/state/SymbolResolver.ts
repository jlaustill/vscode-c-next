/**
 * SymbolResolver — unified symbol resolution for all providers
 *
 * Centralises the dot-access detection, this/global resolution,
 * chained access walking, and local→workspace fallback that was
 * previously duplicated across DefinitionProvider, HoverProvider,
 * and CompletionProvider.
 */

import * as vscode from "vscode";
import { ISymbolInfo } from "./types";
import {
  extractTrailingWord,
  findSymbolByName,
  findSymbolWithFallback,
  resolveChainStart,
  resolveNextParent,
  concatParentName,
} from "./utils";
import ScopeTracker from "./ScopeTracker";
import type WorkspaceIndex from "./WorkspaceIndex";

/**
 * Extends ISymbolInfo with the source of the resolution (local vs workspace).
 */
export interface IResolvedSymbol extends ISymbolInfo {
  source: "local" | "workspace";
}

/**
 * Minimal word-range information needed by the resolver.
 * Only the start character is required (to peek at charBefore).
 */
export interface IWordRange {
  startCharacter: number;
}

export default class SymbolResolver {
  constructor(private readonly workspaceIndex: WorkspaceIndex | null) {}

  // --------------------------------------------------------------------------
  // resolveAtPosition
  // --------------------------------------------------------------------------

  /**
   * Resolve the symbol at a cursor position, handling:
   *  - dot-access parent extraction
   *  - `this` → current scope, `global` → top-level
   *  - local-first, then workspace fallback
   */
  resolveAtPosition(
    lineText: string,
    word: string,
    wordRange: IWordRange,
    documentSource: string,
    cursorLine: number,
    localSymbols: ISymbolInfo[],
    documentUri: vscode.Uri,
  ): IResolvedSymbol | undefined {
    // Detect dot context
    const charBefore =
      wordRange.startCharacter > 0
        ? lineText.charAt(wordRange.startCharacter - 1)
        : "";

    let parentName: string | undefined;
    if (charBefore === ".") {
      const beforeDot = lineText.substring(0, wordRange.startCharacter - 1);
      const trailingWord = extractTrailingWord(beforeDot);
      if (trailingWord) {
        parentName = trailingWord;
      }
    }

    // Resolve this/global qualifiers
    if (parentName === "this") {
      const scope = ScopeTracker.getCurrentScope(documentSource, cursorLine);
      if (scope) {
        parentName = scope;
      }
    } else if (parentName === "global") {
      parentName = undefined;
    }

    // ---------- WITH parent constraint ----------
    if (parentName) {
      // Local first
      const local = findSymbolByName(localSymbols, word, parentName);
      if (local) {
        return { ...local, source: "local" };
      }

      // Workspace members
      if (this.workspaceIndex) {
        const wsSymbol = findSymbolByName(
          this.workspaceIndex.getAllSymbols(),
          word,
          parentName,
        );
        if (wsSymbol) {
          return { ...wsSymbol, source: "workspace" };
        }
      }

      // Fall back to workspace findDefinition (unqualified cross-file)
      if (this.workspaceIndex) {
        const def = this.workspaceIndex.findDefinition(word, documentUri);
        if (def) {
          return { ...def, source: "workspace" };
        }
      }

      return undefined;
    }

    // ---------- WITHOUT parent constraint ----------
    const local = findSymbolWithFallback(localSymbols, word);
    if (local) {
      return { ...local, source: "local" };
    }

    if (this.workspaceIndex) {
      const def = this.workspaceIndex.findDefinition(word, documentUri);
      if (def) {
        return { ...def, source: "workspace" };
      }
    }

    return undefined;
  }

  // --------------------------------------------------------------------------
  // resolveChain
  // --------------------------------------------------------------------------

  /**
   * Walk a dot-chain (e.g. `["this", "GPIO7", "DataRegister"]`) and return
   * the final parent name that can be used for member lookup.
   *
   * Ported from CompletionProvider.resolveChainedAccess().
   */
  resolveChain(
    chain: string[],
    documentSource: string,
    cursorLine: number,
    localSymbols: ISymbolInfo[],
    documentUri: vscode.Uri,
  ): string | null {
    if (chain.length === 0) return null;

    const currentScope = ScopeTracker.getCurrentScope(
      documentSource,
      cursorLine,
    );

    const startResult = resolveChainStart(chain[0], currentScope);
    if (!startResult) return null;

    // "global" alone is not a valid chain endpoint
    if (chain[0] === "global" && chain.length === 1) return null;

    let currentParent = startResult.parent;
    const { startIndex } = startResult;

    // For named scopes with a single-element chain (e.g. ["Ossm"]),
    // the parent is already the scope name — nothing else to resolve.
    // However, if the name is a typed variable (e.g. "current" with type "TSensorValue"),
    // resolve to the type so struct member lookup works.
    if (startIndex === 0 && chain.length === 1) {
      return this.resolveVariableType(currentParent, localSymbols, documentUri);
    }

    // Merge local + workspace symbols for lookup
    const allSymbols = this.mergeSymbols(localSymbols, documentUri);

    for (let i = startIndex; i < chain.length; i++) {
      const memberName = chain[i];
      const parentConstraint = currentParent === "" ? null : currentParent;
      const symbol = findSymbolByName(allSymbols, memberName, parentConstraint);

      if (!symbol) {
        currentParent = concatParentName(currentParent, memberName);
        continue;
      }

      currentParent = resolveNextParent(
        symbol,
        currentParent,
        memberName,
        currentScope,
        allSymbols,
      );
    }

    return currentParent;
  }

  // --------------------------------------------------------------------------
  // findMembers
  // --------------------------------------------------------------------------

  /**
   * Return all symbols whose `parent` matches `parentName`.
   * Merges local symbols, workspace symbols, and included-file symbols.
   * Deduplicates by fullName so the same symbol from multiple sources
   * is only returned once.
   */
  findMembers(
    parentName: string,
    localSymbols: ISymbolInfo[],
    documentUri: vscode.Uri,
  ): ISymbolInfo[] {
    const seen = new Set<string>();
    const result: ISymbolInfo[] = [];

    const add = (sym: ISymbolInfo): void => {
      if (seen.has(sym.fullName)) return;
      seen.add(sym.fullName);
      result.push(sym);
    };

    // Local symbols first (higher priority)
    for (const sym of localSymbols) {
      if (sym.parent === parentName) {
        add(sym);
      }
    }

    if (this.workspaceIndex) {
      // Workspace-wide symbols
      for (const sym of this.workspaceIndex.getAllSymbols()) {
        if (sym.parent === parentName) {
          add(sym);
        }
      }

      // Included file symbols
      for (const sym of this.workspaceIndex.getIncludedSymbols(documentUri)) {
        if (sym.parent === parentName) {
          add(sym);
        }
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * If `name` is a typed variable/field, return its type name for member lookup.
   * Otherwise return the name unchanged (it's likely a scope/namespace).
   */
  private resolveVariableType(
    name: string,
    localSymbols: ISymbolInfo[],
    documentUri: vscode.Uri,
  ): string {
    const allSymbols = this.mergeSymbols(localSymbols, documentUri);

    // Look up the symbol by name (any parent)
    const symbol = findSymbolByName(allSymbols, name);
    if (
      symbol?.type &&
      (symbol.kind === "variable" || symbol.kind === "field")
    ) {
      // Check if there are actual members using this type as parent
      const hasMembers = allSymbols.some((s) => s.parent === symbol.type);
      if (hasMembers) {
        return symbol.type!;
      }
    }

    return name;
  }

  /**
   * Combine local symbols with workspace and included symbols for chain walking.
   * Local symbols take precedence (they appear first in the merged array,
   * and findSymbolByName returns the first match).
   */
  private mergeSymbols(
    localSymbols: ISymbolInfo[],
    documentUri: vscode.Uri,
  ): ISymbolInfo[] {
    if (!this.workspaceIndex) return localSymbols;

    return [
      ...localSymbols,
      ...this.workspaceIndex.getAllSymbols(),
      ...this.workspaceIndex.getIncludedSymbols(documentUri),
    ];
  }
}
