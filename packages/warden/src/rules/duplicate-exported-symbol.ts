import type {
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
  WardenExportedSymbolDefinition,
} from './types.js';

const RULE_NAME = 'duplicate-exported-symbol';

const ALLOWED_DUPLICATE_EXPORT_GROUPS: readonly {
  readonly names: readonly string[];
  readonly reason: string;
  readonly workspaceNames: readonly string[];
}[] = [
  {
    names: ['surface'],
    reason: 'peer surface packages expose the same conventional entry point',
    workspaceNames: [
      '@ontrails/commander',
      '@ontrails/hono',
      '@ontrails/http',
      '@ontrails/library',
      '@ontrails/mcp',
    ],
  },
  {
    names: ['createApp'],
    reason: 'HTTP native and Hono bindings share app-construction vocabulary',
    workspaceNames: ['@ontrails/hono', '@ontrails/http'],
  },
  {
    names: ['CreateAppOptions'],
    reason: 'HTTP native and Hono bindings share option vocabulary',
    workspaceNames: ['@ontrails/hono', '@ontrails/http'],
  },
  {
    names: ['SurfaceHttpResult'],
    reason: 'HTTP native and Hono bindings share runtime handle vocabulary',
    workspaceNames: ['@ontrails/hono', '@ontrails/http'],
  },
  {
    names: ['AnyTrail', 'Field'],
    reason: '@ontrails/cli mirrors core command-model types for CLI consumers',
    workspaceNames: ['@ontrails/cli', '@ontrails/core'],
  },
  {
    names: [
      'Logger',
      'LogFormatter',
      'LogLevel',
      'LogRecord',
      'LogSink',
      'ObserveCapabilities',
      'ObserveConfig',
      'ObserveInput',
    ],
    reason: '@ontrails/observability mirrors core observability contracts',
    workspaceNames: ['@ontrails/core', '@ontrails/observability'],
  },
  {
    names: [
      'DEFAULT_MEMORY_SINK_MAX_RECORDS',
      'MemorySinkOptions',
      'MemoryTraceSink',
      'createBoundedMemorySink',
      'createMemorySink',
    ],
    reason:
      '@ontrails/tracing compatibility memory sink mirrors @ontrails/observability',
    workspaceNames: ['@ontrails/observability', '@ontrails/tracing'],
  },
  {
    names: [
      'ActivationTraceRecordName',
      'NOOP_SINK',
      'SignalTraceRecordName',
      'TRACE_CONTEXT_KEY',
      'TraceFn',
      'clearTraceSink',
      'createActivationTraceRecord',
      'createSignalTraceRecord',
      'createTraceRecord',
      'getTraceContext',
      'getTraceSink',
      'registerTraceSink',
      'traceContextFromRecord',
      'writeActivationTraceRecord',
      'writeSignalTraceRecord',
    ],
    reason:
      '@ontrails/tracing mirrors core tracing contracts for compatibility',
    workspaceNames: ['@ontrails/core', '@ontrails/tracing'],
  },
  {
    names: ['TraceContext', 'TraceRecord', 'TraceSink'],
    reason:
      '@ontrails/observability and @ontrails/tracing mirror core trace contracts',
    workspaceNames: [
      '@ontrails/core',
      '@ontrails/observability',
      '@ontrails/tracing',
    ],
  },
  {
    names: ['AuthError', 'PermitError'],
    reason:
      '@ontrails/core owns the TrailsError subclass; @ontrails/permits owns the auth-adapter payload type',
    workspaceNames: ['@ontrails/core', '@ontrails/permits'],
  },
  {
    names: ['Result', 'Topo', 'TrailContextInit', 'TrailInput', 'TrailOutput'],
    reason: '@ontrails/library mirrors core runtime types for library users',
    workspaceNames: ['@ontrails/core', '@ontrails/library'],
  },
];

const definitionKey = (definition: WardenExportedSymbolDefinition): string =>
  `${definition.workspaceName}:${definition.filePath}:${definition.line}:${definition.name}`;

const isAllowedDuplicateGroup = (
  definitions: readonly WardenExportedSymbolDefinition[]
): boolean => {
  const [first] = definitions;
  if (!first) {
    return false;
  }
  const workspaceNames = new Set(
    definitions.map((definition) => definition.workspaceName)
  );
  return ALLOWED_DUPLICATE_EXPORT_GROUPS.some(
    (group) =>
      group.names.includes(first.name) &&
      [...workspaceNames].every((name) => group.workspaceNames.includes(name))
  );
};

const duplicateGroupsForFile = (
  context: ProjectContext,
  filePath: string
): readonly {
  readonly current: WardenExportedSymbolDefinition;
  readonly definitions: readonly WardenExportedSymbolDefinition[];
}[] => {
  const groups: {
    current: WardenExportedSymbolDefinition;
    definitions: readonly WardenExportedSymbolDefinition[];
  }[] = [];

  for (const definitions of context.exportedSymbolDefinitionsByName?.values() ??
    []) {
    const workspaceNames = new Set(
      definitions.map((definition) => definition.workspaceName)
    );
    if (workspaceNames.size < 2) {
      continue;
    }
    if (isAllowedDuplicateGroup(definitions)) {
      continue;
    }

    for (const definition of definitions) {
      if (definition.filePath === filePath) {
        groups.push({ current: definition, definitions });
      }
    }
  }

  return groups;
};

const formatOtherDefinitions = (
  current: WardenExportedSymbolDefinition,
  definitions: readonly WardenExportedSymbolDefinition[]
): string =>
  definitions
    .filter(
      (definition) => definitionKey(definition) !== definitionKey(current)
    )
    .map(
      (definition) =>
        `${definition.workspaceName} (${definition.filePath}:${definition.line})`
    )
    .join(', ');

export const duplicateExportedSymbol: ProjectAwareWardenRule = {
  check(): readonly WardenDiagnostic[] {
    return [];
  },
  checkWithContext(
    _sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    return duplicateGroupsForFile(context, filePath).map(
      ({ current, definitions }) => ({
        filePath,
        line: current.line,
        message: `Exported symbol "${current.name}" is defined by ${current.workspaceName} and also by ${formatOtherDefinitions(
          current,
          definitions
        )}. Keep one package as the owner, rename one side, or document a deliberate ownership mirror before exporting both symbols.`,
        rule: RULE_NAME,
        severity: 'warn',
      })
    );
  },
  description:
    'Warn when the same exported symbol is defined by multiple first-party packages.',
  name: RULE_NAME,
  severity: 'warn',
};
