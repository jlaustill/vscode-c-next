/**
 * Workspace Symbol Index
 * Singleton facade that manages workspace-wide symbol indexing for the VS Code extension.
 * Delegates scanning/indexing/file-watching to WorkspaceScanner.
 * Supports both .cnx files and C/C++ headers via server client.
 *
 * Phase 3 (ADR-060): Uses server client for all parsing instead of direct
 * transpiler imports, enabling true extension/transpiler separation.
 */

import * as vscode from "vscode";
import * as path from "node:path";
import SymbolCache from "./SymbolCache";
import {
  IWorkspaceConfig,
  DEFAULT_WORKSPACE_CONFIG,
  ISymbolInfo,
} from "./types";
import IncludeResolver from "./IncludeResolver";
import { CACHE_CLEANUP_INTERVAL_MS } from "../constants/cacheCleanupIntervalMs";
import CNextServerClient from "../server/CNextServerClient";
import WorkspaceScanner from "./WorkspaceScanner";

/**
 * Workspace-wide symbol index
 * Provides cross-file symbol lookup for IDE features
 */
export default class WorkspaceIndex {
  private static instance: WorkspaceIndex | null = null;

  private readonly cache: SymbolCache;

  private readonly headerCache: SymbolCache; // Separate cache for header files

  private readonly config: IWorkspaceConfig;

  private workspaceFolders: vscode.WorkspaceFolder[] = [];

  private initialized: boolean = false;

  /** Include resolver for header file paths */
  private readonly includeResolver: IncludeResolver;

  /** Periodic cache cleanup interval */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  /** Server client for parsing (set via setServerClient) */
  private serverClient: CNextServerClient | null = null;

  /** Scanner handles indexing, file watching, and dependency tracking */
  private readonly scanner: WorkspaceScanner;

  private constructor() {
    this.cache = new SymbolCache();
    this.headerCache = new SymbolCache();
    this.config = { ...DEFAULT_WORKSPACE_CONFIG };
    this.includeResolver = new IncludeResolver();
    this.scanner = new WorkspaceScanner(
      this.cache,
      this.headerCache,
      this.includeResolver,
      this.config,
    );
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): WorkspaceIndex {
    WorkspaceIndex.instance ??= new WorkspaceIndex();
    return WorkspaceIndex.instance;
  }

  /**
   * Set the server client for parsing
   * Must be called before initialize() for full functionality
   */
  setServerClient(client: CNextServerClient): void {
    this.serverClient = client;
    this.scanner.setServerClient(client);
  }

  /**
   * Set a callback for status updates (replaces setStatusBarItem)
   */
  setStatusCallback(callback: (text: string) => void): void {
    this.scanner.onStatusUpdate = callback;
  }

  /**
   * Initialize the workspace index
   * Scans workspace folders for .cnx and header files and indexes them
   */
  async initialize(folders: vscode.WorkspaceFolder[]): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.workspaceFolders = folders;
    this.initialized = true;

    // Load include resolver config for the first workspace folder
    if (folders.length > 0) {
      const includeConfig = IncludeResolver.loadConfig(folders[0].uri.fsPath);
      this.includeResolver.updateConfig(includeConfig);
    }

    // Start background indexing
    if (this.config.enableBackgroundIndexing) {
      this.scanner.scanFolders(this.workspaceFolders, () => this.getStats());
    }

    // Set up periodic cache cleanup
    this.cleanupInterval = setInterval(() => {
      this.cache.clearUnused();
      this.headerCache.clearUnused();
    }, CACHE_CLEANUP_INTERVAL_MS);
  }

  /**
   * Find a symbol definition by name
   * Returns the first matching symbol across the workspace
   * Searches .cnx files first, then included headers if fromFile is provided
   * When parentId is provided, only matches symbols with that parentId
   */
  findDefinition(
    name: string,
    fromFile?: vscode.Uri,
    parentId?: string,
  ): ISymbolInfo | undefined {
    const allSymbols = this.cache.getAllSymbols();
    const matchesParent = (s: ISymbolInfo): boolean =>
      parentId ? s.parentId === parentId : true;

    // First, look for an exact match on fullName in .cnx files
    let symbol = allSymbols.find(
      (s) => s.fullName === name && matchesParent(s),
    );
    if (symbol) {
      return symbol;
    }

    // Then look for a match on name in .cnx files
    symbol = allSymbols.find((s) => s.name === name && matchesParent(s));
    if (symbol) {
      return symbol;
    }

    // If we have a source file context, check its included headers
    if (fromFile) {
      const includedSymbols = this.getIncludedSymbols(fromFile);
      symbol = includedSymbols.find((s) => s.name === name && matchesParent(s));
      if (symbol) {
        return symbol;
      }
    }

    // Finally, check all header symbols
    const headerSymbols = this.headerCache.getAllSymbols();
    symbol = headerSymbols.find((s) => s.name === name && matchesParent(s));
    return symbol;
  }

  /**
   * Get all symbols from files directly included by a file.
   * Note: Only returns symbols from direct includes, not transitive
   * (A includes B includes C -- A won't see C's symbols). This is
   * sufficient for typical C-Next projects with shallow include trees.
   * @param uri The source file to check includes for
   */
  getIncludedSymbols(uri: vscode.Uri): ISymbolInfo[] {
    const includedPaths =
      this.scanner.includeDependencies.get(uri.fsPath) || [];
    const symbols: ISymbolInfo[] = [];

    for (const includedPath of includedPaths) {
      const includedUri = vscode.Uri.file(includedPath);
      // .cnx includes are stored in the main cache, others in headerCache
      const targetCache = includedPath.endsWith(".cnx")
        ? this.cache
        : this.headerCache;
      const entry = targetCache.get(includedUri);
      if (entry) {
        symbols.push(...entry.symbols);
      }
    }

    return symbols;
  }

  /**
   * Get all symbols from a specific file
   * Note: This is now async due to server-based parsing
   */
  async getSymbolsForFileAsync(uri: vscode.Uri): Promise<ISymbolInfo[]> {
    // Ensure file is indexed
    const needsIndex = !this.cache.has(uri) || this.cache.isStale(uri);
    if (needsIndex) {
      await this.scanner.indexFile(uri);
    }

    const entry = this.cache.get(uri);
    return entry?.symbols || [];
  }

  /**
   * Get all symbols from a specific file (sync version using cache only)
   * Returns cached symbols or empty array if not indexed
   */
  getSymbolsForFile(uri: vscode.Uri): ISymbolInfo[] {
    const entry = this.cache.get(uri);
    return entry?.symbols || [];
  }

  /**
   * Get all symbols in the workspace
   */
  getAllSymbols(): ISymbolInfo[] {
    return this.cache.getAllSymbols();
  }

  /**
   * Handle file change event
   */
  onFileChanged(uri: vscode.Uri): void {
    this.scanner.onFileChanged(uri);
  }

  /**
   * Handle file deletion
   */
  onFileDeleted(uri: vscode.Uri): void {
    this.scanner.onFileDeleted(uri);
  }

  /**
   * Handle file creation
   */
  onFileCreated(uri: vscode.Uri): void {
    this.scanner.onFileCreated(uri);
  }

  /**
   * Force reindex of the workspace
   */
  reindex(): void {
    this.cache.clear();
    this.headerCache.clear();
    this.scanner.includeDependencies.clear();
    this.scanner.scanFolders(this.workspaceFolders, () => this.getStats());
  }

  /**
   * Collect unique file paths matching a filename from symbols
   * Returns true if more than one unique path is found (early exit optimization)
   */
  private collectMatchingFiles(
    symbols: ISymbolInfo[],
    fileName: string,
    existingFiles: Set<string>,
  ): boolean {
    for (const symbol of symbols) {
      if (!symbol.sourceFile) continue;
      if (path.basename(symbol.sourceFile) !== fileName) continue;

      existingFiles.add(symbol.sourceFile);
      if (existingFiles.size > 1) return true;
    }
    return false;
  }

  /**
   * Check if a filename exists in multiple locations in the workspace
   * Used for smart path display in hover tooltips
   */
  hasFilenameConflict(fileName: string): boolean {
    const allFiles = new Set<string>();

    // Check CNX files, then header files
    return (
      this.collectMatchingFiles(
        this.cache.getAllSymbols(),
        fileName,
        allFiles,
      ) ||
      this.collectMatchingFiles(
        this.headerCache.getAllSymbols(),
        fileName,
        allFiles,
      )
    );
  }

  /**
   * Get statistics about the index
   */
  getStats(): {
    cnxSymbols: number;
    headerSymbols: number;
    filesIndexed: number;
    headersIndexed: number;
  } {
    const cnxStats = this.cache.getStats();
    const headerStats = this.headerCache.getStats();
    return {
      cnxSymbols: cnxStats.symbolCount,
      headerSymbols: headerStats.symbolCount,
      filesIndexed: cnxStats.fileCount,
      headersIndexed: headerStats.fileCount,
    };
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.scanner.dispose();
    this.cache.clear();
    this.headerCache.clear();
    this.initialized = false;
    WorkspaceIndex.instance = null;
  }
}
