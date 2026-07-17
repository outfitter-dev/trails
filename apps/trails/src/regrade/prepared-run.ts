import { InternalError, Result, ValidationError } from '@ontrails/core';
import type { Result as TrailsResult } from '@ontrails/core';
import {
  regradeReceiptContentHash,
  regradeReceiptPlanContentHash,
  regradeReceiptPlanSchema,
} from '@ontrails/regrade';
import type {
  PreparedRegradeRunIdentity,
  RegradeClass,
} from '@ontrails/regrade';
import { listGovernedVocabularyTransitions } from '@ontrails/warden';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path';

import { trailsPackageVersion } from '../versions.js';
import { canonicalJsonStringify } from './plan-artifact.js';
import type { RegradePlanArtifact } from './plan-artifact.js';

const ignoredLockDirectories = new Set([
  '.agents',
  '.git',
  '.turbo',
  'dist',
  'node_modules',
]);

const normalizePath = (path: string): string => path.split(sep).join('/');

const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};

const loaderForModuleExtension = (
  extension: string
): 'js' | 'jsx' | 'ts' | 'tsx' => {
  if (extension === '.tsx') {
    return 'tsx';
  }
  if (extension === '.jsx') {
    return 'jsx';
  }
  return ['.cts', '.mts', '.ts'].includes(extension) ? 'ts' : 'js';
};

const collectLockPaths = (rootDir: string): readonly string[] => {
  const paths: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredLockDirectories.has(entry.name)) {
          visit(join(directory, entry.name));
        }
        continue;
      }
      if (entry.isFile() && entry.name === 'trails.lock') {
        paths.push(join(directory, entry.name));
      }
    }
  };
  visit(rootDir);
  return paths.toSorted(compareCodeUnits);
};

const lockStateHash = (
  rootDir: string
): TrailsResult<string, InternalError> => {
  try {
    const locks = collectLockPaths(rootDir).map((absolutePath) => ({
      contentHash: createHash('sha256')
        .update(readFileSync(absolutePath))
        .digest('hex'),
      path: normalizePath(relative(rootDir, absolutePath)),
    }));
    return Result.ok(regradeReceiptContentHash(locks));
  } catch (error) {
    return Result.err(
      new InternalError('Failed to derive Regrade lock identity.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { rootDir },
      })
    );
  }
};

const projectRuleStateHash = (
  rootDir: string
): TrailsResult<string, InternalError> => {
  try {
    const root = realpathSync(rootDir);
    const entryPaths: string[] = [];
    const rulesFile = join(root, '.trails/rules.ts');
    const rulesDirectory = join(root, '.trails/rules');
    if (existsSync(rulesFile)) {
      entryPaths.push(rulesFile);
    }
    if (existsSync(rulesDirectory)) {
      for (const entry of readdirSync(rulesDirectory, {
        withFileTypes: true,
      })) {
        if (
          entry.isFile() &&
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.test.ts') &&
          !entry.name.startsWith('_')
        ) {
          entryPaths.push(join(rulesDirectory, entry.name));
        }
      }
    }

    const paths = new Set<string>();
    const visitModule = (absolutePath: string): void => {
      if (paths.has(absolutePath)) {
        return;
      }
      paths.add(absolutePath);
      const extension = extname(absolutePath);
      if (
        ![
          '.cjs',
          '.cts',
          '.js',
          '.jsx',
          '.mjs',
          '.mts',
          '.ts',
          '.tsx',
        ].includes(extension)
      ) {
        return;
      }
      const imports = new Bun.Transpiler({
        loader: loaderForModuleExtension(extension),
      }).scanImports(readFileSync(absolutePath, 'utf8'));
      for (const imported of imports) {
        const resolved = Bun.resolveSync(imported.path, dirname(absolutePath));
        const relativePath = relative(root, resolved);
        if (
          isAbsolute(resolved) &&
          relativePath !== '..' &&
          !relativePath.startsWith(`..${sep}`) &&
          !relativePath.split(sep).includes('node_modules')
        ) {
          visitModule(resolved);
        }
      }
    };
    for (const entryPath of entryPaths) {
      visitModule(entryPath);
    }
    return Result.ok(
      regradeReceiptContentHash(
        [...paths].toSorted(compareCodeUnits).map((absolutePath) => ({
          contentHash: createHash('sha256')
            .update(readFileSync(absolutePath))
            .digest('hex'),
          path: normalizePath(relative(rootDir, absolutePath)),
        }))
      )
    );
  } catch (error) {
    return Result.err(
      new InternalError('Failed to derive Regrade policy identity.', {
        ...(error instanceof Error ? { cause: error } : {}),
        context: { rootDir },
      })
    );
  }
};

/**
 * Build the command-local reuse identity from receipt-aligned facts.
 *
 * @example
 * ```ts
 * const identity = preparedRegradeRunIdentity({ artifact, rootDir: '.' });
 * if (identity.isOk()) console.log(identity.value.planContentHash);
 * ```
 */
export const preparedRegradeRunIdentity = (params: {
  readonly artifact: RegradePlanArtifact;
  readonly classIds?: readonly string[] | undefined;
  readonly classes?: readonly RegradeClass[] | undefined;
  readonly includeEntries: 'actionable' | 'all';
  readonly rootDir: string;
}): TrailsResult<PreparedRegradeRunIdentity, Error> => {
  const parsedPlan = regradeReceiptPlanSchema.safeParse(params.artifact.plan);
  if (!parsedPlan.success) {
    return Result.err(
      new InternalError('Failed to derive Regrade plan identity.', {
        context: { issues: parsedPlan.error.issues },
      })
    );
  }
  const lockHash = lockStateHash(params.rootDir);
  if (lockHash.isErr()) {
    return lockHash;
  }
  const usesProjectRules = parsedPlan.data.kind === 'class';
  const policyStateHash = usesProjectRules
    ? projectRuleStateHash(params.rootDir)
    : Result.ok(null);
  if (policyStateHash.isErr()) {
    return policyStateHash;
  }
  return Result.ok({
    lockStateHash: lockHash.value,
    planContentHash: regradeReceiptPlanContentHash({
      plan: parsedPlan.data,
      provenance: params.artifact.provenance,
    }),
    policyHash: regradeReceiptContentHash({
      classIds: [...(params.classIds ?? [])].toSorted(),
      classes: (params.classes ?? []).map((regradeClass) => ({
        describe: regradeClass.describe,
        id: regradeClass.id,
        scanTargets: regradeClass.scanTargets ?? null,
      })),
      ...(policyStateHash.value === null
        ? {}
        : { projectRulesHash: policyStateHash.value }),
      transitions: listGovernedVocabularyTransitions(),
    }),
    scopeHash: regradeReceiptContentHash({
      includeEntries: params.includeEntries,
      scope: params.artifact.plan.scope ?? null,
    }),
    toolVersion: trailsPackageVersion,
  });
};

/** Reject an active plan that changed after its prepared evaluation. */
export const validatePreparedRegradePlanArtifact = (params: {
  readonly current: RegradePlanArtifact;
  readonly currentPath: string;
  readonly expected: RegradePlanArtifact;
  readonly expectedPath: string;
}): TrailsResult<void, ValidationError> => {
  if (
    params.currentPath !== params.expectedPath ||
    canonicalJsonStringify(params.current) !==
      canonicalJsonStringify(params.expected)
  ) {
    return Result.err(
      new ValidationError('Regrade plan changed during apply preflight.', {
        context: { plan: params.expected.path },
      })
    );
  }
  return Result.ok();
};
