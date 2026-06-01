/**
 * `adapter.check` trail -- Local adapter authoring readiness checks.
 */

import { adapterTargetPlacements, checkAdapters } from '@ontrails/adapter-kit';
import type { AdapterCheckReport } from '@ontrails/adapter-kit';
import { isPlainObject, Result, trail, ValidationError } from '@ontrails/core';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';

import { resolveTrailRootDir } from './root-dir.js';

const adapterCheckInputSchema = z.object({
  rootDir: z.string().optional().describe('Root directory to scan'),
});

const adapterPlacementSchema = z.enum(adapterTargetPlacements);

const adapterCheckDiagnosticSchema = z.object({
  code: z.string().describe('Stable adapter diagnostic code'),
  message: z.string(),
  packageJsonPath: z.string(),
  packageName: z.string().optional(),
  placement: adapterPlacementSchema.optional(),
  severity: z.enum(['error', 'warn']),
  target: z.string().optional(),
});

const adapterCheckSubjectSchema = z.object({
  conformanceTestPaths: z.array(z.string()).readonly(),
  key: z.string(),
  ownerPackage: z.string(),
  packageJsonPath: z.string(),
  packageName: z.string(),
  packageRoot: z.string(),
  placement: adapterPlacementSchema,
  target: z.string(),
  targetKey: z.string(),
  testingImport: z.string().optional(),
});

const adapterTargetSchema = z.object({
  key: z.string(),
  ownerPackage: z.string(),
  packageJsonPath: z.string(),
  packageRoot: z.string(),
  placements: z.array(adapterPlacementSchema).readonly(),
  supportExportTarget: z.string().optional(),
  supportImport: z.string().optional(),
  target: z.string(),
  testingExportTarget: z.string().optional(),
  testingImport: z.string().optional(),
});

const adapterCheckOutputSchema = z.object({
  diagnostics: z.array(adapterCheckDiagnosticSchema).readonly(),
  formatted: z.string(),
  passed: z.boolean(),
  subjects: z.array(adapterCheckSubjectSchema).readonly(),
  targets: z.array(adapterTargetSchema).readonly(),
});

const relativeToRoot = (rootDir: string, path: string): string => {
  const normalized = relative(rootDir, path).replaceAll('\\', '/');
  return normalized.length === 0 || normalized.startsWith('..')
    ? path
    : normalized;
};

const workspacePatternsFromManifest = (
  manifest: Readonly<Record<string, unknown>>
): readonly string[] => {
  const { workspaces } = manifest;
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (pattern): pattern is string => typeof pattern === 'string'
    );
  }

  const packages = isPlainObject(workspaces)
    ? workspaces['packages']
    : undefined;
  return Array.isArray(packages)
    ? packages.filter(
        (pattern): pattern is string => typeof pattern === 'string'
      )
    : [];
};

const readWorkspaceManifest = (
  packageJsonPath: string
): Result<Readonly<Record<string, unknown>>, ValidationError> => {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return isPlainObject(parsed)
      ? Result.ok(parsed)
      : Result.err(
          new ValidationError(
            `adapter.check root package.json must contain a JSON object: "${packageJsonPath}"`
          )
        );
  } catch (error) {
    return Result.err(
      new ValidationError(
        `adapter.check could not read root package.json: "${packageJsonPath}"`,
        error instanceof Error ? { cause: error } : undefined
      )
    );
  }
};

const validateAdapterCheckRoot = (
  rootDir: string
): Result<void, ValidationError> => {
  if (!existsSync(rootDir)) {
    return Result.err(
      new ValidationError(`adapter.check rootDir does not exist: "${rootDir}"`)
    );
  }

  if (!statSync(rootDir).isDirectory()) {
    return Result.err(
      new ValidationError(
        `adapter.check rootDir must be a directory: "${rootDir}"`
      )
    );
  }

  const packageJsonPath = join(rootDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return Result.err(
      new ValidationError(
        `adapter.check rootDir must contain a package.json workspace manifest: "${packageJsonPath}"`
      )
    );
  }

  const manifest = readWorkspaceManifest(packageJsonPath);
  if (manifest.isErr()) {
    return Result.err(manifest.error);
  }

  if (workspacePatternsFromManifest(manifest.value).length === 0) {
    return Result.err(
      new ValidationError(
        `adapter.check root package.json must declare workspace packages: "${packageJsonPath}"`
      )
    );
  }

  return Result.ok();
};

export const formatAdapterCheckReport = (
  report: AdapterCheckReport,
  rootDir: string
): string => {
  const passed = report.diagnostics.length === 0;
  const lines = [
    '## Adapter Check Report',
    '',
    `Result: ${passed ? 'PASS' : 'FAIL'}`,
    `Targets: ${report.targets.length}`,
    `Adapters: ${report.subjects.length}`,
    `Diagnostics: ${report.diagnostics.length}`,
  ];

  if (report.targets.length > 0) {
    lines.push('', '### Targets');
    for (const target of report.targets) {
      lines.push(
        `- ${target.key} (${target.placements.join(', ')}) from ${relativeToRoot(rootDir, target.packageJsonPath)}`
      );
    }
  }

  if (report.subjects.length > 0) {
    lines.push('', '### Adapters');
    for (const subject of report.subjects) {
      const conformance =
        subject.conformanceTestPaths.length === 0
          ? 'no conformance tests'
          : `${subject.conformanceTestPaths.length} conformance test(s)`;
      lines.push(
        `- ${subject.packageName} -> ${subject.targetKey} (${subject.placement}, ${conformance})`
      );
    }
  }

  if (report.diagnostics.length > 0) {
    lines.push('', '### Diagnostics');
    for (const diagnostic of report.diagnostics) {
      lines.push(
        `- ${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${relativeToRoot(rootDir, diagnostic.packageJsonPath)}: ${diagnostic.message}`
      );
    }
  }

  return lines.join('\n');
};

export const adapterCheckTrail = trail('adapter.check', {
  blaze: (input, ctx) => {
    const rootDirResult = resolveTrailRootDir(input.rootDir, ctx.cwd);
    if (rootDirResult.isErr()) {
      return rootDirResult;
    }

    const rootDir = rootDirResult.value;
    const validRoot = validateAdapterCheckRoot(rootDir);
    if (validRoot.isErr()) {
      return validRoot;
    }

    const report = checkAdapters(rootDir);

    return Result.ok({
      diagnostics: [...report.diagnostics],
      formatted: formatAdapterCheckReport(report, rootDir),
      passed: report.diagnostics.length === 0,
      subjects: [...report.subjects],
      targets: [...report.targets],
    });
  },
  description: 'Check adapter authoring readiness',
  examples: [
    {
      input: {},
      name: 'Check adapters in the current workspace',
    },
  ],
  input: adapterCheckInputSchema,
  intent: 'read',
  output: adapterCheckOutputSchema,
  permit: 'public',
});
