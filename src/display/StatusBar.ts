import * as vscode from "vscode";

/**
 * Status bar UI for workspace index status
 */
export default class StatusBar {
  private statusBarItem: vscode.StatusBarItem | null = null;

  setStatusBarItem(item: vscode.StatusBarItem): void {
    this.statusBarItem = item;
  }

  update(text: string): void {
    if (this.statusBarItem) {
      this.statusBarItem.text = text;
    }
  }
}
