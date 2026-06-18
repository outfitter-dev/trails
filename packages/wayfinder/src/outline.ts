import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import {
  DerivationError,
  NotFoundError,
  Result,
  ValidationError,
  securePath,
  trail,
} from '@ontrails/core';
import type { TrailsError } from '@ontrails/core';
import type { TopoGraph, TopoGraphEntry } from '@ontrails/topographer';
import {
  findTrailDefinitions,
  getStringValue,
  identifierName,
  isCallExpression,
  isClassMember,
  isDeclarationWithId,
  isExportAllDeclaration,
  isExportDeclaration,
  isExportDefaultDeclaration,
  isExportNamedDeclaration,
  isExportSpecifier,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isMemberExpression,
  isProgram,
  isVariableDeclaration,
  isVariableDeclarator,
  offsetToLineColumn,
  parseWithDiagnostics,
  walkWithParents,
} from '@ontrails/warden/ast';
import type { AstNode, AstParentContext } from '@ontrails/warden/ast';
import { z } from 'zod';

import { loadWayfinderArtifacts } from './loader.js';
import type { WayfinderArtifactLoad } from './loader.js';

const outlineFeatureNames = [
  'source',
  'trails',
  'apps',
  'contracts',
  'surfaces',
  'graph',
  'diagnostics',
] as const;

const defaultOutlineFeatures = [
  'trails',
  'apps',
  'surfaces',
  'graph',
  'diagnostics',
] as const;

const outlineViewFeatures = {
  all: outlineFeatureNames,
  contracts: ['trails', 'contracts', 'graph', 'diagnostics'],
  default: defaultOutlineFeatures,
  review: ['source', 'trails', 'contracts', 'graph', 'diagnostics'],
  source: ['source', 'diagnostics'],
  surfaces: ['trails', 'apps', 'surfaces', 'graph', 'diagnostics'],
} as const satisfies Record<string, readonly OutlineFeature[]>;

const outlineFeatureSchema = z.enum(outlineFeatureNames);
const outlineViewSchema = z.enum([
  'all',
  'contracts',
  'custom',
  'default',
  'review',
  'source',
  'surfaces',
]);

export type OutlineFeature = z.infer<typeof outlineFeatureSchema>;
export type OutlineView = z.infer<typeof outlineViewSchema>;

export const outlineInputSchema = z
  .object({
    all: z
      .boolean()
      .default(false)
      .describe('Show every outline feature family'),
    contracts: z
      .boolean()
      .default(false)
      .describe('Show trail contract and schema facts'),
    features: z
      .string()
      .optional()
      .describe('Comma-separated feature families to include'),
    file: z.string().min(1).describe('Source file to outline'),
    review: z
      .boolean()
      .default(false)
      .describe('Show the source and contract facts most useful for review'),
    rootDir: z.string().optional().describe('Workspace root directory'),
    source: z
      .boolean()
      .default(false)
      .describe('Show source-level imports, exports, and declarations'),
    surfaces: z
      .boolean()
      .default(false)
      .describe('Show surface and app membership facts'),
  })
  .strict();

export type OutlineInput = z.output<typeof outlineInputSchema>;

const sourceImportSchema = z.object({
  names: z.array(z.string()).readonly(),
  source: z.string(),
});

const sourceExportSchema = z.object({
  line: z.number().int().positive(),
  names: z.array(z.string()).readonly(),
  source: z.string().optional(),
});

const sourceDeclarationSchema = z.object({
  kind: z.enum([
    'class',
    'class-member',
    'const',
    'function',
    'interface',
    'type',
    'variable',
  ]),
  line: z.number().int().positive(),
  name: z.string(),
});

const sourceAppSchema = z.object({
  callee: z.string(),
  line: z.number().int().positive(),
  name: z.string(),
});

const sourceOutlineSchema = z.object({
  declarations: z.array(sourceDeclarationSchema).readonly(),
  exports: z.array(sourceExportSchema).readonly(),
  imports: z.array(sourceImportSchema).readonly(),
  lineCount: z.number().int().nonnegative(),
});

const trailOutlineSchema = z.object({
  contracts: z
    .object({
      input: z.boolean(),
      output: z.boolean(),
    })
    .optional(),
  graph: z
    .object({
      exampleCount: z.number().int().nonnegative(),
      intent: z.enum(['destroy', 'read', 'write']),
      surfaces: z.array(z.string()).readonly(),
    })
    .optional(),
  id: z.string(),
  line: z.number().int().positive(),
});

const graphOutlineSchema = z.object({
  matchedTrailIds: z.array(z.string()).readonly(),
  source: z
    .object({
      freshness: z.string(),
      kind: z.string(),
      path: z.string().optional(),
    })
    .nullable(),
});

const outlineDiagnosticSchema = z.object({
  code: z.string(),
  line: z.number().int().positive().optional(),
  message: z.string(),
  severity: z.enum(['error', 'info', 'warn']),
});

const outlineCountsSchema = z.object({
  apps: z.number().int().nonnegative(),
  declarations: z.number().int().nonnegative(),
  diagnostics: z.number().int().nonnegative(),
  graphMatches: z.number().int().nonnegative().optional(),
  trails: z.number().int().nonnegative(),
});

export const outlineOutputSchema = z.object({
  apps: z.array(sourceAppSchema).readonly().optional(),
  counts: outlineCountsSchema,
  diagnostics: z.array(outlineDiagnosticSchema).readonly().optional(),
  features: z.object({
    included: z.array(outlineFeatureSchema).readonly(),
    omitted: z.array(outlineFeatureSchema).readonly(),
    view: outlineViewSchema,
  }),
  file: z.string(),
  graph: graphOutlineSchema.optional(),
  rootDir: z.string(),
  source: sourceOutlineSchema.optional(),
  surfaces: z.array(z.string()).readonly().optional(),
  trails: z.array(trailOutlineSchema).readonly().optional(),
});

export type OutlineOutput = z.output<typeof outlineOutputSchema>;

interface OutlineDiagnostic {
  readonly code: string;
  readonly line?: number | undefined;
  readonly message: string;
  readonly severity: 'error' | 'info' | 'warn';
}

interface SourceImport {
  readonly names: readonly string[];
  readonly source: string;
}

interface SourceExport {
  readonly line: number;
  readonly names: readonly string[];
  readonly source?: string | undefined;
}

interface SourceDeclaration {
  readonly kind:
    | 'class'
    | 'class-member'
    | 'const'
    | 'function'
    | 'interface'
    | 'type'
    | 'variable';
  readonly line: number;
  readonly name: string;
}

interface SourceTrail {
  readonly id: string;
  readonly line: number;
}

interface SourceApp {
  readonly callee: string;
  readonly line: number;
  readonly name: string;
}

interface ParsedSourceOutline {
  readonly apps: readonly SourceApp[];
  readonly declarations: readonly SourceDeclaration[];
  readonly diagnostics: readonly OutlineDiagnostic[];
  readonly exports: readonly SourceExport[];
  readonly imports: readonly SourceImport[];
  readonly lineCount: number;
  readonly trails: readonly SourceTrail[];
}

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].toSorted();

const lineFor = (sourceCode: string, node: AstNode): number =>
  offsetToLineColumn(sourceCode, node.start).line;

const stringLiteralValue = (node: AstNode | undefined): string | undefined => {
  if (!node) {
    return undefined;
  }
  return getStringValue(node) ?? undefined;
};

const propertyName = (node: AstNode | undefined): string | undefined => {
  if (!node) {
    return undefined;
  }
  if (isIdentifier(node)) {
    return identifierName(node) ?? undefined;
  }
  return stringLiteralValue(node);
};

const staticCalleeName = (node: AstNode | undefined): string | undefined => {
  if (!node) {
    return undefined;
  }
  if (isIdentifier(node)) {
    return identifierName(node) ?? undefined;
  }
  if (isMemberExpression(node)) {
    const receiver = identifierName(node.object);
    const member = propertyName(node.property);
    return receiver && member ? `${receiver}.${member}` : member;
  }
  return undefined;
};

const localImportName = (specifier: AstNode): string | undefined => {
  if (!isImportSpecifier(specifier)) {
    return undefined;
  }
  const { imported, local } = specifier;
  if (specifier.type === 'ImportSpecifier') {
    return (
      identifierName(local) ??
      identifierName(imported) ??
      stringLiteralValue(imported) ??
      undefined
    );
  }
  return identifierName(local) ?? undefined;
};

const collectImports = (ast: AstNode): readonly SourceImport[] => {
  const imports: SourceImport[] = [];
  for (const node of isProgram(ast) ? (ast.body ?? []) : []) {
    if (!isImportDeclaration(node)) {
      continue;
    }
    const source = stringLiteralValue(node.source);
    if (source === undefined) {
      continue;
    }
    imports.push({
      names: uniqueSorted(
        (node.specifiers ?? []).flatMap((specifier) => {
          const name = localImportName(specifier);
          return name === undefined ? [] : [name];
        })
      ),
      source,
    });
  }
  return imports;
};

const declarationName = (node: AstNode | undefined): string | undefined => {
  if (!isDeclarationWithId(node)) {
    return undefined;
  }
  return identifierName(node.id) ?? undefined;
};

const variableKind = (declaration: AstNode): SourceDeclaration['kind'] =>
  isVariableDeclaration(declaration) && declaration.kind === 'const'
    ? 'const'
    : 'variable';

const collectVariableDeclarations = (
  node: AstNode,
  kind: SourceDeclaration['kind'],
  sourceCode: string
): SourceDeclaration[] => {
  if (!isVariableDeclaration(node)) {
    return [];
  }
  return (node.declarations ?? []).flatMap((declarator) => {
    if (!isVariableDeclarator(declarator)) {
      return [];
    }
    const name = identifierName(declarator.id);
    return name === null
      ? []
      : [{ kind, line: lineFor(sourceCode, declarator), name }];
  });
};

const isTopLevelStatement = (context: AstParentContext): boolean => {
  if (isProgram(context.parent)) {
    return true;
  }
  if (
    !isExportNamedDeclaration(context.parent) &&
    !isExportDefaultDeclaration(context.parent)
  ) {
    return false;
  }
  return (
    context.parent.parent === undefined || isProgram(context.parent.parent)
  );
};

const collectDeclarations = (
  ast: AstNode,
  sourceCode: string
): readonly SourceDeclaration[] => {
  const declarations: SourceDeclaration[] = [];

  walkWithParents(ast, (node, context) => {
    if (isClassMember(node)) {
      const name = propertyName(node.key);
      if (name !== undefined) {
        declarations.push({
          kind: 'class-member',
          line: lineFor(sourceCode, node),
          name,
        });
      }
      return;
    }

    if (!isTopLevelStatement(context)) {
      return;
    }

    if (isDeclarationWithId(node) && node.type === 'FunctionDeclaration') {
      const name = declarationName(node);
      if (name !== undefined) {
        declarations.push({
          kind: 'function',
          line: lineFor(sourceCode, node),
          name,
        });
      }
      return;
    }

    if (isDeclarationWithId(node) && node.type === 'ClassDeclaration') {
      const name = declarationName(node);
      if (name !== undefined) {
        declarations.push({
          kind: 'class',
          line: lineFor(sourceCode, node),
          name,
        });
      }
      return;
    }

    if (
      isDeclarationWithId(node) &&
      (node.type === 'TSInterfaceDeclaration' ||
        node.type === 'InterfaceDeclaration')
    ) {
      const name = declarationName(node);
      if (name !== undefined) {
        declarations.push({
          kind: 'interface',
          line: lineFor(sourceCode, node),
          name,
        });
      }
      return;
    }

    if (isDeclarationWithId(node) && node.type === 'TSTypeAliasDeclaration') {
      const name = declarationName(node);
      if (name !== undefined) {
        declarations.push({
          kind: 'type',
          line: lineFor(sourceCode, node),
          name,
        });
      }
      return;
    }

    if (isVariableDeclaration(node)) {
      declarations.push(
        ...collectVariableDeclarations(node, variableKind(node), sourceCode)
      );
    }
  });

  return declarations.toSorted(
    (a, b) => a.line - b.line || a.name.localeCompare(b.name)
  );
};

const exportNamesFromDeclaration = (
  declaration: AstNode
): readonly string[] => {
  if (isVariableDeclaration(declaration)) {
    return collectVariableDeclarations(declaration, 'variable', '').map(
      (entry) => entry.name
    );
  }
  const name = declarationName(declaration);
  return name === undefined ? [] : [name];
};

const collectExports = (
  ast: AstNode,
  sourceCode: string
): readonly SourceExport[] => {
  const exports: SourceExport[] = [];
  for (const node of isProgram(ast) ? (ast.body ?? []) : []) {
    if (!isExportDeclaration(node)) {
      continue;
    }
    const exportSource = stringLiteralValue(node.source);
    const names = uniqueSorted([
      ...(node.declaration === undefined
        ? []
        : exportNamesFromDeclaration(node.declaration)),
      ...(node.specifiers ?? []).flatMap((specifier) => {
        if (!isExportSpecifier(specifier)) {
          return [];
        }
        const { exported, local } = specifier;
        return [propertyName(exported) ?? propertyName(local)].filter(
          (name): name is string => name !== undefined
        );
      }),
      ...(isExportDefaultDeclaration(node) ? ['default'] : []),
      ...(isExportAllDeclaration(node) ? ['*'] : []),
    ]);
    exports.push({
      line: lineFor(sourceCode, node),
      names,
      ...(exportSource === undefined ? {} : { source: exportSource }),
    });
  }
  return exports;
};

const collectApps = (
  ast: AstNode,
  sourceCode: string
): readonly SourceApp[] => {
  const apps: SourceApp[] = [];
  walkWithParents(ast, (node, context) => {
    if (!isVariableDeclarator(node) || !isCallExpression(node.init)) {
      return;
    }
    const callee = staticCalleeName(node.init.callee);
    if (callee !== 'topo' && callee !== 'createTrailsApp') {
      return;
    }
    const name = identifierName(node.id);
    if (name === null) {
      return;
    }
    const lineSource = context.parent ?? node;
    apps.push({ callee, line: lineFor(sourceCode, lineSource), name });
  });
  return apps;
};

const parseSourceOutline = (
  filePath: string,
  sourceCode: string
): ParsedSourceOutline | null => {
  const parsed = parseWithDiagnostics(filePath, sourceCode);
  if (parsed.ast === null) {
    return null;
  }

  return {
    apps: collectApps(parsed.ast, sourceCode),
    declarations: collectDeclarations(parsed.ast, sourceCode),
    diagnostics: parsed.diagnostics.map((diagnostic) => {
      const [label] = diagnostic.labels;
      return {
        code: 'source.parse',
        ...(label === undefined
          ? {}
          : { line: offsetToLineColumn(sourceCode, label.start).line }),
        message: diagnostic.message,
        severity:
          diagnostic.severity.toLowerCase() === 'error' ? 'error' : 'warn',
      };
    }),
    exports: collectExports(parsed.ast, sourceCode),
    imports: collectImports(parsed.ast),
    lineCount: sourceCode.length === 0 ? 0 : sourceCode.split('\n').length,
    trails: findTrailDefinitions(parsed.ast).map((definition) => ({
      id: definition.id,
      line: offsetToLineColumn(sourceCode, definition.start).line,
    })),
  };
};

const selectedView = (
  input: OutlineInput
): Result<
  { readonly features: readonly OutlineFeature[]; readonly view: OutlineView },
  ValidationError
> => {
  const selected = [
    input.all ? 'all' : undefined,
    input.contracts ? 'contracts' : undefined,
    input.review ? 'review' : undefined,
    input.source ? 'source' : undefined,
    input.surfaces ? 'surfaces' : undefined,
    input.features === undefined ? undefined : 'custom',
  ].filter((value): value is OutlineView => value !== undefined);

  if (selected.length > 1) {
    return Result.err(
      new ValidationError(
        'Choose only one outline view: --review, --source, --contracts, --surfaces, --all, or --features.'
      )
    );
  }

  const view = selected[0] ?? 'default';
  if (view !== 'custom') {
    return Result.ok({ features: outlineViewFeatures[view], view });
  }

  const values = (input.features ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const parsed = z.array(outlineFeatureSchema).safeParse(values);
  if (!parsed.success || values.length === 0) {
    return Result.err(
      new ValidationError(
        `--features must be a comma-separated list drawn from: ${outlineFeatureNames.join(', ')}.`
      )
    );
  }
  return Result.ok({
    features: uniqueSorted(parsed.data) as OutlineFeature[],
    view,
  });
};

const hasFeature = (
  features: readonly OutlineFeature[],
  feature: OutlineFeature
): boolean => features.includes(feature);

const loadGraphSoft = async (
  rootDir: string
): Promise<{
  readonly diagnostics: readonly OutlineDiagnostic[];
  readonly graph: TopoGraph | null;
  readonly load: WayfinderArtifactLoad | null;
}> => {
  try {
    const load = await loadWayfinderArtifacts({ rootDir });
    if (load.topoGraph === null) {
      return {
        diagnostics: [
          {
            code: 'graph.missing',
            message:
              'No saved Wayfinder TopoGraph artifact found. Source outline is still available. To add graph reconciliation, run `trails compile --module <app-module> --root-dir <workspace-root> --permit \'{"id":"operator","scopes":["topo:write"]}\'` with a permit authorized for topo:write.',
            severity: 'warn',
          },
        ],
        graph: null,
        load,
      };
    }
    return {
      diagnostics:
        load.freshness.status === 'fresh'
          ? []
          : [
              {
                code: 'graph.freshness',
                message: `Saved Wayfinder artifacts are ${load.freshness.status}.`,
                severity: 'warn',
              },
            ],
      graph: load.topoGraph,
      load,
    };
  } catch (error) {
    return {
      diagnostics: [
        {
          code: 'graph.load',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to load Wayfinder artifacts.',
          severity: 'warn',
        },
      ],
      graph: null,
      load: null,
    };
  }
};

const trailGraphFacts = (
  graph: TopoGraph | null,
  id: string
):
  | {
      readonly exampleCount: number;
      readonly intent: 'destroy' | 'read' | 'write';
      readonly surfaces: readonly string[];
    }
  | undefined => {
  const entry = graph?.entries.find(
    (candidate): candidate is TopoGraphEntry =>
      candidate.kind === 'trail' && candidate.id === id
  );
  if (entry === undefined) {
    return undefined;
  }
  return {
    exampleCount: entry.exampleCount,
    intent: entry.intent ?? 'write',
    surfaces: entry.surfaces,
  };
};

const contractFacts = (
  graph: TopoGraph | null,
  id: string
): { readonly input: boolean; readonly output: boolean } | undefined => {
  const entry = graph?.entries.find(
    (candidate) => candidate.kind === 'trail' && candidate.id === id
  );
  return entry === undefined
    ? undefined
    : { input: entry.input !== undefined, output: entry.output !== undefined };
};

const graphSourcePath = (rootDir: string): string =>
  resolve(rootDir, '.trails', 'topo.lock');

const graphOutline = (
  rootDir: string,
  graph: TopoGraph | null,
  load: WayfinderArtifactLoad | null,
  sourceTrails: readonly SourceTrail[]
): z.output<typeof graphOutlineSchema> => ({
  matchedTrailIds: sourceTrails
    .map((sourceTrail) => sourceTrail.id)
    .filter((id) =>
      graph?.entries.some((entry) => entry.kind === 'trail' && entry.id === id)
    )
    .toSorted(),
  source:
    graph === null || load === null
      ? null
      : {
          freshness: load.freshness.status,
          kind: 'topoGraph',
          path: graphSourcePath(rootDir),
        },
});

const buildOutline = async (
  input: OutlineInput,
  cwd: string | undefined
): Promise<Result<OutlineOutput, TrailsError>> => {
  const view = selectedView(input);
  if (view.isErr()) {
    return view;
  }

  const rootDir = resolve(input.rootDir ?? cwd ?? process.cwd());
  const safeFile = securePath(rootDir, input.file);
  if (safeFile.isErr()) {
    return safeFile;
  }

  let sourceCode: string;
  try {
    sourceCode = await readFile(safeFile.value, 'utf8');
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    return Result.err(
      new NotFoundError(`Unable to read source file "${input.file}".`, {
        cause,
        context: { file: safeFile.value },
      })
    );
  }

  const parsed = parseSourceOutline(safeFile.value, sourceCode);
  if (parsed === null) {
    return Result.err(
      new DerivationError(`Unable to parse source file "${input.file}".`, {
        context: { file: safeFile.value },
      })
    );
  }

  const graphLoad = await loadGraphSoft(rootDir);
  const diagnostics = [...parsed.diagnostics, ...graphLoad.diagnostics];
  const { features } = view.value;
  const omitted = outlineFeatureNames.filter(
    (feature) => !features.includes(feature)
  );
  const relativeFile = relative(rootDir, safeFile.value) || input.file;
  const trails = parsed.trails.map((sourceTrail) => ({
    ...(hasFeature(features, 'contracts')
      ? { contracts: contractFacts(graphLoad.graph, sourceTrail.id) }
      : {}),
    id: sourceTrail.id,
    line: sourceTrail.line,
    ...(hasFeature(features, 'graph')
      ? { graph: trailGraphFacts(graphLoad.graph, sourceTrail.id) }
      : {}),
  }));
  const surfaces = uniqueSorted(
    parsed.trails.flatMap(
      (sourceTrail) =>
        trailGraphFacts(graphLoad.graph, sourceTrail.id)?.surfaces ?? []
    )
  );
  const graphMatches = parsed.trails.filter((sourceTrail) =>
    graphLoad.graph?.entries.some(
      (entry) => entry.kind === 'trail' && entry.id === sourceTrail.id
    )
  ).length;

  return Result.ok({
    ...(hasFeature(features, 'apps') ? { apps: parsed.apps } : {}),
    counts: {
      apps: parsed.apps.length,
      declarations: parsed.declarations.length,
      diagnostics: diagnostics.length,
      ...(hasFeature(features, 'graph') ? { graphMatches } : {}),
      trails: parsed.trails.length,
    },
    ...(hasFeature(features, 'diagnostics') ? { diagnostics } : {}),
    features: {
      included: features,
      omitted,
      view: view.value.view,
    },
    file: relativeFile,
    ...(hasFeature(features, 'graph')
      ? {
          graph: graphOutline(
            rootDir,
            graphLoad.graph,
            graphLoad.load,
            parsed.trails
          ),
        }
      : {}),
    rootDir,
    ...(hasFeature(features, 'source')
      ? {
          source: {
            declarations: parsed.declarations,
            exports: parsed.exports,
            imports: parsed.imports,
            lineCount: parsed.lineCount,
          },
        }
      : {}),
    ...(hasFeature(features, 'surfaces') ? { surfaces } : {}),
    ...(hasFeature(features, 'trails') ? { trails } : {}),
  });
};

export const wayfindOutlineTrail = trail('wayfind.outline', {
  args: ['file'],
  blaze: async (input, ctx) => buildOutline(input, ctx.cwd),
  description:
    'Outline one source file and connect source structure to saved Trails graph facts',
  examples: [
    {
      input: { file: 'apps/trails/src/app.ts', rootDir: '.' },
      name: 'Outline a Trails source file',
    },
  ],
  input: outlineInputSchema,
  intent: 'read',
  output: outlineOutputSchema,
  visibility: 'internal',
});
