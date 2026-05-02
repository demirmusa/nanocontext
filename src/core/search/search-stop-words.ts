import { ENGLISH_SEARCH_STOP_WORDS } from './search-stop-words.en';
import { TURKISH_SEARCH_STOP_WORDS } from './search-stop-words.tr';

export type SearchStopWordLanguage = 'en' | 'tr';

const DEFAULT_SEARCH_STOP_WORD_LANGUAGES: readonly SearchStopWordLanguage[] = ['en', 'tr'];

const SEARCH_STOP_WORDS_BY_LANGUAGE: Record<SearchStopWordLanguage, readonly string[]> = {
  en: ENGLISH_SEARCH_STOP_WORDS,
  tr: TURKISH_SEARCH_STOP_WORDS,
};

export function loadSearchStopWords(
  languages: readonly SearchStopWordLanguage[] = DEFAULT_SEARCH_STOP_WORD_LANGUAGES,
): ReadonlySet<string> {
  const words = new Set<string>();
  for (const language of languages) {
    for (const word of SEARCH_STOP_WORDS_BY_LANGUAGE[language]) {
      words.add(word);
    }
  }
  return words;
}

export const SEARCH_STOP_WORDS = loadSearchStopWords();

export function isSearchStopWord(term: string): boolean {
  return SEARCH_STOP_WORDS.has(term.toLocaleLowerCase());
}
