/**
 * MCP resource rendering for cold Trails context.
 */

import { deriveStructuredTrailExamples } from '@ontrails/core';
import type { Topo, Trail } from '@ontrails/core';

import {
  MCP_TOOL_DEFERRED_META_KEY,
  MCP_TOOL_TRAILHEAD_META_KEY,
} from './build.js';
import type { McpToolDefinition } from './build.js';

/**
 * Resource URI used for the resolved MCP surface map.
 *
 * @example
 * ```ts
 * import { MCP_SURFACE_MAP_RESOURCE_URI } from '@ontrails/mcp';
 *
 * const surfaceMap = resources.read(MCP_SURFACE_MAP_RESOURCE_URI);
 * ```
 */
export const MCP_SURFACE_MAP_RESOURCE_URI = 'trails://surface-map';

/**
 * Prefix used for trail example resources exposed through MCP.
 *
 * @example
 * ```ts
 * import { MCP_EXAMPLES_RESOURCE_PREFIX } from '@ontrails/mcp';
 *
 * const uri = `${MCP_EXAMPLES_RESOURCE_PREFIX}${encodeURIComponent('tasks.create')}`;
 * ```
 */
export const MCP_EXAMPLES_RESOURCE_PREFIX = 'trails://examples/';

/**
 * Prefix used for trail graph fact resources exposed through MCP.
 *
 * @example
 * ```ts
 * import { MCP_TRAIL_RESOURCE_PREFIX } from '@ontrails/mcp';
 *
 * const uri = `${MCP_TRAIL_RESOURCE_PREFIX}${encodeURIComponent('tasks.create')}`;
 * ```
 */
export const MCP_TRAIL_RESOURCE_PREFIX = 'trails://trail/';

export interface McpResourceDefinition {
  readonly uri: string;
  readonly mimeType: string;
  readonly name: string;
  readonly description?: string | undefined;
}

export interface McpResourceContent {
  readonly uri: string;
  readonly mimeType: string;
  readonly text: string;
}

export interface McpResourcesConfig {
  readonly surfaceMap?: boolean | undefined;
  readonly examples?: boolean | undefined;
  readonly graph?: boolean | undefined;
}

export interface BuiltMcpResources {
  readonly list: readonly McpResourceDefinition[];
  readonly read: (uri: string) => McpResourceContent | undefined;
}

interface McpSurfaceMapTool {
  readonly annotations: McpToolDefinition['annotations'];
  readonly description: string | undefined;
  readonly trailheadId?: string | undefined;
  readonly inputSchema: Record<string, unknown>;
  readonly memberTrailIds?: readonly string[] | undefined;
  readonly name: string;
  readonly outputSchema?: Record<string, unknown> | undefined;
  readonly trailId?: string | undefined;
  readonly versions?: McpToolDefinition['versions'];
  readonly deferred?: true | undefined;
}

interface McpSurfaceMap {
  readonly surface: 'mcp';
  readonly tools: readonly McpSurfaceMapTool[];
}

interface McpTrailResource {
  readonly trailId: string;
  readonly description?: string | undefined;
  readonly intent: Trail<unknown, unknown, unknown>['intent'];
  readonly visibility: Trail<unknown, unknown, unknown>['visibility'];
  readonly composes: readonly string[];
  readonly resources: readonly string[];
  readonly signals: {
    readonly fires: readonly string[];
    readonly on: readonly string[];
  };
  readonly surface: 'mcp';
  readonly tools: readonly McpSurfaceMapTool[];
}

const asJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

const renderSurfaceMapTool = (tool: McpToolDefinition): McpSurfaceMapTool => ({
  annotations: tool.annotations,
  description: tool.description,
  inputSchema: tool.inputSchema,
  name: tool.name,
  ...(tool.trailheadId === undefined ? {} : { trailheadId: tool.trailheadId }),
  ...(tool.memberTrailIds === undefined
    ? {}
    : { memberTrailIds: tool.memberTrailIds }),
  ...(tool.outputSchema === undefined
    ? {}
    : { outputSchema: tool.outputSchema }),
  ...(tool.trailId === undefined ? {} : { trailId: tool.trailId }),
  ...(tool.versions === undefined ? {} : { versions: tool.versions }),
  ...(tool._meta?.[MCP_TOOL_DEFERRED_META_KEY] === true
    ? { deferred: true }
    : {}),
});

const buildSurfaceMap = (
  tools: readonly McpToolDefinition[]
): McpSurfaceMap => ({
  surface: 'mcp',
  tools: tools.map(renderSurfaceMapTool),
});

const exposedTrailIds = (
  tools: readonly McpToolDefinition[]
): ReadonlySet<string> =>
  new Set(
    tools.flatMap((tool) => [
      ...(tool.trailId === undefined ? [] : [tool.trailId]),
      ...(tool.memberTrailIds ?? []),
    ])
  );

const examplesUriForTrail = (trailId: string): string =>
  `${MCP_EXAMPLES_RESOURCE_PREFIX}${encodeURIComponent(trailId)}`;

const trailUriForTrail = (trailId: string): string =>
  `${MCP_TRAIL_RESOURCE_PREFIX}${encodeURIComponent(trailId)}`;

const buildExampleResource = (
  trailItem: Trail<unknown, unknown, unknown>
):
  | {
      readonly content: McpResourceContent;
      readonly listing: McpResourceDefinition;
    }
  | undefined => {
  const examples = deriveStructuredTrailExamples(trailItem.examples);
  if (examples === undefined) {
    return undefined;
  }

  const uri = examplesUriForTrail(trailItem.id);
  return {
    content: {
      mimeType: 'application/json',
      text: asJson({
        examples,
        trailId: trailItem.id,
      }),
      uri,
    },
    listing: {
      description: `Structured examples for trail "${trailItem.id}".`,
      mimeType: 'application/json',
      name: `Trail examples: ${trailItem.id}`,
      uri,
    },
  };
};

const buildExampleResources = (
  graph: Topo,
  tools: readonly McpToolDefinition[]
): readonly {
  readonly content: McpResourceContent;
  readonly listing: McpResourceDefinition;
}[] => {
  const visibleTrailIds = exposedTrailIds(tools);
  return graph
    .list()
    .filter((trailItem) => visibleTrailIds.has(trailItem.id))
    .map((trailItem) =>
      buildExampleResource(trailItem as Trail<unknown, unknown, unknown>)
    )
    .filter((resource) => resource !== undefined);
};

const resourceId = (
  resource: Trail<unknown, unknown, unknown>['resources'][number]
) => resource.id;

const buildTrailGraphResource = (
  trailItem: Trail<unknown, unknown, unknown>,
  tools: readonly McpToolDefinition[]
): {
  readonly content: McpResourceContent;
  readonly listing: McpResourceDefinition;
} => {
  const uri = trailUriForTrail(trailItem.id);
  const surfaceTools = tools
    .filter(
      (tool) =>
        tool.trailId === trailItem.id ||
        tool.memberTrailIds?.includes(trailItem.id) === true
    )
    .map(renderSurfaceMapTool);
  const payload: McpTrailResource = {
    composes: trailItem.composes,
    ...(trailItem.description === undefined
      ? {}
      : { description: trailItem.description }),
    intent: trailItem.intent,
    resources: trailItem.resources.map(resourceId),
    signals: {
      fires: trailItem.fires,
      on: trailItem.on,
    },
    surface: 'mcp',
    tools: surfaceTools,
    trailId: trailItem.id,
    visibility: trailItem.visibility,
  };

  return {
    content: {
      mimeType: 'application/json',
      text: asJson(payload),
      uri,
    },
    listing: {
      description: `MCP-visible graph facts for trail "${trailItem.id}".`,
      mimeType: 'application/json',
      name: `Trail graph fact: ${trailItem.id}`,
      uri,
    },
  };
};

const buildTrailGraphResources = (
  graph: Topo,
  tools: readonly McpToolDefinition[]
): readonly {
  readonly content: McpResourceContent;
  readonly listing: McpResourceDefinition;
}[] => {
  const visibleTrailIds = exposedTrailIds(tools);
  return graph
    .list()
    .filter((trailItem) => visibleTrailIds.has(trailItem.id))
    .map((trailItem) =>
      buildTrailGraphResource(
        trailItem as Trail<unknown, unknown, unknown>,
        tools
      )
    );
};

/**
 * Build the cold-context MCP resources for a Trails graph and tool set.
 *
 * @example
 * ```ts
 * import { buildMcpResources, deriveMcpTools } from '@ontrails/mcp';
 *
 * const tools = deriveMcpTools(app).value;
 * const resources = buildMcpResources(app, tools);
 * ```
 */
export const buildMcpResources = (
  graph: Topo,
  tools: readonly McpToolDefinition[],
  config: McpResourcesConfig = {}
): BuiltMcpResources => {
  const listings: McpResourceDefinition[] = [];
  const contents = new Map<string, McpResourceContent>();

  if (config.surfaceMap !== false) {
    const surfaceMapListing = {
      description: 'Resolved MCP surface rendering for this Trails app.',
      mimeType: 'application/json',
      name: 'Trails MCP surface map',
      uri: MCP_SURFACE_MAP_RESOURCE_URI,
    };
    listings.push(surfaceMapListing);
    contents.set(MCP_SURFACE_MAP_RESOURCE_URI, {
      mimeType: 'application/json',
      text: asJson(buildSurfaceMap(tools)),
      uri: MCP_SURFACE_MAP_RESOURCE_URI,
    });
  }

  if (config.examples !== false) {
    for (const resource of buildExampleResources(graph, tools)) {
      listings.push(resource.listing);
      contents.set(resource.content.uri, resource.content);
    }
  }

  if (config.graph === true) {
    for (const resource of buildTrailGraphResources(graph, tools)) {
      listings.push(resource.listing);
      contents.set(resource.content.uri, resource.content);
    }
  }

  return {
    list: listings,
    read: (uri) => contents.get(uri),
  };
};

/**
 * Return whether an MCP tool was rendered from a surface trailhead.
 *
 * @example
 * ```ts
 * import { isMcpTrailheadTool } from '@ontrails/mcp';
 *
 * const trailheadTools = tools.filter(isMcpTrailheadTool);
 * ```
 */
export const isMcpTrailheadTool = (tool: McpToolDefinition): boolean =>
  tool._meta?.[MCP_TOOL_TRAILHEAD_META_KEY] !== undefined;
