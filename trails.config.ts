import { defineConfig } from '@ontrails/config';
import { releaseConfigSchema } from '@ontrails/trails/release';
import { wardenConfigSchema } from '@ontrails/warden';
import { z } from 'zod';

export default defineConfig({
  base: {
    warden: {
      apps: [
        'trails',
        'trails-demo',
        'examples/junction/src/app.ts',
        'examples/lookout/src/app.ts',
        'examples/packlist/src/app.ts',
        'examples/stash/src/app.ts',
        'examples/switchback/src/app.ts',
      ],
    },
  },
  schema: z.object({
    release: releaseConfigSchema,
    warden: wardenConfigSchema,
  }),
});
