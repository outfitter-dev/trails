/**
 * Schema-derived store for stash.
 *
 * One Zod schema per entity, derived into SQLite tables through
 * `@ontrails/store` + `@ontrails/drizzle`. Domain revisions are modeled as
 * their own table: `snippet.update` inserts a new `revisions` row and never
 * mutates an existing one, so revision history is immutable by construction.
 *
 * The `snippets` table is `versioned` so the framework manages an optimistic
 * concurrency `version` column and the store's `reconcile` factory can cover
 * it. That framework-managed version is a third, separate concept from both
 * domain revisions (data history) and trail versioning (contract evolution).
 */

import { store as defineStore } from '@ontrails/store';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entity schemas
// ---------------------------------------------------------------------------

export const fileSchema = z.object({
  content: z
    .string()
    .describe('File content: UTF-8 text, or base64 when encoding is "base64"'),
  encoding: z
    .enum(['utf8', 'base64'])
    .default('utf8')
    .describe('Content encoding; use "base64" for binary files'),
  language: z
    .string()
    .optional()
    .describe('Language hint, e.g. "typescript" (optional)'),
  name: z.string().min(1).describe('File name including extension'),
});

export const visibilitySchema = z
  .enum(['public', 'secret'])
  .describe('Snippet visibility: public, or secret (owner-only)');

export const userSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  name: z.string(),
});

export const tokenSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  name: z.string(),
  revoked: z.boolean().default(false),
  scopes: z.array(z.string()),
  secret: z.string(),
  userId: z.string(),
});

export const snippetSchema = z.object({
  createdAt: z.string(),
  description: z.string(),
  forkOf: z
    .string()
    .nullable()
    .describe('Snippet id this snippet was forked from, or null'),
  id: z.string(),
  ownerId: z.string(),
  updatedAt: z.string(),
  visibility: visibilitySchema,
});

export const revisionSchema = z.object({
  createdAt: z.string(),
  files: z.array(fileSchema),
  id: z.string(),
  message: z.string().nullable(),
  seq: z.number().int().min(1),
  snippetId: z.string(),
});

export const starSchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  snippetId: z.string(),
  userId: z.string(),
});

export const searchEntrySchema = z.object({
  id: z.string(),
  snippetId: z.string(),
  term: z.string(),
});

export type StashFile = z.output<typeof fileSchema>;
export type User = z.output<typeof userSchema>;
export type Token = z.output<typeof tokenSchema>;
export type Revision = z.output<typeof revisionSchema>;
export type Star = z.output<typeof starSchema>;
export type SearchEntry = z.output<typeof searchEntrySchema>;

// ---------------------------------------------------------------------------
// Store definition
// ---------------------------------------------------------------------------

export const stashStoreDefinition = defineStore({
  revisions: {
    generated: ['id', 'createdAt'],
    identity: 'id',
    indexed: ['snippetId'],
    references: { snippetId: 'snippets' },
    schema: revisionSchema,
  },
  searchEntries: {
    generated: ['id'],
    identity: 'id',
    indexed: ['term', 'snippetId'],
    schema: searchEntrySchema,
  },
  snippets: {
    generated: ['id', 'createdAt', 'updatedAt'],
    identity: 'id',
    indexed: ['ownerId', 'visibility'],
    references: { ownerId: 'users' },
    schema: snippetSchema,
    versioned: true,
  },
  stars: {
    generated: ['id', 'createdAt'],
    identity: 'id',
    indexed: ['snippetId', 'userId'],
    references: { snippetId: 'snippets', userId: 'users' },
    schema: starSchema,
  },
  tokens: {
    generated: ['id', 'createdAt'],
    identity: 'id',
    indexed: ['secret', 'userId'],
    references: { userId: 'users' },
    schema: tokenSchema,
  },
  users: {
    generated: ['id', 'createdAt'],
    identity: 'id',
    schema: userSchema,
  },
});

/** Snippet row as stored, including the framework-managed `version` column. */
export type SnippetRow = z.output<
  (typeof stashStoreDefinition)['tables']['snippets']['schema']
>;
