import type { AnyEntity, Trail, TrailExample } from '@ontrails/core';
import {
  getEntityReferences,
  getTrailVersionEntryKind,
  isArchivedTrailVersionEntry,
} from '@ontrails/core';
import { z } from 'zod';

type ExampleRecord = Readonly<Record<string, unknown>>;

export interface TrailExampleTarget {
  readonly composes: readonly string[];
  readonly current: boolean;
  readonly examples: readonly TrailExample<unknown, unknown>[];
  readonly id: string;
  readonly input: Trail<unknown, unknown, unknown>['input'];
  readonly output: Trail<unknown, unknown, unknown>['output'];
  readonly trail: Trail<unknown, unknown, unknown>;
  readonly version?: number | undefined;
}

const normalizeComposeRef = (value: string | { readonly id: string }): string =>
  typeof value === 'string' ? value : value.id;

/**
 * Tracks examples that `deriveTrailExamples` synthesizes from entity
 * fixtures. Authored examples are passed through untouched and never
 * appear here, so consumers can distinguish the two by identity.
 *
 * Exposed via `isDerivedExample` so downstream testing helpers (e.g.
 * `testExamples` composing coverage) can relax invariants that only make
 * sense for authored inputs.
 */
const derivedExamples = new WeakSet<TrailExample<unknown, unknown>>();

/**
 * Returns `true` if the given example was synthesized from entity fixtures
 * by `deriveTrailExamples`, `false` if it was authored on the trail.
 */
export const isDerivedExample = (
  example: TrailExample<unknown, unknown>
): boolean => derivedExamples.has(example);

interface EntityFixture {
  readonly entity: AnyEntity;
  readonly example: ExampleRecord;
  readonly index: number;
}

const capitalize = (value: string): string =>
  value.length === 0 ? value : value.slice(0, 1).toUpperCase() + value.slice(1);

const collectReferenceMap = (
  entities: readonly AnyEntity[]
): ReadonlyMap<string, ReturnType<typeof getEntityReferences>> => {
  const entityNames = new Set(entities.map((entity) => entity.name));

  return new Map(
    entities.map((entity) => [
      entity.name,
      getEntityReferences(entity).filter((reference) =>
        entityNames.has(reference.entity)
      ),
    ])
  );
};

const getIdentityValue = (fixture: EntityFixture): unknown =>
  fixture.example[fixture.entity.identity];

const candidateMatchesSelectedReference = (
  candidate: EntityFixture,
  target: EntityFixture,
  reference: ReturnType<typeof getEntityReferences>[number]
): boolean =>
  Object.is(candidate.example[reference.field], getIdentityValue(target));

const selectedMatchesCandidateReference = (
  fixture: EntityFixture,
  candidate: EntityFixture,
  reference: ReturnType<typeof getEntityReferences>[number]
): boolean =>
  Object.is(fixture.example[reference.field], getIdentityValue(candidate));

const matchesCandidateReferences = (
  candidate: EntityFixture,
  selected: readonly EntityFixture[],
  referencesByEntity: ReadonlyMap<
    string,
    ReturnType<typeof getEntityReferences>
  >
): boolean => {
  const candidateReferences =
    referencesByEntity.get(candidate.entity.name) ?? [];

  for (const reference of candidateReferences) {
    const target = selected.find(
      (fixture) => fixture.entity.name === reference.entity
    );
    if (target === undefined) {
      continue;
    }
    if (!candidateMatchesSelectedReference(candidate, target, reference)) {
      return false;
    }
  }

  return true;
};

const matchesSelectedReferences = (
  candidate: EntityFixture,
  selected: readonly EntityFixture[],
  referencesByEntity: ReadonlyMap<
    string,
    ReturnType<typeof getEntityReferences>
  >
): boolean => {
  for (const fixture of selected) {
    const fixtureReferences = referencesByEntity.get(fixture.entity.name) ?? [];
    for (const reference of fixtureReferences) {
      if (reference.entity !== candidate.entity.name) {
        continue;
      }
      if (!selectedMatchesCandidateReference(fixture, candidate, reference)) {
        return false;
      }
    }
  }

  return true;
};

const matchesKnownReferences = (
  candidate: EntityFixture,
  selected: readonly EntityFixture[],
  referencesByEntity: ReadonlyMap<
    string,
    ReturnType<typeof getEntityReferences>
  >
): boolean =>
  matchesCandidateReferences(candidate, selected, referencesByEntity) &&
  matchesSelectedReferences(candidate, selected, referencesByEntity);

const selectEntityFixtures = (
  entities: readonly AnyEntity[],
  referencesByEntity: ReadonlyMap<
    string,
    ReturnType<typeof getEntityReferences>
  >,
  index = 0,
  selected: readonly EntityFixture[] = []
): readonly (readonly EntityFixture[])[] => {
  const entity = entities[index];
  if (entity === undefined) {
    return [selected];
  }

  const examples = entity.examples ?? [];
  const matchingFixtures = examples.flatMap((example, exampleIndex) => {
    const fixture = {
      entity,
      example: example as ExampleRecord,
      index: exampleIndex,
    } satisfies EntityFixture;

    if (!matchesKnownReferences(fixture, selected, referencesByEntity)) {
      return [];
    }

    return selectEntityFixtures(entities, referencesByEntity, index + 1, [
      ...selected,
      fixture,
    ]);
  });

  return matchingFixtures;
};

/**
 * Merge selected entity fixtures into a single candidate input object.
 *
 * The resulting record contains:
 * - `<entity>`: the full fixture payload keyed by entity name.
 * - `<entity><Identity>`: the fixture's identity value on a prefixed key.
 * - `<entity><Field>`: every fixture field on a prefixed key.
 * - Unqualified `<field>` keys: first-write-wins across entities.
 *
 * The first-write-wins behaviour on unqualified keys is intentional but can
 * silently drop a later entity's value when two entities share a field name
 * (e.g. both declare `id`). The prefixed aliases above are unambiguous and
 * always written, so schemas that consume the prefixed form are unaffected;
 * schemas that rely on the bare field name should disambiguate via the
 * prefixed alias instead.
 */
const buildDerivedInput = (
  fixtures: readonly EntityFixture[]
): Record<string, unknown> => {
  const candidate: Record<string, unknown> = {};

  for (const fixture of fixtures) {
    candidate[fixture.entity.name] = fixture.example;
    candidate[`${fixture.entity.name}${capitalize(fixture.entity.identity)}`] =
      getIdentityValue(fixture);

    for (const [field, value] of Object.entries(fixture.example)) {
      if (!Object.hasOwn(candidate, field)) {
        candidate[field] = value;
      }

      candidate[`${fixture.entity.name}${capitalize(field)}`] = value;
    }
  }

  return candidate;
};

/**
 * Derive the merged candidate input down to keys the trail's input schema
 * knows about.
 *
 * `buildDerivedInput` emits synthesized prefixed aliases (e.g. `userEmail`)
 * alongside bare field names. Strict schemas (`z.object(...).strict()`)
 * reject any unknown key, which means an otherwise valid derived fixture
 * would silently fail `safeParse` just because of the synthesized aliases.
 * When the input is a `ZodObject`, trim the candidate to its declared keys
 * before validation. Non-object inputs pass through unchanged — they are
 * validated as-is and can decide for themselves.
 */
const deriveInputForSchema = (
  inputSchema: Trail<unknown, unknown, unknown>['input'],
  candidate: Record<string, unknown>
): Record<string, unknown> => {
  if (!(inputSchema instanceof z.ZodObject)) {
    return candidate;
  }

  const known = Object.keys(inputSchema.shape);
  const derived: Record<string, unknown> = {};
  for (const key of known) {
    if (Object.hasOwn(candidate, key)) {
      derived[key] = candidate[key];
    }
  }
  return derived;
};

/**
 * Derive an expected output value from the selected entity fixtures when
 * exactly one fixture's payload satisfies the trail's output schema.
 *
 * Returns `undefined` when the trail has no output schema, when no fixture
 * matches, or when more than one matches — callers should then leave the
 * derived example without an `expected` and fall back to schema-only
 * validation. We intentionally do **not** infer `expected` from the merged
 * candidate input: input and output schemas frequently overlap structurally
 * but represent different semantics, so inferring from the input would
 * produce false deep-equality failures.
 */
const deriveExpectedValue = (
  trail: Trail<unknown, unknown, unknown>,
  fixtures: readonly EntityFixture[]
): unknown => {
  if (trail.output === undefined) {
    return undefined;
  }

  const outputSchema = trail.output;
  const entityMatches = fixtures
    .map((fixture) => outputSchema.safeParse(fixture.example))
    .filter((candidate) => candidate.success);

  if (entityMatches.length !== 1) {
    return undefined;
  }

  const [singleMatch] = entityMatches;
  if (singleMatch === undefined) {
    return undefined;
  }
  return singleMatch.data;
};

const formatFixtureName = (
  fixtures: readonly EntityFixture[],
  index: number
): string => {
  const label = fixtures
    .map((fixture) => {
      const identity = getIdentityValue(fixture);
      const fallback = fixture.index + 1;
      return `${fixture.entity.name}:${String(identity ?? fallback)}`;
    })
    .join(', ');

  return label.length > 0
    ? `Derived fixture ${index + 1} (${label})`
    : `Derived fixture ${index + 1}`;
};

/**
 * Prefer authored trail examples and fall back to entity-derived fixtures.
 *
 * Examples returned by this helper come from one of two provenances:
 * - **Authored.** When `trail.examples` is non-empty, its entries are
 *   returned verbatim. These are the developer's stated intent and carry
 *   full invariants — including composing-coverage assertions in
 *   `testExamples`.
 * - **Derived.** When there are no authored examples but the trail has
 *   entities with examples, candidate inputs are synthesized from entity
 *   fixtures and validated against `trail.input`. These are opportunistic
 *   coverage that exists to let `testAll(app)` exercise entity-backed
 *   trails without per-test setup; they are not guaranteed to exercise
 *   every composition branch, so consumers should relax invariants that
 *   only make sense for authored inputs (see `isDerivedExample`).
 *
 * Entity examples stay as the raw input payload so Trails validation /
 * transforms still happen exactly once inside the normal test execution
 * path. Derived examples are additionally tagged via a module-level
 * `WeakSet` so consumers can detect them without widening the public
 * `TrailExample` shape.
 */
export const deriveTrailExamples = (
  trail: Trail<unknown, unknown, unknown>
): readonly TrailExample<unknown, unknown>[] => {
  if (trail.examples !== undefined && trail.examples.length > 0) {
    return trail.examples;
  }

  if (trail.entities.length === 0) {
    return [];
  }

  if (
    trail.entities.some(
      (entity) => entity.examples === undefined || entity.examples.length === 0
    )
  ) {
    return [];
  }

  const referencesByEntity = collectReferenceMap(trail.entities);
  const fixtureSets = selectEntityFixtures(trail.entities, referencesByEntity);

  return fixtureSets.flatMap((fixtures, index) => {
    const merged = buildDerivedInput(fixtures);
    const input = deriveInputForSchema(trail.input, merged);
    const validated = trail.input.safeParse(input);
    if (!validated.success) {
      return [];
    }

    const expected = deriveExpectedValue(trail, fixtures);
    const derived: TrailExample<unknown, unknown> = {
      ...(expected === undefined ? {} : { expected }),
      input,
      name: formatFixtureName(fixtures, index),
    };
    derivedExamples.add(derived);
    return [derived];
  });
};

export const deriveTrailExampleTargets = (
  trail: Trail<unknown, unknown, unknown>
): readonly TrailExampleTarget[] => {
  const targets: TrailExampleTarget[] = [];
  const currentExamples = deriveTrailExamples(trail);
  if (currentExamples.length > 0) {
    targets.push({
      composes: trail.composes,
      current: true,
      examples: currentExamples,
      id: trail.id,
      input: trail.input,
      output: trail.output,
      trail,
    });
  }

  for (const [rawVersion, entry] of Object.entries(
    trail.versions ?? {}
  ).toSorted(([left], [right]) => Number(left) - Number(right))) {
    if (isArchivedTrailVersionEntry(entry)) {
      continue;
    }
    const examples = entry.examples ?? [];
    if (examples.length === 0) {
      continue;
    }
    const kind = getTrailVersionEntryKind(entry);
    targets.push({
      composes:
        kind === 'fork'
          ? (entry.composes ?? []).map(normalizeComposeRef)
          : trail.composes,
      current: false,
      examples,
      id: `${trail.id}@${rawVersion}`,
      input: entry.input,
      output: entry.output,
      trail,
      version: Number(rawVersion),
    });
  }

  return targets;
};
