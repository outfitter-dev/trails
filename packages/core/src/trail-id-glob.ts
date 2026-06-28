import { matchesAnyGlob, matchesGlob } from './glob.js';

declare const trailIdGlobBrand: unique symbol;

export type TrailIdGlob = string & {
  readonly [trailIdGlobBrand]: 'TrailIdGlob';
};

export const matchesTrailIdGlob = (id: string, pattern: string): boolean =>
  matchesGlob(id, pattern, { separator: '.' });

export const matchesAnyTrailIdGlob = (
  id: string,
  patterns: readonly string[] | undefined
): boolean => matchesAnyGlob(id, patterns, { separator: '.' });
