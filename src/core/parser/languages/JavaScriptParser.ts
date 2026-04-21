/* eslint-disable @typescript-eslint/no-explicit-any */
import { BaseLanguageParser } from '../BaseLanguageParser';

import { ParsedClassInfo, ParsedMethodInfo } from '../../interfaces/types';

export class JavaScriptParser extends BaseLanguageParser {
  readonly language = 'javascript';
  readonly extensions = ['.js', '.jsx', '.mjs', '.cjs'];

  protected getWasmFileName(): string {
    return 'tree-sitter-javascript.wasm';
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

      // class_heritage in JS grammar contains the superclass
      const heritage = node.children.find((c: any) => c.type === 'class_heritage');
      if (heritage) {
        // The first non-keyword child is the superclass expression
        for (const child of heritage.children) {
          if (child.type !== 'extends') {
            extendsName = this.nodeText(child, content);
            break;
          }
        }
      }

      const info: ParsedClassInfo = {
        name,
        loc: this.locString(node),
      };
      if (extendsName) info.extends = extendsName;
      // JS has no implements clause

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

    // 2. Standalone function declarations
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
          // Arrow with single param may not have formal_parameters node
          const paramStr = params ? this.nodeText(params, content) : '()';

          const isAsync = value.children.some((c: any) => c.type === 'async');
          const asyncPrefix = isAsync ? 'async ' : '';

          const isExport = decl.parent?.type === 'export_statement';
          const exportPrefix = isExport ? 'export ' : '';
          const keyword = decl.children[0]?.type || 'const';

          methods.push({
            name,
            loc: this.locString(decl),
            sig: `${exportPrefix}${keyword} ${asyncPrefix}${name} = ${paramStr} => ...`,
            refs: this.extractCallRefs(value, content),
          });
        }
      }
    }

    // 4. Prototype/object method assignments: obj.prop = function(...) { ... }
    //    e.g. req.header = function header(name) { ... }
    const capturedFuncNodes = new Set<any>();
    const assignExprs = this.findAll(rootNode, 'assignment_expression');
    for (const assign of assignExprs) {
      if (this.isInsideClass(assign)) continue;

      const left = assign.childForFieldName('left');
      if (!left || left.type !== 'member_expression') continue;

      const right = assign.childForFieldName('right');
      if (!right || (right.type !== 'function_expression' && right.type !== 'arrow_function')) continue;

      const propNode = left.childForFieldName('property');
      if (!propNode) continue;

      const propName = this.nodeText(propNode, content);
      const objNode = left.childForFieldName('object');
      const objName = objNode ? this.nodeText(objNode, content) : '';

      const params = right.childForFieldName('parameters');
      const paramStr = params ? this.nodeText(params, content) : '()';
      const body = right.childForFieldName('body');

      const isAsync = right.children.some((c: any) => c.type === 'async');
      const asyncPrefix = isAsync ? 'async ' : '';

      capturedFuncNodes.add(right);

      methods.push({
        name: propName,
        loc: this.locString(assign.parent?.type === 'expression_statement' ? assign.parent : assign),
        sig: `${objName}.${propName} = ${asyncPrefix}function${paramStr}`,
        refs: body ? this.extractCallRefs(body, content) : [],
      });
    }

    // 5. Function expressions passed as arguments in call expressions
    //    e.g. defineGetter(req, 'query', function query() { ... })
    const callExprs = this.findAll(rootNode, 'call_expression');
    for (const call of callExprs) {
      if (this.isInsideClass(call)) continue;

      const args = call.childForFieldName('arguments');
      if (!args) continue;

      const argChildren = args.children.filter(
        (c: any) => c.type !== '(' && c.type !== ')' && c.type !== ','
      );

      for (const arg of argChildren) {
        if (arg.type !== 'function_expression') continue;
        if (capturedFuncNodes.has(arg)) continue;

        const funcNameNode = arg.childForFieldName('name');
        let name: string | undefined;

        if (funcNameNode) {
          name = this.nodeText(funcNameNode, content);
        } else {
          // Derive name from a preceding string argument (e.g. defineGetter(obj, 'name', fn))
          const argIndex = argChildren.indexOf(arg);
          for (let i = argIndex - 1; i >= 0; i--) {
            if (argChildren[i].type === 'string') {
              name = this.nodeText(argChildren[i], content).replace(/['"]/g, '');
              break;
            }
          }
        }

        if (!name) continue;

        const params = arg.childForFieldName('parameters');
        const paramStr = params ? this.nodeText(params, content) : '()';
        const body = arg.childForFieldName('body');

        capturedFuncNodes.add(arg);

        methods.push({
          name,
          loc: this.locString(call.parent?.type === 'expression_statement' ? call.parent : call),
          sig: `function ${name}${paramStr}`,
          refs: body ? this.extractCallRefs(body, content) : [],
        });
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
    const body = node.childForFieldName('body');

    const parts: string[] = [];

    // Static
    if (node.children.some((c: any) => c.type === 'static')) parts.push('static');

    // Async
    if (node.children.some((c: any) => c.type === 'async')) parts.push('async');

    // Getter / Setter
    const getSet = node.children.find((c: any) => c.type === 'get' || c.type === 'set');
    if (getSet) parts.push(this.nodeText(getSet, content));

    const paramStr = params ? this.nodeText(params, content) : '()';
    parts.push(`${name}${paramStr}`);

    const refs = body ? this.extractCallRefs(body, content) : [];

    const method: ParsedMethodInfo = {
      name,
      loc: this.locString(node),
      sig: parts.join(' '),
      refs,
    };

    if (className) method.class = className;

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
    const body = node.childForFieldName('body');

    const parts: string[] = [];

    if (node.parent?.type === 'export_statement') parts.push('export');
    if (node.children.some((c: any) => c.type === 'async')) parts.push('async');
    parts.push('function');

    const paramStr = params ? this.nodeText(params, content) : '()';
    parts.push(`${name}${paramStr}`);

    return {
      name,
      loc: this.locString(node),
      sig: parts.join(' '),
      refs: body ? this.extractCallRefs(body, content) : [],
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

    // ESM: import ... from 'module'
    const importNodes = this.findAll(rootNode, 'import_statement');
    for (const node of importNodes) {
      const source = node.childForFieldName('source');
      if (source) {
        const text = this.nodeText(source, content).replace(/['"]/g, '');
        imports.push(text);
      }
    }

    // CJS: require('module')
    const callNodes = this.findAll(rootNode, 'call_expression');
    for (const call of callNodes) {
      const fn = call.childForFieldName('function');
      if (fn && this.nodeText(fn, content) === 'require') {
        const args = call.childForFieldName('arguments');
        if (args) {
          // First argument should be a string
          const firstArg = args.children.find(
            (c: any) => c.type === 'string' || c.type === 'template_string',
          );
          if (firstArg) {
            const text = this.nodeText(firstArg, content).replace(/['"`]/g, '');
            if (text && !imports.includes(text)) {
              imports.push(text);
            }
          }
        }
      }
    }

    return imports;
  }

  // ------------------------------------------------------------------
  // Exports
  // ------------------------------------------------------------------

  protected extractExports(rootNode: any, content: string): string[] {
    const exports: string[] = [];

    // ESM exports
    const exportNodes = this.findAll(rootNode, 'export_statement');
    for (const node of exportNodes) {
      // export class/function/const Name
      const declaration = node.childForFieldName('declaration');
      if (declaration) {
        const nameNode = declaration.childForFieldName('name');
        if (nameNode) {
          exports.push(this.nodeText(nameNode, content));
        } else {
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

    // CJS: module.exports = Name  or  module.exports = { ... }
    const assignments = this.findAll(rootNode, 'assignment_expression');
    for (const assign of assignments) {
      const left = assign.childForFieldName('left');
      if (left && this.nodeText(left, content) === 'module.exports') {
        const right = assign.childForFieldName('right');
        if (right) {
          if (right.type === 'identifier') {
            const name = this.nodeText(right, content);
            if (!exports.includes(name)) exports.push(name);
          } else if (right.type === 'object') {
            // module.exports = { foo, bar }
            for (const child of right.children) {
              if (child.type === 'shorthand_property_identifier') {
                const name = this.nodeText(child, content);
                if (!exports.includes(name)) exports.push(name);
              } else if (child.type === 'pair') {
                const key = child.childForFieldName('key');
                if (key) {
                  const name = this.nodeText(key, content);
                  if (!exports.includes(name)) exports.push(name);
                }
              }
            }
          }
        }
      }
    }

    return exports;
  }
}
