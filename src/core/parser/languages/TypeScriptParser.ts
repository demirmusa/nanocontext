/* eslint-disable @typescript-eslint/no-explicit-any */
import { BaseLanguageParser } from '../BaseLanguageParser';

import { ParsedClassInfo, ParsedMethodInfo } from '../../interfaces/types';

export class TypeScriptParser extends BaseLanguageParser {
  readonly language = 'typescript';
  readonly extensions = ['.ts', '.tsx'];

  protected getWasmFileName(): string {
    return 'tree-sitter-typescript.wasm';
  }

  // ------------------------------------------------------------------
  // Classes
  // ------------------------------------------------------------------

  protected extractClasses(rootNode: any, content: string): ParsedClassInfo[] {
    const classes: ParsedClassInfo[] = [];
    const classNodes = this.findAll(rootNode, 'class_declaration');

    for (const node of classNodes) {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) continue;

      const name = this.nodeText(nameNode, content);
      let extendsName: string | undefined;
      let implementsList: string[] | undefined;

      // extends_clause is a direct child of class_declaration
      for (const child of node.children) {
        if (child.type === 'extends_clause') {
          // The type that follows the "extends" keyword
          for (const c of child.children) {
            if (c.type !== 'extends') {
              extendsName = this.nodeText(c, content);
              break;
            }
          }
        }
        if (child.type === 'implements_clause') {
          implementsList = [];
          for (const c of child.children) {
            if (c.type === 'type_identifier' || c.type === 'generic_type') {
              implementsList.push(this.nodeText(c, content));
            }
          }
        }
      }

      const info: ParsedClassInfo = {
        name,
        loc: this.locString(node),
      };
      if (extendsName) info.extends = extendsName;
      if (implementsList && implementsList.length > 0) info.implements = implementsList;

      classes.push(info);
    }

    return classes;
  }

  // ------------------------------------------------------------------
  // Methods
  // ------------------------------------------------------------------

  protected extractMethods(rootNode: any, content: string): ParsedMethodInfo[] {
    const methods: ParsedMethodInfo[] = [];

    // 1. Class methods
    const classNodes = this.findAll(rootNode, 'class_declaration');
    for (const classNode of classNodes) {
      const classNameNode = classNode.childForFieldName('name');
      const className = classNameNode ? this.nodeText(classNameNode, content) : undefined;
      const body = classNode.childForFieldName('body');
      if (!body) continue;

      for (const child of body.children) {
        if (child.type === 'method_definition') {
          const method = this.extractMethodInfo(child, content, className);
          if (method) methods.push(method);
        }
      }
    }

    // 2. Standalone function declarations (not inside a class)
    const funcNodes = this.findAll(rootNode, 'function_declaration');
    for (const funcNode of funcNodes) {
      if (this.isInsideClass(funcNode)) continue;
      const method = this.extractFunctionInfo(funcNode, content);
      if (method) methods.push(method);
    }

    // 3. Arrow functions assigned to const/let/var
    const varDecls = this.findAllTypes(rootNode, ['lexical_declaration', 'variable_declaration']);
    for (const decl of varDecls) {
      if (this.isInsideClass(decl)) continue;
      const declarators = decl.children.filter((c: any) => c.type === 'variable_declarator');
      for (const declarator of declarators) {
        const value = declarator.childForFieldName('value');
        if (value && value.type === 'arrow_function') {
          const nameNode = declarator.childForFieldName('name');
          if (!nameNode) continue;

          const name = this.nodeText(nameNode, content);
          const params = value.childForFieldName('parameters');
          const returnType = value.childForFieldName('return_type');

          const paramStr = params ? this.nodeText(params, content) : '()';
          const retStr = returnType
            ? ': ' + this.nodeText(returnType, content).replace(/^:\s*/, '')
            : '';
          const isAsync = value.children.some((c: any) => c.type === 'async');
          const asyncPrefix = isAsync ? 'async ' : '';

          const isExport = decl.parent?.type === 'export_statement';
          const exportPrefix = isExport ? 'export ' : '';
          const keyword = decl.children[0]?.type || 'const';

          methods.push({
            name,
            loc: this.locString(decl),
            sig: `${exportPrefix}${keyword} ${asyncPrefix}${name} = ${paramStr}${retStr} => ...`,
            refs: this.extractCallRefs(value, content),
            stateRefs: this.extractStateReferences(value, content),
          });
        }
      }
    }

    return methods;
  }

  private extractMethodInfo(
    node: any,
    content: string,
    className?: string,
  ): ParsedMethodInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.nodeText(nameNode, content);
    const params = node.childForFieldName('parameters');
    const returnType = node.childForFieldName('return_type');
    const body = node.childForFieldName('body');

    // Collect decorators from preceding siblings
    const decorators: string[] = [];
    let sibling = node.previousSibling;
    while (sibling && sibling.type === 'decorator') {
      decorators.unshift(this.nodeText(sibling, content));
      sibling = sibling.previousSibling;
    }

    // Build signature parts
    const parts: string[] = [];

    // Accessibility modifier (public / private / protected)
    const accessibility = node.children.find(
      (c: any) => c.type === 'accessibility_modifier' || c.type === 'override_modifier',
    );
    if (accessibility) parts.push(this.nodeText(accessibility, content));

    // Static
    if (node.children.some((c: any) => c.type === 'static')) parts.push('static');

    // Async
    if (node.children.some((c: any) => c.type === 'async')) parts.push('async');

    // Getter / Setter
    const getSet = node.children.find((c: any) => c.type === 'get' || c.type === 'set');
    if (getSet) parts.push(this.nodeText(getSet, content));

    // Name + params + return type
    const paramStr = params ? this.nodeText(params, content) : '()';
    const retStr = returnType
      ? ': ' + this.nodeText(returnType, content).replace(/^:\s*/, '')
      : '';
    parts.push(`${name}${paramStr}${retStr}`);

    const refs = body ? this.extractCallRefs(body, content) : [];
    const stateRefs = body ? this.extractStateReferences(body, content) : [];

    const method: ParsedMethodInfo = {
      name,
      loc: this.locString(node),
      sig: parts.join(' '),
      refs,
      stateRefs,
    };

    if (className) method.class = className;
    if (decorators.length > 0) method.decorators = decorators;

    return method;
  }

  private extractFunctionInfo(
    node: any,
    content: string,
  ): ParsedMethodInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.nodeText(nameNode, content);
    const params = node.childForFieldName('parameters');
    const returnType = node.childForFieldName('return_type');
    const body = node.childForFieldName('body');

    const parts: string[] = [];

    if (node.parent?.type === 'export_statement') parts.push('export');
    if (node.children.some((c: any) => c.type === 'async')) parts.push('async');
    parts.push('function');

    const paramStr = params ? this.nodeText(params, content) : '()';
    const retStr = returnType
      ? ': ' + this.nodeText(returnType, content).replace(/^:\s*/, '')
      : '';
    parts.push(`${name}${paramStr}${retStr}`);

    return {
      name,
      loc: this.locString(node),
      sig: parts.join(' '),
      refs: body ? this.extractCallRefs(body, content) : [],
      stateRefs: body ? this.extractStateReferences(body, content) : [],
    };
  }

  private isInsideClass(node: any): boolean {
    let parent = node.parent;
    while (parent) {
      if (parent.type === 'class_declaration' || parent.type === 'class') return true;
      parent = parent.parent;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Imports
  // ------------------------------------------------------------------

  protected extractImports(rootNode: any, content: string): string[] {
    const imports: string[] = [];
    const importNodes = this.findAll(rootNode, 'import_statement');

    for (const node of importNodes) {
      const source = node.childForFieldName('source');
      if (source) {
        const text = this.nodeText(source, content).replace(/['"]/g, '');
        imports.push(text);
      }
    }

    return imports;
  }

  // ------------------------------------------------------------------
  // Exports
  // ------------------------------------------------------------------

  protected extractExports(rootNode: any, content: string): string[] {
    const exports: string[] = [];
    const exportNodes = this.findAll(rootNode, 'export_statement');

    for (const node of exportNodes) {
      // export class/function/const/interface/type/enum Name
      const declaration = node.childForFieldName('declaration');
      if (declaration) {
        const nameNode = declaration.childForFieldName('name');
        if (nameNode) {
          exports.push(this.nodeText(nameNode, content));
        } else {
          // variable_declaration may contain multiple declarators
          const declarators = this.findAll(declaration, 'variable_declarator');
          for (const d of declarators) {
            const n = d.childForFieldName('name');
            if (n) exports.push(this.nodeText(n, content));
          }
        }
      }

      // export { name1, name2 }
      const exportClause = node.children.find((c: any) => c.type === 'export_clause');
      if (exportClause) {
        const specs = exportClause.children.filter((c: any) => c.type === 'export_specifier');
        for (const spec of specs) {
          const n = spec.childForFieldName('name');
          if (n) exports.push(this.nodeText(n, content));
        }
      }

      // export default
      if (node.children.some((c: any) => c.type === 'default')) {
        exports.push('default');
      }
    }

    return exports;
  }
}
