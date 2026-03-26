import type { WardenDiagnostic, WardenRule } from './types.js';

const SURFACE_MODULES = [
  'express',
  'hono',
  'fastify',
  '@modelcontextprotocol/sdk',
  'node:http',
  'node:https',
  '@hono/node-server',
  'koa',
];

const SURFACE_TYPE_NAMES = [
  'Request',
  'Response',
  'NextFunction',
  'McpSession',
  'McpCallToolRequest',
  'IncomingMessage',
  'ServerResponse',
];

const escapeRegex = (m: string): string =>
  m.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SURFACE_MODULE_PATTERN = new RegExp(
  `from\\s+["'](${SURFACE_MODULES.map(escapeRegex).join('|')})`
);

const SURFACE_TYPE_PATTERN = new RegExp(
  `import\\s+(?:type\\s+)?\\{[^}]*(${SURFACE_TYPE_NAMES.join('|')})[^}]*\\}`
);

const checkModuleImport = (
  line: string,
  lineNum: number,
  filePath: string
): WardenDiagnostic | undefined => {
  if (!SURFACE_MODULE_PATTERN.test(line)) {
    return undefined;
  }
  const captured = line.match(
    new RegExp(`from\\s+["'](${SURFACE_MODULES.map(escapeRegex).join('|')})`)
  );
  return {
    filePath,
    line: lineNum,
    message: `Do not import from surface module "${captured?.[1] ?? 'unknown'}" in trail implementation files.`,
    rule: 'context-no-surface-types',
    severity: 'error',
  };
};

const checkTypeImport = (
  line: string,
  lineNum: number,
  filePath: string
): WardenDiagnostic | undefined => {
  if (!SURFACE_TYPE_PATTERN.test(line)) {
    return undefined;
  }
  const captured = line.match(
    new RegExp(
      `import\\s+(?:type\\s+)?\\{[^}]*(${SURFACE_TYPE_NAMES.join('|')})[^}]*\\}`
    )
  );
  return {
    filePath,
    line: lineNum,
    message: `Do not import surface type "${captured?.[1] ?? 'unknown'}" in trail implementation files.`,
    rule: 'context-no-surface-types',
    severity: 'error',
  };
};

const processImportLine = (
  line: string,
  lineNum: number,
  filePath: string,
  diagnostics: WardenDiagnostic[]
): void => {
  if (!/^\s*import\s/.test(line)) {
    return;
  }
  const moduleDiag = checkModuleImport(line, lineNum, filePath);
  if (moduleDiag) {
    diagnostics.push(moduleDiag);
    return;
  }
  const typeDiag = checkTypeImport(line, lineNum, filePath);
  if (typeDiag) {
    diagnostics.push(typeDiag);
  }
};

/**
 * Detects imports of surface-specific types in trail implementation files.
 */
export const contextNoSurfaceTypes: WardenRule = {
  check(sourceCode: string, filePath: string): readonly WardenDiagnostic[] {
    if (!/\b(?:trail|hike)\s*\(/.test(sourceCode)) {
      return [];
    }
    const diagnostics: WardenDiagnostic[] = [];
    const lines = sourceCode.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line) {
        processImportLine(line, i + 1, filePath, diagnostics);
      }
    }
    return diagnostics;
  },
  description:
    'Disallow surface-specific type imports (Request, Response, McpSession, etc.) in trail implementation files.',
  name: 'context-no-surface-types',

  severity: 'error',
};
