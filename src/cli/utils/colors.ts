/**
 * Simple ANSI color helpers for CLI output.
 * Avoids chalk dependency (v5 is ESM-only, incompatible with CJS).
 */
export const colors = {
  green: (s: string): string => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string): string => `\x1b[33m${s}\x1b[0m`,
  red: (s: string): string => `\x1b[31m${s}\x1b[0m`,
  cyan: (s: string): string => `\x1b[36m${s}\x1b[0m`,
  blue: (s: string): string => `\x1b[34m${s}\x1b[0m`,
  magenta: (s: string): string => `\x1b[35m${s}\x1b[0m`,
  gray: (s: string): string => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string): string => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string): string => `\x1b[2m${s}\x1b[0m`,
};
