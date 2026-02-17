/**
 * Integration Test — Layer 2: WorkspaceIndex
 * Tests WorkspaceIndex with real server parsing and real include resolution.
 * Validates caching, include dependency tracking, and cross-file symbol lookup.
 */

import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import {
  describeIntegration,
  startServerClient,
  createWorkspaceIndex,
  loadFixture,
  getWorkspaceInternals,
  initializeWithFixtureDir,
} from "../../__tests__/helpers";
import CNextServerClient from "../../server/CNextServerClient";
import WorkspaceIndex from "../WorkspaceIndex";

describeIntegration("WorkspaceIndex Integration", () => {
  let client: CNextServerClient;

  beforeAll(async () => {
    client = await startServerClient();
  });

  afterAll(async () => {
    await client.stop();
  });

  afterEach(() => {
    // Reset singleton between tests
    const existing = WorkspaceIndex.getInstance();
    existing.dispose();
  });

  it("indexes a single file and caches symbols", async () => {
    const index = createWorkspaceIndex(client);
    await initializeWithFixtureDir(index, "scope-basic");

    const { uri } = loadFixture("scope-basic", "LED.cnx");
    const symbols = await index.getSymbolsForFileAsync(uri);

    expect(symbols.length).toBeGreaterThan(0);
    const names = symbols.map((s) => s.name);
    expect(names).toContain("LED");
    expect(names).toContain("pin");
    expect(names).toContain("toggle");

    // Verify it's cached
    const internals = getWorkspaceInternals(index);
    expect(internals.cache.has(uri)).toBe(true);
  });

  it("getSymbolsForFileAsync triggers on-demand indexing", async () => {
    const index = createWorkspaceIndex(client);
    await initializeWithFixtureDir(index, "scope-basic");

    const { uri } = loadFixture("scope-basic", "LED.cnx");
    const internals = getWorkspaceInternals(index);

    // Not cached yet (background indexing may have run, so invalidate first)
    internals.cache.set(uri, [], 0, false); // Force stale

    const symbols = await index.getSymbolsForFileAsync(uri);
    expect(symbols.length).toBeGreaterThan(0);
  });

  it("cross-file includes populate includeDependencies", async () => {
    const index = createWorkspaceIndex(client);
    await initializeWithFixtureDir(index, "cross-file");

    const { uri: mainUri } = loadFixture("cross-file", "main.cnx");
    await index.getSymbolsForFileAsync(mainUri);

    const internals = getWorkspaceInternals(index);
    const deps = internals.includeDependencies.get(mainUri.fsPath);
    expect(deps).toBeDefined();
    expect(deps!.length).toBeGreaterThan(0);

    // Should include the resolved path to driver.cnx
    const driverDep = deps!.find((d) => d.endsWith("driver.cnx"));
    expect(driverDep).toBeDefined();
  });

  it("getIncludedSymbols returns symbols from included .cnx files", async () => {
    const index = createWorkspaceIndex(client);
    await initializeWithFixtureDir(index, "cross-file");

    const { uri: mainUri } = loadFixture("cross-file", "main.cnx");
    await index.getSymbolsForFileAsync(mainUri);

    const includedSymbols = index.getIncludedSymbols(mainUri);
    expect(includedSymbols.length).toBeGreaterThan(0);

    const names = includedSymbols.map((s) => s.name);
    expect(names).toContain("Driver");
    expect(names).toContain("init");
    expect(names).toContain("start");
    expect(names).toContain("driverVersion");
    expect(names).toContain("driverHelper");
  });

  it("findDefinition resolves cross-file symbols", async () => {
    const index = createWorkspaceIndex(client);
    await initializeWithFixtureDir(index, "cross-file");

    const { uri: mainUri } = loadFixture("cross-file", "main.cnx");
    await index.getSymbolsForFileAsync(mainUri);

    // Driver is defined in driver.cnx, included by main.cnx
    const result = index.findDefinition("Driver", mainUri);
    expect(result).toBeDefined();
    expect(result!.name).toBe("Driver");
    expect(result!.sourceFile).toContain("driver.cnx");
  });

  it("transitive includes: A sees B's symbols but not C's", async () => {
    const index = createWorkspaceIndex(client);
    await initializeWithFixtureDir(index, "transitive-include");

    // Index top.cnx (includes middle.cnx which includes leaf.cnx)
    const { uri: topUri } = loadFixture("transitive-include", "top.cnx");
    await index.getSymbolsForFileAsync(topUri);

    // top.cnx should see middle.cnx symbols (direct include)
    const topIncluded = index.getIncludedSymbols(topUri);
    const topIncludedNames = topIncluded.map((s) => s.name);
    expect(topIncludedNames).toContain("Middle");
    expect(topIncludedNames).toContain("process");

    // top.cnx should NOT see leaf.cnx symbols (transitive — not yet supported)
    expect(topIncludedNames).not.toContain("Leaf");
    expect(topIncludedNames).not.toContain("compute");

    // But middle.cnx should see leaf.cnx symbols (direct include)
    const { uri: middleUri } = loadFixture("transitive-include", "middle.cnx");
    const middleIncluded = index.getIncludedSymbols(middleUri);
    const middleIncludedNames = middleIncluded.map((s) => s.name);
    expect(middleIncludedNames).toContain("Leaf");
    expect(middleIncludedNames).toContain("compute");
  });

  it("included symbols have sourceFile paths", async () => {
    const index = createWorkspaceIndex(client);
    await initializeWithFixtureDir(index, "cross-file");

    const { uri: mainUri } = loadFixture("cross-file", "main.cnx");
    await index.getSymbolsForFileAsync(mainUri);

    const includedSymbols = index.getIncludedSymbols(mainUri);
    for (const sym of includedSymbols) {
      expect(sym.sourceFile).toBeDefined();
      expect(sym.sourceFile).toContain("driver.cnx");
    }
  });

  it("global-symbols: included globals are accessible", async () => {
    const index = createWorkspaceIndex(client);
    await initializeWithFixtureDir(index, "global-symbols");

    const { uri: mainUri } = loadFixture("global-symbols", "main.cnx");
    await index.getSymbolsForFileAsync(mainUri);

    const includedSymbols = index.getIncludedSymbols(mainUri);
    const names = includedSymbols.map((s) => s.name);
    expect(names).toContain("globalCounter");
    expect(names).toContain("globalThreshold");
    expect(names).toContain("resetCounters");
  });
});
