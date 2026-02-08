/**
 * VS Code API Mock for unit testing
 * Provides mock implementations of commonly used VS Code APIs
 */

// ============================================================================
// Enums
// ============================================================================

export enum CompletionItemKind {
  Text = 0,
  Method = 1,
  Function = 2,
  Constructor = 3,
  Field = 4,
  Variable = 5,
  Class = 6,
  Interface = 7,
  Module = 8,
  Property = 9,
  Unit = 10,
  Value = 11,
  Enum = 12,
  Keyword = 13,
  Snippet = 14,
  Color = 15,
  File = 16,
  Reference = 17,
  Folder = 18,
  EnumMember = 19,
  Constant = 20,
  Struct = 21,
  Event = 22,
  Operator = 23,
  TypeParameter = 24,
}

export enum SymbolKind {
  File = 0,
  Module = 1,
  Namespace = 2,
  Package = 3,
  Class = 4,
  Method = 5,
  Property = 6,
  Field = 7,
  Constructor = 8,
  Enum = 9,
  Interface = 10,
  Function = 11,
  Variable = 12,
  Constant = 13,
  String = 14,
  Number = 15,
  Boolean = 16,
  Array = 17,
  Object = 18,
  Key = 19,
  Null = 20,
  EnumMember = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
  Three = 3,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum CompletionTriggerKind {
  Invoke = 0,
  TriggerCharacter = 1,
  TriggerForIncompleteCompletions = 2,
}

// ============================================================================
// Classes
// ============================================================================

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }

  isBefore(other: Position): boolean {
    if (this.line < other.line) return true;
    if (this.line > other.line) return false;
    return this.character < other.character;
  }

  isAfter(other: Position): boolean {
    return other.isBefore(this);
  }

  translate(lineDelta: number = 0, characterDelta: number = 0): Position {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }

  with(line?: number, character?: number): Position {
    return new Position(line ?? this.line, character ?? this.character);
  }
}

export class Range {
  constructor(
    public readonly start: Position,
    public readonly end: Position,
  ) {}

  static fromPositions(
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
  ): Range {
    return new Range(
      new Position(startLine, startChar),
      new Position(endLine, endChar),
    );
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }

  get isSingleLine(): boolean {
    return this.start.line === this.end.line;
  }

  contains(positionOrRange: Position | Range): boolean {
    if (positionOrRange instanceof Position) {
      return (
        !positionOrRange.isBefore(this.start) &&
        !positionOrRange.isAfter(this.end)
      );
    }
    return (
      this.contains(positionOrRange.start) && this.contains(positionOrRange.end)
    );
  }
}

export class Location {
  constructor(
    public readonly uri: Uri,
    public readonly range: Range | Position,
  ) {}
}

export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query: string,
    public readonly fragment: string,
  ) {}

  static file(path: string): Uri {
    return new Uri("file", "", path, "", "");
  }

  static parse(value: string): Uri {
    // Simple parse for testing
    if (value.startsWith("file://")) {
      return Uri.file(value.slice(7));
    }
    return new Uri("", "", value, "", "");
  }

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    if (this.scheme === "file") {
      return `file://${this.path}`;
    }
    return this.path;
  }

  with(change: { scheme?: string; path?: string }): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      this.authority,
      change.path ?? this.path,
      this.query,
      this.fragment,
    );
  }
}

export class MarkdownString {
  value: string = "";
  isTrusted: boolean = false;
  supportThemeIcons: boolean = false;

  constructor(value?: string) {
    this.value = value ?? "";
  }

  appendText(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendMarkdown(value: string): MarkdownString {
    this.value += value;
    return this;
  }

  appendCodeblock(code: string, language?: string): MarkdownString {
    this.value += `\n\`\`\`${language ?? ""}\n${code}\n\`\`\`\n`;
    return this;
  }
}

export class CompletionItem {
  label: string | { label: string; description?: string };
  kind?: CompletionItemKind;
  detail?: string;
  documentation?: string | MarkdownString;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  range?: Range;
  command?: { command: string; title: string; arguments?: unknown[] };

  constructor(
    label: string | { label: string; description?: string },
    kind?: CompletionItemKind,
  ) {
    this.label = label;
    this.kind = kind;
  }
}

export class CompletionList {
  isIncomplete: boolean;
  items: CompletionItem[];

  constructor(items?: CompletionItem[], isIncomplete?: boolean) {
    this.items = items ?? [];
    this.isIncomplete = isIncomplete ?? false;
  }
}

export class Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  source?: string;
  code?: string | number;

  constructor(
    range: Range,
    message: string,
    severity: DiagnosticSeverity = DiagnosticSeverity.Error,
  ) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

export class Hover {
  contents: MarkdownString | MarkdownString[];
  range?: Range;

  constructor(
    contents: MarkdownString | MarkdownString[] | string,
    range?: Range,
  ) {
    if (typeof contents === "string") {
      this.contents = new MarkdownString(contents);
    } else {
      this.contents = contents;
    }
    this.range = range;
  }
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

// ============================================================================
// Mock Implementations
// ============================================================================

export interface TextLine {
  lineNumber: number;
  text: string;
  range: Range;
  rangeIncludingLineBreak: Range;
  firstNonWhitespaceCharacterIndex: number;
  isEmptyOrWhitespace: boolean;
}

export interface TextDocument {
  uri: Uri;
  fileName: string;
  languageId: string;
  version: number;
  isDirty: boolean;
  isUntitled: boolean;
  lineCount: number;
  getText(range?: Range): string;
  lineAt(line: number): TextLine;
  positionAt(offset: number): Position;
  offsetAt(position: Position): number;
  getWordRangeAtPosition(position: Position, regex?: RegExp): Range | undefined;
}

export interface CancellationToken {
  isCancellationRequested: boolean;
  onCancellationRequested: (listener: () => void) => { dispose: () => void };
}

export interface CompletionContext {
  triggerKind: CompletionTriggerKind;
  triggerCharacter?: string;
}

export interface OutputChannel {
  name: string;
  append(value: string): void;
  appendLine(value: string): void;
  clear(): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  dispose(): void;
}

export interface StatusBarItem {
  alignment: StatusBarAlignment;
  priority?: number;
  text: string;
  tooltip?: string;
  color?: string | ThemeColor;
  backgroundColor?: ThemeColor;
  command?: string;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface WebviewPanel {
  viewType: string;
  title: string;
  webview: { html: string; postMessage: (message: unknown) => void };
  visible: boolean;
  reveal(viewColumn?: ViewColumn): void;
  dispose(): void;
  onDidDispose: (
    listener: () => void,
    thisArg?: unknown,
    disposables?: { dispose: () => void }[],
  ) => { dispose: () => void };
  onDidChangeViewState: (
    listener: (e: { webviewPanel: WebviewPanel }) => void,
    thisArg?: unknown,
    disposables?: { dispose: () => void }[],
  ) => { dispose: () => void };
}

export interface DiagnosticCollection {
  name: string;
  set(uri: Uri, diagnostics: Diagnostic[]): void;
  delete(uri: Uri): void;
  clear(): void;
  dispose(): void;
}

export interface WorkspaceFolder {
  uri: Uri;
  name: string;
  index: number;
}

export interface FileSystemWatcher {
  onDidChange: (listener: (uri: Uri) => void) => { dispose: () => void };
  onDidCreate: (listener: (uri: Uri) => void) => { dispose: () => void };
  onDidDelete: (listener: (uri: Uri) => void) => { dispose: () => void };
  dispose(): void;
}

// ============================================================================
// Mock Factory Functions
// ============================================================================

export function createMockTextDocument(options: {
  uri?: Uri;
  fileName?: string;
  languageId?: string;
  content?: string;
}): TextDocument {
  const content = options.content ?? "";
  const lines = content.split("\n");

  return {
    uri: options.uri ?? Uri.file("/test/file.cnx"),
    fileName: options.fileName ?? "/test/file.cnx",
    languageId: options.languageId ?? "cnext",
    version: 1,
    isDirty: false,
    isUntitled: false,
    lineCount: lines.length,
    getText: (range?: Range) => {
      if (!range) return content;
      const startOffset =
        lines.slice(0, range.start.line).join("\n").length +
        (range.start.line > 0 ? 1 : 0) +
        range.start.character;
      const endOffset =
        lines.slice(0, range.end.line).join("\n").length +
        (range.end.line > 0 ? 1 : 0) +
        range.end.character;
      return content.slice(startOffset, endOffset);
    },
    lineAt: (line: number | Position): TextLine => {
      const lineNum = typeof line === "number" ? line : line.line;
      const text = lines[lineNum] ?? "";
      return {
        lineNumber: lineNum,
        text,
        range: new Range(
          new Position(lineNum, 0),
          new Position(lineNum, text.length),
        ),
        rangeIncludingLineBreak: new Range(
          new Position(lineNum, 0),
          new Position(lineNum, text.length + 1),
        ),
        firstNonWhitespaceCharacterIndex: text.search(/\S/),
        isEmptyOrWhitespace: text.trim().length === 0,
      };
    },
    positionAt: (offset: number): Position => {
      let remaining = offset;
      for (let i = 0; i < lines.length; i++) {
        if (remaining <= lines[i].length) {
          return new Position(i, remaining);
        }
        remaining -= lines[i].length + 1; // +1 for newline
      }
      return new Position(lines.length - 1, lines[lines.length - 1].length);
    },
    offsetAt: (position: Position): number => {
      let offset = 0;
      for (let i = 0; i < position.line; i++) {
        offset += lines[i].length + 1;
      }
      return offset + position.character;
    },
    getWordRangeAtPosition: (
      position: Position,
      regex: RegExp = /\w+/g,
    ): Range | undefined => {
      const line = lines[position.line];
      if (!line) return undefined;
      // Ensure the pattern has the global flag to prevent infinite loops with RegExp exec()
      const pattern = regex.global
        ? regex
        : new RegExp(regex.source, regex.flags + "g");
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (position.character >= start && position.character <= end) {
          return new Range(
            new Position(position.line, start),
            new Position(position.line, end),
          );
        }
      }
      return undefined;
    },
  };
}

export function createMockCancellationToken(
  isCancelled = false,
): CancellationToken {
  return {
    isCancellationRequested: isCancelled,
    onCancellationRequested: () => ({ dispose: () => {} }),
  };
}

export function createMockCompletionContext(
  triggerKind: CompletionTriggerKind = CompletionTriggerKind.Invoke,
  triggerCharacter?: string,
): CompletionContext {
  return { triggerKind, triggerCharacter };
}

export function createMockOutputChannel(name = "Test"): OutputChannel {
  const lines: string[] = [];
  return {
    name,
    append: (value: string) => lines.push(value),
    appendLine: (value: string) => lines.push(value + "\n"),
    clear: () => (lines.length = 0),
    show: () => {},
    hide: () => {},
    dispose: () => {},
  };
}

export function createMockStatusBarItem(): StatusBarItem {
  return {
    alignment: StatusBarAlignment.Right,
    text: "",
    show: () => {},
    hide: () => {},
    dispose: () => {},
  };
}

// ============================================================================
// Namespace Mocks
// ============================================================================

export const commands = {
  executeCommand: async <T>(
    _command: string,
    ..._args: unknown[]
  ): Promise<T | undefined> => {
    return undefined;
  },
  registerCommand: (
    _command: string,
    _callback: (...args: unknown[]) => unknown,
  ) => {
    return { dispose: () => {} };
  },
};

export const workspace = {
  workspaceFolders: [] as WorkspaceFolder[],
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => defaultValue,
    has: (_key: string) => false,
    update: async () => {},
  }),
  openTextDocument: async (uri: Uri): Promise<TextDocument> => {
    return createMockTextDocument({ uri });
  },
  createFileSystemWatcher: (_pattern: string): FileSystemWatcher => ({
    onDidChange: () => ({ dispose: () => {} }),
    onDidCreate: () => ({ dispose: () => {} }),
    onDidDelete: () => ({ dispose: () => {} }),
    dispose: () => {},
  }),
  onDidChangeTextDocument: () => ({ dispose: () => {} }),
  onDidCloseTextDocument: () => ({ dispose: () => {} }),
};

export const window = {
  activeTextEditor: undefined as { document: TextDocument } | undefined,
  createOutputChannel: (name: string): OutputChannel =>
    createMockOutputChannel(name),
  createStatusBarItem: (
    _alignment?: StatusBarAlignment,
    _priority?: number,
  ): StatusBarItem => createMockStatusBarItem(),
  showWarningMessage: async (_message: string) => undefined,
  showErrorMessage: async (_message: string) => undefined,
  showInformationMessage: async (_message: string) => undefined,
  createWebviewPanel: (
    viewType: string,
    title: string,
    _viewColumn: ViewColumn,
    _options?: { enableScripts?: boolean; retainContextWhenHidden?: boolean },
  ): WebviewPanel => ({
    viewType,
    title,
    webview: { html: "", postMessage: () => {} },
    visible: true,
    reveal: () => {},
    dispose: () => {},
    onDidDispose: () => ({ dispose: () => {} }),
    onDidChangeViewState: () => ({ dispose: () => {} }),
  }),
  onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
  onDidChangeTextEditorSelection: () => ({ dispose: () => {} }),
};

export const languages = {
  createDiagnosticCollection: (name: string): DiagnosticCollection => ({
    name,
    set: () => {},
    delete: () => {},
    clear: () => {},
    dispose: () => {},
  }),
  registerCompletionItemProvider: () => ({ dispose: () => {} }),
  registerHoverProvider: () => ({ dispose: () => {} }),
  registerDefinitionProvider: () => ({ dispose: () => {} }),
};

// ============================================================================
// Disposable
// ============================================================================

export interface Disposable {
  dispose(): void;
}

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];

  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return {
      dispose: () => this.listeners.splice(this.listeners.indexOf(listener), 1),
    };
  };

  fire(event: T) {
    this.listeners.forEach((l) => l(event));
  }

  dispose() {
    this.listeners = [];
  }
}
