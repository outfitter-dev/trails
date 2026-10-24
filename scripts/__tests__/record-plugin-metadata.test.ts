import { describe, expect, test } from 'bun:test';

import { recordPluginMetadata } from '../record-plugin-metadata.js';

const REASON = 'Framework target metadata only; plugin behavior is unchanged.';
const SKILL_SCOPE = 'plugin.trails.skill:trails';
const PLUGIN_SCOPE = 'plugin:trails';

const entry = (id: string, scope: string) => ({
  bump: 'none',
  id,
  ignored: false,
  reason: REASON,
  scopes: [scope],
  status: 'pending',
});

const recorder = (entries: unknown[]) => {
  const calls: string[][] = [];
  return {
    calls,
    run: (args: readonly string[]): Promise<string> => {
      calls.push([...args]);
      return Promise.resolve(JSON.stringify({ data: { entries }, ok: true }));
    },
  };
};

const refresh = (id: string) => [
  'change',
  'refresh',
  `@${id}`,
  '--yes',
  '--root',
  '.',
];

const add = (scope: string) => [
  'change',
  'add',
  '--scope',
  scope,
  '--bump',
  'none',
  '--reason',
  REASON,
  '--root',
  '.',
];

describe('plugin metadata evidence', () => {
  test('adds metadata records when neither scope has pending metadata evidence', async () => {
    const { calls, run } = recorder([]);
    await recordPluginMetadata(run);
    expect(calls).toEqual([
      ['change', 'list', '--root', '.', '--json'],
      add(SKILL_SCOPE),
      add(PLUGIN_SCOPE),
    ]);
  });

  test('refreshes all prior metadata records instead of adding duplicates', async () => {
    const { calls, run } = recorder([
      entry('old-skill', SKILL_SCOPE),
      entry('new-skill', SKILL_SCOPE),
      entry('old-plugin', PLUGIN_SCOPE),
      entry('new-plugin', PLUGIN_SCOPE),
    ]);
    await recordPluginMetadata(run);
    expect(calls.slice(1)).toEqual([
      refresh('old-skill'),
      refresh('new-skill'),
      refresh('old-plugin'),
      refresh('new-plugin'),
    ]);
  });

  test('adds only the missing scope', async () => {
    const { calls, run } = recorder([entry('skill', SKILL_SCOPE)]);
    await recordPluginMetadata(run);
    expect(calls.slice(1)).toEqual([refresh('skill'), add(PLUGIN_SCOPE)]);
  });

  test('does not refresh unrelated, behavioral, ignored, applied, or multi-scope changes', async () => {
    const { calls, run } = recorder([
      entry('other', 'agent:maintainer'),
      { ...entry('behavior', SKILL_SCOPE), reason: 'Plugin behavior changed.' },
      { ...entry('patch', SKILL_SCOPE), bump: 'patch' },
      { ...entry('ignored', SKILL_SCOPE), ignored: true },
      { ...entry('applied', PLUGIN_SCOPE), status: 'applied' },
      { ...entry('multi', SKILL_SCOPE), scopes: [SKILL_SCOPE, PLUGIN_SCOPE] },
    ]);
    await recordPluginMetadata(run);
    expect(calls.slice(1)).toEqual([add(SKILL_SCOPE), add(PLUGIN_SCOPE)]);
  });

  test('fails closed on an invalid list response before mutating evidence', async () => {
    const calls: string[][] = [];
    await expect(
      recordPluginMetadata((args) => {
        calls.push([...args]);
        return Promise.resolve('{"ok":false}');
      })
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  test('stops on refresh failure before adding or refreshing another scope', async () => {
    const { calls, run } = recorder([entry('skill', SKILL_SCOPE)]);
    await expect(
      recordPluginMetadata((args) => {
        if (args[1] === 'refresh') {
          return Promise.reject(new Error('refresh failed'));
        }
        return run(args);
      })
    ).rejects.toThrow('refresh failed');
    expect(calls).toHaveLength(1);
  });
});
