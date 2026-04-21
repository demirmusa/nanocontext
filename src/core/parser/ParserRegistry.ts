import { IParserRegistry, ILanguageParser } from '../interfaces/IParser';
import * as path from 'path';

/**
 * Registry that maps file extensions to language parsers.
 * Implements IParserRegistry.
 */
export class ParserRegistry implements IParserRegistry {
  private parsers: Map<string, ILanguageParser> = new Map();
  private languageParsers: ILanguageParser[] = [];

  /**
   * Register a language parser. All of its declared extensions
   * will be mapped to this parser instance.
   */
  register(parser: ILanguageParser): void {
    this.languageParsers.push(parser);
    for (const ext of parser.extensions) {
      // Normalise: ensure extension starts with '.'
      const normalised = ext.startsWith('.') ? ext : `.${ext}`;
      this.parsers.set(normalised.toLowerCase(), parser);
    }
  }

  /**
   * Find the parser that can handle `filePath` based on its extension.
   * Returns null if no parser is registered for the extension.
   */
  getParser(filePath: string): ILanguageParser | null {
    const ext = path.extname(filePath).toLowerCase();
    return this.parsers.get(ext) ?? null;
  }

  /**
   * List all registered language names (deduplicated).
   */
  getSupportedLanguages(): string[] {
    const seen = new Set<string>();
    for (const p of this.languageParsers) {
      seen.add(p.language);
    }
    return Array.from(seen);
  }

  /**
   * List all registered file extensions.
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.parsers.keys());
  }
}
