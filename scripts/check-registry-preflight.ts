#!/usr/bin/env bun
import { runRegistryPreflightCli } from '@ontrails/trails/release';

if (import.meta.main) {
  process.exit(await runRegistryPreflightCli(process.argv.slice(2)));
}

export {
  checkRegistryPosture,
  classifyPackageRegistryState,
  discoverRegistryWorkspaces,
  formatDistTagSummary,
  registryPostureErrors,
  runRegistryPreflight,
  type PackageRegistryFacts,
  type PackageRegistryState,
  type RegistryCheckPhase,
  type RegistryResult,
  type RegistryVersionView,
  type RegistryView,
  type RegistryWorkspace,
} from '@ontrails/trails/release';
