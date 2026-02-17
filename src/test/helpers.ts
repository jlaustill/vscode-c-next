import * as vscode from "vscode";
import * as path from "path";

const EXTENSION_ID = "jlaustill.vscode-c-next";

/**
 * Activate the C-Next extension and return it.
 * Opens a .cnx file to trigger activation if needed.
 */
export async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  if (!ext) {
    throw new Error(`Extension ${EXTENSION_ID} not found`);
  }

  if (!ext.isActive) {
    // Opening a .cnx file triggers activation via onLanguage:cnext
    const fixtureUri = getFixtureUri("hello.cnx");
    await vscode.workspace.openTextDocument(fixtureUri);
    await ext.activate();
  }

  return ext;
}

/**
 * Get the URI for a fixture file in the sample-workspace.
 */
export function getFixtureUri(filename: string): vscode.Uri {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) {
    throw new Error("No workspace folder open");
  }
  return vscode.Uri.file(path.join(workspaceFolders[0].uri.fsPath, filename));
}

/**
 * Open a fixture file in the editor and return the document.
 */
export async function openFixtureFile(
  filename: string,
): Promise<vscode.TextDocument> {
  const uri = getFixtureUri(filename);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  return doc;
}

/**
 * Wait for a specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
