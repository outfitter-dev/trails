#!/usr/bin/env bun
import { runTrailsHomebrewCli } from '@ontrails/trails/release';

if (import.meta.main) {
  process.exit(await runTrailsHomebrewCli(process.argv.slice(2)));
}
