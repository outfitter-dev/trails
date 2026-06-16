#!/usr/bin/env bun
import { runReleasePolicyCli } from '@ontrails/trails/release';

if (import.meta.main) {
  process.exit(await runReleasePolicyCli(process.argv.slice(2)));
}
