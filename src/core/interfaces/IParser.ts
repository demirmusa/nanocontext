import { ParsedFile } from './types';

export interface ILanguageParser {
  readonly language: string;
  readonly extensions: string[];
  parse(content: string, filePath: string): Promise<ParsedFile>;
}

export interface IParserRegistry {
  register(parser: ILanguageParser): void;
  getParser(filePath: string): ILanguageParser | null;
  getSupportedLanguages(): string[];
  getSupportedExtensions(): string[];
}
