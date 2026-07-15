import type { AttachedTypedLayer, Layer, Topo, Trail } from '@ontrails/core';
import {
  LAYER_FIELD_RESERVED_NAMES,
  collectAttachedTypedLayers,
  renderLayerFieldName,
  zodToJsonSchema,
} from '@ontrails/core';
import { z } from 'zod';

type AnyTrail = Trail<unknown, unknown, unknown>;
type MutableLayerShape = Record<string, z.ZodRawShape[string]>;

export interface LibraryLayerFieldRendering {
  readonly claimedName: string;
  readonly routingTarget: string;
}

export interface LibraryLayerInputRendering {
  readonly fields: readonly LibraryLayerFieldRendering[];
  readonly input: z.ZodObject<z.ZodRawShape>;
  readonly layerName: string;
}

export interface LibraryInputRendering {
  readonly input: z.ZodType;
  readonly layers: readonly LibraryLayerInputRendering[];
}

const isJsonObjectSchema = (
  value: unknown
): value is { properties?: Record<string, unknown> } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isObjectRecord = (
  value: unknown
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const capitalized = (value: string): string => {
  if (value.length === 0) {
    return value;
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
};

const buildLibraryRenameTarget = (
  layerName: string,
  originalName: string
): string => `${layerName}${capitalized(originalName)}`;

const objectPropertiesFor = (schema: z.ZodType): readonly string[] => {
  const jsonSchema = zodToJsonSchema(schema);
  if (!isJsonObjectSchema(jsonSchema) || jsonSchema.properties === undefined) {
    return [];
  }
  return Object.keys(jsonSchema.properties);
};

const isJsonObjectInput = (schema: z.ZodType): boolean =>
  isJsonObjectSchema(zodToJsonSchema(schema));

const renderLayerInputFields = (
  attached: AttachedTypedLayer,
  claimedNames: Set<string>,
  layerShape: MutableLayerShape
): LibraryLayerInputRendering => {
  const { layer } = attached;
  if (layer.input === undefined) {
    return { fields: [], input: z.object({}), layerName: layer.name };
  }

  const fields: LibraryLayerFieldRendering[] = [];
  for (const [fieldName, fieldSchema] of Object.entries(layer.input.shape)) {
    const rendering = renderLayerFieldName(
      layer.name,
      fieldName,
      fieldName,
      buildLibraryRenameTarget(layer.name, fieldName),
      claimedNames,
      LAYER_FIELD_RESERVED_NAMES
    );
    fields.push({
      claimedName: rendering.claimedName,
      routingTarget: rendering.routingTarget,
    });
    layerShape[rendering.claimedName] = fieldSchema;
  }

  return { fields, input: layer.input, layerName: layer.name };
};

/**
 * Render a trail's public library input: authored trail input plus any typed
 * layer input fields attached at topo, surface, or trail scope.
 */
export const renderLibraryInput = (
  graph: Topo,
  trail: AnyTrail,
  surfaceLayers?: readonly Layer[]
): LibraryInputRendering => {
  const attachedLayers = collectAttachedTypedLayers(
    graph,
    trail,
    surfaceLayers
  );
  if (attachedLayers.length === 0) {
    return { input: trail.input, layers: [] };
  }

  const trailProperties = objectPropertiesFor(trail.input);
  const claimedNames = new Set(trailProperties);
  if (trailProperties.length === 0 && !isJsonObjectInput(trail.input)) {
    throw new Error(
      `Library layer input rendering requires object input for trail "${trail.id}".`
    );
  }

  const layerShape: MutableLayerShape = {};
  const layers: LibraryLayerInputRendering[] = [];
  for (const attached of attachedLayers) {
    const rendering = renderLayerInputFields(
      attached,
      claimedNames,
      layerShape
    );
    if (rendering.fields.length > 0) {
      layers.push(rendering);
    }
  }

  if (layers.length === 0) {
    return { input: trail.input, layers: [] };
  }

  return {
    input: trail.input.and(z.object(layerShape)),
    layers,
  };
};

/**
 * Split a library method input back into trail input plus per-layer runtime
 * input slots using the rendering routing table.
 */
export const partitionLibraryInput = (
  input: unknown,
  renderings: readonly LibraryLayerInputRendering[]
): {
  readonly layerInputs: Record<string, unknown>;
  readonly trailInput: unknown;
} => {
  if (renderings.length === 0 || !isObjectRecord(input)) {
    return { layerInputs: {}, trailInput: input };
  }

  const claimedKeys = new Set<string>();
  const layerInputs: Record<string, unknown> = {};
  for (const rendering of renderings) {
    const layerInput: Record<string, unknown> = {};
    let received = false;
    for (const field of rendering.fields) {
      claimedKeys.add(field.claimedName);
      const value = input[field.claimedName];
      if (value === undefined) {
        continue;
      }
      layerInput[field.routingTarget] = value;
      received = true;
    }
    if (received) {
      layerInputs[rendering.layerName] = layerInput;
      continue;
    }

    const emptyInput = rendering.input.safeParse({});
    if (emptyInput.success) {
      layerInputs[rendering.layerName] = emptyInput.data;
    }
  }

  const trailInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!claimedKeys.has(key)) {
      trailInput[key] = value;
    }
  }
  return { layerInputs, trailInput };
};
