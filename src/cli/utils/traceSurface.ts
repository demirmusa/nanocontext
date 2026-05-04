import { TraceRelation, TraceSurfaceResult } from '../../core/interfaces/types';
import { colors } from './colors';

export function printTraceSurface(surface: TraceSurfaceResult, emptyLabel: string): void {
  if (surface.target) {
    console.log(`${colors.bold(surface.target.symbol)} ${colors.dim(`${surface.target.path} [${surface.target.range}]`)}`);
  }

  if (surface.results.length === 0) {
    console.log(colors.dim(emptyLabel));
  } else {
    for (const item of surface.results) {
      console.log(renderRelation(item));
    }
  }

  if (surface.warning) {
    console.log('');
    console.log(colors.dim(surface.warning));
  }
}

function renderRelation(item: TraceRelation): string {
  return `${item.symbol} ${colors.dim(`${item.path} [${item.range}]`)}`;
}
