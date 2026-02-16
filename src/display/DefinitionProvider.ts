import * as vscode from "vscode";
import * as fs from "node:fs";
import CNextExtensionContext from "../ExtensionContext";
import SymbolResolver, { IResolvedSymbol } from "../state/SymbolResolver";
import { ISymbolInfo } from "../state/types";

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
    if (token.isCancellationRequested) return null;

    // Get the word at the cursor position
    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z_]\w*/);
    if (!wordRange) {
      return null;
    }

    const word = document.getText(wordRange);
    const lineText = document.lineAt(position).text;
    const source = document.getText();

    // Parse symbols from the current document
    const parseResult = await this.extensionContext?.serverClient?.parseSymbols(
      source,
      document.uri.fsPath,
    );
    const symbols: ISymbolInfo[] = parseResult?.symbols ?? [];

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
   * Create a location for a symbol in the current document
   */
  private createLocation(
    uri: vscode.Uri,
    symbol: ISymbolInfo,
    document: vscode.TextDocument,
  ): vscode.Location | null {
    if (!symbol.line) {
      return null;
    }

    const definitionLine = symbol.line - 1; // Convert to 0-based

    // Try to find the exact column of the symbol name on that line
    const defLineText = document.lineAt(definitionLine).text;
    const nameIndex = defLineText.indexOf(symbol.name);

    if (nameIndex >= 0) {
      const startPos = new vscode.Position(definitionLine, nameIndex);
      const endPos = new vscode.Position(
        definitionLine,
        nameIndex + symbol.name.length,
      );
      return new vscode.Location(uri, new vscode.Range(startPos, endPos));
    }

    return new vscode.Location(uri, new vscode.Position(definitionLine, 0));
  }

  /**
   * Create a location for a symbol in another file (cross-file navigation)
   */
  private createLocationFromFile(
    uri: vscode.Uri,
    symbol: IResolvedSymbol,
  ): vscode.Location | null {
    if (!symbol.line) {
      return null;
    }

    const definitionLine = symbol.line - 1; // Convert to 0-based

    try {
      // Read the target file to find exact column
      const content = fs.readFileSync(uri.fsPath, "utf-8");
      const lines = content.split("\n");

      if (definitionLine < lines.length) {
        const defLineText = lines[definitionLine];
        const nameIndex = defLineText.indexOf(symbol.name);

        if (nameIndex >= 0) {
          const startPos = new vscode.Position(definitionLine, nameIndex);
          const endPos = new vscode.Position(
            definitionLine,
            nameIndex + symbol.name.length,
          );
          return new vscode.Location(uri, new vscode.Range(startPos, endPos));
        }
      }
    } catch {
      // File read error - return position at start of line
    }

    return new vscode.Location(uri, new vscode.Position(definitionLine, 0));
  }
}
