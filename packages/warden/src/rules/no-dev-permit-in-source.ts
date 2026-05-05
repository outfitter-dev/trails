/**
 * Flags occurrences of the `--dev-permit` CLI flag string in source code.
 *
 * `--dev-permit` is a local-development ergonomic that injects a synthetic
 * full-access permit into the CLI execution pipeline (see TRL-410). It must
 * never appear in committed scripts, CI configs, or library source — its
 * presence in checked-in code defeats permit governance.
 *
 * The rule scans source text for the literal token `--dev-permit` (string
 * literal, comment, or code). It is intentionally text-based rather than
 * AST-based: the failure modes the rule targets (a developer pasting a CLI
 * invocation into a script or doc, or wiring it into a `package.json`-like
 * manifest) appear in places the AST cannot reason about.
 *
 * Allow-list: the CLI flag/build modules and the Warden rule surfaces that
 * define this rule's own metadata are exempt. The Warden runner invokes this
 * rule across TypeScript source plus committed script/config surfaces such as
 * shell scripts, CI YAML, and `package.json`. Unlike most Warden source rules,
 * test TypeScript files are still scanned for this literal because checked-in
 * tests can become copied scripts or examples.
 */
import { resolve, sep } from 'node:path';

import type { WardenDiagnostic, WardenRule } from './types.js';

const RULE_NAME = 'no-dev-permit-in-source';

/** Literal CLI flag string the rule searches for. */
const DEV_PERMIT_LITERAL = '--dev-permit';

/**
 * Path suffixes (in POSIX form) for source files that legitimately contain
 * the literal `--dev-permit` string. Other files are flagged.
 *
 * Each entry is matched against the normalized (forward-slash) absolute
 * path with a trailing-segment match, so the rule stays correct regardless
 * of the consumer's repository root.
 */
const ALLOWED_PATH_SUFFIXES: readonly string[] = [
  // The CLI flag preset module authors `--dev-permit` as the canonical name.
  '/packages/cli/src/flags.ts',
  // The build module spells the kebab-case form when reading the parsed flag.
  '/packages/cli/src/build.ts',
  // The rule's own implementation file references the literal it searches for.
  '/packages/warden/src/rules/no-dev-permit-in-source.ts',
  // Rule metadata and trail wrapper document the same literal for users.
  '/packages/warden/src/rules/metadata.ts',
  '/packages/warden/src/trails/no-dev-permit-in-source.trail.ts',
];

const normalizePath = (filePath: string): string =>
  resolve(filePath).split(sep).join('/');

const isAllowedFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  return ALLOWED_PATH_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
};

const findLineOfFirstMatch = (sourceCode: string): number => {
  const idx = sourceCode.indexOf(DEV_PERMIT_LITERAL);
  if (idx === -1) {
    return 1;
  }
  let line = 1;
  for (let i = 0; i < idx; i += 1) {
    if (sourceCode.codePointAt(i) === 10) {
      line += 1;
    }
  }
  return line;
};

/**
 * Flags occurrences of the `--dev-permit` flag string in committed source.
 */
export const noDevPermitInSource: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (isAllowedFile(filePath)) {
      return [];
    }
    if (!sourceCode.includes(DEV_PERMIT_LITERAL)) {
      return [];
    }
    return [
      {
        filePath,
        line: findLineOfFirstMatch(sourceCode),
        message:
          '`--dev-permit` is a local-development flag and must not appear in committed source. Use `--token` or `--permit` for CI and scripted invocations.',
        rule: RULE_NAME,
        severity: 'error',
      },
    ];
  },
  description:
    'Disallow the `--dev-permit` CLI flag string in committed source code.',
  name: RULE_NAME,
  severity: 'error',
};
