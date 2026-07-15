/**
 * Warn when a call-site MCP trailhead map diverges from the app-authored
 * `surfaces` overlay's `mcp` list bindings.
 *
 * The overlay is the authored, lockable default; a call-site trailhead map
 * is a supported override-in-context that wins at runtime. Divergence between
 * the two is legal but must be visible: an agent reading the committed lock
 * would otherwise trust grouped entries the running surface does not render.
 *
 * Rule-kind note: no Warden rule kind currently sees both the serialized
 * graph overlays and source ASTs directly. This rule is the closest honest
 * shape — a render-aware source rule whose `ProjectContext` carries
 * per-app authored `mcp` binding sets resolved from the run's topo targets
 * (graph overlays when available, else app-module overlay registrations).
 * A call-site map is attributed to an app only when one of its literal
 * member selectors matches a trail id in that app's topo, so one app's
 * authored bindings never flag another app's call-site map. Without
 * context (`check` without context, or a run with no topo targets) the
 * rule stays silent rather than guessing.
 */

import { classifySurfaceBinding, matchesTrailPattern } from '@ontrails/core';
import type { SurfaceBindings } from '@ontrails/core';

import {
  extractStringOrTemplateLiteral,
  findConfigProperty,
  getNodeArgument,
  getNodeElements,
  getNodeExpression,
  getNodeId,
  getNodeInit,
  getNodeKey,
  getNodeName,
  getNodeProperties,
  getNodeTypeAnnotation,
  getNodeValueNode,
  getPropertyName,
  offsetToLine,
  parse,
  walk,
} from '@ontrails/source';
import type { AstNode } from '@ontrails/source';
import type {
  AuthoredMcpSurfaceBindingSet,
  ProjectAwareWardenRule,
  ProjectContext,
  WardenDiagnostic,
} from './types.js';

const RULE_NAME = 'trailhead-override-divergence';

const unwrapExpression = (node: AstNode | undefined): AstNode | undefined => {
  let current = node;
  while (
    current?.type === 'TSAsExpression' ||
    current?.type === 'TSSatisfiesExpression'
  ) {
    current = getNodeExpression(current) ?? getNodeArgument(current);
  }
  return current;
};

const objectProperties = (node: AstNode): readonly AstNode[] =>
  node.type === 'ObjectExpression' ? (getNodeProperties(node) ?? []) : [];

const propertyValue = (property: AstNode): AstNode | undefined =>
  property.type === 'Property' ? getNodeValueNode(property) : undefined;

const isTrailheadDefinition = (node: AstNode): boolean =>
  node.type === 'ObjectExpression' &&
  findConfigProperty(node, 'trails') !== null;

const isTrailheadMapCandidate = (node: AstNode): boolean =>
  objectProperties(node).some((property) => {
    const value = unwrapExpression(propertyValue(property));
    return value !== undefined && isTrailheadDefinition(value);
  });

const isTrailheadMapBindingName = (name: string | null): boolean =>
  name !== null &&
  (name === 'trailheads' ||
    name.endsWith('Trailheads') ||
    name.endsWith('TrailheadMap'));

const hasTrailheadMapTypeAnnotation = (
  sourceCode: string,
  node: AstNode
): boolean => {
  const typeAnnotation = getNodeTypeAnnotation(node);
  return (
    typeAnnotation !== undefined &&
    /\b(?:McpSurfaceTrailheadMap|TrailheadMap)\b/.test(
      sourceCode.slice(typeAnnotation.start, typeAnnotation.end)
    )
  );
};

const diagnostic = (
  sourceCode: string,
  filePath: string,
  node: AstNode,
  message: string
): WardenDiagnostic => ({
  filePath,
  line: offsetToLine(sourceCode, node.start),
  message,
  rule: RULE_NAME,
  severity: 'warn',
});

/**
 * Collect the literal selector strings of one trailhead definition. Returns
 * `null` when any selector is dynamic — `surface-trailhead-coherence`
 * already flags those, so this rule skips the comparison instead of
 * double-reporting.
 */
const literalSelectors = (definition: AstNode): readonly string[] | null => {
  const trailsProp = findConfigProperty(definition, 'trails');
  const trailsValue = trailsProp ? propertyValue(trailsProp) : undefined;
  const value = unwrapExpression(trailsValue);
  if (!value) {
    return null;
  }
  const nodes =
    value.type === 'ArrayExpression'
      ? getNodeElements(value).filter((element) => element !== null)
      : [value];
  const selectors: string[] = [];
  for (const node of nodes) {
    const selector = extractStringOrTemplateLiteral(node);
    if (selector === null) {
      return null;
    }
    selectors.push(selector);
  }
  return selectors;
};

const authoredGroupSelectors = (
  bindings: SurfaceBindings
): ReadonlyMap<string, readonly string[]> => {
  const groups = new Map<string, readonly string[]>();
  for (const [name, value] of Object.entries(bindings)) {
    const shape = classifySurfaceBinding(value);
    if (shape.kind === 'group') {
      groups.set(name, shape.members);
    }
  }
  return groups;
};

const sameSelectorSet = (
  first: readonly string[],
  second: readonly string[]
): boolean => {
  const firstSet = new Set(first);
  const secondSet = new Set(second);
  return (
    firstSet.size === secondSet.size &&
    [...firstSet].every((selector) => secondSet.has(selector))
  );
};

const formatSelectors = (selectors: readonly string[]): string =>
  [...new Set(selectors)]
    .toSorted()
    .map((selector) => `"${selector}"`)
    .join(', ');

/**
 * Attribute a call-site trailhead map to a binding set: the map belongs to
 * an app when at least one of its literal member selectors matches a trail
 * id registered in that app's topo.
 */
const mapBelongsToSet = (
  trailheadMap: AstNode,
  set: AuthoredMcpSurfaceBindingSet
): boolean =>
  objectProperties(trailheadMap).some((property) => {
    const value = unwrapExpression(propertyValue(property));
    if (value === undefined || !isTrailheadDefinition(value)) {
      return false;
    }
    const selectors = literalSelectors(value);
    return (
      selectors !== null &&
      selectors.some((selector) =>
        set.trailIds.some((trailId) => matchesTrailPattern(trailId, selector))
      )
    );
  });

const diagnoseTrailheadMap = (
  sourceCode: string,
  filePath: string,
  trailheadMap: AstNode,
  set: AuthoredMcpSurfaceBindingSet,
  groups: ReadonlyMap<string, readonly string[]>
): readonly WardenDiagnostic[] => {
  const diagnostics: WardenDiagnostic[] = [];
  const groupNames = [...groups.keys()].toSorted();

  for (const property of objectProperties(trailheadMap)) {
    const trailheadId = getPropertyName(getNodeKey(property));
    const value = unwrapExpression(propertyValue(property));
    if (!trailheadId || value === undefined || !isTrailheadDefinition(value)) {
      continue;
    }

    const authored = groups.get(trailheadId);
    if (authored === undefined) {
      diagnostics.push(
        diagnostic(
          sourceCode,
          filePath,
          property,
          `Call-site MCP trailhead "${trailheadId}" has no matching mcp list binding in app "${set.appName}"'s surfaceOverlay (authored groups: ${groupNames.length > 0 ? groupNames.map((name) => `"${name}"`).join(', ') : 'none'}). The call-site map overrides the lockable default at runtime — author the same binding in surfaceOverlay({ mcp }) or rename one side.`
        )
      );
      continue;
    }

    const selectors = literalSelectors(value);
    if (selectors === null) {
      continue;
    }
    if (!sameSelectorSet(selectors, authored)) {
      diagnostics.push(
        diagnostic(
          sourceCode,
          filePath,
          property,
          `Call-site MCP trailhead "${trailheadId}" selects [${formatSelectors(selectors)}] but app "${set.appName}"'s surfaceOverlay mcp binding "${trailheadId}" authors [${formatSelectors(authored)}]. The call-site map overrides the lockable default at runtime — align the member selectors or make the intentional divergence explicit by renaming one side.`
        )
      );
    }
  }

  // The override replaces the authored default whole-map at runtime, so an
  // authored group missing from the call-site map is silently dropped while
  // the committed lock still advertises it.
  const callSiteNames = new Set(
    objectProperties(trailheadMap).flatMap((property) => {
      const name = getPropertyName(getNodeKey(property));
      const value = unwrapExpression(propertyValue(property));
      return name && value !== undefined && isTrailheadDefinition(value)
        ? [name]
        : [];
    })
  );
  for (const name of groupNames) {
    if (!callSiteNames.has(name)) {
      diagnostics.push(
        diagnostic(
          sourceCode,
          filePath,
          trailheadMap,
          `App "${set.appName}"'s surfaceOverlay mcp binding "${name}" is not carried by this call-site trailhead map, so it will not be rendered at runtime while the committed lock still advertises it. Add "${name}" to the call-site map or remove it from the authored overlay.`
        )
      );
    }
  }

  return diagnostics;
};

/**
 * Warn when a source file's call-site MCP trailhead map diverges from the
 * app-authored `surfaces` overlay's `mcp` list bindings.
 */
export const trailheadOverrideDivergence: ProjectAwareWardenRule = {
  check(): readonly WardenDiagnostic[] {
    // Without render context there are no authored bindings to compare
    // against; stay silent instead of guessing.
    return [];
  },
  checkWithContext(
    sourceCode: string,
    filePath: string,
    context: ProjectContext
  ): readonly WardenDiagnostic[] {
    const sets = (context.authoredMcpSurfaceBindingSets ?? [])
      .map((set) => ({
        groups: authoredGroupSelectors(set.bindings),
        set,
      }))
      .filter(({ groups }) => groups.size > 0);
    if (sets.length === 0) {
      return [];
    }

    const ast = parse(filePath, sourceCode);
    if (!ast) {
      return [];
    }

    const seen = new Set<number>();
    const diagnostics: WardenDiagnostic[] = [];
    const diagnoseCandidate = (node: AstNode | undefined): void => {
      const unwrapped = unwrapExpression(node);
      if (
        unwrapped === undefined ||
        unwrapped.type !== 'ObjectExpression' ||
        seen.has(unwrapped.start) ||
        !isTrailheadMapCandidate(unwrapped)
      ) {
        return;
      }
      seen.add(unwrapped.start);
      for (const { set, groups } of sets) {
        if (!mapBelongsToSet(unwrapped, set)) {
          continue;
        }
        diagnostics.push(
          ...diagnoseTrailheadMap(sourceCode, filePath, unwrapped, set, groups)
        );
      }
    };

    walk(ast, (node) => {
      if (node.type === 'Property') {
        const propertyName = getPropertyName(getNodeKey(node));
        if (propertyName === 'trailheads') {
          diagnoseCandidate(propertyValue(node));
        }
        return;
      }

      if (node.type === 'VariableDeclarator') {
        const bindingName = getNodeName(getNodeId(node));
        if (
          typeof bindingName === 'string' &&
          isTrailheadMapBindingName(bindingName)
        ) {
          diagnoseCandidate(getNodeInit(node) ?? undefined);
        }
        return;
      }

      if (
        (node.type === 'TSAsExpression' ||
          node.type === 'TSSatisfiesExpression') &&
        hasTrailheadMapTypeAnnotation(sourceCode, node)
      ) {
        diagnoseCandidate(node);
      }
    });

    return diagnostics;
  },
  description:
    'Call-site MCP trailhead maps stay aligned with the app-authored surfaces overlay mcp bindings they override.',
  name: RULE_NAME,
  severity: 'warn',
};
