import { ValidationError } from '@ontrails/core';
import { z } from 'zod';

const cursorSchema = z.tuple([z.string(), z.string(), z.string().min(1)]);

/** Each client owns its opaque tokens; raw provider cursors do not enforce this scope. */
export const createBindingCursor = (role: 'kv' | 'blob') => {
  const owner = crypto.randomUUID();
  return {
    decode(cursor: string | undefined, prefix: string): string | undefined {
      if (cursor === undefined) {
        return undefined;
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(decodeURIComponent(cursor));
      } catch {
        throw new ValidationError(`Invalid Cloudflare ${role} cursor`);
      }
      const parsed = cursorSchema.safeParse(decoded);
      if (
        !parsed.success ||
        parsed.data[0] !== owner ||
        parsed.data[1] !== prefix
      ) {
        throw new ValidationError(
          `Cloudflare ${role} cursor belongs to another binding or prefix query`
        );
      }
      return parsed.data[2];
    },
    encode(prefix: string, nativeCursor: string): string {
      return encodeURIComponent(JSON.stringify([owner, prefix, nativeCursor]));
    },
  };
};
