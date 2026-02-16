/**
 * Integration Test — Layer 3: Completion Flow (End-to-End)
 * Tests the full completion pipeline: server parses .cnx → WorkspaceIndex caches →
 * CompletionProvider resolves chains.
 *
 * Accesses `getMemberCompletions` via (provider as any) with real server-parsed symbols.
 */

import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import * as vscode from "vscode";
import {
  describeIntegration,
  startServerClient,
  createWorkspaceIndex,
  loadFixture,
  completionNames,
  initializeWithFixtureDir,
} from "../../__tests__/helpers";
import CNextServerClient from "../../server/CNextServerClient";
import type { ISymbolInfo } from "../../server/CNextServerClient";
import WorkspaceIndex from "../../state/WorkspaceIndex";
import CNextCompletionProvider from "../CompletionProvider";

/**
 * Access the private getMemberCompletions method on the provider
 */
function getMemberCompletions(
  provider: CNextCompletionProvider,
  symbols: ISymbolInfo[],
  chain: string[],
  currentScope: string | null,
  currentFunction: string | null,
  documentUri?: vscode.Uri,
): vscode.CompletionItem[] {
  return (
    provider as unknown as {
      getMemberCompletions: (
        symbols: ISymbolInfo[],
        chain: string[],
        currentScope: string | null,
        currentFunction: string | null,
        documentUri?: vscode.Uri,
      ) => vscode.CompletionItem[];
    }
  ).getMemberCompletions(
    symbols,
    chain,
    currentScope,
    currentFunction,
    documentUri,
  );
}

describeIntegration("Completion Flow Integration", () => {
  let client: CNextServerClient;
  let index: WorkspaceIndex;
  let provider: CNextCompletionProvider;

  beforeAll(async () => {
    client = await startServerClient();
  });

  afterAll(async () => {
    await client.stop();
  });

  afterEach(() => {
    const existing = WorkspaceIndex.getInstance();
    existing.dispose();
  });

  // ==========================================================================
  // this. completions
  // ==========================================================================

  describeIntegration("this. completions", () => {
    it("shows scope members for this.", async () => {
      const { content } = loadFixture("scope-basic", "LED.cnx");
      const result = await client.parseSymbols(content, "/test/LED.cnx");

      index = createWorkspaceIndex(client);
      provider = new CNextCompletionProvider(index);

      const items = getMemberCompletions(
        provider,
        result.symbols,
        ["this"],
        "LED",
        "toggle",
      );

      const names = completionNames(items);
      expect(names).toContain("pin");
      expect(names).toContain("state");
      expect(names).toContain("on");
      expect(names).toContain("off");
    });

    it("filters out current function (no recursion)", async () => {
      const { content } = loadFixture("scope-basic", "LED.cnx");
      const result = await client.parseSymbols(content, "/test/LED.cnx");

      index = createWorkspaceIndex(client);
      provider = new CNextCompletionProvider(index);

      const items = getMemberCompletions(
        provider,
        result.symbols,
        ["this"],
        "LED",
        "toggle",
      );

      const names = completionNames(items);
      expect(names).not.toContain("toggle");
    });

    it("returns empty outside a scope", async () => {
      const { content } = loadFixture("scope-basic", "LED.cnx");
      const result = await client.parseSymbols(content, "/test/LED.cnx");

      index = createWorkspaceIndex(client);
      provider = new CNextCompletionProvider(index);

      const items = getMemberCompletions(
        provider,
        result.symbols,
        ["this"],
        null, // No current scope
        null,
      );

      expect(items).toHaveLength(0);
    });

    it("this.currentColor. chain resolves to enum members", async () => {
      const { content } = loadFixture("enum-scope", "main.cnx");
      const result = await client.parseSymbols(content, "/test/enum.cnx");

      index = createWorkspaceIndex(client);
      provider = new CNextCompletionProvider(index);

      const items = getMemberCompletions(
        provider,
        result.symbols,
        ["this", "currentColor"],
        "Display",
        "setColor",
      );

      const names = completionNames(items);
      expect(names).toContain("Red");
      expect(names).toContain("Green");
      expect(names).toContain("Blue");
    });
  });

  // ==========================================================================
  // ScopeName. completions
  // ==========================================================================

  describeIntegration("ScopeName. completions", () => {
    it("LED. shows LED members", async () => {
      const { content } = loadFixture("scope-basic", "LED.cnx");
      const result = await client.parseSymbols(content, "/test/LED.cnx");

      index = createWorkspaceIndex(client);
      provider = new CNextCompletionProvider(index);

      const items = getMemberCompletions(
        provider,
        result.symbols,
        ["LED"],
        null,
        null,
      );

      const names = completionNames(items);
      expect(names).toContain("pin");
      expect(names).toContain("state");
      expect(names).toContain("on");
      expect(names).toContain("off");
      expect(names).toContain("toggle");
    });

    it("Color. shows enum members", async () => {
      const { content } = loadFixture("enum-scope", "main.cnx");
      const result = await client.parseSymbols(content, "/test/enum.cnx");

      index = createWorkspaceIndex(client);
      provider = new CNextCompletionProvider(index);

      const items = getMemberCompletions(
        provider,
        result.symbols,
        ["Color"],
        null,
        null,
      );

      const names = completionNames(items);
      expect(names).toContain("Red");
      expect(names).toContain("Green");
      expect(names).toContain("Blue");
    });
  });

  // ==========================================================================
  // Cross-file ScopeName. completions
  // ==========================================================================

  describeIntegration("Cross-file ScopeName. completions", () => {
    it("Driver. from main.cnx shows members via include", async () => {
      index = createWorkspaceIndex(client);
      await initializeWithFixtureDir(index, "cross-file");
      provider = new CNextCompletionProvider(index);

      // Index main.cnx (triggers indexing of driver.cnx via include)
      const { uri: mainUri, content: mainContent } = loadFixture(
        "cross-file",
        "main.cnx",
      );
      await index.getSymbolsForFileAsync(mainUri);

      // Parse main.cnx symbols (what the provider would see)
      const mainResult = await client.parseSymbols(mainContent, mainUri.fsPath);

      const items = getMemberCompletions(
        provider,
        mainResult.symbols,
        ["Driver"],
        "App",
        "setup",
        mainUri,
      );

      const names = completionNames(items);
      expect(names).toContain("init");
      expect(names).toContain("start");
      expect(names).toContain("status");
    });
  });

  // ==========================================================================
  // global. completions
  // ==========================================================================

  describeIntegration("global. completions", () => {
    it("shows top-level symbols from current file", async () => {
      const { content } = loadFixture("cross-file", "driver.cnx");
      const result = await client.parseSymbols(content, "/test/driver.cnx");

      index = createWorkspaceIndex(client);
      provider = new CNextCompletionProvider(index);

      const items = getMemberCompletions(
        provider,
        result.symbols,
        ["global"],
        "Driver",
        "init",
      );

      const names = completionNames(items);
      expect(names).toContain("driverVersion");
      expect(names).toContain("driverHelper");
      // Should NOT contain scope members
      expect(names).not.toContain("init");
      expect(names).not.toContain("status");
    });

    it("shows top-level symbols from included files", async () => {
      index = createWorkspaceIndex(client);
      await initializeWithFixtureDir(index, "global-symbols");
      provider = new CNextCompletionProvider(index);

      const { uri: mainUri, content: mainContent } = loadFixture(
        "global-symbols",
        "main.cnx",
      );
      await index.getSymbolsForFileAsync(mainUri);

      const mainResult = await client.parseSymbols(mainContent, mainUri.fsPath);

      const items = getMemberCompletions(
        provider,
        mainResult.symbols,
        ["global"],
        "App",
        "start",
        mainUri,
      );

      const names = completionNames(items);
      expect(names).toContain("globalCounter");
      expect(names).toContain("globalThreshold");
      expect(names).toContain("resetCounters");
    });
  });

  // ==========================================================================
  // Transitive includes (documented limitation)
  // ==========================================================================

  describeIntegration("Transitive includes", () => {
    it("Leaf. from top.cnx returns empty (transitive — not yet supported)", async () => {
      index = createWorkspaceIndex(client);
      await initializeWithFixtureDir(index, "transitive-include");
      provider = new CNextCompletionProvider(index);

      const { uri: topUri, content: topContent } = loadFixture(
        "transitive-include",
        "top.cnx",
      );
      await index.getSymbolsForFileAsync(topUri);

      const topResult = await client.parseSymbols(topContent, topUri.fsPath);

      const items = getMemberCompletions(
        provider,
        topResult.symbols,
        ["Leaf"],
        "Top",
        "run",
        topUri,
      );

      // Transitive includes don't propagate — Leaf is not directly included by top
      expect(items).toHaveLength(0);
    });

    it("Leaf. from middle.cnx returns members (direct include works)", async () => {
      index = createWorkspaceIndex(client);
      await initializeWithFixtureDir(index, "transitive-include");
      provider = new CNextCompletionProvider(index);

      const { uri: middleUri, content: middleContent } = loadFixture(
        "transitive-include",
        "middle.cnx",
      );
      await index.getSymbolsForFileAsync(middleUri);

      const middleResult = await client.parseSymbols(
        middleContent,
        middleUri.fsPath,
      );

      const items = getMemberCompletions(
        provider,
        middleResult.symbols,
        ["Leaf"],
        "Middle",
        "process",
        middleUri,
      );

      const names = completionNames(items);
      expect(names).toContain("compute");
      expect(names).toContain("value");
    });
  });
});
