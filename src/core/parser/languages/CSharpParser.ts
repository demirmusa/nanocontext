/* eslint-disable @typescript-eslint/no-explicit-any */
import { BaseLanguageParser } from '../BaseLanguageParser';

import { ParsedClassInfo, ParsedMethodInfo } from '../../interfaces/types';

export class CSharpParser extends BaseLanguageParser {
  readonly language = 'csharp';
  readonly extensions = ['.cs'];

  protected getWasmFileName(): string {
    return 'tree-sitter-c_sharp.wasm';
  }

  // ------------------------------------------------------------------
  // Classes (also structs, records, interfaces)
  // ------------------------------------------------------------------

  protected extractClasses(rootNode: any, content: string): ParsedClassInfo[] {
    const classes: ParsedClassInfo[] = [];
    const typeKinds = [
      'class_declaration',
      'struct_declaration',
      'record_declaration',
      'interface_declaration',
    ];
    const typeNodes = this.findAllTypes(rootNode, typeKinds);

    for (const node of typeNodes) {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) continue;

      const name = this.nodeText(nameNode, content);
      let extendsName: string | undefined;
      let implementsList: string[] | undefined;

      // base_list contains base types: class Foo : Bar, IFoo, IBaz
      const baseList = node.children.find((c: any) => c.type === 'base_list');
      if (baseList) {
        const baseTypes: string[] = [];
        for (const child of baseList.children) {
          // Each base type may be an identifier, generic_name, qualified_name, etc.
          if (
            child.type === 'identifier' ||
            child.type === 'generic_name' ||
            child.type === 'qualified_name' ||
            child.type === 'predefined_type'
          ) {
            baseTypes.push(this.nodeText(child, content));
          }
        }

        if (baseTypes.length > 0) {
          if (node.type === 'class_declaration' || node.type === 'record_declaration') {
            // Convention: first item that does not start with "I" followed by
            // an uppercase letter is likely the base class. Items starting with
            // "I" + uppercase are interfaces.
            const base = baseTypes.find(t => !/^I[A-Z]/.test(t));
            const ifaces = baseTypes.filter(t => t !== base);

            if (base) extendsName = base;
            if (ifaces.length > 0) implementsList = ifaces;
          } else {
            // struct / interface: all are "implements" semantically
            implementsList = baseTypes;
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

    const methodKinds = [
      'method_declaration',
      'constructor_declaration',
    ];
    const methodNodes = this.findAllTypes(rootNode, methodKinds);

    for (const node of methodNodes) {
      const method = this.extractMethodOrCtor(node, content);
      if (method) methods.push(method);
    }

    return methods;
  }

  private extractMethodOrCtor(
    node: any,
    content: string,
  ): ParsedMethodInfo | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;

    const name = this.nodeText(nameNode, content);
    const params = node.childForFieldName('parameters');
    const body = node.childForFieldName('body');

    // Owning class
    const className = this.findOwnerTypeName(node, content);

    // Collect attributes (decorators) from preceding attribute_list siblings
    const decorators: string[] = [];
    let sibling = node.previousSibling;
    while (sibling && sibling.type === 'attribute_list') {
      // Each attribute_list contains one or more attribute nodes
      const attrs = this.findAll(sibling, 'attribute');
      for (const attr of attrs) {
        decorators.unshift(`[${this.nodeText(attr, content)}]`);
      }
      sibling = sibling.previousSibling;
    }

    // Build signature
    const parts: string[] = [];

    // Modifiers: public, private, protected, internal, static, virtual, override,
    // abstract, async, new, sealed, extern, partial, unsafe, readonly
    for (const child of node.children) {
      if (child.type === 'modifier') {
        parts.push(this.nodeText(child, content));
      }
    }

    // Return type (methods have it, constructors do not)
    if (node.type === 'method_declaration') {
      const returnType = node.childForFieldName('returns');
      if (returnType) {
        parts.push(this.nodeText(returnType, content));
      }
    }

    const paramStr = params ? this.nodeText(params, content) : '()';
    parts.push(`${name}${paramStr}`);

    const refs = body ? this.extractCSharpCallRefs(body, content) : [];

    const method: ParsedMethodInfo = {
      name,
      loc: this.locString(node),
      sig: parts.join(' '),
      refs,
    };

    if (className) method.class = className;
    if (decorators.length > 0) method.decorators = decorators;

    return method;
  }

  /** Find the name of the enclosing type (class / struct / record / interface). */
  private findOwnerTypeName(
    node: any,
    content: string,
  ): string | undefined {
    const typeKinds = new Set([
      'class_declaration',
      'struct_declaration',
      'record_declaration',
      'interface_declaration',
    ]);
    let parent = node.parent;
    while (parent) {
      if (typeKinds.has(parent.type)) {
        const n = parent.childForFieldName('name');
        return n ? this.nodeText(n, content) : undefined;
      }
      parent = parent.parent;
    }
    return undefined;
  }

  /**
   * C# call references. The tree-sitter-c-sharp grammar uses
   * `invocation_expression` rather than `call_expression`.
   */
  private extractCSharpCallRefs(
    node: any,
    content: string,
  ): string[] {
    const invocations = this.findAll(node, 'invocation_expression');
    const refs = new Set<string>();

    for (const inv of invocations) {
      // The first child of invocation_expression is the callee expression
      const fn = inv.childForFieldName('function');
      if (fn) {
        refs.add(this.nodeText(fn, content));
      } else if (inv.childCount > 0) {
        // Fallback: first child is the method/member being invoked
        const first = inv.child(0);
        if (first) {
          refs.add(this.nodeText(first, content));
        }
      }
    }

    return Array.from(refs);
  }

  // ------------------------------------------------------------------
  // Imports (using directives)
  // ------------------------------------------------------------------

  protected extractImports(rootNode: any, content: string): string[] {
    const imports: string[] = [];
    const usingNodes = this.findAll(rootNode, 'using_directive');

    for (const node of usingNodes) {
      // The namespace/type is in the named child or we can extract the text
      // after "using" / "using static"
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        imports.push(this.nodeText(nameNode, content));
      } else {
        // Fallback: extract from full text, stripping "using", "static", alias, and semicolon
        const full = this.nodeText(node, content)
          .replace(/^using\s+/, '')
          .replace(/^static\s+/, '')
          .replace(/^\w+\s*=\s*/, '')
          .replace(/;$/, '')
          .trim();
        if (full) imports.push(full);
      }
    }

    return imports;
  }

  // ------------------------------------------------------------------
  // Exports (public API surface)
  // ------------------------------------------------------------------

  protected extractExports(rootNode: any, content: string): string[] {
    const exports: string[] = [];

    // Public types
    const typeKinds = [
      'class_declaration',
      'struct_declaration',
      'record_declaration',
      'interface_declaration',
      'enum_declaration',
    ];
    const typeNodes = this.findAllTypes(rootNode, typeKinds);

    for (const node of typeNodes) {
      // Check if it has a "public" modifier
      const isPublic = node.children.some(
        (c: any) => c.type === 'modifier' && this.nodeText(c, content) === 'public',
      );
      if (isPublic) {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          exports.push(this.nodeText(nameNode, content));
        }
      }
    }

    // Namespaces
    const nsNodes = this.findAllTypes(rootNode, [
      'namespace_declaration',
      'file_scoped_namespace_declaration',
    ]);
    for (const ns of nsNodes) {
      const nameNode = ns.childForFieldName('name');
      if (nameNode) {
        const nsName = this.nodeText(nameNode, content);
        if (!exports.includes(nsName)) exports.push(nsName);
      }
    }

    return exports;
  }
}
