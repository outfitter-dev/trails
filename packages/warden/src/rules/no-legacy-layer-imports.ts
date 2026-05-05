/**
 * Flags references to legacy layer symbols removed during Layer Evolution.
 *
 * The pre-TRL-469 era of Trails shipped three first-party layers as ergonomics
 * over `executeTrail`:
 *
 *   - `authLayer` — re-exposed permit enforcement, even though permits were
 *     intrinsic to `executeTrail`.
 *   - `autoIterateLayer` — wrapped the CLI iteration ergonomics that the
 *     surface now derives directly via `--all` (TRL-469).
 *   - `dateShortcutsLayer` — wrapped the CLI date-expansion helpers that the
 *     surface now derives directly (TRL-470).
 *
 * TRL-475 removed `authLayer`; TRL-476 removed the CLI layer exports
 * `autoIterateLayer` and `dateShortcutsLayer`. Importing them from
 * `@ontrails/permits` or `@ontrails/cli` produces a TypeScript error today;
 * this rule layers a coaching diagnostic on top so authors that still type
 * the symbol — in a comment, a string, or a stale import — get a redirect to
 * the migration ADR during the deprecation window.
 *
 * The rule is intentionally text-based: legacy names appear in a mix of
 * imports, JSDoc, error messages, and migration notes, all of which should
 * surface a coaching message.
 *
 * Allow-list: a small set of files documenting the removal itself reference
 * the literal symbol names. The rule's own implementation file references
 * each name and is also exempt.
 *
 * Test files (`__tests__/`, `*.test.ts`) are filtered before this rule is
 * invoked by the warden runner, so the regression test referencing
 * `authLayer` in its name (`packages/core/src/__tests__/execute-permit.test.ts`)
 * does not need a separate exemption.
 */
import { resolve, sep } from 'node:path';

import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'no-legacy-layer-imports';

/**
 * Legacy layer symbol names that were removed during Layer Evolution.
 *
 * Listed longest-first is not required for correctness (none of these names
 * are substrings of one another), but kept alphabetized for stable output
 * across rule runs.
 */
const LEGACY_LAYER_NAMES = [
  'authLayer',
  'autoIterateLayer',
  'dateShortcutsLayer',
] as const;

type LegacyLayerName = (typeof LEGACY_LAYER_NAMES)[number];

interface LegacyLayerMigration {
  readonly guidance: string;
  readonly removedIn: 'TRL-475' | 'TRL-476';
}

const LEGACY_LAYER_MIGRATIONS: Record<LegacyLayerName, LegacyLayerMigration> = {
  authLayer: {
    guidance: 'Permit enforcement is intrinsic to executeTrail',
    removedIn: 'TRL-475',
  },
  autoIterateLayer: {
    guidance: 'Pagination uses CLI surface derivation (--all) per TRL-469',
    removedIn: 'TRL-476',
  },
  dateShortcutsLayer: {
    guidance: 'Date shortcuts use CLI surface derivation per TRL-470',
    removedIn: 'TRL-476',
  },
};

/**
 * Path suffixes (in POSIX form) for source files that legitimately reference
 * one or more removed legacy layer names. Other files are flagged.
 *
 * Each entry is matched against the normalized (forward-slash) absolute path
 * with a trailing-segment match, so the rule stays correct regardless of the
 * consumer's repository root.
 */
const ALLOWED_PATH_SUFFIXES: readonly string[] = [
  // The CLI pagination module documents the removed `autoIterateLayer` in a
  // migration note for apps moving onto the derived `--all` ergonomics.
  '/packages/cli/src/pagination.ts',
  // The CLI date-shortcuts module documents the removed `dateShortcutsLayer`
  // in a migration note for apps moving onto the derived expansion helpers.
  '/packages/cli/src/date-shortcuts.ts',
  // The rule's own implementation file references the literals it searches for.
  '/packages/warden/src/rules/no-legacy-layer-imports.ts',
  // Warden rule metadata names the legacy symbols in the rule's invariant
  // string for traceability between the rule and the removed exports.
  '/packages/warden/src/rules/metadata.ts',
  // The rule trail includes an executable example that demonstrates the
  // diagnostic emitted for legacy layer imports.
  '/packages/warden/src/trails/no-legacy-layer-imports.trail.ts',
];

const normalizePath = (filePath: string): string =>
  resolve(filePath).split(sep).join('/');

const isAllowedFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return ALLOWED_PATH_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
};

interface Match {
  readonly name: LegacyLayerName;
  readonly index: number;
}

const IDENTIFIER_CHAR = /[$0-9A-Z_a-z]/u;

const isIdentifierChar = (value: string): boolean =>
  value !== '' && IDENTIFIER_CHAR.test(value);

const indexOfStandaloneName = (
  sourceCode: string,
  name: LegacyLayerName
): number => {
  let fromIndex = 0;
  while (fromIndex < sourceCode.length) {
    const index = sourceCode.indexOf(name, fromIndex);
    if (index === -1) {
      return -1;
    }
    const before = index === 0 ? '' : (sourceCode[index - 1] ?? '');
    const after = sourceCode[index + name.length] ?? '';
    if (!(isIdentifierChar(before) || isIdentifierChar(after))) {
      return index;
    }
    fromIndex = index + name.length;
  }
  return -1;
};

const findFirstMatch = (sourceCode: string): Match | null => {
  let earliest: Match | null = null;
  for (const name of LEGACY_LAYER_NAMES) {
    const index = indexOfStandaloneName(sourceCode, name);
    if (index === -1) {
      continue;
    }
    if (earliest === null || index < earliest.index) {
      earliest = { index, name };
    }
  }
  return earliest;
};

const lineForOffset = (sourceCode: string, offset: number): number => {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (sourceCode.codePointAt(i) === 10) {
      line += 1;
    }
  }
  return line;
};

const buildMessage = (name: LegacyLayerName): string => {
  const migration = LEGACY_LAYER_MIGRATIONS[name];
  return `Legacy layer '${name}' was removed in ${migration.removedIn}. ${migration.guidance}. See docs/adr/drafts/20260409-layer-evolution.md.`;
};

/**
 * Flags references to the removed legacy layer symbols in committed source.
 */
export const noLegacyLayerImports: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isAllowedFile(filePath)) {
      return [];
    }
    const match = findFirstMatch(sourceCode);
    if (!match) {
      return [];
    }
    return [
      {
        filePath,
        line: lineForOffset(sourceCode, match.index),
        message: buildMessage(match.name),
        rule: RULE_NAME,
        severity: 'error',
      },
    ];
  },
  description:
    'Disallow references to legacy layer exports (authLayer, autoIterateLayer, dateShortcutsLayer) removed across TRL-475/TRL-476.',
  name: RULE_NAME,
  severity: 'error',
};
