#!/usr/bin/env bun
import { runTrailsCliReleaseCli } from '@ontrails/trails/release';

if (import.meta.main) {
  process.exit(await runTrailsCliReleaseCli(process.argv.slice(2)));
}
