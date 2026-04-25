Convert a Commander CLI command to a trail with automatic flag derivation.

## Before

```typescript
import { Command } from 'commander';

const program = new Command();

program
  .command('deploy')
  .description('Deploy a service to a target environment')
  .requiredOption('--service <name>', 'Service name')
  .requiredOption('--env <environment>', 'Target environment')
  .option('--dry-run', 'Preview without deploying', false)
  .option('--timeout <ms>', 'Deploy timeout in milliseconds', '30000')
  .action(async (opts) => {
    try {
      if (!['staging', 'production'].includes(opts.env)) {
        console.error(`Invalid environment: ${opts.env}`);
        process.exit(1);
      }
      const result = await runDeploy(opts.service, opts.env, {
        dryRun: opts.dryRun,
        timeout: parseInt(opts.timeout, 10),
      });
      console.log(`Deployed ${opts.service} to ${opts.env}: ${result.url}`);
    } catch (err) {
      console.error(`Deploy failed: ${err.message}`);
      process.exit(1);
    }
  });

program.parse();
```

## After

```typescript
// trails/deploy.ts
import { z } from 'zod';
import { trail, Result, InternalError } from '@ontrails/core';

export const run = trail('deploy.run', {
  input: z.object({
    service: z.string().describe('Service name'),
    env: z.enum(['staging', 'production']).describe('Target environment'),
    dryRun: z.boolean().default(false).describe('Preview without deploying'),
    timeout: z.number().default(30000).describe('Deploy timeout in milliseconds'),
  }),
  output: z.object({ url: z.string(), service: z.string(), env: z.string() }),
  description: 'Deploy a service to a target environment',
  intent: 'write',
  examples: [
    { name: 'staging dry run', input: { service: 'api', env: 'staging', dryRun: true } },
    { name: 'production deploy', input: { service: 'api', env: 'production' } },
  ],
  blaze: async (input) => {
    try {
      const result = await runDeploy(input.service, input.env, {
        dryRun: input.dryRun,
        timeout: input.timeout,
      });
      return Result.ok({ url: result.url, service: input.service, env: input.env });
    } catch (error) {
      return Result.err(new InternalError('Deploy failed', { cause: error as Error }));
    }
  },
});
```

Dotted IDs become subcommands. Flags derive from the Zod schema:

```typescript
// cli.ts
import { topo } from '@ontrails/core';
import { surface } from '@ontrails/cli/commander';
import * as deploy from './trails/deploy.js';

const graph = topo('myapp', deploy);
await surface(graph);
// myapp deploy run --service api --env staging --dry-run
// Flags, defaults, descriptions, and validation all derived from Zod.
```
