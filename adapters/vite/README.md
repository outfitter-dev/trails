# `@ontrails/vite`

Bridge a fetch-based Trails HTTP surface into Vite's dev-server middleware stack.

```ts
import { createApp } from '@ontrails/hono';
import { vite } from '@ontrails/vite';
import { defineConfig } from 'vite';

import { graph } from './src/app';

export default defineConfig({
  plugins: [
    {
      name: 'trails-surface',
      configureServer(server) {
        server.middlewares.use('/api', vite(createApp(graph)));
      },
    },
  ],
});
```

Mount the middleware under the path segment you want Vite to delegate to Trails.
