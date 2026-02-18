import * as vscode from "vscode";
import * as fs from "node:fs";
import CNextExtensionContext from "../ExtensionContext";
import SymbolResolver, { IResolvedSymbol } from "../state/SymbolResolver";
import { extractStructFields } from "../state/utils";
import { ISymbolInfo } from "../state/types";
import { getWordContext } from "./providerUtils";

/**
 * C-Next Definition Provider
 * Provides "Go to Definition" support for C-Next source files
 * Delegates all symbol resolution to SymbolResolver
 */
export default class CNextDefinitionProvider
  implements vscode.DefinitionProvider
{
  constructor(
    private readonly resolver: SymbolResolver,
    private readonly extensionContext?: CNextExtensionContext,
  ) {}

  /**
   * Provide definition location for the symbol at the given position
   */
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Definition | null> {
    const ctx = getWordContext(document, position, token);
    if (!ctx) return null;

    const { word, lineText, wordRange } = ctx;
    const source = document.getText();

    // Parse symbols from the current document
    const parseResult = await this.extensionContext?.serverClient?.parseSymbols(
      source,
      document.uri.fsPath,
    );
    // Merge server symbols with locally-extracted struct fields
    const structFields = extractStructFields(source);
    const serverSymbols: ISymbolInfo[] = parseResult?.symbols ?? [];
    const symbols =
      structFields.length > 0
        ? [...serverSymbols, ...structFields]
        : serverSymbols;

    // Resolve the symbol via SymbolResolver
    const resolved = this.resolver.resolveAtPosition(
      lineText,
      word,
      { startCharacter: wordRange.start.character },
      source,
      position.line,
      symbols,
      document.uri,
    );

    if (!resolved) {
      return null;
    }

    // Build a vscode.Location from the resolved symbol
    if (resolved.source === "workspace" && resolved.sourceFile) {
      const targetUri = vscode.Uri.file(resolved.sourceFile);
      return this.createLocationFromFile(targetUri, resolved);
    }

    return this.createLocation(document.uri, resolved, document);
  }

  /**
   * Build a Location from a line of text, highlighting the symbol name if found.
   * Falls back to the start of the line if the name isn't on that line.
   */
  private buildLocation(
    uri: vscode.Uri,
    definitionLine: number,
    lineText: string,
    symbolName: string,
  ): vscode.Location {
    const nameIndex = lineText.indexOf(symbolName);
    if (nameIndex >= 0) {
      const startPos = new vscode.Position(definitionLine, nameIndex);
      const endPos = new vscode.Position(
        definitionLine,
        nameIndex + symbolName.length,
      );
      return new vscode.Location(uri, new vscode.Range(startPos, endPos));
    }
    return new vscode.Location(uri, new vscode.Position(definitionLine, 0));
  }

  /**
   * Create a location for a symbol in the current document
   */
  private createLocation(
    uri: vscode.Uri,
    symbol: ISymbolInfo,
    document: vscode.TextDocument,
  ): vscode.Location | null {
    if (!symbol.line) return null;
    const definitionLine = symbol.line - 1;
    const lineText = document.lineAt(definitionLine).text;
    return this.buildLocation(uri, definitionLine, lineText, symbol.name);
  }

  /**
   * Create a location for a symbol in another file (cross-file navigation)
   */
  private createLocationFromFile(
    uri: vscode.Uri,
    symbol: IResolvedSymbol,
  ): vscode.Location | null {
    if (!symbol.line) return null;
    const definitionLine = symbol.line - 1;

    try {
      const content = fs.readFileSync(uri.fsPath, "utf-8");
      const lines = content.split("\n");
      if (definitionLine < lines.length) {
        return this.buildLocation(
          uri,
          definitionLine,
          lines[definitionLine],
          symbol.name,
        );
      }
    } catch {
      // File read error - fall through to line-start position
    }

    return new vscode.Location(uri, new vscode.Position(definitionLine, 0));
  }
}
