import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as vscode from "vscode";
import { mapToCompletionKind, type TSymbolKind } from "../completionProvider";

describe("CNextCompletionProvider", () => {
  it("should not write debug files to /tmp", () => {
    const source = fs.readFileSync(
      new URL("../completionProvider.ts", import.meta.url),
      "utf-8",
    );
    expect(source).not.toContain("/tmp/cnext-completions.txt");
    expect(source).not.toContain("/tmp/cnext-workspace-symbols.txt");
  });
});

describe("mapToCompletionKind", () => {
  it("maps namespace to Module", () => {
    expect(mapToCompletionKind("namespace")).toBe(
      vscode.CompletionItemKind.Module,
    );
  });

  it("maps scope to Module", () => {
    expect(mapToCompletionKind("scope")).toBe(vscode.CompletionItemKind.Module);
  });

  it("maps class to Module", () => {
    expect(mapToCompletionKind("class")).toBe(vscode.CompletionItemKind.Module);
  });

  it("maps struct to Struct", () => {
    expect(mapToCompletionKind("struct")).toBe(
      vscode.CompletionItemKind.Struct,
    );
  });

  it("maps register to Module", () => {
    expect(mapToCompletionKind("register")).toBe(
      vscode.CompletionItemKind.Module,
    );
  });

  it("maps function to Function", () => {
    expect(mapToCompletionKind("function")).toBe(
      vscode.CompletionItemKind.Function,
    );
  });

  it("maps method to Function", () => {
    expect(mapToCompletionKind("method")).toBe(
      vscode.CompletionItemKind.Function,
    );
  });

  it("maps variable to Variable", () => {
    expect(mapToCompletionKind("variable")).toBe(
      vscode.CompletionItemKind.Variable,
    );
  });

  it("maps field to Variable", () => {
    expect(mapToCompletionKind("field")).toBe(
      vscode.CompletionItemKind.Variable,
    );
  });

  it("maps enum to Enum", () => {
    expect(mapToCompletionKind("enum")).toBe(vscode.CompletionItemKind.Enum);
  });

  it("maps enumMember to EnumMember", () => {
    expect(mapToCompletionKind("enumMember")).toBe(
      vscode.CompletionItemKind.EnumMember,
    );
  });

  it("maps bitmap to Struct", () => {
    expect(mapToCompletionKind("bitmap")).toBe(
      vscode.CompletionItemKind.Struct,
    );
  });

  it("maps bitmapField to Field", () => {
    expect(mapToCompletionKind("bitmapField")).toBe(
      vscode.CompletionItemKind.Field,
    );
  });

  it("maps registerMember to Field", () => {
    expect(mapToCompletionKind("registerMember")).toBe(
      vscode.CompletionItemKind.Field,
    );
  });

  it("maps callback to Function", () => {
    expect(mapToCompletionKind("callback")).toBe(
      vscode.CompletionItemKind.Function,
    );
  });

  it("maps unknown kind to Text", () => {
    expect(mapToCompletionKind("unknown" as TSymbolKind)).toBe(
      vscode.CompletionItemKind.Text,
    );
  });
});
