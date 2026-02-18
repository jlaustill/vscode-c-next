import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import { ISymbolInfo } from "../server/CNextServerClient";
import WorkspaceIndex from "../state/WorkspaceIndex";
import SymbolResolver from "../state/SymbolResolver";
import { extractStructFields } from "../state/utils";
import CNextExtensionContext from "../ExtensionContext";
import {
  findOutputPath,
  findWordInSource,
  getAccessDescription,
} from "./utils";
import { getWordContext } from "./providerUtils";

/**
 * Language type for file detection
 * Mirrors TLanguage from the transpiler but defined locally to avoid direct import
 */
type TLanguage = "c" | "cpp" | "cnext";

/**
 * Extended symbol info that includes source file path
 */
interface ISymbolWithFile extends ISymbolInfo {
  sourceFile?: string;
}

/**
 * C-Next primitive type info for hover
 */
const TYPE_INFO: Record<string, { description: string; bits: number }> = {
  u8: { description: "Unsigned 8-bit integer", bits: 8 },
  u16: { description: "Unsigned 16-bit integer", bits: 16 },
  u32: { description: "Unsigned 32-bit integer", bits: 32 },
  u64: { description: "Unsigned 64-bit integer", bits: 64 },
  i8: { description: "Signed 8-bit integer", bits: 8 },
  i16: { description: "Signed 16-bit integer", bits: 16 },
  i32: { description: "Signed 32-bit integer", bits: 32 },
  i64: { description: "Signed 64-bit integer", bits: 64 },
  f32: { description: "Single-precision floating point (32-bit)", bits: 32 },
  f64: { description: "Double-precision floating point (64-bit)", bits: 64 },
  bool: { description: "Boolean value (true/false)", bits: 1 },
  void: { description: "No return value", bits: 0 },
  string: {
    description: "Bounded string type. Use string<N> to specify capacity.",
    bits: 0,
  },
  ISR: {
    description:
      "Interrupt Service Routine type - void function with no parameters",
    bits: 0,
  },
};

/**
 * C-Next keyword info for hover
 */
const KEYWORD_INFO: Record<string, string> = {
  // Declaration keywords
  register: "Declares a hardware register binding with memory-mapped I/O",
  scope: "Declares a singleton service with prefixed member names (ADR-016)",
  class: "Declares a type with fields and methods (instances via pointer)",
  struct: "Declares a data structure (ADR-014)",
  enum: "Declares a type-safe enumeration (ADR-017)",
  const: "Declares a compile-time constant value (ADR-013)",

  // Control flow
  if: "Conditional statement",
  else: "Alternative branch of conditional",
  for: "Loop with initialization, condition, and increment",
  while: "Loop with condition",
  do: "Do-while loop - executes at least once (ADR-027)",
  switch: "Multi-way branch with required braces per case (ADR-025)",
  case: "Switch case label - use || for multiple values",
  default: "Default switch case - use default(n) for counted cases",
  break: "Exit from loop or switch",
  continue: "Skip to next loop iteration",
  return: "Return from function",

  // Boolean literals
  true: "Boolean true value",
  false: "Boolean false value",

  // Visibility modifiers (ADR-016)
  public: "Public visibility - accessible from outside the scope",
  private: "Private visibility - only accessible within the scope",

  // Overflow behavior (ADR-044)
  clamp: "Clamp overflow behavior - values saturate at min/max (default)",
  wrap: "Wrap overflow behavior - values wrap around on overflow",

  // Qualification keywords (ADR-016)
  this: "Refers to members of the current scope",
  global: "Refers to global scope members",

  // Operators
  sizeof: "Returns the size of a type or expression in bytes (ADR-023)",

  // Register access modifiers
  rw: "Read-write access modifier for register members",
  ro: "Read-only access modifier for register members",
  wo: "Write-only access modifier for register members",
  w1c: "Write-1-to-clear access modifier for register members",
  w1s: "Write-1-to-set access modifier for register members",

  // Legacy (kept for compatibility)
  namespace: 'Legacy: Use "scope" instead (ADR-016)',

  // ADR-047: NULL keyword for C interop
  NULL: "C library null pointer - only valid in comparison with C stream functions",
};

/**
 * ADR-047: C library function metadata for hover
 * These are whitelisted stream I/O functions that can return NULL
 */
interface ICLibraryFunctionInfo {
  description: string;
  nullMeaning: string;
  docsUrl: string;
  signature: string;
}

const C_LIBRARY_FUNCTIONS: Record<string, ICLibraryFunctionInfo> = {
  fgets: {
    description: "Read a line from stream into buffer",
    nullMeaning: "Returns NULL on EOF or read error",
    docsUrl: "https://en.cppreference.com/w/c/io/fgets",
    signature: "char* fgets(char* str, int count, FILE* stream)",
  },
  fputs: {
    description: "Write a string to stream",
    nullMeaning: "Returns EOF (negative) on write error",
    docsUrl: "https://en.cppreference.com/w/c/io/fputs",
    signature: "int fputs(const char* str, FILE* stream)",
  },
  fgetc: {
    description: "Read a character from stream",
    nullMeaning: "Returns EOF on end-of-file or read error",
    docsUrl: "https://en.cppreference.com/w/c/io/fgetc",
    signature: "int fgetc(FILE* stream)",
  },
  fputc: {
    description: "Write a character to stream",
    nullMeaning: "Returns EOF on write error",
    docsUrl: "https://en.cppreference.com/w/c/io/fputc",
    signature: "int fputc(int ch, FILE* stream)",
  },
  gets: {
    description: "Read a line from stdin (DEPRECATED - use fgets)",
    nullMeaning: "Returns NULL on EOF or read error",
    docsUrl: "https://en.cppreference.com/w/c/io/gets",
    signature: "char* gets(char* str)",
  },
};

/**
 * ADR-047: Forbidden C library functions that return pointers
 * These require ADR-103 (stream handling) infrastructure
 */
const FORBIDDEN_C_FUNCTIONS: Record<string, string> = {
  fopen: "File operations require ADR-103 stream handling (v2)",
  fclose: "File operations require ADR-103 stream handling (v2)",
  malloc: "Dynamic allocation is forbidden (ADR-003)",
  calloc: "Dynamic allocation is forbidden (ADR-003)",
  realloc: "Dynamic allocation is forbidden (ADR-003)",
  free: "Dynamic allocation is forbidden (ADR-003)",
  getenv: "Environment access requires ADR-103 infrastructure (v2)",
  strstr: "Pointer-returning string functions not yet supported",
  strchr: "Pointer-returning string functions not yet supported",
  strrchr: "Pointer-returning string functions not yet supported",
  memchr: "Pointer-returning memory functions not yet supported",
};

/**
 * Build hover content for a C library function
 */
function buildCLibraryHover(
  funcName: string,
  info: ICLibraryFunctionInfo,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  // [C Library] badge
  md.appendMarkdown(`**[C Library]** \`${funcName}\`\n\n`);
  md.appendMarkdown(`${info.description}\n\n`);
  md.appendCodeblock(info.signature, "c");
  md.appendMarkdown(`\n**NULL Return:** ${info.nullMeaning}\n\n`);
  md.appendMarkdown(`*Must check return value against NULL*\n\n`);
  md.appendMarkdown(`[Documentation](${info.docsUrl})`);

  return md;
}

/**
 * Build hover content for a forbidden C function
 */
function buildForbiddenFunctionHover(
  funcName: string,
  reason: string,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  md.appendMarkdown(`**[C Library - Not Supported]** \`${funcName}\`\n\n`);
  md.appendMarkdown(`⚠️ ${reason}\n\n`);
  md.appendMarkdown(`*This function is not available in C-Next v1.*`);

  return md;
}

/**
 * Detect the language type from a file path
 * For .h files, defaults to C but can be overridden if C++ constructs are detected
 */
function detectLanguage(filePath: string): TLanguage {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".cnx":
      return "cnext";
    case ".cpp":
    case ".cc":
    case ".cxx":
    case ".hpp":
    case ".hh":
    case ".hxx":
      return "cpp";
    case ".c":
      return "c";
    case ".h":
      // Default to C for .h files
      // Could be enhanced to detect C++ constructs if needed
      return "c";
    default:
      return "c";
  }
}

/**
 * Get the language label with file extension for display
 */
function getLanguageLabel(language: TLanguage, ext: string): string {
  switch (language) {
    case "cnext":
      return `C-Next (${ext})`;
    case "cpp":
      return `C++ (${ext})`;
    case "c":
      return `C (${ext})`;
  }
}

/**
 * Get a smart display path - filename if unique, relative path if duplicates exist
 */
function getSmartDisplayPath(
  filePath: string,
  workspaceIndex?: WorkspaceIndex,
): string {
  const fileName = path.basename(filePath);

  // If we have workspace index, check for conflicts
  if (workspaceIndex?.hasFilenameConflict(fileName)) {
    // Return relative path from workspace root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders?.length) {
      const relativePath = path.relative(
        workspaceFolders[0].uri.fsPath,
        filePath,
      );
      return relativePath;
    }
  }

  return fileName;
}

/**
 * Format the source footer line with clickable link
 * Format: "Source: [filename:line](command:...) (Language (.ext))"
 */
function formatSourceFooter(
  filePath: string,
  line: number,
  workspaceIndex?: WorkspaceIndex,
): string {
  const displayPath = getSmartDisplayPath(filePath, workspaceIndex);
  const ext = path.extname(filePath).toLowerCase();
  const language = detectLanguage(filePath);
  const languageLabel = getLanguageLabel(language, ext);

  // Create a clickable link that opens the file at the specific line
  // VS Code markdown supports command URIs - use vscode.open with selection options
  const fileUri = vscode.Uri.file(filePath);
  const openArgs = [
    fileUri.toString(),
    {
      selection: {
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: 1,
      },
    },
  ];
  const commandUri = `command:vscode.open?${encodeURIComponent(JSON.stringify(openArgs))}`;

  return `\n\n---\nSource: [${displayPath}:${line}](${commandUri}) (${languageLabel})`;
}

/**
 * Resolve a parent reference to dot notation by walking the symbol chain.
 * e.g., "Scope_method" → "Scope.method"
 * Checks local symbols first, then workspace index for cross-file resolution.
 */
/** Max recursion depth for parent chain resolution (guard against cycles) */
const MAX_PARENT_DEPTH = 10;

function resolveDisplayParent(
  parentId: string,
  symbols: ISymbolInfo[],
  workspaceIndex?: WorkspaceIndex,
  depth: number = 0,
): string {
  if (depth >= MAX_PARENT_DEPTH) {
    return parentId;
  }

  // Search local symbols first, then workspace-wide
  let parentSymbol = symbols.find((s) => s.id === parentId);
  if (!parentSymbol && workspaceIndex) {
    parentSymbol = workspaceIndex
      .getAllSymbols()
      .find((s) => s.id === parentId);
  }

  if (parentSymbol?.parentId) {
    const resolvedGrandparent = resolveDisplayParent(
      parentSymbol.parentId,
      symbols,
      workspaceIndex,
      depth + 1,
    );
    return `${resolvedGrandparent}.${parentSymbol.name}`;
  }
  if (parentSymbol) {
    return parentSymbol.name;
  }
  return parentId;
}

/**
 * Context for building symbol hover content
 */
interface IHoverContext {
  symbol: ISymbolWithFile;
  displayName: string;
  displayParent?: string;
  scopeName?: string;
}

/**
 * Append "Defined in" scope info if available
 */
function appendDefinedIn(md: vscode.MarkdownString, scopeName?: string): void {
  if (scopeName) {
    md.appendMarkdown(`\n\n*Defined in:* ${scopeName} scope`);
  }
}

/**
 * Build hover for container types (scope, namespace, class)
 */
function buildContainerHover(
  md: vscode.MarkdownString,
  kind: string,
  name: string,
  description: string,
): void {
  md.appendMarkdown(`**${kind}** \`${name}\`\n\n`);
  md.appendMarkdown(description);
}

/**
 * Build hover for function/method symbols
 */
function buildFunctionHover(
  md: vscode.MarkdownString,
  ctx: IHoverContext,
): void {
  const { symbol, displayName, scopeName } = ctx;
  md.appendMarkdown(`**function** \`${displayName}\`\n\n`);

  // Build display signature with dot notation
  let displaySignature =
    symbol.signature || `${symbol.type || "void"} ${symbol.name}()`;
  if (symbol.parent) {
    const underscoreName = `${symbol.parent}_${symbol.name}`;
    const dotName = `${symbol.parent}.${symbol.name}`;
    displaySignature = displaySignature.replace(underscoreName, dotName);
  }
  md.appendCodeblock(displaySignature, "cnext");
  if (scopeName) {
    md.appendMarkdown(`\n*Defined in: ${scopeName} scope*`);
  }
}

/**
 * Build hover for variable/field symbols
 */
function buildVariableHover(
  md: vscode.MarkdownString,
  ctx: IHoverContext,
): void {
  const { symbol, displayName, scopeName } = ctx;
  const kindLabel = symbol.parentId ? "field" : "variable";
  md.appendMarkdown(`**${kindLabel}** \`${displayName}\`\n\n`);
  md.appendMarkdown(`*Type:* \`${symbol.type || "unknown"}\``);
  if (symbol.size !== undefined) {
    md.appendMarkdown(`\n\n*Size:* ${symbol.size}`);
  }
  appendDefinedIn(md, scopeName);
}

/**
 * Build hover for bitmap field symbols
 */
function buildBitmapFieldHover(
  md: vscode.MarkdownString,
  ctx: IHoverContext,
): void {
  const { symbol, displayName, displayParent } = ctx;
  md.appendMarkdown(`**bitmap field** \`${displayName}\`\n\n`);
  if (symbol.type) {
    md.appendMarkdown(`*Type:* \`${symbol.type}\``);
  }
  if (symbol.signature) {
    md.appendMarkdown(`\n\n*Range:* ${symbol.signature}`);
  }
  if (displayParent) {
    md.appendMarkdown(`\n\n*Bitmap:* ${displayParent}`);
  }
}

/**
 * Build hover for register member symbols
 */
function buildRegisterMemberHover(
  md: vscode.MarkdownString,
  ctx: IHoverContext,
): void {
  const { symbol, displayName, displayParent } = ctx;
  const access = symbol.accessModifier || "rw";
  md.appendMarkdown(`**register member** \`${displayName}\`\n\n`);
  md.appendCodeblock(`${symbol.type || "u32"} ${access}`, "cnext");
  md.appendMarkdown(`\n*Access:* ${getAccessDescription(access)}`);
  if (displayParent) {
    md.appendMarkdown(`\n\n*Register:* ${displayParent}`);
  }
}

/**
 * Build the main hover content based on symbol kind
 */
function buildHoverContent(
  md: vscode.MarkdownString,
  ctx: IHoverContext,
): void {
  const { symbol, displayName, displayParent, scopeName } = ctx;

  switch (symbol.kind) {
    case "scope":
    case "namespace":
      buildContainerHover(
        md,
        "scope",
        symbol.name,
        "Singleton service with prefixed member names.",
      );
      break;
    case "class":
      buildContainerHover(
        md,
        "class",
        symbol.name,
        "Type with fields and methods.",
      );
      break;
    case "struct":
      buildContainerHover(md, "struct", displayName, "Data structure.");
      break;
    case "register":
      buildContainerHover(
        md,
        "register",
        displayName,
        "Hardware register binding for memory-mapped I/O.",
      );
      break;
    case "function":
    case "method":
      buildFunctionHover(md, ctx);
      break;
    case "variable":
    case "field":
      buildVariableHover(md, ctx);
      break;
    case "enum":
      buildContainerHover(md, "enum", displayName, "Type-safe enumeration.");
      appendDefinedIn(md, scopeName);
      break;
    case "enumMember":
      md.appendMarkdown(`**enum member** \`${displayName}\`\n\n`);
      if (symbol.type) md.appendMarkdown(`*Value:* ${symbol.type}`);
      if (displayParent) md.appendMarkdown(`\n\n*Enum:* ${displayParent}`);
      break;
    case "bitmap":
      buildContainerHover(
        md,
        "bitmap",
        displayName,
        "Bit-field type for hardware registers.",
      );
      appendDefinedIn(md, scopeName);
      break;
    case "bitmapField":
      buildBitmapFieldHover(md, ctx);
      break;
    case "registerMember":
      buildRegisterMemberHover(md, ctx);
      break;
    default:
      md.appendMarkdown(`**${symbol.kind}** \`${symbol.name}\``);
  }
}

/**
 * Build hover content for a symbol
 * @param symbol The symbol to build hover for
 * @param symbols All symbols in scope (for parent chain resolution)
 * @param sourceFile Optional source file path (for cross-file symbols)
 * @param workspaceIndex Optional workspace index for smart path display
 */
function buildSymbolHover(
  symbol: ISymbolWithFile,
  symbols: ISymbolInfo[],
  sourceFile?: string,
  workspaceIndex?: WorkspaceIndex,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  // Build context for hover content
  const displayParent = symbol.parentId
    ? resolveDisplayParent(symbol.parentId, symbols, workspaceIndex)
    : undefined;
  const ctx: IHoverContext = {
    symbol,
    displayName: displayParent
      ? `${displayParent}.${symbol.name}`
      : symbol.name,
    displayParent,
    scopeName: displayParent?.split(".")[0],
  };

  // Build the main content
  buildHoverContent(md, ctx);

  // Add source traceability footer with clickable link
  const displayFile = sourceFile || symbol.sourceFile;
  const lineNumber = symbol.line ?? 1;
  if (displayFile) {
    md.appendMarkdown(
      formatSourceFooter(displayFile, lineNumber, workspaceIndex),
    );
  } else if (symbol.line !== undefined) {
    md.appendMarkdown(`\n\n*Line ${symbol.line}*`);
  }

  return md;
}

/**
 * C-Next Hover Provider
 * Provides hover information for C-Next source files
 * Supports cross-file symbol lookup via WorkspaceIndex
 * Falls back to C/C++ extension for stdlib functions via generated .c files
 */
export default class CNextHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly resolver: SymbolResolver,
    private readonly workspaceIndex?: WorkspaceIndex,
    private readonly extensionContext?: CNextExtensionContext,
  ) {}

  /**
   * Provide hover information for the given position
   */
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | null> {
    const ctx = getWordContext(document, position, token);
    if (!ctx) return null;

    const { word, lineText, wordRange } = ctx;

    // Check built-in types, keywords, and C library functions
    const builtinHover = this.tryBuiltinHover(word, wordRange);
    if (builtinHover) return builtinHover;

    // FAST PATH: Parse current document to get local symbols via server
    const source = document.getText();
    const parseResult = await this.extensionContext?.serverClient?.parseSymbols(
      source,
      document.uri.fsPath,
    );
    if (!parseResult) {
      // Server unavailable - keyword/type/C-library hovers handled above,
      // fall through to C/C++ extension fallback for symbol hover
      const cHover = await this.queryCExtensionHover(document, word, wordRange);
      if (cHover) {
        return cHover;
      }
      return null;
    }
    // Merge server symbols with locally-extracted struct fields
    const structFields = extractStructFields(source);
    const symbols =
      structFields.length > 0
        ? [...parseResult.symbols, ...structFields]
        : parseResult.symbols;

    // Delegate symbol resolution to SymbolResolver
    const resolved = this.resolver.resolveAtPosition(
      lineText,
      word,
      { startCharacter: wordRange.start.character },
      source,
      position.line,
      symbols,
      document.uri,
    );

    if (resolved) {
      const sourceFile =
        resolved.source === "local" ? document.uri.fsPath : undefined;
      return new vscode.Hover(
        buildSymbolHover(resolved, symbols, sourceFile, this.workspaceIndex),
        wordRange,
      );
    }

    // FALLBACK: Query C/C++ extension via the generated .c file
    const cHover = await this.queryCExtensionHover(document, word, wordRange);
    if (cHover) {
      return cHover;
    }

    return null;
  }

  /**
   * Check for built-in types, keywords, and C library functions.
   */
  private tryBuiltinHover(
    word: string,
    wordRange: vscode.Range,
  ): vscode.Hover | null {
    if (TYPE_INFO[word]) {
      const info = TYPE_INFO[word];
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**type** \`${word}\`\n\n`);
      md.appendMarkdown(info.description);
      if (info.bits > 0) {
        md.appendMarkdown(`\n\n*Bit width:* ${info.bits}`);
      }
      return new vscode.Hover(md, wordRange);
    }

    if (KEYWORD_INFO[word]) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**keyword** \`${word}\`\n\n`);
      md.appendMarkdown(KEYWORD_INFO[word]);
      return new vscode.Hover(md, wordRange);
    }

    if (C_LIBRARY_FUNCTIONS[word]) {
      return new vscode.Hover(
        buildCLibraryHover(word, C_LIBRARY_FUNCTIONS[word]),
        wordRange,
      );
    }

    if (FORBIDDEN_C_FUNCTIONS[word]) {
      return new vscode.Hover(
        buildForbiddenFunctionHover(word, FORBIDDEN_C_FUNCTIONS[word]),
        wordRange,
      );
    }

    return null;
  }

  /**
   * Find the output file path (.c or .cpp) for a .cnx document
   * Uses cache if current files don't exist (allows hover during parse errors)
   */
  private findOutputFilePath(document: vscode.TextDocument): string | null {
    const outputPathCache =
      this.extensionContext?.lastGoodOutputPath ?? new Map<string, string>();
    return findOutputPath(
      document.uri.fsPath,
      document.uri.toString(),
      outputPathCache,
    );
  }

  /**
   * Query the C/C++ extension for hover info by looking up the symbol
   * in the generated .c/.cpp file
   */
  private async queryCExtensionHover(
    document: vscode.TextDocument,
    word: string,
    wordRange: vscode.Range,
  ): Promise<vscode.Hover | null> {
    // Find the output file (uses cache if current file has parse errors)
    const outputPath = this.findOutputFilePath(document);
    if (!outputPath) {
      return null;
    }

    try {
      // Read the output file and find the word
      const outputSource = fs.readFileSync(outputPath, "utf-8");
      const wordPos = findWordInSource(outputSource, word);

      if (!wordPos) {
        return null;
      }

      const wordPosition = new vscode.Position(wordPos.line, wordPos.character);

      // Query the C/C++ extension's hover provider
      const outputUri = vscode.Uri.file(outputPath);
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        outputUri,
        wordPosition,
      );

      if (hovers?.length) {
        const hover = hovers[0];

        // Try to get the definition location for the source footer
        const definitions = await vscode.commands.executeCommand<
          vscode.Location[]
        >("vscode.executeDefinitionProvider", outputUri, wordPosition);

        // Build the source footer
        let sourceFooter = "";
        if (definitions?.length) {
          const def = definitions[0];
          const defPath = def.uri.fsPath;
          const defLine = def.range.start.line + 1; // Convert to 1-based
          sourceFooter = formatSourceFooter(
            defPath,
            defLine,
            this.workspaceIndex,
          );
        } else {
          // Fallback: use the generated C file as the source
          const line = wordPosition.line + 1; // Convert to 1-based
          sourceFooter = formatSourceFooter(
            outputPath,
            line,
            this.workspaceIndex,
          );
        }

        // Post-process hover contents: replace C++ :: with C-Next dot notation
        // Only replace :: between word characters (avoids https://, etc.)
        const scopeOpRegex = /(\w)::(\w)/g;
        const contents = hover.contents.map((content) => {
          if (content instanceof vscode.MarkdownString) {
            const fixed = new vscode.MarkdownString(
              content.value.replaceAll(scopeOpRegex, "$1.$2"),
            );
            fixed.isTrusted = true;
            return fixed;
          }
          if (typeof content === "string") {
            return content.replaceAll(scopeOpRegex, "$1.$2");
          }
          return content;
        });

        // Append the source footer
        const footerMd = new vscode.MarkdownString(sourceFooter);
        footerMd.isTrusted = true;
        contents.push(footerMd);

        return new vscode.Hover(contents, wordRange);
      }
    } catch (err) {
      // Silently fail - C/C++ extension might not be installed
      console.error("C-Next: Failed to query C/C++ hover:", err);
    }

    return null;
  }
}
