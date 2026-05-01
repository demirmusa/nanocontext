/* eslint-disable @typescript-eslint/no-explicit-any */
import * as TreeSitter from 'web-tree-sitter';
import * as path from 'path';
import { ILanguageParser } from '../interfaces/IParser';
import { ParsedFile, ParsedClassInfo, ParsedMethodInfo, StateReferenceInfo } from '../interfaces/types';

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

  protected extractStateReferences(node: SyntaxNode, content: string): StateReferenceInfo[] {
    const text = this.nodeText(node, content);
    const refs = new Map<string, StateReferenceInfo>();
    const lineStarts = buildLineStarts(text);
    const pathPattern = /\b(?:this|props|state|store|config|settings|options|[A-Z][A-Za-z0-9_]*Config)\??(?:\.[A-Za-z_$][\w$]*)+\b/g;
    let match: RegExpExecArray | null;

    while ((match = pathPattern.exec(text)) !== null) {
      const path = match[0].replace(/\?\./g, '.');
      const after = text.slice(match.index + match[0].length);
      if (/^\s*\(/.test(after)) {
        continue;
      }

      const line = node.startPosition.row + findLineForIndex(lineStarts, match.index) + 1;
      const kind = /^\s*(?:\+\+|--|\?\?=|\|\|=|&&=|[+\-*/%]?=(?!=|>))/.test(after) ? 'write' : 'read';
      const key = `${path}:${line}:${kind}`;
      if (!refs.has(key)) {
        refs.set(key, {
          path,
          range: `${line}-${line}`,
          kind,
          context: extractLineAt(text, match.index).trim(),
        });
      }
    }

    return Array.from(refs.values());
  }
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function findLineForIndex(starts: number[], index: number): number {
  let line = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] > index) break;
    line = i;
  }
  return line;
}

function extractLineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? undefined : end);
}
