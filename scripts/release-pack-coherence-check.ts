#!/usr/bin/env bun
import { runReleasePackCoherenceCli } from '@ontrails/trails/release';

if (import.meta.main) {
  process.exit(await runReleasePackCoherenceCli(process.argv.slice(2)));
}
