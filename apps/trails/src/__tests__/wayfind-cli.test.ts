import { deriveCliCommands } from '@ontrails/cli';
import { describe, expect, test } from 'bun:test';

import { app, operatorApp, trailsCliIncludedTrails } from '../app.js';

const unwrapCommands = () => {
  const result = deriveCliCommands(app, { include: trailsCliIncludedTrails });
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

describe('Trails Wayfinder CLI surface', () => {
  test('projects selected Wayfinder queries as local CLI commands', () => {
    const commands = unwrapCommands();
    const commandPaths = commands.map((command) => command.path.join(' '));
    const trailIds = commands.map((command) => command.trail.id);

    expect(commandPaths).toContain('wayfind overview');
    expect(commandPaths).toContain('wayfind adapters');
    expect(commandPaths).toContain('wayfind search');
    expect(commandPaths).toContain('wayfind trails');
    expect(commandPaths).toContain('wayfind contract');
    expect(commandPaths).toContain('wayfind describe');
    expect(commandPaths).toContain('wayfind errors');
    expect(commandPaths).toContain('wayfind nearby');
    expect(commandPaths).toContain('wayfind impact');
    expect(commandPaths).toContain('wayfind examples');

    expect(trailIds).toContain('wayfind.overview');
    expect(trailIds).toContain('wayfind.adapters');
    expect(trailIds).toContain('wayfind.search');
    expect(trailIds).toContain('wayfind.trails');
    expect(trailIds).toContain('wayfind.contract');
    expect(trailIds).toContain('wayfind.describe');
    expect(trailIds).toContain('wayfind.errors');
    expect(trailIds).toContain('wayfind.nearby');
    expect(trailIds).toContain('wayfind.impact');
    expect(trailIds).toContain('wayfind.examples');
  });

  test('does not expose deferred Wayfinder queries on the CLI', () => {
    const commands = unwrapCommands();
    const trailIds = commands.map((command) => command.trail.id);

    expect(trailIds).not.toContain('wayfind.query');
    expect(trailIds).not.toContain('wayfind.implications');
    expect(trailIds).not.toContain('wayfind.diff');
  });

  test('keeps the base operator topo separate from CLI Wayfinder exposure', () => {
    expect(operatorApp.get('wayfind.overview')).toBeUndefined();
    expect(app.get('wayfind.overview')).toBeDefined();
  });
});
