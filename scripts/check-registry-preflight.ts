#!/usr/bin/env bun
import { runRegistryPreflightCli } from '@ontrails/trails/release';

if (import.meta.main) {
  process.exit(await runRegistryPreflightCli(process.argv.slice(2)));
}

export {
  checkRegistryPosture,
  discoverRegistryWorkspaces,
  formatDistTagSummary,
  registryPostureErrors,
  runRegistryPreflight,
  type RegistryView,
  type RegistryWorkspace,
} from '@ontrails/trails/release';
