import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, '../../package.json'), 'utf8')
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe('@ontrails/topography Wayfind package boundary', () => {
  test('keeps the graph and workspace observation dependency floor explicit', () => {
    expect(packageJson.dependencies).toEqual({
      '@ontrails/adapter-kit': 'workspace:^',
      '@ontrails/config': 'workspace:^',
      '@ontrails/source': 'workspace:^',
    });
    expect(packageJson.peerDependencies).toEqual({
      '@ontrails/core': 'workspace:^',
      zod: 'catalog:',
    });
    expect(packageJson.dependencies).not.toHaveProperty('@ontrails/warden');
  });
});
