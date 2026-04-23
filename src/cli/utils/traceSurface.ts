import { TraceRelation, TraceSurfaceResult } from '../../core/interfaces/types';
import { colors } from './colors';

export function printTraceSurface(surface: TraceSurfaceResult, emptyLabel: string): void {
  if (surface.target) {
    console.log(`${colors.bold(surface.target.symbol)} ${colors.dim(`${surface.target.path} [${surface.target.range}]`)}`);
    if (surface.target.reason) {
      console.log(colors.dim(`  ${surface.target.reason}`));
    }
  }

  if (surface.results.length === 0) {
    console.log(colors.dim(emptyLabel));
  } else {
    for (const item of surface.results) {
      console.log(renderRelation(item));
    }
  }

  if (surface.related?.length) {
    console.log('');
    console.log(colors.dim('Related:'));
    for (const item of surface.related) {
      console.log(colors.dim(`  ${renderRelation(item)}`));
    }
  }

  if (surface.warning) {
    console.log('');
    console.log(colors.dim(surface.warning));
  }

  if (surface.suggestedNext) {
    console.log('');
    console.log(colors.dim(`Next: ${surface.suggestedNext}`));
  }
}

function renderRelation(item: TraceRelation): string {
  const reason = item.reason ? colors.dim(` ${item.reason}`) : '';
  return `${item.symbol} ${colors.dim(`${item.path} [${item.range}]`)} ${colors.dim(`(${item.kind}, ${item.confidence})`)}${reason}`;
}
