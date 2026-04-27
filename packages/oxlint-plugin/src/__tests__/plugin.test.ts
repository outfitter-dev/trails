import { describe, expect, test } from 'bun:test';

import plugin, { rules } from '../index.js';

describe('@ontrails/oxlint-plugin', () => {
  test('exports package metadata and rule registry', () => {
    const meta = Reflect.get(plugin, 'meta') as { name?: string } | undefined;
    const pluginRules = Reflect.get(plugin, 'rules');

    expect(meta?.name).toBe('@ontrails/oxlint-plugin');
    expect(pluginRules).toBe(rules);
    expect(Object.keys(pluginRules)).toEqual(['local-plugin-smoke']);
  });
});
