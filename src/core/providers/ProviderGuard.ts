import { IEmbeddingProvider } from '../interfaces/IEmbeddingProvider';
import { ILLMProvider, FileInsightResult, SmartSearchSelectionResult } from '../interfaces/ILLMProvider';
import { SmartSearchCandidate } from '../interfaces/types';

export interface ProviderGuardStats {
  attempts: number;
  retries: number;
  failures: number;
  timeouts: number;
  rateLimits: number;
  nonRetryableFailures: number;
}

interface GuardOptions {
  provider: string;
  maxConcurrency: number;
  maxRetries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
}

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}

export class GuardedEmbeddingProvider implements IEmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private guard: ProviderGuard;

  constructor(private inner: IEmbeddingProvider, options?: Partial<GuardOptions>) {
    this.name = inner.name;
    this.dimensions = inner.dimensions;
    this.guard = new ProviderGuard({
      provider: inner.name,
      maxConcurrency: providerConcurrency(inner.name),
      ...options,
    });
  }

  isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  embed(text: string): Promise<number[]> {
    return this.guard.run(() => this.inner.embed(text));
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }

  getProviderGuardStats(): ProviderGuardStats {
    return this.guard.getStats();
  }
}

export class GuardedLLMProvider implements ILLMProvider {
  readonly name: string;
  private guard: ProviderGuard;

  constructor(private inner: ILLMProvider, options?: Partial<GuardOptions>) {
    this.name = inner.name;
    this.guard = new ProviderGuard({
      provider: inner.name,
      maxConcurrency: providerConcurrency(inner.name),
      ...options,
    });
  }

  isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  generateFileInsights(methods: { id: string; name: string; code: string }[], language: string): Promise<FileInsightResult> {
    return this.guard.run(() => this.inner.generateFileInsights(methods, language));
  }

  selectRelevantSearchResults(
    query: string,
    candidates: SmartSearchCandidate[],
    limit: number,
  ): Promise<SmartSearchSelectionResult> {
    return this.guard.run(() => this.inner.selectRelevantSearchResults(query, candidates, limit));
  }

  getProviderGuardStats(): ProviderGuardStats {
    return this.guard.getStats();
  }
}

class ProviderGuard {
  private semaphore: Semaphore;
  private stats: ProviderGuardStats = {
    attempts: 0,
    retries: 0,
    failures: 0,
    timeouts: 0,
    rateLimits: 0,
    nonRetryableFailures: 0,
  };
  private maxRetries: number;
  private timeoutMs: number;
  private baseDelayMs: number;

  constructor(options: GuardOptions) {
    this.semaphore = new Semaphore(Math.max(1, options.maxConcurrency));
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.baseDelayMs = options.baseDelayMs ?? 400;
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    return this.semaphore.run(() => this.runWithRetry(operation));
  }

  getStats(): ProviderGuardStats {
    return { ...this.stats };
  }

  private async runWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      attempt++;
      this.stats.attempts++;
      try {
        return await withTimeout(operation(), this.timeoutMs);
      } catch (error) {
        if (isTimeoutError(error)) {
          this.stats.timeouts++;
        }
        if (isRateLimitError(error)) {
          this.stats.rateLimits++;
        }
        if (!isRetryableProviderError(error) || attempt > this.maxRetries) {
          this.stats.failures++;
          if (!isRetryableProviderError(error)) {
            this.stats.nonRetryableFailures++;
          }
          throw error;
        }
        this.stats.retries++;
        await sleep(backoffDelay(this.baseDelayMs, attempt));
      }
    }
  }
}

function providerConcurrency(provider: string): number {
  switch (provider) {
    case 'openai':
    case 'anthropic':
      return 4;
    case 'ollama':
      return 2;
    default:
      return 2;
  }
}

function isRetryableProviderError(error: unknown): boolean {
  if (isTimeoutError(error) || isRateLimitError(error)) {
    return true;
  }
  const status = errorStatus(error);
  return status === 408 || status === 409 || status === 425 || (status !== undefined && status >= 500);
}

function isRateLimitError(error: unknown): boolean {
  return errorStatus(error) === 429 || /rate.?limit|too many requests/i.test(errorMessage(error));
}

function isTimeoutError(error: unknown): boolean {
  return errorMessage(error) === 'provider-timeout' || /timeout|timed out|ETIMEDOUT/i.test(errorMessage(error));
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
    const status = candidate.status ?? candidate.statusCode;
    if (typeof status === 'number') return status;
    if (typeof candidate.code === 'number') return candidate.code;
  }
  const match = errorMessage(error).match(/\b(4\d\d|5\d\d)\b/);
  return match ? Number(match[1]) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('provider-timeout')), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function backoffDelay(baseDelayMs: number, attempt: number): number {
  const jitter = Math.floor(Math.random() * 100);
  return Math.min(10_000, baseDelayMs * 2 ** (attempt - 1) + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
