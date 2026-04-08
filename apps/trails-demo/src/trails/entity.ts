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

import { entityStoreResource } from '../resources/entity-store.js';
import type { Entity } from '../store.js';
import { entitySchema } from '../store.js';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const entitySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  type: z.string(),
});

const toEntity = (entity: Entity) => ({
  createdAt: entity.createdAt,
  id: entity.id,
  name: entity.name,
  tags: [...entity.tags],
  type: entity.type,
  updatedAt: entity.updatedAt,
});

const toSummary = (entity: Entity) => ({
  id: entity.id,
  name: entity.name,
  tags: [...entity.tags],
  type: entity.type,
});

export const show = trail('entity.show', {
  blaze: async (input, ctx) => {
    const store = entityStoreResource.from(ctx);
    const entity = await store.entities.get(input.name);
    if (!entity) {
      return Result.err(new NotFoundError(`Entity "${input.name}" not found`));
    }
    return Result.ok(toEntity(entity));
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
  resources: [entityStoreResource],
});

// ---------------------------------------------------------------------------
// entity.add
// ---------------------------------------------------------------------------

export const add = trail('entity.add', {
  blaze: async (input, ctx) => {
    const store = entityStoreResource.from(ctx);
    try {
      const entity = await store.entities.insert({
        name: input.name,
        tags: input.tags ?? [],
        type: input.type,
      });
      await ctx.fire?.('entity.updated', {
        action: 'created',
        entityId: entity.id,
        entityName: entity.name,
        timestamp: entity.createdAt,
      });
      return Result.ok(toEntity(entity));
    } catch (error) {
      if (error instanceof AlreadyExistsError) {
        return Result.err(error);
      }

      return Result.err(
        error instanceof Error ? error : new Error(String(error))
      );
    }
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
  fires: ['entity.updated'],
  input: z.object({
    name: z.string().describe('Entity name'),
    tags: z
      .array(z.string())
      .optional()
      .default([])
      .describe('Tags for categorization'),
    type: z.string().describe('Entity type (concept, tool, pattern)'),
  }),
  intent: 'write',
  output: entitySchema,
  resources: [entityStoreResource],
});

// ---------------------------------------------------------------------------
// entity.delete
// ---------------------------------------------------------------------------

export const remove = trail('entity.delete', {
  blaze: async (input, ctx) => {
    const store = entityStoreResource.from(ctx);
    // Look up the entity first so we can emit its real id on the signal —
    // `input.name` is a natural key, not the generated entity id.
    const existing = await store.entities.get(input.name);
    if (!existing) {
      return Result.err(new NotFoundError(`Entity "${input.name}" not found`));
    }
    const deleted = await store.entities.remove(input.name);
    if (!deleted.deleted) {
      return Result.err(new NotFoundError(`Entity "${input.name}" not found`));
    }
    await ctx.fire?.('entity.updated', {
      action: 'deleted',
      entityId: existing.id,
      entityName: existing.name,
      timestamp: new Date().toISOString(),
    });
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
  fires: ['entity.updated'],
  input: z.object({
    name: z.string().describe('Entity name to delete'),
  }),
  intent: 'destroy',
  output: z.object({
    deleted: z.boolean(),
    name: z.string(),
  }),
  resources: [entityStoreResource],
});

// ---------------------------------------------------------------------------
// entity.list
// ---------------------------------------------------------------------------

export const list = trail('entity.list', {
  blaze: async (input, ctx) => {
    const store = entityStoreResource.from(ctx);
    const filters = input.type === undefined ? undefined : { type: input.type };
    const [entities, allMatching] = await Promise.all([
      store.entities.list(filters, {
        limit: input.limit,
        offset: input.offset,
      }),
      store.entities.list(filters),
    ]);
    return Result.ok({
      entities: entities.map(toSummary),
      total: allMatching.length,
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
  resources: [entityStoreResource],
});
