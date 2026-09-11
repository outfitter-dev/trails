#!/usr/bin/env bun
import { resolve } from 'node:path';

import { executeConsumerTransition } from './consumer-zero-transition/run.ts';

const USAGE = `Usage: bun scripts/migrate-consumer-to-0x.ts --root <consumer> [--apply] [--install]

Preview and optionally apply the approved Trails 1.0-line to 0.2.0 consumer
manifest transition. Preview is the default. --install requires --apply.`;

interface CliOptions {
  readonly apply: boolean;
  readonly consumerRoot: string;
  readonly install: boolean;
}

const parseArgs = (args: readonly string[]): CliOptions | 'help' => {
  let apply = false;
  let consumerRoot: string | undefined;
  let install = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--install') {
      install = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return 'help';
    }
    if (arg === '--root') {
      consumerRoot = args[index + 1];
      if (!consumerRoot || consumerRoot.startsWith('--')) {
        throw new Error('--root requires a directory path.');
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg ?? ''}`);
  }

  if (!consumerRoot) {
    throw new Error('--root is required.');
  }
  if (install && !apply) {
    throw new Error('--install requires --apply.');
  }
  return { apply, consumerRoot: resolve(consumerRoot), install };
};

export const runConsumerTransitionCli = (args: readonly string[]): number => {
  let options: CliOptions | 'help';
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }
  if (options === 'help') {
    console.log(USAGE);
    return 0;
  }

  const result = executeConsumerTransition({
    ...options,
    trailsRoot: resolve(import.meta.dir, '..'),
  });
  const output = result.code === 0 ? console.log : console.error;
  for (const line of result.lines) {
    output(line);
  }
  return result.code;
};

if (import.meta.main) {
  process.exit(runConsumerTransitionCli(process.argv.slice(2)));
}
