/** Evidence of a single trail execution or manual span. */
export interface Track {
  readonly id: string;
  readonly traceId: string;
  readonly rootId: string;
  readonly parentId?: string | undefined;
  readonly kind: 'trail' | 'span';
  readonly name: string;
  readonly trailId?: string | undefined;
  readonly trailhead?: 'cli' | 'mcp' | 'http' | 'ws' | undefined;
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  readonly startedAt: number;
  readonly endedAt?: number | undefined;
  readonly status: 'ok' | 'err' | 'cancelled';
  readonly errorCategory?: string | undefined;
  readonly permit?:
    | { readonly id: string; readonly tenantId?: string }
    | undefined;
  readonly attrs: Readonly<Record<string, unknown>>;
}

/** Options for creating a trail-scoped Track. */
interface CreateTrackOptions {
  readonly trailId: string;
  readonly traceId?: string | undefined;
  readonly parentId?: string | undefined;
  readonly rootId?: string | undefined;
  readonly trailhead?: Track['trailhead'];
  readonly intent?: Track['intent'];
  readonly permit?:
    | { readonly id: string; readonly tenantId?: string }
    | undefined;
}

/** Create a fresh Track for a trail execution. */
export const createTrack = (options: CreateTrackOptions): Track => {
  const id = Bun.randomUUIDv7();
  const traceId = options.traceId ?? Bun.randomUUIDv7();

  return {
    attrs: {},
    endedAt: undefined,
    id,
    intent: options.intent,
    kind: 'trail',
    name: options.trailId,
    parentId: options.parentId,
    permit: options.permit,
    rootId: options.rootId ?? id,
    startedAt: Date.now(),
    status: 'ok',
    traceId,
    trailId: options.trailId,
    trailhead: options.trailhead,
  };
};
