import { isPlainObject } from '@ontrails/core';

import type {
  DependencyField,
  TransitionChange,
  TransitionDiagnostic,
} from './types.ts';
import { TARGET_VERSION } from './types.ts';

const DEPENDENCY_FIELDS: readonly DependencyField[] = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
];
const OLD_VERSION = /^(\^|~)?(?:1\.0\.0-beta\.[0-9A-Za-z.-]+|1\.0\.[01])$/u;
const TARGET_RANGE = /^(?:\^|~)?0\.2\.0$/u;
const NPM_ALIAS = /^npm:(@ontrails\/[a-z0-9._-]+)@(.+)$/u;

interface FieldPlan {
  readonly changes: readonly TransitionChange[];
  readonly diagnostics: readonly TransitionDiagnostic[];
}

const replacementFor = (specifier: string): string | undefined => {
  const match = OLD_VERSION.exec(specifier);
  return match ? `${match[1] ?? ''}${TARGET_VERSION}` : undefined;
};

const workspaceReplacementFor = (specifier: string): string | undefined => {
  if (!specifier.startsWith('workspace:')) {
    return undefined;
  }
  const range = specifier.slice('workspace:'.length);
  if (range === '^') {
    return `^${TARGET_VERSION}`;
  }
  if (range === '~') {
    return `~${TARGET_VERSION}`;
  }
  if (range === '*' || range === '') {
    return TARGET_VERSION;
  }
  return replacementFor(range);
};

const planSpecifier = ({
  localPackages,
  name,
  publicPackages,
  specifier,
}: {
  readonly localPackages: ReadonlySet<string>;
  readonly name: string;
  readonly publicPackages: ReadonlySet<string>;
  readonly specifier: string;
}): {
  readonly effectiveName?: string;
  readonly replacement?: string;
  readonly unsupported?: boolean;
} => {
  const alias = NPM_ALIAS.exec(specifier);
  const effectiveName =
    alias?.[1] ?? (name.startsWith('@ontrails/') ? name : undefined);
  if (!effectiveName) {
    return {};
  }
  if (!publicPackages.has(effectiveName)) {
    return { effectiveName, unsupported: true };
  }
  const source = alias?.[2] ?? specifier;
  if (source.startsWith('catalog:')) {
    return { effectiveName };
  }
  const replacement = localPackages.has(effectiveName)
    ? replacementFor(source)
    : (workspaceReplacementFor(source) ?? replacementFor(source));
  if (replacement) {
    return {
      effectiveName,
      replacement: alias ? `npm:${effectiveName}@${replacement}` : replacement,
    };
  }
  if (TARGET_RANGE.test(source) || source.startsWith('workspace:')) {
    return { effectiveName };
  }
  return { effectiveName, unsupported: true };
};

const planSpecifierMap = ({
  declarations,
  field,
  file,
  localPackages,
  publicPackages,
}: {
  readonly declarations: Record<string, unknown>;
  readonly field: string;
  readonly file: string;
  readonly localPackages: ReadonlySet<string>;
  readonly publicPackages: ReadonlySet<string>;
}): FieldPlan => {
  const changes: TransitionChange[] = [];
  const diagnostics: TransitionDiagnostic[] = [];
  for (const [name, specifier] of Object.entries(declarations)) {
    if (typeof specifier !== 'string') {
      if (name.startsWith('@ontrails/')) {
        diagnostics.push({
          file,
          message: `${field}.${name} must be a string.`,
          name,
        });
      }
      continue;
    }
    const planned = planSpecifier({
      localPackages,
      name,
      publicPackages,
      specifier,
    });
    if (!planned.effectiveName) {
      continue;
    }
    if (!publicPackages.has(planned.effectiveName)) {
      diagnostics.push({
        file,
        message: `Package ${planned.effectiveName} is not in the current public Trails package set. Migrate its package route before changing versions.`,
        name: planned.effectiveName,
      });
      continue;
    }
    if (planned.unsupported) {
      diagnostics.push({
        file,
        message: `${field}.${name} uses unsupported source ${specifier}.`,
        name: planned.effectiveName,
      });
      continue;
    }
    if (!planned.replacement || planned.replacement === specifier) {
      continue;
    }
    declarations[name] = planned.replacement;
    changes.push({
      field,
      file,
      from: specifier,
      kind: 'replace',
      name,
      to: planned.replacement,
    });
  }
  return { changes, diagnostics };
};

const isBetaTarballOverride = (name: string, specifier: string): boolean => {
  const slug = name.slice('@ontrails/'.length);
  return (
    name.startsWith('@ontrails/') &&
    specifier.startsWith('file:') &&
    specifier.endsWith('.tgz') &&
    specifier.includes(`/ontrails-${slug}-1.0.0-beta.`)
  );
};

const containsTrailsDeclaration = (value: unknown): boolean =>
  isPlainObject(value) &&
  Object.entries(value).some(
    ([name, nested]) =>
      name.startsWith('@ontrails/') || containsTrailsDeclaration(nested)
  );

const planResolutionFields = ({
  file,
  manifest,
  publicPackages,
}: {
  readonly file: string;
  readonly manifest: Record<string, unknown>;
  readonly publicPackages: ReadonlySet<string>;
}): FieldPlan => {
  const changes: TransitionChange[] = [];
  const diagnostics: TransitionDiagnostic[] = [];
  for (const field of ['overrides', 'resolutions'] as const) {
    const declarations = manifest[field];
    if (declarations === undefined) {
      continue;
    }
    if (!isPlainObject(declarations)) {
      diagnostics.push({ file, message: `${field} must be an object.` });
      continue;
    }
    let removedEntry = false;
    for (const [name, specifier] of Object.entries(declarations)) {
      if (typeof specifier !== 'string') {
        if (
          name.startsWith('@ontrails/') ||
          containsTrailsDeclaration(specifier)
        ) {
          diagnostics.push({
            file,
            message: `Nested or non-string ${field}.${name} is not supported by this transition bridge.`,
            name,
          });
        }
        continue;
      }
      if (!name.startsWith('@ontrails/') && name.includes('@ontrails/')) {
        diagnostics.push({
          file,
          message: `Selector-bearing ${field}.${name} is not supported by this transition bridge.`,
          name,
        });
        continue;
      }
      if (isBetaTarballOverride(name, specifier)) {
        Reflect.deleteProperty(declarations, name);
        removedEntry = true;
        changes.push({ field, file, from: specifier, kind: 'remove', name });
        continue;
      }
      const temporary = { [name]: specifier };
      const plan = planSpecifierMap({
        declarations: temporary,
        field,
        file,
        localPackages: new Set(),
        publicPackages,
      });
      diagnostics.push(...plan.diagnostics);
      const replacement = temporary[name];
      if (replacement === specifier) {
        continue;
      }
      declarations[name] = replacement;
      changes.push({
        field,
        file,
        from: specifier,
        kind: 'replace',
        name,
        to: String(replacement),
      });
    }
    if (removedEntry && Object.keys(declarations).length === 0) {
      Reflect.deleteProperty(manifest, field);
    }
  }
  return { changes, diagnostics };
};

const planCatalogs = ({
  file,
  manifest,
  publicPackages,
}: {
  readonly file: string;
  readonly manifest: Record<string, unknown>;
  readonly publicPackages: ReadonlySet<string>;
}): FieldPlan => {
  const plans: FieldPlan[] = [];
  const { catalog, catalogs } = manifest;
  if (catalog !== undefined && !isPlainObject(catalog)) {
    plans.push({
      changes: [],
      diagnostics: [{ file, message: 'catalog must be an object.' }],
    });
  } else if (isPlainObject(catalog)) {
    plans.push(
      planSpecifierMap({
        declarations: catalog,
        field: 'catalog',
        file,
        localPackages: new Set(),
        publicPackages,
      })
    );
  }
  if (catalogs !== undefined && !isPlainObject(catalogs)) {
    plans.push({
      changes: [],
      diagnostics: [{ file, message: 'catalogs must be an object.' }],
    });
  } else if (isPlainObject(catalogs)) {
    for (const [name, namedCatalog] of Object.entries(catalogs)) {
      if (!isPlainObject(namedCatalog)) {
        plans.push({
          changes: [],
          diagnostics: [
            { file, message: `catalogs.${name} must be an object.` },
          ],
        });
        continue;
      }
      plans.push(
        planSpecifierMap({
          declarations: namedCatalog,
          field: `catalogs.${name}`,
          file,
          localPackages: new Set(),
          publicPackages,
        })
      );
    }
  }
  return {
    changes: plans.flatMap((plan) => plan.changes),
    diagnostics: plans.flatMap((plan) => plan.diagnostics),
  };
};

export const planManifestSpecifiers = ({
  file,
  isRoot,
  localPackages,
  manifest,
  publicPackages,
}: {
  readonly file: string;
  readonly isRoot: boolean;
  readonly localPackages: ReadonlySet<string>;
  readonly manifest: Record<string, unknown>;
  readonly publicPackages: ReadonlySet<string>;
}): FieldPlan => {
  const plans: FieldPlan[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const declarations = manifest[field];
    if (declarations === undefined) {
      continue;
    }
    plans.push(
      isPlainObject(declarations)
        ? planSpecifierMap({
            declarations,
            field,
            file,
            localPackages,
            publicPackages,
          })
        : {
            changes: [],
            diagnostics: [{ file, message: `${field} must be an object.` }],
          }
    );
  }
  plans.push(planResolutionFields({ file, manifest, publicPackages }));
  if (isRoot) {
    plans.push(planCatalogs({ file, manifest, publicPackages }));
  }
  return {
    changes: plans.flatMap((plan) => plan.changes),
    diagnostics: plans.flatMap((plan) => plan.diagnostics),
  };
};
