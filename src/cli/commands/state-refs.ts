import { Container } from '../../core/Container';
import { StateReference } from '../../core/interfaces/types';
import { colors } from '../utils/colors';

export async function stateRefsCommand(query?: string, options: { kind?: 'read' | 'write'; limit?: string } = {}): Promise<void> {
  const container = new Container();
  try {
    await container.initialize();
    const refs = await container.dependencyService.getStateReferences(query, parseKind(options.kind), parseLimit(options.limit));
    printStateReferences(refs, 'No state references found.');
  } catch (err) {
    console.error(colors.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  } finally {
    container.dispose();
  }
}

export async function readersCommand(query: string, options: { limit?: string } = {}): Promise<void> {
  const container = new Container();
  try {
    await container.initialize();
    const refs = await container.dependencyService.getStateReaders(query, parseLimit(options.limit));
    printStateReferences(refs, 'No state readers found.');
  } catch (err) {
    console.error(colors.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  } finally {
    container.dispose();
  }
}

export async function writersCommand(query: string, options: { limit?: string } = {}): Promise<void> {
  const container = new Container();
  try {
    await container.initialize();
    const refs = await container.dependencyService.getStateWriters(query, parseLimit(options.limit));
    printStateReferences(refs, 'No state writers found.');
  } catch (err) {
    console.error(colors.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
  } finally {
    container.dispose();
  }
}

export function printStateReferences(refs: StateReference[], emptyLabel: string): void {
  if (refs.length === 0) {
    console.log(colors.dim(emptyLabel));
    return;
  }

  for (const ref of refs) {
    const symbol = ref.symbol ? ` ${colors.dim(`in ${ref.symbol}`)}` : '';
    const context = ref.context ? colors.dim(` ${ref.context}`) : '';
    console.log(`${ref.path} ${colors.dim(`${ref.file} [${ref.range}] (${ref.kind})`)}${symbol}${context}`);
  }
}

function parseLimit(value?: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }
  return Math.min(Math.floor(parsed), 200);
}

function parseKind(value?: string): 'read' | 'write' | undefined {
  if (!value) return undefined;
  if (value === 'read' || value === 'write') return value;
  throw new Error('--kind must be read or write');
}
