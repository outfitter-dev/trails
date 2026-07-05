/**
 * Deterministic seed fixtures shared by the db resource's mock and runtime
 * paths, trail examples, and tests.
 *
 * Every id and timestamp is pinned so trail examples can assert full expected
 * outputs — the deterministic-seed-id convention from the Trails testing
 * guidance.
 */

import { deriveSearchTerms } from './search/terms.js';
import type {
  Revision,
  SearchEntry,
  SnippetRow,
  Star,
  Token,
  User,
} from './store.js';

const AT = '2026-01-01T00:00:00.000Z';
const LATER = '2026-01-02T00:00:00.000Z';

export const seedUsers: readonly User[] = [
  { createdAt: AT, id: 'usr_alice', name: 'alice' },
  { createdAt: AT, id: 'usr_bob', name: 'bob' },
];

export const seedTokens: readonly Token[] = [
  {
    createdAt: AT,
    id: 'tok_alice',
    name: 'alice-dev',
    revoked: false,
    scopes: [
      'snippet:write',
      'snippet:interact',
      'token:manage',
      'search:admin',
    ],
    secret: 'stash_alice_dev_token',
    userId: 'usr_alice',
  },
  {
    createdAt: AT,
    id: 'tok_alice_spare',
    name: 'alice-spare',
    revoked: false,
    scopes: ['snippet:write'],
    secret: 'stash_alice_spare_token',
    userId: 'usr_alice',
  },
  {
    createdAt: AT,
    id: 'tok_bob',
    name: 'bob-dev',
    revoked: false,
    scopes: ['snippet:write', 'snippet:interact'],
    secret: 'stash_bob_dev_token',
    userId: 'usr_bob',
  },
];

export const seedSnippets: readonly SnippetRow[] = [
  {
    createdAt: AT,
    description: 'Greet the trail crew from TypeScript',
    forkOf: null,
    id: 'snip_hello',
    ownerId: 'usr_alice',
    updatedAt: AT,
    version: 1,
    visibility: 'public',
  },
  {
    createdAt: LATER,
    description: 'Release checklist (owner eyes only)',
    forkOf: null,
    id: 'snip_secret',
    ownerId: 'usr_alice',
    updatedAt: LATER,
    version: 1,
    visibility: 'secret',
  },
  {
    createdAt: LATER,
    description: 'Scratch snippet the delete example removes',
    forkOf: null,
    id: 'snip_scratch',
    ownerId: 'usr_alice',
    updatedAt: LATER,
    version: 1,
    visibility: 'public',
  },
];

export const seedRevisions: readonly Revision[] = [
  {
    createdAt: AT,
    files: [
      {
        content: `export const greet = (name: string): string => \`Hello, \${name}!\`;\n`,
        encoding: 'utf8',
        language: 'typescript',
        name: 'greet.ts',
      },
    ],
    id: 'rev_hello_1',
    message: 'initial revision',
    seq: 1,
    snippetId: 'snip_hello',
  },
  {
    createdAt: LATER,
    files: [
      {
        content:
          '# Release checklist\n\n- run the smoke tests\n- tag the release\n',
        encoding: 'utf8',
        language: 'markdown',
        name: 'checklist.md',
      },
    ],
    id: 'rev_secret_1',
    message: 'initial revision',
    seq: 1,
    snippetId: 'snip_secret',
  },
  {
    createdAt: LATER,
    files: [
      {
        content: 'scratch content\n',
        encoding: 'utf8',
        name: 'scratch.txt',
      },
    ],
    id: 'rev_scratch_1',
    message: 'initial revision',
    seq: 1,
    snippetId: 'snip_scratch',
  },
];

export const seedStars: readonly Star[] = [
  {
    createdAt: LATER,
    id: 'star_bob_hello',
    snippetId: 'snip_hello',
    userId: 'usr_bob',
  },
];

/**
 * Seed index rows derived through the same tokenizer `search.index` uses, so
 * the seeded index matches a from-scratch `search.reindex` exactly. Secret
 * snippets are never indexed.
 */
export const seedSearchEntries: readonly SearchEntry[] = seedSnippets
  .filter((snippet) => snippet.visibility === 'public')
  .flatMap((snippet) => {
    const files =
      seedRevisions.find((revision) => revision.snippetId === snippet.id)
        ?.files ?? [];
    return deriveSearchTerms(snippet.description, files).map(
      (term, position) => ({
        id: `sea_${snippet.id}_${String(position)}`,
        snippetId: snippet.id,
        term,
      })
    );
  });

/** Full seed set keyed by table name, in reference-safe insert order. */
export const seedTables = {
  revisions: seedRevisions.map((row) => ({ ...row, files: [...row.files] })),
  searchEntries: [...seedSearchEntries],
  snippets: [...seedSnippets],
  stars: [...seedStars],
  tokens: seedTokens.map((row) => ({ ...row, scopes: [...row.scopes] })),
  users: [...seedUsers],
};
