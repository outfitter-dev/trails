#!/usr/bin/env bun

/**
 * Repo-local wrapper for the Trails ADR management CLI.
 *
 * The canonical implementation lives with the `trails-adrs` skill so the repo
 * and the skill stay aligned, while contributors can still run
 * `bun scripts/adr.ts ...` from the project root.
 */
import '../.claude/skills/trails-adrs/scripts/adr.ts';
