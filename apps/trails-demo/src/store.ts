/**
 * In-memory entity store for the trails-demo app.
 *
 * No external dependencies -- the focus is on demonstrating Trails patterns,
 * not infrastructure.
 */

// ---------------------------------------------------------------------------
// Entity type
// ---------------------------------------------------------------------------

export interface Entity {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface EntityStore {
  get(name: string): Entity | undefined;
  add(entity: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>): Entity;
  delete(name: string): boolean;
  list(options?: { type?: string; limit?: number; offset?: number }): Entity[];
  search(query: string): Entity[];
}

// ---------------------------------------------------------------------------
// Seed input (partial entity without generated fields)
// ---------------------------------------------------------------------------

export interface EntitySeed {
  readonly name: string;
  readonly type: string;
  readonly tags?: readonly string[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createStore = (seed?: readonly EntitySeed[]): EntityStore => {
  let counter = 0;

  const nextId = (): string => {
    counter += 1;
    return `e${String(counter)}`;
  };

  const byName = new Map<string, Entity>();

  // Seed initial data
  if (seed !== undefined) {
    for (const s of seed) {
      const entity: Entity = {
        createdAt: '2026-01-01T00:00:00Z',
        id: nextId(),
        name: s.name,
        tags: s.tags ?? [],
        type: s.type,
        updatedAt: '2026-01-01T00:00:00Z',
      };
      byName.set(entity.name, entity);
    }
  }

  return {
    add(input: Omit<Entity, 'id' | 'createdAt' | 'updatedAt'>): Entity {
      const now = new Date().toISOString();
      const entity: Entity = {
        createdAt: now,
        id: nextId(),
        name: input.name,
        tags: input.tags,
        type: input.type,
        updatedAt: now,
      };
      byName.set(entity.name, entity);
      return entity;
    },

    delete(name: string): boolean {
      return byName.delete(name);
    },

    get(name: string): Entity | undefined {
      return byName.get(name);
    },

    list(options?: {
      type?: string;
      limit?: number;
      offset?: number;
    }): Entity[] {
      let entities = [...byName.values()];

      if (options?.type !== undefined) {
        entities = entities.filter((e) => e.type === options.type);
      }

      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 20;
      return entities.slice(offset, offset + limit);
    },

    search(query: string): Entity[] {
      const q = query.toLowerCase();
      return [...byName.values()].filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
      );
    },
  };
};
