import type { AnyContour, Trail, TrailExample } from '@ontrails/core';
import { getContourReferences } from '@ontrails/core';

type ExampleRecord = Readonly<Record<string, unknown>>;

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

const parseContourExpectedValue = (
  outputSchema: NonNullable<Trail<unknown, unknown, unknown>['output']>,
  fixtures: readonly ContourFixture[]
): unknown => {
  const contourMatches = fixtures
    .map((fixture) => outputSchema.safeParse(fixture.example))
    .filter((candidate) => candidate.success);

  if (contourMatches.length !== 1) {
    return undefined;
  }

  const [singleMatch] = contourMatches;
  return singleMatch?.data;
};

const parseMergedExpectedValue = (
  outputSchema: NonNullable<Trail<unknown, unknown, unknown>['output']>,
  input: Record<string, unknown>
): unknown => {
  const mergedMatch = outputSchema.safeParse(input);
  return mergedMatch.success ? mergedMatch.data : undefined;
};

const deriveExpectedValue = (
  trail: Trail<unknown, unknown, unknown>,
  fixtures: readonly ContourFixture[],
  input: Record<string, unknown>
): unknown => {
  if (trail.output === undefined) {
    return undefined;
  }

  const outputSchema = trail.output;
  const contourExpected = parseContourExpectedValue(outputSchema, fixtures);
  if (contourExpected !== undefined) {
    return contourExpected;
  }

  return parseMergedExpectedValue(outputSchema, input);
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
 * Contour examples stay as the raw input payload so Trails validation/transforms
 * still happen exactly once inside the normal test execution path.
 */
export const resolveTrailExamples = (
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
    const input = buildDerivedInput(fixtures);
    const validated = trail.input.safeParse(input);
    if (!validated.success) {
      return [];
    }

    const expected = deriveExpectedValue(trail, fixtures, input);
    return [
      {
        ...(expected === undefined ? {} : { expected }),
        input,
        name: formatFixtureName(fixtures, index),
      } satisfies TrailExample<unknown, unknown>,
    ];
  });
};
