/**
 * Naive tokenizer shared by the search-index consumer, the full reindex, and
 * the seeded fixtures — one term source, so the seeded index can never drift
 * from what `search.index` would derive.
 *
 * Deliberately simple: the showcase is the reactive indexing pattern, not
 * search quality.
 */

import type { Revision, StashFile } from '../store.js';

/** Cap on indexed characters per file so seeds and reindex stay cheap. */
const CONTENT_INDEX_LIMIT = 2000;

const MIN_TERM_LENGTH = 2;

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= MIN_TERM_LENGTH);

/** Tokenize a user query with the same rules the index uses. */
export const tokenizeQuery = (query: string): string[] => [
  ...new Set(tokenize(query)),
];

const fileTerms = (file: StashFile): string[] => {
  const terms = [file.name.toLowerCase(), ...tokenize(file.name)];
  if (file.language !== undefined) {
    terms.push(...tokenize(file.language));
  }
  if (file.encoding !== 'base64') {
    terms.push(...tokenize(file.content.slice(0, CONTENT_INDEX_LIMIT)));
  }
  return terms;
};

/**
 * Derive the deduplicated, sorted term set for a snippet from its description
 * and the files of its latest revision.
 */
export const deriveSearchTerms = (
  description: string,
  files: Revision['files']
): readonly string[] => {
  const terms = new Set<string>(tokenize(description));
  for (const file of files) {
    for (const term of fileTerms(file)) {
      terms.add(term);
    }
  }
  return [...terms].toSorted();
};
