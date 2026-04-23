import { SymbolResolution } from '../../core/interfaces/types';
import { colors } from './colors';

export function printSymbolResolution(resolution: SymbolResolution): void {
  if (!resolution.matched) {
    console.log(colors.dim(`No symbol match found for ${resolution.query}.`));
    return;
  }

  console.log(`${colors.bold(resolution.matched.display)} ${colors.dim(`${resolution.matched.file} [${resolution.matched.loc}]`)}`);
  console.log(colors.dim(`  match: ${resolution.matched.matchType ?? 'fallback'}  confidence: ${resolution.matched.confidence ?? 'low'}`));

  if (resolution.candidates.length > 1) {
    console.log('');
    console.log(colors.dim('Candidates:'));
    for (const candidate of resolution.candidates.slice(0, 5)) {
      console.log(colors.dim(`  ${candidate.display} ${candidate.file} [${candidate.loc}] (${candidate.matchType ?? 'fallback'}, ${candidate.confidence ?? 'low'})`));
    }
  }

  if (resolution.reason) {
    console.log('');
    console.log(colors.dim(resolution.reason));
  }
}
