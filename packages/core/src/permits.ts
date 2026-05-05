import { z } from 'zod';

/** Minimal permit shape available on TrailContext. */
export interface BasePermit {
  readonly id: string;
  readonly scopes: readonly string[];
}

export const basePermitSchema: z.ZodType<BasePermit> = z.object({
  id: z.string(),
  scopes: z.array(z.string()).readonly(),
});
