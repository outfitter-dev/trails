import ts from 'typescript';

import {
  formatScopeSummary,
  getScopeOptions,
  hasFlag,
  listScopedRepoFiles,
  parseFlagValues,
} from './vocab-cutover-utils';

interface Edit {
  readonly end: number;
  readonly replacement: string;
  readonly ruleId: string;
  readonly start: number;
}

interface ReplacementDetail {
  readonly after: string;
  readonly before: string;
  readonly line: number;
  readonly ruleId: string;
}

interface FilePlan {
  readonly path: string;
  readonly replacements: readonly ReplacementDetail[];
  readonly updated: string;
}

interface RewriteContext {
  readonly isCodeFile: boolean;
  readonly path: string;
  readonly source: string;
}

interface VocabRewriteRule {
  readonly apply: (context: RewriteContext) => readonly Edit[];
  readonly description: string;
  readonly id: string;
}

const writeChanges = hasFlag('--write');
const json = hasFlag('--json');
const listRules = hasFlag('--list-rules');
const selectedRuleIds = parseFlagValues('--rule');
const scopeOptions = getScopeOptions();

const codeFilePattern = /\.[cm]?[jt]sx?$/;

const toLineNumber = (source: string, offset: number): number =>
  source.slice(0, offset).split(/\r?\n/).length;

const applyEdits = (source: string, edits: readonly Edit[]): string => {
  const ordered = [...edits].toSorted(
    (left, right) => right.start - left.start
  );
  let output = source;

  for (const edit of ordered) {
    output =
      output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }

  return output;
};

const collectRegexEdits = (
  source: string,
  ruleId: string,
  matcher: RegExp,
  replacement: string | ((match: RegExpExecArray) => string)
): Edit[] => {
  const edits: Edit[] = [];
  const regex = new RegExp(
    matcher.source,
    matcher.flags.includes('g') ? matcher.flags : `${matcher.flags}g`
  );

  for (const match of source.matchAll(regex)) {
    const [matchedText] = match;
    const start = match.index;
    if (start === undefined) {
      continue;
    }

    edits.push({
      end: start + matchedText.length,
      replacement:
        typeof replacement === 'string' ? replacement : replacement(match),
      ruleId,
      start,
    });
  }

  return edits;
};

const replaceMatchedCase = (
  matched: string,
  lowercaseReplacement: string,
  capitalizedReplacement: string
): string => {
  if (matched === matched.toUpperCase()) {
    return capitalizedReplacement.toUpperCase();
  }

  if (matched[0] === matched[0]?.toUpperCase()) {
    return capitalizedReplacement;
  }

  return lowercaseReplacement;
};

const hasNamedImport = (source: string, identifier: string): boolean => {
  const pattern = new RegExp(
    String.raw`\bimport\s*{[^}]*\b${identifier}\b[^}]*}`,
    'm'
  );

  return pattern.test(source);
};

const collectTsIdentifierEdits = (
  context: RewriteContext,
  ruleId: string,
  oldName: string,
  nextName: string,
  shouldRename: (node: ts.Identifier) => boolean
): Edit[] => {
  if (!context.isCodeFile) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    context.path,
    context.source,
    ts.ScriptTarget.Latest,
    true
  );
  const edits: Edit[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === oldName && shouldRename(node)) {
      edits.push({
        end: node.end,
        replacement: nextName,
        ruleId,
        start: node.getStart(sourceFile),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return edits;
};

const collectTsPropertyKeyEdits = (
  context: RewriteContext,
  ruleId: string,
  oldName: string,
  nextName: string,
  shouldRename: (node: ts.Identifier) => boolean = () => true
): Edit[] => {
  if (!context.isCodeFile) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    context.path,
    context.source,
    ts.ScriptTarget.Latest,
    true
  );
  const edits: Edit[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === oldName &&
      shouldRename(node) &&
      ((ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
        (ts.isPropertySignature(node.parent) && node.parent.name === node))
    ) {
      edits.push({
        end: node.end,
        replacement: nextName,
        ruleId,
        start: node.getStart(sourceFile),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return edits;
};

const isSpecifierIdentifier = (node: ts.Identifier): boolean => {
  const { parent } = node;

  return (
    (ts.isImportSpecifier(parent) &&
      (parent.propertyName === node || parent.name === node)) ||
    (ts.isExportSpecifier(parent) &&
      (parent.propertyName === node || parent.name === node))
  );
};

const isDirectCallCallee = (node: ts.Identifier): boolean =>
  ts.isCallExpression(node.parent) && node.parent.expression === node;

const isGeneralIdentifier = (node: ts.Identifier): boolean => {
  const { parent } = node;

  return (
    ts.isTypeReferenceNode(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isPropertyAccessExpression(parent) ||
    ts.isObjectLiteralExpression(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isShorthandPropertyAssignment(parent)
  );
};

const isGeneralOrCallIdentifier = (node: ts.Identifier): boolean =>
  isGeneralIdentifier(node) || isDirectCallCallee(node);

const objectHasNamedProperty = (
  node: ts.ObjectLiteralExpression,
  propertyName: string
): boolean =>
  node.properties.some((property) => {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isPropertySignature(property)
    ) {
      return false;
    }

    const { name } = property;
    return (
      (ts.isIdentifier(name) && name.text === propertyName) ||
      (ts.isStringLiteral(name) && name.text === propertyName)
    );
  });

const asPropertyKeyNode = (
  node: ts.Identifier
): ts.PropertyAssignment | ts.PropertySignature | null => {
  const { parent } = node;
  if (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) {
    return parent;
  }

  return null;
};

const isTrailSpecObjectLiteral = (
  node: ts.ObjectLiteralExpression
): boolean => {
  const maybeCall = node.parent;
  if (ts.isCallExpression(maybeCall)) {
    const { expression } = maybeCall;
    if (ts.isIdentifier(expression) && expression.text === 'trail') {
      return true;
    }
  }

  return objectHasNamedProperty(node, 'input');
};

const isTrailSpecRunKey = (node: ts.Identifier): boolean => {
  const property = asPropertyKeyNode(node);
  if (!property) {
    return false;
  }

  const objectLiteral = property.parent;
  if (!ts.isObjectLiteralExpression(objectLiteral)) {
    return false;
  }

  return isTrailSpecObjectLiteral(objectLiteral);
};

const safeRules: readonly VocabRewriteRule[] = [
  {
    apply: (context) => [
      ...collectTsPropertyKeyEdits(
        context,
        'run-field',
        'run',
        'blaze',
        isTrailSpecRunKey
      ),
      ...(context.isCodeFile
        ? []
        : collectRegexEdits(
            context.source,
            'run-field',
            /\brun(?=\s*:)/g,
            'blaze'
          )),
    ],
    description:
      'Replace trail implementation field keys from `run:` to `blaze:`.',
    id: 'run-field',
  },
  {
    apply: (context) => [
      ...collectTsIdentifierEdits(
        context,
        'dispatch-call',
        'dispatch',
        'run',
        isDirectCallCallee
      ),
      ...(context.isCodeFile
        ? []
        : collectRegexEdits(
            context.source,
            'dispatch-call',
            /\bdispatch\(/g,
            'run('
          )),
    ],
    description:
      'Replace direct execution helper `dispatch(...)` with `run(...)`.',
    id: 'dispatch-call',
  },
  {
    apply: (context) =>
      collectRegexEdits(
        context.source,
        'crosses-field',
        /\bfollow(?=\s*:)/g,
        'crosses'
      ),
    description:
      'Replace composition declaration keys from `follow:` to `crosses:`.',
    id: 'crosses-field',
  },
  {
    apply: (context) =>
      collectRegexEdits(
        context.source,
        'cross-call',
        /\bctx\.follow\(/g,
        'ctx.cross('
      ),
    description:
      'Replace composition runtime calls from `ctx.follow(...)` to `ctx.cross(...)`.',
    id: 'cross-call',
  },
  {
    apply: (context) => [
      ...collectRegexEdits(
        context.source,
        'provision-api',
        /\bservice\(/g,
        'provision('
      ),
      ...collectRegexEdits(
        context.source,
        'provision-api',
        /\bservices(?=\s*:)/g,
        'provisions'
      ),
    ],
    description:
      'Replace infrastructure factory/declaration syntax from `service()` / `services:` to `provision()` / `provisions:`.',
    id: 'provision-api',
  },
  {
    apply: (context) => [
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\bconfigService\b/g,
        'configProvision'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\bauthService\b/g,
        'authProvision'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\btrackerService\b/g,
        'trackerProvision'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\bcrumbsService\b/g,
        'trackerProvision'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\bconfigLayer\b/g,
        'configGate'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\bauthLayer\b/g,
        'authGate'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\bcrumbsLayer\b/g,
        'trackerGate'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\bconfig\.layer\b/g,
        'config.gate'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\bcrumbs\.status\b/g,
        'tracker.status'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\bcrumbs\.query\b/g,
        'tracker.query'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\bauth-service\b/g,
        'auth-provision'
      ),
      ...collectRegexEdits(
        context.source,
        'provision-symbols',
        /\btracker-service\b/g,
        'tracker-provision'
      ),
    ],
    description:
      'Replace exact legacy service/layer symbol families with their provision/gate equivalents.',
    id: 'provision-symbols',
  },
  {
    apply: (context) => [
      ...collectTsIdentifierEdits(
        context,
        'blaze-call',
        'blaze',
        'trailhead',
        (node) =>
          isSpecifierIdentifier(node) ||
          (isDirectCallCallee(node) && hasNamedImport(context.source, 'blaze'))
      ),
      ...(context.isCodeFile
        ? []
        : [
            ...collectRegexEdits(
              context.source,
              'blaze-call',
              /\bimport\s*{\s*blaze\s*}/g,
              'import { trailhead }'
            ),
            ...collectRegexEdits(
              context.source,
              'blaze-call',
              /\bexport\s*{\s*blaze\s*}/g,
              'export { trailhead }'
            ),
            ...collectRegexEdits(
              context.source,
              'blaze-call',
              /\bblaze\(/g,
              'trailhead('
            ),
          ]),
    ],
    description:
      'Replace top-level trailhead helper imports/calls from `blaze` to `trailhead`.',
    id: 'blaze-call',
  },
  {
    apply: (context) => [
      ...collectTsIdentifierEdits(
        context,
        'surface-api',
        'SURFACE_KEY',
        'TRAILHEAD_KEY',
        isGeneralIdentifier
      ),
      ...collectRegexEdits(
        context.source,
        'surface-api',
        /__trails_surface/g,
        '__trails_trailhead'
      ),
      ...collectRegexEdits(
        context.source,
        'surface-api',
        /\bsurface\.lock\b/g,
        'trailhead.lock'
      ),
      ...collectRegexEdits(
        context.source,
        'surface-api',
        /\b_surface\.json\b/g,
        '_trailhead.json'
      ),
      ...collectTsIdentifierEdits(
        context,
        'surface-api',
        'SurfaceMap',
        'TrailheadMap',
        isGeneralIdentifier
      ),
      ...collectTsIdentifierEdits(
        context,
        'surface-api',
        'SurfaceMapEntry',
        'TrailheadMapEntry',
        isGeneralIdentifier
      ),
      ...collectTsIdentifierEdits(
        context,
        'surface-api',
        'generateSurfaceMap',
        'generateTrailheadMap',
        isGeneralIdentifier
      ),
      ...collectTsIdentifierEdits(
        context,
        'surface-api',
        'hashSurfaceMap',
        'hashTrailheadMap',
        isGeneralIdentifier
      ),
      ...collectTsIdentifierEdits(
        context,
        'surface-api',
        'diffSurfaceMaps',
        'diffTrailheadMaps',
        isGeneralIdentifier
      ),
      ...collectTsIdentifierEdits(
        context,
        'surface-api',
        'writeSurfaceMap',
        'writeTrailheadMap',
        isGeneralIdentifier
      ),
      ...collectTsIdentifierEdits(
        context,
        'surface-api',
        'readSurfaceMap',
        'readTrailheadMap',
        isGeneralIdentifier
      ),
      ...collectTsIdentifierEdits(
        context,
        'surface-api',
        'writeSurfaceLock',
        'writeTrailheadLock',
        isGeneralIdentifier
      ),
      ...collectTsIdentifierEdits(
        context,
        'surface-api',
        'readSurfaceLock',
        'readTrailheadLock',
        isGeneralIdentifier
      ),
      ...collectRegexEdits(
        context.source,
        'surface-api',
        /\bsurface map\b/gi,
        (match) => (match[0][0] === 'S' ? 'Trailhead map' : 'trailhead map')
      ),
    ],
    description:
      'Replace the safest schema/core trailhead API names (`SurfaceMap*`, `SURFACE_KEY`, lock filenames).',
    id: 'surface-api',
  },
  {
    apply: (context) => {
      if (
        context.path === 'packages/core/src/event.ts' ||
        context.path === 'packages/core/src/index.ts'
      ) {
        return [];
      }

      return [
        ...collectTsIdentifierEdits(
          context,
          'signal-api',
          'event',
          'signal',
          (node) => isDirectCallCallee(node) || isSpecifierIdentifier(node)
        ),
        ...(context.isCodeFile
          ? []
          : collectRegexEdits(
              context.source,
              'signal-api',
              /\bevent\(/g,
              'signal('
            )),
      ];
    },
    description:
      'Replace typed notification factory calls from `event(...)` to `signal(...)`.',
    id: 'signal-api',
  },
  {
    apply: (context) => {
      if (
        context.path === 'packages/core/src/event.ts' ||
        context.path === 'packages/core/src/index.ts' ||
        context.path === 'packages/core/src/signal.ts'
      ) {
        return [];
      }

      return [
        ...collectTsIdentifierEdits(
          context,
          'signal-model',
          'EventSpec',
          'SignalSpec',
          isGeneralIdentifier
        ),
        ...collectTsIdentifierEdits(
          context,
          'signal-model',
          'Event',
          'Signal',
          isGeneralIdentifier
        ),
        ...collectTsIdentifierEdits(
          context,
          'signal-model',
          'AnyEvent',
          'AnySignal',
          isGeneralIdentifier
        ),
        ...collectTsIdentifierEdits(
          context,
          'signal-model',
          'listEvents',
          'listSignals',
          isGeneralOrCallIdentifier
        ),
        ...collectTsIdentifierEdits(
          context,
          'signal-model',
          'eventToEntry',
          'signalToEntry',
          isGeneralOrCallIdentifier
        ),
        ...collectTsIdentifierEdits(
          context,
          'signal-model',
          'checkEventOrigins',
          'checkSignalOrigins',
          isGeneralOrCallIdentifier
        ),
        ...(context.isCodeFile
          ? collectRegexEdits(
              context.source,
              'signal-model',
              /\bevent(?=\s*:\s*\(\)\s*=>)/g,
              'signal'
            )
          : []),
        ...(context.isCodeFile
          ? collectRegexEdits(
              context.source,
              'signal-model',
              /(['"])event\1/g,
              (match) => `${match[1]}signal${match[1]}`
            )
          : []),
        ...(context.isCodeFile
          ? collectRegexEdits(
              context.source,
              'signal-model',
              /\bevent-origin-exists\b/g,
              'signal-origin-exists'
            )
          : []),
        ...(context.isCodeFile
          ? collectRegexEdits(
              context.source,
              'signal-model',
              /\bDuplicate event ID\b/g,
              'Duplicate signal ID'
            )
          : []),
      ];
    },
    description:
      'Replace the typed signal model names (`Event*`, topo events, and signal-kind labels) in code-shaped files.',
    id: 'signal-model',
  },
  {
    apply: (context) => [
      ...collectRegexEdits(
        context.source,
        'signal-runtime',
        /\bctx\.emit\(/g,
        'ctx.signal('
      ),
      ...collectRegexEdits(
        context.source,
        'signal-runtime',
        /\bemits(?=\s*:)/g,
        'signals'
      ),
    ],
    description:
      'Replace signal runtime usage from `ctx.emit(...)` / `emits:` to `ctx.signal(...)` / `signals:`.',
    id: 'signal-runtime',
  },
  {
    apply: (context) =>
      collectRegexEdits(
        context.source,
        'entity-factory',
        /\bentity\(/g,
        'mark('
      ),
    description:
      'Replace domain factory calls from `entity(...)` to `mark(...)`.',
    id: 'entity-factory',
  },
  {
    apply: (context) => [
      ...collectRegexEdits(
        context.source,
        'crumbs-package',
        /@ontrails\/crumbs/g,
        '@ontrails/tracker'
      ),
      ...collectRegexEdits(
        context.source,
        'crumbs-package',
        /\b013-crumbs\.md\b/g,
        '013-tracker.md'
      ),
    ],
    description:
      'Replace package and ADR references from `crumbs` to `tracker` where the swap is unambiguous.',
    id: 'crumbs-package',
  },
  {
    apply: (context) =>
      context.isCodeFile
        ? []
        : [
            ...collectRegexEdits(
              context.source,
              'surface-prose',
              /\bsurfaces\b/gi,
              (match) =>
                replaceMatchedCase(match[0], 'trailheads', 'Trailheads')
            ),
            ...collectRegexEdits(
              context.source,
              'surface-prose',
              /\bsurface\b/gi,
              (match) => replaceMatchedCase(match[0], 'trailhead', 'Trailhead')
            ),
          ],
    description:
      'Replace prose-only transport terminology from `surface` / `surfaces` to `trailhead` / `trailheads` in non-code files.',
    id: 'surface-prose',
  },
  {
    apply: (context) =>
      context.isCodeFile
        ? []
        : [
            ...collectRegexEdits(
              context.source,
              'adapter-prose',
              /\badapters\b/gi,
              (match) =>
                replaceMatchedCase(match[0], 'connectors', 'Connectors')
            ),
            ...collectRegexEdits(
              context.source,
              'adapter-prose',
              /\badapter\b/gi,
              (match) => replaceMatchedCase(match[0], 'connector', 'Connector')
            ),
          ],
    description:
      'Replace prose-only integration terminology from `adapter` / `adapters` to `connector` / `connectors` in non-code files.',
    id: 'adapter-prose',
  },
  {
    apply: (context) =>
      context.isCodeFile
        ? []
        : [
            ...collectRegexEdits(
              context.source,
              'crumbs-prose',
              /\bcrumbs\b/gi,
              (match) => replaceMatchedCase(match[0], 'tracker', 'Tracker')
            ),
          ],
    description:
      'Replace prose-only telemetry terminology from `crumbs` to `tracker` in non-code files.',
    id: 'crumbs-prose',
  },
  {
    apply: (context) =>
      context.isCodeFile
        ? []
        : [
            ...collectRegexEdits(
              context.source,
              'layers-prose',
              /\blayers\b/gi,
              (match) => replaceMatchedCase(match[0], 'gates', 'Gates')
            ),
            ...collectRegexEdits(
              context.source,
              'layers-prose',
              /\bmiddleware\b/gi,
              (match) => replaceMatchedCase(match[0], 'gates', 'Gates')
            ),
          ],
    description:
      'Replace prose-only wrapper terminology from `layers` / `middleware` to `gates` in non-code files.',
    id: 'layers-prose',
  },
  {
    apply: (context) =>
      context.isCodeFile
        ? []
        : collectRegexEdits(
            context.source,
            'entity-prose',
            /\bentity\(/g,
            'mark('
          ),
    description:
      'Replace prose-only domain factory calls from `entity(...)` to `mark(...)` in non-code files.',
    id: 'entity-prose',
  },
  {
    apply: (context) =>
      context.isCodeFile
        ? []
        : [
            ...collectRegexEdits(
              context.source,
              'gate-type-prose',
              /\*\*Layer\*\*/g,
              '**Gate**'
            ),
            ...collectRegexEdits(
              context.source,
              'gate-type-prose',
              /\bLayer(?=\[\])/g,
              'Gate'
            ),
            ...collectRegexEdits(
              context.source,
              'gate-type-prose',
              /\bLayer(?=\s*=>)/g,
              'Gate'
            ),
          ],
    description:
      'Replace code-like non-code wrapper type mentions from `Layer` to `Gate` where the swap is exact.',
    id: 'gate-type-prose',
  },
  {
    apply: (context) =>
      context.isCodeFile
        ? []
        : [
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bctx\.service</g,
              'ctx.provision<'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice\.from\(ctx\)/g,
              'provision.from(ctx)'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice \+ layer \+ trails\b/g,
              'provision + gate + trails'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice \+ layer\b/g,
              'provision + gate'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\blayer \+ service\b/g,
              'gate + provision'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bconfigService\b/g,
              'configProvision'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bauthService\b/g,
              'authProvision'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bcrumbsService\b/g,
              'trackerProvision'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bconfigLayer\b/g,
              'configGate'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bauthLayer\b/g,
              'authGate'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bcrumbsLayer\b/g,
              'trackerGate'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\*\*Service\*\*/g,
              '**Provision**'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bServices as a First-Class Primitive\b/g,
              'Provisions as a First-Class Primitive'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bfirst-class-services\.md\b/g,
              'first-class-provisions.md'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice-declarations\b/g,
              'provision-declarations'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice declarations\b/g,
              'provision declarations'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice IDs\b/g,
              'provision IDs'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice config schemas\b/g,
              'provision config schemas'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice graph\b/g,
              'provision graph'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice definitions\b/g,
              'provision definitions'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice definition\b/g,
              'provision definition'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice factories\b/g,
              'provision factories'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice factory\b/g,
              'provision factory'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice lifecycle\b/g,
              'provision lifecycle'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice context\b/g,
              'provision context'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice primitive\b/g,
              'provision primitive'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservices primitive\b/g,
              'provisions primitive'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bServices manage\b/g,
              'Provisions manage'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bLayers inject\b/g,
              'Gates inject'
            ),
            ...collectRegexEdits(
              context.source,
              'infra-prose',
              /\bservice-compatible\b/g,
              'provision-compatible'
            ),
          ],
    description:
      'Replace exact non-code infrastructure vocabulary examples and phrases from service/layer terminology to provision/gate terminology.',
    id: 'infra-prose',
  },
];

const selectedRules =
  selectedRuleIds.length === 0
    ? safeRules
    : safeRules.filter((rule) => selectedRuleIds.includes(rule.id));

const createRewriteContext = async (path: string): Promise<RewriteContext> => ({
  isCodeFile: codeFilePattern.test(path),
  path,
  source: await Bun.file(path).text(),
});

const collectRawEdits = (context: RewriteContext): Edit[] =>
  selectedRules.flatMap((rule) => rule.apply(context));

const dedupeEdits = (edits: readonly Edit[]): Edit[] => {
  const seen = new Set<string>();
  const deduped: Edit[] = [];

  for (const edit of edits) {
    const key = `${edit.start}:${edit.end}:${edit.replacement}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(edit);
  }

  return deduped;
};

const collapseOverlappingSameRuleEdits = (edits: readonly Edit[]): Edit[] => {
  const collapsed: Edit[] = [];

  for (const edit of edits) {
    const previous = collapsed.at(-1);
    if (!previous || previous.end <= edit.start) {
      collapsed.push(edit);
      continue;
    }

    if (previous.ruleId === edit.ruleId) {
      continue;
    }

    collapsed.push(edit);
  }

  return collapsed;
};

const sortEdits = (edits: readonly Edit[]): Edit[] =>
  collapseOverlappingSameRuleEdits(
    dedupeEdits(edits).toSorted((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }

      return right.end - left.end;
    })
  );

const assertNonOverlappingEdits = (path: string, edits: readonly Edit[]) => {
  for (let index = 1; index < edits.length; index += 1) {
    const previousEdit = edits[index - 1];
    const nextEdit = edits[index];
    if (previousEdit && nextEdit && previousEdit.end > nextEdit.start) {
      throw new Error(
        `Overlapping edits in ${path}: ${previousEdit.ruleId} conflicts with ${nextEdit.ruleId}`
      );
    }
  }
};

const buildReplacementDetails = (
  source: string,
  edits: readonly Edit[]
): ReplacementDetail[] =>
  edits.map((edit) => ({
    after: edit.replacement,
    before: source.slice(edit.start, edit.end),
    line: toLineNumber(source, edit.start),
    ruleId: edit.ruleId,
  }));

const createFilePlan = (
  path: string,
  source: string,
  edits: readonly Edit[]
): FilePlan | null => {
  if (edits.length === 0) {
    return null;
  }

  const updated = applyEdits(source, edits);
  if (updated === source) {
    return null;
  }

  return {
    path,
    replacements: buildReplacementDetails(source, edits),
    updated,
  };
};

const collectFilePlan = async (path: string): Promise<FilePlan | null> => {
  const context = await createRewriteContext(path);
  const rawEdits = collectRawEdits(context);
  const edits = sortEdits(rawEdits);
  assertNonOverlappingEdits(path, edits);
  return createFilePlan(path, context.source, edits);
};

const printRuleList = () => {
  console.log('Available safe rewrite rules:\n');
  for (const rule of safeRules) {
    console.log(`- ${rule.id}: ${rule.description}`);
  }
  console.log(
    '\nAudit-only concepts still needing human review: trigger-call, on-field, layer-type, layers-term, broad surface-term, broad adapter-term.'
  );
};

if (listRules) {
  printRuleList();
  process.exit(0);
}

const files = listScopedRepoFiles(scopeOptions);
const filePlans = await Promise.all(files.map((path) => collectFilePlan(path)));
const plans = filePlans.flatMap((plan) => plan ?? []);

if (json) {
  console.log(JSON.stringify(plans, null, 2));
} else if (plans.length === 0) {
  console.log(
    `vocab-cutover rewrite (${writeChanges ? 'write' : 'dry-run'}) found no safe edits for ${formatScopeSummary(scopeOptions)}.`
  );
} else {
  console.log(
    `vocab-cutover rewrite (${writeChanges ? 'write' : 'dry-run'}) planned ${plans.reduce((sum, plan) => sum + plan.replacements.length, 0)} replacement${plans.reduce((sum, plan) => sum + plan.replacements.length, 0) === 1 ? '' : 's'} across ${plans.length} file${plans.length === 1 ? '' : 's'} for ${formatScopeSummary(scopeOptions)}.\n`
  );

  for (const plan of plans) {
    console.log(plan.path);
    for (const replacement of plan.replacements) {
      console.log(
        `  L${replacement.line} [${replacement.ruleId}] ${JSON.stringify(replacement.before)} -> ${JSON.stringify(replacement.after)}`
      );
    }
  }
}

if (writeChanges) {
  for (const plan of plans) {
    await Bun.write(plan.path, plan.updated);
  }
}
