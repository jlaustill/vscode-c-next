/**
 * Integration Test Helpers
 * Shared infrastructure for tests that use the real cnext --serve server
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe } from "vitest";
import * as vscode from "vscode";
import CNextServerClient from "../server/CNextServerClient";
import WorkspaceIndex from "../state/WorkspaceIndex";
import type { ISymbolInfo } from "../state/types";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

/**
 * Resolve the absolute path to the cnext binary by scanning PATH entries.
 * Avoids executing a bare command name via PATH (SonarCloud S4036).
 */
function findCnextBinary(): string | null {
  const dirs = (process.env.PATH ?? "").split(path.delimiter);
  for (const dir of dirs) {
    const fullPath = path.join(dir, "cnext");
    try {
      fs.accessSync(fullPath, fs.constants.X_OK);
      return fullPath;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Check if the cnext binary is available on the system
 */
function isCnextAvailable(): boolean {
  return findCnextBinary() !== null;
}

/**
 * Conditional describe block that skips when cnext is not installed
 */
export const describeIntegration = isCnextAvailable()
  ? describe
  : describe.skip;

/**
 * Vitest env var names that must be cleared for child processes.
 * The cnext binary checks process.env.VITEST and skips execution when set.
 */
const VITEST_ENV_VARS = [
  "VITEST",
  "VITEST_POOL_ID",
  "VITEST_WORKER_ID",
] as const;

/**
 * Start a server client, temporarily clearing VITEST env vars so the
 * cnext child process actually runs (it checks process.env.VITEST).
 */
export async function startServerClient(): Promise<CNextServerClient> {
  const outputChannel = vscode.createMockOutputChannel("C-Next Test");
  const client = new CNextServerClient(outputChannel);

  // Save and clear VITEST env vars so cnext doesn't skip execution
  const saved: Record<string, string | undefined> = {};
  for (const key of VITEST_ENV_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }

  try {
    const started = await client.start();
    if (!started) {
      throw new Error("Failed to start cnext server");
    }
    return client;
  } finally {
    // Restore VITEST env vars
    for (const key of VITEST_ENV_VARS) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key];
      }
    }
  }
}

/**
 * Reset and create a WorkspaceIndex wired to a real server client
 */
export function createWorkspaceIndex(
  client: CNextServerClient,
): WorkspaceIndex {
  // Reset singleton
  const existing = WorkspaceIndex.getInstance();
  existing.dispose();

  const index = WorkspaceIndex.getInstance();
  index.setServerClient(client);
  return index;
}

/**
 * Load a fixture file and return its content, URI, and fsPath
 */
export function loadFixture(
  dir: string,
  file: string,
): { content: string; uri: typeof vscode.Uri.prototype; fsPath: string } {
  const fsPath = path.join(FIXTURES_DIR, dir, file);
  const content = fs.readFileSync(fsPath, "utf-8");
  const uri = vscode.Uri.file(fsPath);
  return { content, uri, fsPath };
}

/**
 * Access private internals of WorkspaceIndex for test verification
 */
export function getWorkspaceInternals(index: WorkspaceIndex) {
  const raw = index as unknown as {
    cache: {
      set: (
        uri: typeof vscode.Uri.prototype,
        symbols: ISymbolInfo[],
        mtime: number,
        hasErrors: boolean,
      ) => void;
      has: (uri: typeof vscode.Uri.prototype) => boolean;
      get: (
        uri: typeof vscode.Uri.prototype,
      ) => { symbols: ISymbolInfo[] } | undefined;
    };
    headerCache: {
      set: (
        uri: typeof vscode.Uri.prototype,
        symbols: ISymbolInfo[],
        mtime: number,
        hasErrors: boolean,
      ) => void;
      has: (uri: typeof vscode.Uri.prototype) => boolean;
      get: (
        uri: typeof vscode.Uri.prototype,
      ) => { symbols: ISymbolInfo[] } | undefined;
    };
    scanner: {
      includeDependencies: Map<string, string[]>;
      indexFile: (
        uri: typeof vscode.Uri.prototype,
        indexingStack?: Set<string>,
      ) => Promise<void>;
    };
    initialized: boolean;
    serverClient: CNextServerClient | null;
  };
  return {
    cache: raw.cache,
    headerCache: raw.headerCache,
    includeDependencies: raw.scanner.includeDependencies,
    initialized: raw.initialized,
    serverClient: raw.serverClient,
    indexFile: raw.scanner.indexFile.bind(raw.scanner),
  };
}

/**
 * Extract label strings from CompletionItem arrays
 */
export function completionNames(items: vscode.CompletionItem[]): string[] {
  return items.map((item) =>
    typeof item.label === "string" ? item.label : item.label.label,
  );
}

/**
 * Initialize a WorkspaceIndex with a fixture directory as workspace root.
 * Sets up the include resolver with the fixture dir so relative includes resolve.
 */
export async function initializeWithFixtureDir(
  index: WorkspaceIndex,
  fixtureDir: string,
): Promise<void> {
  const fullPath = path.join(FIXTURES_DIR, fixtureDir);
  const folder: vscode.WorkspaceFolder = {
    uri: vscode.Uri.file(fullPath),
    name: fixtureDir,
    index: 0,
  };
  await index.initialize([folder]);
}
