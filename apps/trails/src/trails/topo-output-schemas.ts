import { z } from 'zod';

const jsonSchemaOutput = z.record(z.string(), z.unknown());

export const activationChainOutput = z.object({
  consumer: z.string(),
  producer: z.string(),
  signal: z.string(),
});

export const activationSourceOutput = z
  .object({
    cron: z.string().optional(),
    hasParse: z.literal(true).optional(),
    hasPayloadSchema: z.literal(true).optional(),
    hasVerify: z.literal(true).optional(),
    id: z.string(),
    input: z.unknown().optional(),
    inputSchema: jsonSchemaOutput.optional(),
    key: z.string(),
    kind: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
    method: z.string().optional(),
    parseOutputSchema: jsonSchemaOutput.optional(),
    path: z.string().optional(),
    payloadSchema: jsonSchemaOutput.optional(),
    timezone: z.string().optional(),
  })
  .catchall(z.unknown());

export const activationEdgeOutput = z
  .object({
    hasWhere: z.boolean(),
    sourceId: z.string(),
    sourceKey: z.string(),
    sourceKind: z.string(),
    trailId: z.string(),
    where: z.object({ predicate: z.literal(true) }).optional(),
  })
  .catchall(z.unknown());

export const activationOverviewOutput = z.object({
  chainCount: z.number(),
  chains: z.array(activationChainOutput).readonly(),
  edgeCount: z.number(),
  edges: z.array(activationEdgeOutput).readonly(),
  signalIds: z.array(z.string()).readonly(),
  sourceCount: z.number(),
  sourceKeys: z.array(z.string()).readonly(),
  trailIds: z.array(z.string()).readonly(),
});

const topoGraphLayerOutput = z.object({
  input: jsonSchemaOutput.optional(),
  name: z.string(),
  scope: z.enum(['topo', 'trail']),
});

const fieldOverrideOutput = z.object({
  field: z.string(),
  overrides: z
    .array(z.enum(['hint', 'label', 'message', 'options']))
    .readonly(),
  provenance: z.object({
    source: z.literal('trail.fields'),
  }),
});

const contourDetailOutput = z.object({
  description: z.string().optional(),
  exampleCount: z.number(),
  id: z.string(),
  identity: z.string().optional(),
  kind: z.literal('contour'),
  references: z
    .array(
      z.object({
        contour: z.string(),
        field: z.string(),
        identity: z.string(),
      })
    )
    .readonly()
    .optional(),
  schema: jsonSchemaOutput.optional(),
  surfaces: z.array(z.string()).readonly(),
});

const surfaceProjectionBaseOutput = {
  derivedName: z.string(),
  source: z.enum(['authored', 'default-derived']),
  trailId: z.string(),
} as const;

export const surfaceProjectionOutput = z.discriminatedUnion('surface', [
  z.object({
    ...surfaceProjectionBaseOutput,
    commandPath: z.array(z.string()).readonly(),
    method: z.null(),
    surface: z.literal('cli'),
  }),
  z.object({
    ...surfaceProjectionBaseOutput,
    method: z.null(),
    surface: z.literal('mcp'),
    toolName: z.string(),
  }),
  z.object({
    ...surfaceProjectionBaseOutput,
    method: z.string(),
    path: z.string(),
    surface: z.literal('http'),
  }),
]);

export const shippedSurfaceInventoryOutput = z.object({
  count: z.number(),
  excludedSurfaces: z
    .array(
      z.object({
        reason: z.string(),
        status: z.literal('planned'),
        surface: z.literal('websocket'),
      })
    )
    .readonly(),
  projections: z.array(surfaceProjectionOutput).readonly(),
  shippedSurfaces: z.array(z.enum(['cli', 'mcp', 'http'])).readonly(),
  trails: z
    .array(
      z.object({
        explicitSurfaces: z.array(z.string()).readonly(),
        projections: z.array(surfaceProjectionOutput).readonly(),
        trailId: z.string(),
      })
    )
    .readonly(),
});

const trailVersionEntryOutput = z.object({
  crosses: z.array(z.string()).readonly().optional(),
  detours: z
    .array(
      z.object({
        maxAttempts: z.number(),
        on: z.string(),
      })
    )
    .readonly()
    .optional(),
  exampleCount: z.number(),
  examples: z.array(z.unknown()).readonly().optional(),
  input: jsonSchemaOutput,
  kind: z.enum(['revision', 'fork']),
  marker: z.string(),
  output: jsonSchemaOutput,
  resources: z.array(z.string()).readonly().optional(),
  status: z
    .object({
      state: z.enum(['deprecated', 'archived']),
    })
    .catchall(z.unknown())
    .optional(),
});

export const trailDetailOutput = z.object({
  activatedBy: z.array(z.string()).readonly(),
  activates: z.array(z.string()).readonly(),
  activationChains: z.array(activationChainOutput).readonly(),
  activationContext: z.object({
    edgeCount: z.number(),
    sourceCount: z.number(),
    sourceKeys: z.array(z.string()).readonly(),
    trailIds: z.array(z.string()).readonly(),
  }),
  activationEdges: z.array(activationEdgeOutput).readonly(),
  activationSources: z.array(activationSourceOutput).readonly(),
  cli: z
    .object({
      path: z.array(z.string()).readonly(),
    })
    .nullable(),
  composedLayers: z.object({
    surface: z.object({
      cli: z.array(z.string()).readonly(),
      http: z.array(z.string()).readonly(),
      mcp: z.array(z.string()).readonly(),
    }),
    topo: z.array(z.string()).readonly(),
    trail: z.array(z.string()).readonly(),
  }),
  contourDetails: z.array(contourDetailOutput).readonly(),
  contours: z.array(z.string()).readonly(),
  crosses: z.array(z.string()).readonly(),
  description: z.string().nullable(),
  detours: z
    .array(
      z.object({
        maxAttempts: z.number(),
        on: z.string(),
      })
    )
    .readonly()
    .nullable(),
  examples: z.array(z.unknown()).readonly(),
  fieldOverrides: z.array(fieldOverrideOutput).readonly(),
  fires: z.array(z.string()).readonly(),
  governance: z.record(z.string(), z.unknown()).nullable(),
  id: z.string(),
  input: jsonSchemaOutput.nullable(),
  intent: z.enum(['read', 'write', 'destroy']),
  kind: z.literal('trail'),
  layers: z.array(topoGraphLayerOutput).readonly(),
  on: z.array(z.string()).readonly(),
  output: jsonSchemaOutput.nullable(),
  pattern: z.string().nullable(),
  resources: z.array(z.string()).readonly(),
  safety: z.string(),
  supports: z.array(z.number()).readonly(),
  surfaceProjections: z.array(surfaceProjectionOutput).readonly(),
  surfaces: z.array(z.string()).readonly(),
  version: z.number().nullable(),
  versions: z.record(z.string(), trailVersionEntryOutput),
});

export const resourceDetailOutput = z.object({
  description: z.string().nullable(),
  health: z.enum(['available', 'none']),
  id: z.string(),
  kind: z.literal('resource'),
  lifetime: z.literal('singleton'),
  usedBy: z.array(z.string()).readonly(),
});

export const signalDetailOutput = z.object({
  consumers: z.array(z.string()).readonly(),
  description: z.string().nullable(),
  examples: z.array(z.unknown()).readonly(),
  from: z.array(z.string()).readonly(),
  id: z.string(),
  kind: z.literal('signal'),
  // null when the surface-map entry is missing for this signal (e.g. partial
  // import or schema migration). Coherent with the list view's
  // `payloadSchema: false` flag — distinguishes "schema not found" from
  // "schema accepts any value" (the latter would be `{}`).
  payload: z.record(z.string(), z.unknown()).nullable(),
  producers: z.array(z.string()).readonly(),
});
