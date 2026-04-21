export { ParserRegistry } from './ParserRegistry';
export { BaseLanguageParser } from './BaseLanguageParser';
export { TypeScriptParser } from './languages/TypeScriptParser';
export { JavaScriptParser } from './languages/JavaScriptParser';
export { CSharpParser } from './languages/CSharpParser';

import { ParserRegistry } from './ParserRegistry';
import { TypeScriptParser } from './languages/TypeScriptParser';
import { JavaScriptParser } from './languages/JavaScriptParser';
import { CSharpParser } from './languages/CSharpParser';

/**
 * Create a ParserRegistry pre-loaded with all built-in language parsers.
 */
export function createDefaultRegistry(): ParserRegistry {
  const registry = new ParserRegistry();
  registry.register(new TypeScriptParser());
  registry.register(new JavaScriptParser());
  registry.register(new CSharpParser());
  return registry;
}
