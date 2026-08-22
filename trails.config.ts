import { defineConfig } from '@ontrails/config';
import { releaseConfigSchema } from '@ontrails/trails/release';
import { wardenConfigSchema } from '@ontrails/warden';
import { z } from 'zod';

export default defineConfig({
  base: {
    warden: {
      scope: { exclude: ['scripts/scratch-inventory/**'] },
    },
  },
  schema: z.object({
    release: releaseConfigSchema,
    warden: wardenConfigSchema,
  }),
  workspace: {
    apps: {
      demo: { root: 'apps/trails-demo' },
      junction: { root: 'examples/junction' },
      lookout: { root: 'examples/lookout' },
      packlist: { root: 'examples/packlist' },
      stash: { root: 'examples/stash' },
      switchback: { root: 'examples/switchback' },
      trails: { root: 'apps/trails' },
    },
  },
});
