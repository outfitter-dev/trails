#!/usr/bin/env bun
import { runNativeBunPublishCli } from '@ontrails/trails/release';

if (import.meta.main) {
  process.exit(await runNativeBunPublishCli(process.argv.slice(2)));
}

export { findPackedFirstPartyDependencyMismatches } from '@ontrails/trails/release';
