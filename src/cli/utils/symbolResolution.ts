import { SymbolResolution } from '../../core/interfaces/types';
import { colors } from './colors';

export function printSymbolResolution(resolution: SymbolResolution): void {
  if (!resolution.matched) {
    console.log(colors.dim(`No symbol match found for ${resolution.query}.`));
    return;
  }

  console.log(`${colors.bold(resolution.matched.display)} ${colors.dim(`${resolution.matched.file} [${resolution.matched.loc}]`)}`);

  if (resolution.candidates.length > 1) {
    const candidates = resolution.candidates.slice(1, 3);
    if (candidates.length > 0) {
      console.log(colors.dim(`ambiguous: ${resolution.candidates.length} candidates`));
      for (const candidate of candidates) {
        console.log(colors.dim(`  ${candidate.display} ${candidate.file} [${candidate.loc}]`));
      }
    }
  }
}
