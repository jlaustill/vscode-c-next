import * as vscode from "vscode";

/** Regex for C-Next identifiers, shared across providers */
const IDENTIFIER_PATTERN = /[a-zA-Z_]\w*/;

/** Word context extracted from a document position */
interface IWordContext {
  word: string;
  lineText: string;
  wordRange: vscode.Range;
}

/**
 * Extract the word, line text, and word range at a document position.
 * Returns null if cancelled or no identifier found at the position.
 */
export function getWordContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
): IWordContext | null {
  if (token.isCancellationRequested) return null;
  const wordRange = document.getWordRangeAtPosition(
    position,
    IDENTIFIER_PATTERN,
  );
  if (!wordRange) return null;
  return {
    word: document.getText(wordRange),
    lineText: document.lineAt(position).text,
    wordRange,
  };
}
