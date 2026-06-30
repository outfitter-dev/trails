#!/usr/bin/env bun
import { runReleaseNotesCli } from '@ontrails/trails/release';

if (import.meta.main) {
  process.exit(await runReleaseNotesCli(process.argv.slice(2)));
}
