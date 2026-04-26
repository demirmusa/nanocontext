import { ILLMProvider, ILLMProviderFactory } from '../interfaces/ILLMProvider';
import { LLMConfig } from '../interfaces/types';
import { OllamaLLMProvider } from './providers/OllamaLLMProvider';
import { OpenAILLMProvider } from './providers/OpenAILLMProvider';
import { AnthropicLLMProvider } from './providers/AnthropicLLMProvider';
import { CodexCliLLMProvider } from './providers/CodexCliLLMProvider';

export class LLMProviderFactory implements ILLMProviderFactory {
  private providerMap = new Map<string, new (config: LLMConfig) => ILLMProvider>();

  constructor() {
    this.providerMap.set('ollama', OllamaLLMProvider);
    this.providerMap.set('openai', OpenAILLMProvider);
    this.providerMap.set('anthropic', AnthropicLLMProvider);
    this.providerMap.set('codex-cli', CodexCliLLMProvider as new (config: LLMConfig) => ILLMProvider);
  }

  create(config: LLMConfig): ILLMProvider {
    const ProviderClass = this.providerMap.get(config.provider);
    if (!ProviderClass) {
      throw new Error(`Unknown LLM provider: ${config.provider}. Available: ${this.getAvailableProviders().join(', ')}`);
    }
    return new ProviderClass(config);
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providerMap.keys());
  }

  registerProvider(name: string, providerClass: new (config: LLMConfig) => ILLMProvider): void {
    this.providerMap.set(name, providerClass);
  }
}
