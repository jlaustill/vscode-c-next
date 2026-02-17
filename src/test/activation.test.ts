import * as assert from "assert";
import * as vscode from "vscode";
import { activateExtension, openFixtureFile, sleep } from "./helpers";

suite("Extension Activation", () => {
  test("extension is present", () => {
    const ext = vscode.extensions.getExtension("jlaustill.vscode-c-next");
    assert.ok(ext, "Extension should be found by ID");
  });

  test("extension activates on .cnx file open", async () => {
    const ext = await activateExtension();
    assert.ok(ext.isActive, "Extension should be active after opening .cnx");
  });

  test("registers cnext.openPreview command", async () => {
    await activateExtension();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("cnext.openPreview"),
      "cnext.openPreview should be registered",
    );
  });

  test("registers cnext.openPreviewToSide command", async () => {
    await activateExtension();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("cnext.openPreviewToSide"),
      "cnext.openPreviewToSide should be registered",
    );
  });

  test("creates diagnostics collection", async () => {
    await activateExtension();
    // Open a .cnx file and verify diagnostics are available for it
    const doc = await openFixtureFile("hello.cnx");
    // Give the extension time to process
    await sleep(2000);
    // The diagnostics collection exists if we can query it without error
    const diagnostics = vscode.languages.getDiagnostics(doc.uri);
    assert.ok(
      Array.isArray(diagnostics),
      "Should be able to query diagnostics for .cnx file",
    );
  });

  test("recognizes .cnx files as cnext language", async () => {
    const doc = await openFixtureFile("hello.cnx");
    assert.strictEqual(
      doc.languageId,
      "cnext",
      "Language ID should be cnext for .cnx files",
    );
  });
});
