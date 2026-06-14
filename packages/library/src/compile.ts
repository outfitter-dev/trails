/**
 * `compile` — the package emitter. Consumes the `LibraryProjection` (never the
 * topo directly) and produces the source files of a generated TypeScript
 * package: consumer-fluent root, `/result`, `/schemas`, `/trails` subpaths.
 *
 * v0 is runtime-backed: the generated package imports the source topo and the
 * `@ontrails/library` runtime (the kernel seam), so execution delegates to the
 * shared pipeline. The standalone trajectory (vendoring the kernel) does not
 * change consumer code — see the runtime-kernel section of the ADR.
 *
 * This slice returns the file plan (path + content); writing it to disk is a
 * thin apply step. Pure: derives the projection and builds strings, no I/O.
 */
import { deriveLibraryApi } from './derive.js';
import type {
  DeriveLibraryApiOptions,
  LibraryExport,
  LibraryProjection,
} from './derive.js';
import type { Topo } from './kernel.js';

/** Options for emitting a generated library package. */
export interface CompileOptions extends DeriveLibraryApiOptions {
  /** The generated package name (e.g. `@acme/core`). */
  readonly packageName: string;
  /** Import specifier the generated code uses to reach the source topo. */
  readonly appImportPath: string;
  /** The exported binding name of the topo at `appImportPath` (default `app`). */
  readonly appExportName?: string;
  /** Runtime dependency range for `@ontrails/library` in emitted package.json. */
  readonly libraryDependency?: string;
  /** Generated package version. Defaults to `0.0.0`. */
  readonly version?: string;
  /** Peer dependency range for Zod in emitted package.json. */
  readonly zodDependency?: string;
  /**
   * Import specifier for source trail type bindings. Defaults to
   * `appImportPath` when `trailTypeExports` is provided.
   */
  readonly typeImportPath?: string;
  /**
   * Optional mapping from projected trail id to the source module export that
   * owns that trail's TypeScript type. Unmapped trails intentionally keep
   * `unknown` public signatures instead of pretending topo artifacts preserve
   * erased source types.
   */
  readonly trailTypeExports?: Readonly<Record<string, string>>;
}

/** A single emitted file: project-relative path and full contents. */
export interface CompiledFile {
  readonly path: string;
  readonly content: string;
}

/** The result of compiling a topo into a generated library package. */
export interface CompileResult {
  readonly packageName: string;
  /** The resolved projection the files were emitted from. */
  readonly projection: LibraryProjection;
  /** The emitted files, in stable path order. */
  readonly files: readonly CompiledFile[];
}

const pascalCase = (value: string): string =>
  value
    .split(/[.\-_]/u)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

const isStateless = (entry: LibraryExport): boolean =>
  entry.resources.length === 0;

const statelessExports = (
  projection: LibraryProjection
): readonly LibraryExport[] => projection.exports.filter(isStateless);

const resourceExports = (
  projection: LibraryProjection
): readonly LibraryExport[] =>
  projection.exports.filter((entry) => !isStateless(entry));

const factoryName = (projection: LibraryProjection): string =>
  `create${pascalCase(projection.app)}`;

const DEFAULT_LIBRARY_DEPENDENCY = '^1.0.0';
const DEFAULT_ZOD_DEPENDENCY = '^4.3.5';

const sanitizeJsDocLine = (value: string): string =>
  value.replaceAll('*/', '* /').trim();

const jsDoc = (lines: readonly string[], indent = ''): string =>
  [
    `${indent}/**`,
    ...lines
      .map(sanitizeJsDocLine)
      .filter((line) => line.length > 0)
      .map((line) => `${indent} * ${line}`),
    `${indent} */`,
  ].join('\n');

const exportDescription = (entry: LibraryExport): string =>
  entry.description ?? `Call the \`${entry.trailId}\` trail.`;

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/u;

interface ExportTypeBinding {
  readonly input: string;
  readonly output: string;
  readonly sourceExport: string;
}

type TypeBindings = ReadonlyMap<string, ExportTypeBinding>;

const typeNamesFor = (
  entry: LibraryExport
): Pick<ExportTypeBinding, 'input' | 'output'> => {
  const base = pascalCase(entry.exportName);
  return { input: `${base}Input`, output: `${base}Output` };
};

const resolveTypeBindings = (
  projection: LibraryProjection,
  options: CompileOptions
): TypeBindings => {
  const configured = options.trailTypeExports ?? {};
  const bindings = new Map<string, ExportTypeBinding>();
  for (const entry of projection.exports) {
    const sourceExport = configured[entry.trailId];
    if (!sourceExport) {
      continue;
    }
    if (!IDENTIFIER_PATTERN.test(sourceExport)) {
      throw new Error(
        `trailTypeExports["${entry.trailId}"] must be an exported identifier`
      );
    }
    bindings.set(entry.trailId, { ...typeNamesFor(entry), sourceExport });
  }
  return bindings;
};

const inputTypeFor = (entry: LibraryExport, bindings: TypeBindings): string =>
  bindings.get(entry.trailId)?.input ?? 'unknown';

const outputTypeFor = (entry: LibraryExport, bindings: TypeBindings): string =>
  bindings.get(entry.trailId)?.output ?? 'unknown';

const schemaTypeImport = (
  projection: LibraryProjection,
  bindings: TypeBindings
): string | undefined => {
  const names = projection.exports.flatMap((entry) => {
    const binding = bindings.get(entry.trailId);
    return binding ? [binding.input, binding.output] : [];
  });
  if (names.length === 0) {
    return undefined;
  }
  return `import type { ${names.join(', ')} } from './schemas.js';`;
};

const generatePackageJson = (options: CompileOptions): string => {
  const manifest = {
    dependencies: {
      '@ontrails/library':
        options.libraryDependency ?? DEFAULT_LIBRARY_DEPENDENCY,
      zod: options.zodDependency ?? DEFAULT_ZOD_DEPENDENCY,
    },
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
      './result': './src/result.ts',
      './schemas': './src/schemas.ts',
      './trails': './src/trails.ts',
    },
    name: options.packageName,
    type: 'module',
    version: options.version ?? '0.0.0',
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
};

const statelessFunction = (
  entry: LibraryExport,
  bindings: TypeBindings
): string =>
  [
    jsDoc([
      exportDescription(entry),
      `Projects trail \`${entry.trailId}\` as a stateless library function.`,
    ]),
    `export const ${entry.exportName} = (`,
    `  input: ${inputTypeFor(entry, bindings)}`,
    `): Promise<${outputTypeFor(entry, bindings)}> =>`,
    `  rootClient.call.${entry.exportName}(input) as Promise<${outputTypeFor(entry, bindings)}>;`,
  ].join('\n');

const factoryMethod = (entry: LibraryExport, bindings: TypeBindings): string =>
  [
    jsDoc(
      [
        exportDescription(entry),
        `Projects trail \`${entry.trailId}\` behind the resource client.`,
      ],
      '    '
    ),
    `    ${entry.exportName}: (`,
    `      input: ${inputTypeFor(entry, bindings)}`,
    `    ): Promise<${outputTypeFor(entry, bindings)}> =>`,
    `      client.call.${entry.exportName}(input) as Promise<${outputTypeFor(entry, bindings)}>,`,
  ].join('\n');

const generateIndex = (
  projection: LibraryProjection,
  options: CompileOptions,
  bindings: TypeBindings
): string => {
  const appExport = options.appExportName ?? 'app';
  const stateless = statelessExports(projection);
  const resourceful = resourceExports(projection);
  const typedSchemas = schemaTypeImport(projection, bindings);

  const parts: string[] = [
    "import { surface } from '@ontrails/library';",
    "import type { SurfaceLibraryOptions } from '@ontrails/library';",
    ...(typedSchemas ? [typedSchemas] : []),
    '',
    `import { ${appExport} } from '${options.appImportPath}';`,
    '',
    `const rootClient = await surface(${appExport});`,
  ];

  for (const entry of stateless) {
    parts.push('', statelessFunction(entry, bindings));
  }

  if (resourceful.length > 0) {
    parts.push(
      '',
      `export const ${factoryName(projection)} = async (`,
      '  options: SurfaceLibraryOptions = {}',
      ') => {',
      `  const client = await surface(${appExport}, options);`,
      '  return {',
      resourceful.map((entry) => factoryMethod(entry, bindings)).join('\n'),
      '  };',
      '};'
    );
  }

  return `${parts.join('\n')}\n`;
};

const generateSchemas = (
  projection: LibraryProjection,
  options: CompileOptions,
  bindings: TypeBindings
): string => {
  const appExport = 'app';
  const typedEntries = projection.exports.filter((entry) =>
    bindings.has(entry.trailId)
  );
  const sourceTypeExports = [
    ...new Set(
      typedEntries.map(
        (entry) => bindings.get(entry.trailId)?.sourceExport ?? ''
      )
    ),
  ]
    .filter((name) => name.length > 0)
    .toSorted((left, right) => left.localeCompare(right));
  const lines = [
    `import { ${appExport} } from './trails.js';`,
    "import { deriveLibraryApi } from '@ontrails/library';",
    ...(typedEntries.length > 0
      ? [
          "import type { TrailInput, TrailOutput } from '@ontrails/library';",
          `import type { ${sourceTypeExports.join(', ')} } from '${options.typeImportPath ?? options.appImportPath}';`,
        ]
      : []),
    '',
    '// Authored Zod schemas, keyed by export name, projected from the topo.',
    'const projection = deriveLibraryApi(app);',
    'const byName = new Map(',
    '  projection.exports.map((entry) => [entry.exportName, entry])',
    ');',
    '',
    'const requireExport = (name: string) => {',
    '  const entry = byName.get(name);',
    '  if (!entry) {',
    "    throw new Error('missing projected library export: ' + name);",
    '  }',
    '  return entry;',
    '};',
    '',
  ];
  for (const entry of projection.exports) {
    const binding = bindings.get(entry.trailId);
    if (binding) {
      lines.push(
        '',
        `export type ${binding.input} = TrailInput<typeof ${binding.sourceExport}>;`,
        `export type ${binding.output} = TrailOutput<typeof ${binding.sourceExport}>;`
      );
    }
    lines.push(
      '',
      jsDoc([
        `Authored input schema for \`${entry.trailId}\`, exported as \`${entry.exportName}\`.`,
      ]),
      `export const ${entry.exportName}InputSchema = requireExport('${entry.exportName}').input;`,
      '',
      jsDoc([
        `Authored output schema for \`${entry.trailId}\`, if the trail declares one.`,
      ]),
      `export const ${entry.exportName}OutputSchema = requireExport('${entry.exportName}').output;`
    );
  }
  lines.push('', 'export const schemas = {');
  for (const entry of projection.exports) {
    lines.push(
      `  ${entry.exportName}: {`,
      `    input: ${entry.exportName}InputSchema,`,
      `    output: ${entry.exportName}OutputSchema,`,
      '  },'
    );
  }
  lines.push('} as const;');
  return `${lines.join('\n')}\n`;
};

const generateTrails = (options: CompileOptions): string => {
  const appExport = options.appExportName ?? 'app';
  return [
    '// Full Trails-native entrypoint: the resolved topo for composition,',
    '// contract tests, and graph inspection.',
    `export { ${appExport} as app } from '${options.appImportPath}';`,
    '',
  ].join('\n');
};

const resultStatelessFunction = (
  entry: LibraryExport,
  bindings: TypeBindings
): string =>
  [
    jsDoc([
      exportDescription(entry),
      `Returns the raw Result boundary for trail \`${entry.trailId}\`.`,
    ]),
    `export const ${entry.exportName} = (`,
    `  input: ${inputTypeFor(entry, bindings)}`,
    `): Promise<Result<${outputTypeFor(entry, bindings)}, LibraryError>> =>`,
    `  resultClient.result.${entry.exportName}(input) as Promise<Result<${outputTypeFor(entry, bindings)}, LibraryError>>;`,
  ].join('\n');

const resultFactoryMethod = (
  entry: LibraryExport,
  bindings: TypeBindings
): string =>
  [
    jsDoc(
      [
        exportDescription(entry),
        `Returns the raw Result boundary for trail \`${entry.trailId}\`.`,
      ],
      '    '
    ),
    `    ${entry.exportName}: (`,
    `      input: ${inputTypeFor(entry, bindings)}`,
    `    ): Promise<Result<${outputTypeFor(entry, bindings)}, LibraryError>> =>`,
    `      client.result.${entry.exportName}(input) as Promise<Result<${outputTypeFor(entry, bindings)}, LibraryError>>,`,
  ].join('\n');

const generateResult = (
  projection: LibraryProjection,
  options: CompileOptions,
  bindings: TypeBindings
): string => {
  const appExport = options.appExportName ?? 'app';
  const stateless = statelessExports(projection);
  const resourceful = resourceExports(projection);
  const typedSchemas = schemaTypeImport(projection, bindings);
  const parts = [
    '// No-throw API: returns the Result envelope instead of unwrapping.',
    "import { runLibraryResult, surface } from '@ontrails/library';",
    "import type { LibraryError, Result, SurfaceLibraryOptions } from '@ontrails/library';",
    ...(typedSchemas ? [typedSchemas] : []),
    '',
    `import { ${appExport} } from '${options.appImportPath}';`,
    '',
    `const resultClient = await surface(${appExport});`,
  ];

  for (const entry of stateless) {
    parts.push('', resultStatelessFunction(entry, bindings));
  }

  if (resourceful.length > 0) {
    parts.push(
      '',
      `export const ${factoryName(projection)} = async (`,
      '  options: SurfaceLibraryOptions = {}',
      ') => {',
      `  const client = await surface(${appExport}, options);`,
      '  return {',
      resourceful
        .map((entry) => resultFactoryMethod(entry, bindings))
        .join('\n'),
      '  };',
      '};'
    );
  }

  parts.push(
    '',
    'export const call = (',
    '  id: string,',
    '  input: unknown,',
    '  options: SurfaceLibraryOptions = {}',
    `) => runLibraryResult(${appExport}, id, input, options);`,
    ''
  );

  return `${parts.join('\n')}\n`;
};

const generateTsconfig = (): string =>
  `${JSON.stringify(
    {
      compilerOptions: {
        module: 'preserve',
        moduleResolution: 'bundler',
        strict: true,
        target: 'esnext',
        types: ['bun'],
      },
      include: ['src'],
    },
    null,
    2
  )}\n`;

/**
 * Compile a topo into a generated library package. Returns the emitted file
 * plan; the resolved projection is included for inspection and governance.
 *
 * @example
 * const result = compile(app, {
 *   packageName: '@acme/core',
 *   appImportPath: '@acme/app',
 * });
 * for (const file of result.files) {
 *   console.log(file.path);
 * }
 */
export const compile = (
  graph: Topo,
  options: CompileOptions
): CompileResult => {
  const projection = deriveLibraryApi(graph, options);
  const typeBindings = resolveTypeBindings(projection, options);
  const files: CompiledFile[] = [
    { content: generatePackageJson(options), path: 'package.json' },
    { content: generateTsconfig(), path: 'tsconfig.json' },
    {
      content: generateIndex(projection, options, typeBindings),
      path: 'src/index.ts',
    },
    {
      content: generateResult(projection, options, typeBindings),
      path: 'src/result.ts',
    },
    {
      content: generateSchemas(projection, options, typeBindings),
      path: 'src/schemas.ts',
    },
    { content: generateTrails(options), path: 'src/trails.ts' },
  ];
  return { files, packageName: options.packageName, projection };
};
