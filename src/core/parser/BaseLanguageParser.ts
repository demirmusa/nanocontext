/* eslint-disable @typescript-eslint/no-explicit-any */
import * as TreeSitter from 'web-tree-sitter';
import * as path from 'path';
import { ILanguageParser } from '../interfaces/IParser';
import { ParsedFile, ParsedClassInfo, ParsedMethodInfo } from '../interfaces/types';

type SyntaxNode = any;
type TreeSitterParser = any;

export abstract class BaseLanguageParser implements ILanguageParser {
  abstract readonly language: string;
  abstract readonly extensions: string[];
  protected parser: TreeSitterParser | null = null;
  private static initialized = false;

  protected abstract getWasmFileName(): string;
  protected abstract extractClasses(rootNode: SyntaxNode, content: string): ParsedClassInfo[];
  protected abstract extractMethods(rootNode: SyntaxNode, content: string): ParsedMethodInfo[];
  protected abstract extractImports(rootNode: SyntaxNode, content: string): string[];
  protected abstract extractExports(rootNode: SyntaxNode, content: string): string[];

  async ensureInitialized(): Promise<void> {
    if (this.parser) return;

    const TS = TreeSitter as any;
    // web-tree-sitter@0.24.x exports the Parser constructor directly
    const ParserClass = typeof TS === 'function' ? TS : (TS.default || TS.Parser || TS);

    if (!BaseLanguageParser.initialized) {
      await ParserClass.init();
      BaseLanguageParser.initialized = true;
    }

    this.parser = new ParserClass();
    const langWasm = path.join(
      path.dirname(require.resolve('tree-sitter-wasms/package.json')),
      'out',
      this.getWasmFileName(),
    );
    const lang = await ParserClass.Language.load(langWasm);
    this.parser.setLanguage(lang);
  }

  async parse(content: string, filePath: string): Promise<ParsedFile> {
    await this.ensureInitialized();
    const tree = this.parser!.parse(content);

    return {
      file: filePath,
      lang: this.language,
      classes: this.extractClasses(tree.rootNode, content),
      methods: this.extractMethods(tree.rootNode, content),
      imports: this.extractImports(tree.rootNode, content),
      exports: this.extractExports(tree.rootNode, content),
    };
  }

  protected nodeText(node: SyntaxNode, content: string): string {
    return content.substring(node.startIndex, node.endIndex);
  }

  protected locString(node: SyntaxNode): string {
    return `${node.startPosition.row + 1}-${node.endPosition.row + 1}`;
  }

  protected findAll(node: SyntaxNode, type: string): SyntaxNode[] {
    const results: SyntaxNode[] = [];
    const cursor = node.walk();

    const visit = (): void => {
      if (cursor.nodeType === type) {
        results.push(cursor.currentNode);
      }
      if (cursor.gotoFirstChild()) {
        do { visit(); } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };
    visit();
    return results;
  }

  protected findAllTypes(node: SyntaxNode, types: string[]): SyntaxNode[] {
    const typeSet = new Set(types);
    const results: SyntaxNode[] = [];
    const cursor = node.walk();

    const visit = (): void => {
      if (typeSet.has(cursor.nodeType)) {
        results.push(cursor.currentNode);
      }
      if (cursor.gotoFirstChild()) {
        do { visit(); } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };
    visit();
    return results;
  }

  protected extractCallRefs(node: SyntaxNode, content: string): string[] {
    const calls = this.findAll(node, 'call_expression');
    const refs = new Set<string>();

    for (const call of calls) {
      const fn = call.childForFieldName('function');
      if (fn) {
        refs.add(this.nodeText(fn, content));
      }
    }
    return Array.from(refs);
  }
}
