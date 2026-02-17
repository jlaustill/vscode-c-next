/**
 * Workspace Scanner
 * Handles scanning/indexing/file-watching logic for .cnx and header files.
 * Extracted from WorkspaceIndex to separate scanning concern from query concern.
 */

import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import SymbolCache from "./SymbolCache";
import { IWorkspaceConfig, ISymbolInfo } from "./types";
import IncludeResolver from "./IncludeResolver";
import CNextServerClient from "../server/CNextServerClient";

/**
 * Scans workspace folders, indexes .cnx and header files,
 * and manages file change events for re-indexing.
 */
export default class WorkspaceScanner {
  /** Map of file -> included headers (dependency graph) */
  readonly includeDependencies: Map<string, string[]> = new Map();

  /** Whether a full workspace scan is in progress */
  private indexing: boolean = false;

  /** Debounce timer for file changes */
  private fileChangeTimer: NodeJS.Timeout | null = null;

  /** Pending file change URIs waiting for debounce */
  private readonly pendingChanges: Set<string> = new Set();

  /** Server client for parsing (set via setServerClient) */
  private serverClient: CNextServerClient | null = null;

  /** Optional callback for status updates (replaces direct status bar access) */
  onStatusUpdate?: (text: string) => void;

  constructor(
    private readonly cache: SymbolCache,
    private readonly headerCache: SymbolCache,
    private readonly includeResolver: IncludeResolver,
    private readonly config: IWorkspaceConfig,
  ) {}

  /**
   * Set the server client for parsing
   */
  setServerClient(client: CNextServerClient): void {
    this.serverClient = client;
  }

  /**
   * Scan all workspace folders for .cnx files and index them.
   * This is the main entry point called by WorkspaceIndex during initialization.
   */
  async scanFolders(
    folders: vscode.WorkspaceFolder[],
    getStats: () => {
      cnxSymbols: number;
      headerSymbols: number;
      headersIndexed: number;
    },
  ): Promise<void> {
    if (this.indexing) {
      return;
    }

    this.indexing = true;
    this.onStatusUpdate?.("$(sync~spin) Indexing...");

    try {
      for (const folder of folders) {
        await this.indexFolder(folder.uri.fsPath);
      }

      const stats = getStats();
      const totalSymbols = stats.cnxSymbols + stats.headerSymbols;
      const headerInfo =
        stats.headersIndexed > 0 ? ` (+${stats.headersIndexed} headers)` : "";
      this.onStatusUpdate?.(`$(check) ${totalSymbols} symbols${headerInfo}`);
    } catch (error) {
      console.error("Workspace indexing error:", error);
      this.onStatusUpdate?.("$(warning) Index error");
    } finally {
      this.indexing = false;
    }
  }

  /**
   * Recursively index a folder for .cnx files
   */
  private async indexFolder(folderPath: string): Promise<void> {
    try {
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(folderPath, entry.name);

        // Skip excluded patterns
        if (this.isExcluded(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await this.indexFolder(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".cnx")) {
          await this.indexFile(vscode.Uri.file(fullPath));
        }
      }
    } catch {
      // Ignore permission errors, etc.
    }
  }

  /**
   * Index a single .cnx file
   * @param indexingStack Tracks files currently being indexed to prevent circular includes
   */
  async indexFile(uri: vscode.Uri, indexingStack?: Set<string>): Promise<void> {
    // Check if already cached and not stale
    if (this.cache.has(uri) && !this.cache.isStale(uri)) {
      return;
    }

    // Circular include protection
    if (indexingStack?.has(uri.fsPath)) {
      return;
    }

    // Server client required for parsing
    if (!this.serverClient?.isRunning()) {
      return;
    }

    try {
      const stat = fs.statSync(uri.fsPath);

      // Skip large files
      if (stat.size > this.config.maxFileSizeKb * 1024) {
        return;
      }

      const source = fs.readFileSync(uri.fsPath, "utf-8");
      const result = await this.serverClient.parseSymbols(source, uri.fsPath);

      // Add source file path to each symbol
      const symbolsWithFile: ISymbolInfo[] = result.symbols.map((s) => ({
        id: s.id,
        parentId: s.parentId,
        name: s.name,
        fullName: s.fullName,
        kind: s.kind,
        type: s.type,
        parent: s.parent,
        signature: s.signature,
        accessModifier: s.accessModifier,
        line: s.line ?? 0,
        size: s.size,
        sourceFile: uri.fsPath,
      }));

      this.cache.set(uri, symbolsWithFile, stat.mtimeMs, !result.success);

      // Extract and resolve includes, then index included files
      const includes = this.includeResolver.extractIncludes(source);
      const resolvedIncludes: string[] = [];

      // Build indexing stack for circular include protection.
      // The same stack is shared across sibling includes so we detect
      // circular dependencies across the entire include tree, not just
      // direct parent chains (e.g., A->B->C->A is caught even from A's perspective).
      const stack = indexingStack ?? new Set<string>();
      stack.add(uri.fsPath);

      for (const inc of includes) {
        const resolvedPath = this.includeResolver.resolve(
          inc.path,
          uri.fsPath,
          inc.isSystem,
        );
        if (resolvedPath) {
          resolvedIncludes.push(resolvedPath);
          // Route .cnx includes through indexFile, others through indexHeaderFile
          if (resolvedPath.endsWith(".cnx")) {
            await this.indexFile(vscode.Uri.file(resolvedPath), stack);
          } else {
            await this.indexHeaderFile(vscode.Uri.file(resolvedPath));
          }
        }
      }

      // Store dependency graph
      this.includeDependencies.set(uri.fsPath, resolvedIncludes);
    } catch {
      // Parse error or file read error - skip silently
    }
  }

  /**
   * Index a header file (.h or .c) using the server's C parser
   */
  private async indexHeaderFile(uri: vscode.Uri): Promise<void> {
    // Check if already cached and not stale
    if (this.headerCache.has(uri) && !this.headerCache.isStale(uri)) {
      return;
    }

    // Server client required for parsing
    if (!this.serverClient?.isRunning()) {
      return;
    }

    try {
      const stat = fs.statSync(uri.fsPath);

      // Skip large files
      if (stat.size > this.config.maxFileSizeKb * 1024) {
        return;
      }

      const source = fs.readFileSync(uri.fsPath, "utf-8");
      const result = await this.serverClient.parseCHeader(source, uri.fsPath);

      // Convert to ISymbolInfo format with source file
      const symbolsWithFile: ISymbolInfo[] = result.symbols.map((s) => ({
        name: s.name,
        fullName: s.fullName,
        kind: s.kind,
        type: s.type,
        parent: s.parent,
        line: s.line ?? 0,
        sourceFile: uri.fsPath,
      }));

      this.headerCache.set(uri, symbolsWithFile, stat.mtimeMs, false);
    } catch {
      // Parse error or server error - skip silently
    }
  }

  /**
   * Check if a path should be excluded from indexing
   */
  private isExcluded(filePath: string): boolean {
    for (const pattern of this.config.excludePatterns) {
      // Simple glob matching
      if (pattern.includes("**/")) {
        const suffix = pattern.replace("**/", "");
        if (filePath.includes(suffix.replace("/**", ""))) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Handle file change event (debounced)
   */
  onFileChanged(uri: vscode.Uri): void {
    // Debounce rapid changes
    this.pendingChanges.add(uri.toString());

    if (this.fileChangeTimer) {
      clearTimeout(this.fileChangeTimer);
    }

    this.fileChangeTimer = setTimeout(() => {
      this.processPendingChanges();
    }, 300);
  }

  /**
   * Handle file deletion
   */
  onFileDeleted(uri: vscode.Uri): void {
    const filePath = uri.fsPath;

    if (filePath.endsWith(".cnx")) {
      this.cache.invalidate(uri);
      this.includeDependencies.delete(filePath);
      // Invalidate any files that included this .cnx file
      this.invalidateDependentFiles(filePath);
    } else if (filePath.endsWith(".h") || filePath.endsWith(".c")) {
      this.headerCache.invalidate(uri);
      // Invalidate any .cnx files that included this header
      this.invalidateDependentFiles(filePath);
    }
  }

  /**
   * Handle file creation
   */
  onFileCreated(uri: vscode.Uri): void {
    const filePath = uri.fsPath;

    if (filePath.endsWith(".cnx")) {
      this.indexFile(uri);
    }
    // Headers are indexed on-demand when included
  }

  /**
   * Invalidate .cnx files that include a changed file
   */
  private invalidateDependentFiles(headerPath: string): void {
    for (const [cnxPath, headers] of this.includeDependencies) {
      if (headers.includes(headerPath)) {
        this.cache.invalidate(vscode.Uri.file(cnxPath));
      }
    }
  }

  /**
   * Process pending file changes after debounce
   */
  private processPendingChanges(): void {
    for (const uriString of this.pendingChanges) {
      const uri = vscode.Uri.parse(uriString);
      const filePath = uri.fsPath;

      if (filePath.endsWith(".cnx")) {
        this.cache.invalidate(uri);
        // Invalidate any files that included this .cnx file
        this.invalidateDependentFiles(filePath);
        this.indexFile(uri);
      } else if (filePath.endsWith(".h") || filePath.endsWith(".c")) {
        this.headerCache.invalidate(uri);
        // Invalidate dependent .cnx files so they re-resolve includes
        this.invalidateDependentFiles(filePath);
      }
    }

    this.pendingChanges.clear();
    this.fileChangeTimer = null;
  }

  /**
   * Dispose scanner resources (timers)
   */
  dispose(): void {
    if (this.fileChangeTimer) {
      clearTimeout(this.fileChangeTimer);
      this.fileChangeTimer = null;
    }
    this.includeDependencies.clear();
  }
}
