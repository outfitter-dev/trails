/**
 * Entity trails -- CRUD operations for the demo domain.
 *
 * Demonstrates: intent (read/destroy), detours, examples with full-match
 * and error-path assertions.
 */

import {
  trail,
  Result,
  NotFoundError,
  AlreadyExistsError,
} from '@ontrails/core';
import { z } from 'zod';

import { entityStoreService } from '../services/entity-store.js';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const entitySchema = z.object({
  createdAt: z.string(),
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  type: z.string(),
  updatedAt: z.string(),
});

const entitySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  type: z.string(),
});

export const show = trail('entity.show', {
  blaze: (input, ctx) => {
    const store = entityStoreService.from(ctx);
    const entity = store.get(input.name);
    if (!entity) {
      return Result.err(new NotFoundError(`Entity "${input.name}" not found`));
    }
    return Result.ok({
      createdAt: entity.createdAt,
      id: entity.id,
      name: entity.name,
      tags: [...entity.tags],
      type: entity.type,
      updatedAt: entity.updatedAt,
    });
  },
  description: 'Show an entity by name',
  detours: {
    NotFoundError: ['search'],
  },
  examples: [
    {
      description: 'Look up an existing entity by its exact name',
      input: { name: 'Alpha' },
      name: 'Show entity by name',
    },
    {
      description: 'Returns NotFoundError when the entity does not exist',
      error: 'NotFoundError',
      input: { name: 'nonexistent' },
      name: 'Entity not found',
    },
  ],
  input: z.object({
    name: z.string().describe('Entity name to look up'),
  }),
  intent: 'read',
  output: entitySchema,
  services: [entityStoreService],
});

// ---------------------------------------------------------------------------
// entity.add
// ---------------------------------------------------------------------------

export const add = trail('entity.add', {
  blaze: (input, ctx) => {
    const store = entityStoreService.from(ctx);
    const existing = store.get(input.name);
    if (existing) {
      return Result.err(
        new AlreadyExistsError(`Entity "${input.name}" already exists`)
      );
    }
    const entity = store.add({
      name: input.name,
      tags: input.tags ?? [],
      type: input.type,
    });
    return Result.ok({
      createdAt: entity.createdAt,
      id: entity.id,
      name: entity.name,
      tags: [...entity.tags],
      type: entity.type,
      updatedAt: entity.updatedAt,
    });
  },
  description: 'Create a new entity',
  examples: [
    {
      description: 'Create an entity with name, type, and tags',
      input: { name: 'Beta', tags: ['automation'], type: 'tool' },
      name: 'Add a new entity',
    },
    {
      description: 'Returns AlreadyExistsError when the name is taken',
      error: 'AlreadyExistsError',
      input: { name: 'Alpha', type: 'concept' },
      name: 'Duplicate entity returns conflict',
    },
  ],
  input: z.object({
    name: z.string().describe('Entity name'),
    tags: z
      .array(z.string())
      .optional()
      .default([])
      .describe('Tags for categorization'),
    type: z.string().describe('Entity type (concept, tool, pattern)'),
  }),
  output: entitySchema,
  services: [entityStoreService],
});

// ---------------------------------------------------------------------------
// entity.delete
// ---------------------------------------------------------------------------

export const remove = trail('entity.delete', {
  blaze: (input, ctx) => {
    const store = entityStoreService.from(ctx);
    const deleted = store.delete(input.name);
    if (!deleted) {
      return Result.err(new NotFoundError(`Entity "${input.name}" not found`));
    }
    return Result.ok({ deleted: true, name: input.name });
  },
  description: 'Delete an entity by name',
  examples: [
    {
      description: 'Successfully delete an entity that exists',
      input: { name: 'Deletable' },
      name: 'Delete an existing entity',
    },
    {
      description: 'Returns NotFoundError when the entity does not exist',
      error: 'NotFoundError',
      input: { name: 'nonexistent' },
      name: 'Delete non-existent entity returns not found',
    },
  ],
  input: z.object({
    name: z.string().describe('Entity name to delete'),
  }),
  intent: 'destroy',
  output: z.object({
    deleted: z.boolean(),
    name: z.string(),
  }),
  services: [entityStoreService],
});

// ---------------------------------------------------------------------------
// entity.list
// ---------------------------------------------------------------------------

export const list = trail('entity.list', {
  blaze: (input, ctx) => {
    const store = entityStoreService.from(ctx);
    const listOptions: { limit?: number; offset?: number; type?: string } = {
      limit: input.limit,
      offset: input.offset,
    };
    if (input.type !== undefined) {
      listOptions.type = input.type;
    }
    const entities = store.list(listOptions);
    return Result.ok({
      entities: entities.map((e) => ({
        id: e.id,
        name: e.name,
        tags: [...e.tags],
        type: e.type,
      })),
      total: entities.length,
    });
  },
  description: 'List entities with optional type filter',
  examples: [
    {
      description: 'List all entities without filtering',
      input: { limit: 20, offset: 0 },
      name: 'List all entities',
    },
    {
      description: 'Filter entities by their type',
      input: { limit: 20, offset: 0, type: 'concept' },
      name: 'List entities by type',
    },
  ],
  input: z.object({
    limit: z.number().optional().default(20).describe('Maximum results'),
    offset: z.number().optional().default(0).describe('Pagination offset'),
    type: z.string().optional().describe('Filter by entity type'),
  }),
  intent: 'read',
  output: z.object({
    entities: z.array(entitySummarySchema),
    total: z.number(),
  }),
  services: [entityStoreService],
});
