import type { AnyContour, Trail, TrailExample } from '@ontrails/core';
import { getContourReferences } from '@ontrails/core';
import { z } from 'zod';

type ExampleRecord = Readonly<Record<string, unknown>>;

/**
 * Tracks examples that `deriveTrailExamples` synthesizes from contour
 * fixtures. Authored examples are passed through untouched and never
 * appear here, so consumers can distinguish the two by identity.
 *
 * Exposed via `isDerivedExample` so downstream testing helpers (e.g.
 * `testExamples` crossing coverage) can relax invariants that only make
 * sense for authored inputs.
 */
const derivedExamples = new WeakSet<TrailExample<unknown, unknown>>();

/**
 * Returns `true` if the given example was synthesized from contour fixtures
 * by `deriveTrailExamples`, `false` if it was authored on the trail.
 */
export const isDerivedExample = (
  example: TrailExample<unknown, unknown>
): boolean => derivedExamples.has(example);

interface ContourFixture {
  readonly contour: AnyContour;
  readonly example: ExampleRecord;
  readonly index: number;
}

const capitalize = (value: string): string =>
  value.length === 0 ? value : value.slice(0, 1).toUpperCase() + value.slice(1);

const collectReferenceMap = (
  contours: readonly AnyContour[]
): ReadonlyMap<string, ReturnType<typeof getContourReferences>> => {
  const contourNames = new Set(contours.map((contour) => contour.name));

  return new Map(
    contours.map((contour) => [
      contour.name,
      getContourReferences(contour).filter((reference) =>
        contourNames.has(reference.contour)
      ),
    ])
  );
};

const getIdentityValue = (fixture: ContourFixture): unknown =>
  fixture.example[fixture.contour.identity];

const candidateMatchesSelectedReference = (
  candidate: ContourFixture,
  target: ContourFixture,
  reference: ReturnType<typeof getContourReferences>[number]
): boolean =>
  Object.is(candidate.example[reference.field], getIdentityValue(target));

const selectedMatchesCandidateReference = (
  fixture: ContourFixture,
  candidate: ContourFixture,
  reference: ReturnType<typeof getContourReferences>[number]
): boolean =>
  Object.is(fixture.example[reference.field], getIdentityValue(candidate));

const matchesCandidateReferences = (
  candidate: ContourFixture,
  selected: readonly ContourFixture[],
  referencesByContour: ReadonlyMap<
    string,
    ReturnType<typeof getContourReferences>
  >
): boolean => {
  const candidateReferences =
    referencesByContour.get(candidate.contour.name) ?? [];

  for (const reference of candidateReferences) {
    const target = selected.find(
      (fixture) => fixture.contour.name === reference.contour
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
  candidate: ContourFixture,
  selected: readonly ContourFixture[],
  referencesByContour: ReadonlyMap<
    string,
    ReturnType<typeof getContourReferences>
  >
): boolean => {
  for (const fixture of selected) {
    const fixtureReferences =
      referencesByContour.get(fixture.contour.name) ?? [];
    for (const reference of fixtureReferences) {
      if (reference.contour !== candidate.contour.name) {
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
  candidate: ContourFixture,
  selected: readonly ContourFixture[],
  referencesByContour: ReadonlyMap<
    string,
    ReturnType<typeof getContourReferences>
  >
): boolean =>
  matchesCandidateReferences(candidate, selected, referencesByContour) &&
  matchesSelectedReferences(candidate, selected, referencesByContour);

const selectContourFixtures = (
  contours: readonly AnyContour[],
  referencesByContour: ReadonlyMap<
    string,
    ReturnType<typeof getContourReferences>
  >,
  index = 0,
  selected: readonly ContourFixture[] = []
): readonly (readonly ContourFixture[])[] => {
  const contour = contours[index];
  if (contour === undefined) {
    return [selected];
  }

  const examples = contour.examples ?? [];
  const matchingFixtures = examples.flatMap((example, exampleIndex) => {
    const fixture = {
      contour,
      example: example as ExampleRecord,
      index: exampleIndex,
    } satisfies ContourFixture;

    if (!matchesKnownReferences(fixture, selected, referencesByContour)) {
      return [];
    }

    return selectContourFixtures(contours, referencesByContour, index + 1, [
      ...selected,
      fixture,
    ]);
  });

  return matchingFixtures;
};

/**
 * Merge selected contour fixtures into a single candidate input object.
 *
 * The resulting record contains:
 * - `<contour>`: the full fixture payload keyed by contour name.
 * - `<contour><Identity>`: the fixture's identity value on a prefixed key.
 * - `<contour><Field>`: every fixture field on a prefixed key.
 * - Unqualified `<field>` keys: first-write-wins across contours.
 *
 * The first-write-wins behaviour on unqualified keys is intentional but can
 * silently drop a later contour's value when two contours share a field name
 * (e.g. both declare `id`). The prefixed aliases above are unambiguous and
 * always written, so schemas that consume the prefixed form are unaffected;
 * schemas that rely on the bare field name should disambiguate via the
 * prefixed alias instead.
 */
const buildDerivedInput = (
  fixtures: readonly ContourFixture[]
): Record<string, unknown> => {
  const candidate: Record<string, unknown> = {};

  for (const fixture of fixtures) {
    candidate[fixture.contour.name] = fixture.example;
    candidate[
      `${fixture.contour.name}${capitalize(fixture.contour.identity)}`
    ] = getIdentityValue(fixture);

    for (const [field, value] of Object.entries(fixture.example)) {
      if (!Object.hasOwn(candidate, field)) {
        candidate[field] = value;
      }

      candidate[`${fixture.contour.name}${capitalize(field)}`] = value;
    }
  }

  return candidate;
};

/**
 * Project the merged candidate input down to keys the trail's input schema
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
const projectInputForSchema = (
  inputSchema: Trail<unknown, unknown, unknown>['input'],
  candidate: Record<string, unknown>
): Record<string, unknown> => {
  if (!(inputSchema instanceof z.ZodObject)) {
    return candidate;
  }

  const known = Object.keys(inputSchema.shape);
  const projected: Record<string, unknown> = {};
  for (const key of known) {
    if (Object.hasOwn(candidate, key)) {
      projected[key] = candidate[key];
    }
  }
  return projected;
};

/**
 * Derive an expected output value from the selected contour fixtures when
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
  fixtures: readonly ContourFixture[]
): unknown => {
  if (trail.output === undefined) {
    return undefined;
  }

  const outputSchema = trail.output;
  const contourMatches = fixtures
    .map((fixture) => outputSchema.safeParse(fixture.example))
    .filter((candidate) => candidate.success);

  if (contourMatches.length !== 1) {
    return undefined;
  }

  const [singleMatch] = contourMatches;
  if (singleMatch === undefined) {
    return undefined;
  }
  return singleMatch.data;
};

const formatFixtureName = (
  fixtures: readonly ContourFixture[],
  index: number
): string => {
  const label = fixtures
    .map((fixture) => {
      const identity = getIdentityValue(fixture);
      const fallback = fixture.index + 1;
      return `${fixture.contour.name}:${String(identity ?? fallback)}`;
    })
    .join(', ');

  return label.length > 0
    ? `Derived fixture ${index + 1} (${label})`
    : `Derived fixture ${index + 1}`;
};

/**
 * Prefer authored trail examples and fall back to contour-derived fixtures.
 *
 * Examples returned by this helper come from one of two provenances:
 * - **Authored.** When `trail.examples` is non-empty, its entries are
 *   returned verbatim. These are the developer's stated intent and carry
 *   full invariants — including crossing-coverage assertions in
 *   `testExamples`.
 * - **Derived.** When there are no authored examples but the trail has
 *   contours with examples, candidate inputs are synthesized from contour
 *   fixtures and validated against `trail.input`. These are opportunistic
 *   coverage that exists to let `testAll(app)` exercise contour-backed
 *   trails without per-test setup; they are not guaranteed to exercise
 *   every composition branch, so consumers should relax invariants that
 *   only make sense for authored inputs (see `isDerivedExample`).
 *
 * Contour examples stay as the raw input payload so Trails validation /
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

  if (trail.contours.length === 0) {
    return [];
  }

  if (
    trail.contours.some(
      (contour) =>
        contour.examples === undefined || contour.examples.length === 0
    )
  ) {
    return [];
  }

  const referencesByContour = collectReferenceMap(trail.contours);
  const fixtureSets = selectContourFixtures(
    trail.contours,
    referencesByContour
  );

  return fixtureSets.flatMap((fixtures, index) => {
    const merged = buildDerivedInput(fixtures);
    const input = projectInputForSchema(trail.input, merged);
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
