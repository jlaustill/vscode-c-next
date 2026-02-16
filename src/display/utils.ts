import * as fs from "node:fs";
import { stripComments } from "../state/utils";

/**
 * Find a word in source code and return its position.
 * Skips matches inside comments (line and block comments).
 */
export function findWordInSource(
  source: string,
  word: string,
): { line: number; character: number } | null {
  const lines = source.split("\n");
  const escaped = word.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const regex = new RegExp(String.raw`\b${escaped}\b`);

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Strip comments before matching to avoid false positives
    const clean = stripComments(line);
    const match = regex.exec(clean);

    if (match) {
      return { line: lineNum, character: match.index };
    }
  }

  return null;
}

export function getAccessDescription(access: string): string {
  switch (access) {
    case "rw":
      return "read-write";
    case "ro":
      return "read-only";
    case "wo":
      return "write-only";
    case "w1c":
      return "write-1-to-clear";
    case "w1s":
      return "write-1-to-set";
    default:
      return access;
  }
}

export function getCompletionLabel(
  label: string | { label: string; description?: string },
): string {
  return typeof label === "string" ? label : label.label;
}

export function escapeRegex(str: string): string {
  return str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function findOutputPath(
  cnxFsPath: string,
  uriString: string,
  outputPathCache: Map<string, string>,
): string | null {
  const cppPath = cnxFsPath.replace(/\.cnx$/, ".cpp");
  if (fs.existsSync(cppPath)) return cppPath;
  const cPath = cnxFsPath.replace(/\.cnx$/, ".c");
  if (fs.existsSync(cPath)) return cPath;
  const cachedPath = outputPathCache.get(uriString);
  if (cachedPath && fs.existsSync(cachedPath)) return cachedPath;
  return null;
}
