import * as fs from "node:fs";

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

export const C_FUNCTION_DECLARATION_PATTERN =
  /^(void|int|bool|char|float|double|uint\d+_t|int\d+_t)\s+\w+\s*\([^)]*\)\s*\{?$/;

export const INDENTED_LINE_PATTERN = /^\s{4,}/;

export const INDENTATION_PATTERN = /^(\s+)/;
