export { ParserRegistry } from './ParserRegistry';
export { BaseLanguageParser } from './BaseLanguageParser';
export { TypeScriptParser } from './languages/TypeScriptParser';
export { JavaScriptParser } from './languages/JavaScriptParser';
export { CSharpParser } from './languages/CSharpParser';
export { PlainTextParser } from './languages/PlainTextParser';

import { ParserRegistry } from './ParserRegistry';
import { TypeScriptParser } from './languages/TypeScriptParser';
import { JavaScriptParser } from './languages/JavaScriptParser';
import { CSharpParser } from './languages/CSharpParser';
import { PlainTextParser } from './languages/PlainTextParser';

export function createDefaultRegistry(): ParserRegistry {
  const registry = new ParserRegistry();
  registry.register(new TypeScriptParser());
  registry.register(new JavaScriptParser());
  registry.register(new CSharpParser());
  registry.register(new PlainTextParser());
  return registry;
}
