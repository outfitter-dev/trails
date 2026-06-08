import { defineConfig } from '@ontrails/config';
import { releaseConfigSchema } from '@ontrails/trails/release';
import { wardenConfigSchema } from '@ontrails/warden';
import { z } from 'zod';

export default defineConfig({
  base: {
    warden: {
      apps: ['trails', 'trails-demo'],
    },
  },
  schema: z.object({
    release: releaseConfigSchema,
    warden: wardenConfigSchema,
  }),
});
