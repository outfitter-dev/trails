/** Warden-private draft policy helpers. */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DRAFT_ID_PREFIX } from '@ontrails/core';

import {
  getStringValue,
  identifierName,
  isStringLiteral,
  walk,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';

/**
 * Names of framework constants whose value is a draft-marker prefix literal.
 *
 * String literals that initialize a `const` declaration with one of these
 * names are treated as the framework's own draft-marker declarations, not as
 * draft-id usage. This list is intentionally small and explicit — adding a
 * new framework draft-prefix constant requires updating this set.
 */
export const FRAMEWORK_DRAFT_PREFIX_CONSTANT_NAMES: ReadonlySet<string> =
  new Set(['DRAFT_ID_PREFIX', 'DRAFT_FILE_PREFIX']);

/**
 * Exact string literal value allowed for framework draft-prefix constant
 * declarations. Tightens the exemption so a future framework file cannot
 * redeclare `DRAFT_ID_PREFIX = '_draft.something-else'` and accidentally
 * suppress its own draft-id diagnostic.
 */
const FRAMEWORK_DRAFT_PREFIX_LITERAL = DRAFT_ID_PREFIX;

interface PackageJsonWithName {
  readonly name: string;
}

const FRAMEWORK_DRAFT_PREFIX_PACKAGES: ReadonlySet<string> = new Set([
  '@ontrails/core',
  '@ontrails/warden',
]);

const isPackageJsonWithName = (value: unknown): value is PackageJsonWithName =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { name?: unknown }).name === 'string';

const readPackageJsonName = (packageJsonPath: string): string | null => {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return isPackageJsonWithName(parsed) ? parsed.name : null;
  } catch {
    return null;
  }
};

const frameworkDraftPackageRoot = (filePath: string): string | null => {
  const resolvedPath = resolve(filePath);
  if (basename(resolvedPath) !== 'draft.ts') {
    return null;
  }

  const sourceDir = dirname(resolvedPath);
  if (basename(sourceDir) !== 'src') {
    return null;
  }

  const packageRoot = dirname(sourceDir);
  if (!existsSync(join(packageRoot, 'package.json'))) {
    return null;
  }

  return packageRoot;
};

/** Fallback exemption when framework files are consumed from a different install path. */
const isFrameworkDraftPrefixSourceFile = (filePath: string): boolean => {
  const root = frameworkDraftPackageRoot(filePath);
  if (!root) {
    return false;
  }
  const packageName = readPackageJsonName(join(root, 'package.json'));
  return (
    packageName !== null && FRAMEWORK_DRAFT_PREFIX_PACKAGES.has(packageName)
  );
};

/**
 * Absolute paths of the two framework files allowed to declare the
 * draft-prefix constants. Anchored against the rule module's own URL so the
 * exemption is scoped to this package's real on-disk location — a consumer
 * repository that happens to declare `const DRAFT_ID_PREFIX = '_draft.leak'`
 * anywhere else cannot hide a genuine leak by matching the identifier name.
 *
 * The two framework files are:
 *  - `packages/core/src/draft.ts`   (defines `DRAFT_ID_PREFIX`)
 *  - `packages/warden/src/draft.ts` (defines `DRAFT_FILE_PREFIX`)
 */
const FRAMEWORK_DRAFT_CONSTANT_FILES: ReadonlySet<string> = new Set([
  resolve(
    fileURLToPath(new URL('../../../../core/src/draft.ts', import.meta.url))
  ),
  resolve(fileURLToPath(new URL('../../draft.ts', import.meta.url))),
]);

/**
 * Collect the source offsets of string literals that initialize a framework
 * draft-prefix constant declaration (e.g. `export const DRAFT_ID_PREFIX =
 * '_draft.'`). Used by draft-awareness rules to skip their own marker
 * constants.
 *
 * Exemption is gated on all three of:
 *   1. The file is one of the two known framework draft files, or its package
 *      root `package.json` name is `@ontrails/core` or `@ontrails/warden`.
 *   2. The declaration name is `DRAFT_ID_PREFIX` or `DRAFT_FILE_PREFIX`.
 *   3. The string literal value is exactly `'_draft.'`.
 *
 * A consumer file that reuses one of these identifier names cannot hide a
 * `_draft.*` leak — the path gate rejects it outright.
 */
export const collectFrameworkDraftPrefixConstantOffsets = (
  ast: AstNode,
  filePath: string
): ReadonlySet<number> => {
  const offsets = new Set<number>();

  const resolvedPath = resolve(filePath);
  if (
    !FRAMEWORK_DRAFT_CONSTANT_FILES.has(resolvedPath) &&
    !isFrameworkDraftPrefixSourceFile(resolvedPath)
  ) {
    return offsets;
  }

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') {
      return;
    }

    const { id, init } = node as unknown as {
      readonly id?: AstNode;
      readonly init?: AstNode;
    };
    const name = identifierName(id);
    if (
      !name ||
      !FRAMEWORK_DRAFT_PREFIX_CONSTANT_NAMES.has(name) ||
      !init ||
      !isStringLiteral(init)
    ) {
      return;
    }

    if (getStringValue(init) !== FRAMEWORK_DRAFT_PREFIX_LITERAL) {
      return;
    }

    offsets.add(init.start);
  });

  return offsets;
};
