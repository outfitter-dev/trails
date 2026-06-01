/**
 * Warden projection for shared adapter readiness checks.
 *
 * Adapter facts stay in @ontrails/adapter-kit. Warden only maps those facts
 * into governance diagnostics and severity.
 */

import { checkAdapters } from '@ontrails/adapter-kit';
import type { AdapterCheckDiagnostic } from '@ontrails/adapter-kit';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { WardenDiagnostic } from './rules/types.js';

export const adapterCheckRuleName = 'adapter-check';
const adapterCheckRootCode = 'adapter-check-root';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toWardenDiagnostic = (
  diagnostic: AdapterCheckDiagnostic
): WardenDiagnostic => ({
  code: diagnostic.code,
  filePath: diagnostic.packageJsonPath,
  line: 1,
  message: diagnostic.message,
  rule: adapterCheckRuleName,
  severity: 'warn',
});

const toRootDiagnostic = (
  message: string,
  filePath: string
): WardenDiagnostic => ({
  code: adapterCheckRootCode,
  filePath,
  line: 1,
  message,
  rule: adapterCheckRuleName,
  severity: 'error',
});

const workspacePatternsFromManifest = (
  manifest: Readonly<Record<string, unknown>>
): readonly string[] => {
  const { workspaces } = manifest;
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (pattern): pattern is string => typeof pattern === 'string'
    );
  }

  const packages = isRecord(workspaces) ? workspaces['packages'] : undefined;
  return Array.isArray(packages)
    ? packages.filter(
        (pattern): pattern is string => typeof pattern === 'string'
      )
    : [];
};

const validateAdapterCheckRoot = (
  rootDir: string
): readonly WardenDiagnostic[] => {
  if (!existsSync(rootDir)) {
    return [
      toRootDiagnostic(
        `adapter.check rootDir does not exist: "${rootDir}"`,
        rootDir
      ),
    ];
  }

  if (!statSync(rootDir).isDirectory()) {
    return [
      toRootDiagnostic(
        `adapter.check rootDir must be a directory: "${rootDir}"`,
        rootDir
      ),
    ];
  }

  const packageJsonPath = join(rootDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return [
      toRootDiagnostic(
        `adapter.check rootDir must contain a package.json workspace manifest: "${packageJsonPath}"`,
        packageJsonPath
      ),
    ];
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? `: ${error.message}` : '';
    return [
      toRootDiagnostic(
        `adapter.check could not read root package.json: "${packageJsonPath}"${reason}`,
        packageJsonPath
      ),
    ];
  }

  if (!isRecord(manifest)) {
    return [
      toRootDiagnostic(
        `adapter.check root package.json must contain a JSON object: "${packageJsonPath}"`,
        packageJsonPath
      ),
    ];
  }

  if (workspacePatternsFromManifest(manifest).length === 0) {
    return [
      toRootDiagnostic(
        `adapter.check root package.json must declare workspace packages: "${packageJsonPath}"`,
        packageJsonPath
      ),
    ];
  }

  return [];
};

export const runWardenAdapterChecks = (
  rootDir: string
): readonly WardenDiagnostic[] => {
  const rootDiagnostics = validateAdapterCheckRoot(rootDir);
  if (rootDiagnostics.length > 0) {
    return rootDiagnostics;
  }

  return checkAdapters(rootDir).diagnostics.map(toWardenDiagnostic);
};
