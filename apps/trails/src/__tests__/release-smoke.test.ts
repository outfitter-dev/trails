import { deriveCliCommands } from '@ontrails/cli';
import { describe, expect, test } from 'bun:test';

import { operatorApp } from '../app.js';
import { releaseSmokeCheckValues } from '../release/index.js';

const unwrapCommands = () => {
  const result = deriveCliCommands(operatorApp);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

describe('release.smoke surface', () => {
  test('projects release smoke as a CLI command with check values', () => {
    const commands = unwrapCommands();
    const command = commands.find(
      (candidate) => candidate.trail.id === 'release.smoke'
    );

    expect(releaseSmokeCheckValues).toEqual([
      'all',
      'packed-artifacts',
      'wayfinder-dogfood',
    ]);
    expect(command).toBeDefined();
    expect(command?.path).toEqual(['release', 'smoke']);
  });
});
