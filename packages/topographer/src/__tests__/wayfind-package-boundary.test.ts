import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, '../../package.json'), 'utf8')
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe('@ontrails/topographer Wayfind package boundary', () => {
  test('keeps the folded Wayfind dependency floor explicit', () => {
    expect(packageJson.dependencies).toEqual({
      '@ontrails/adapter-kit': 'workspace:^',
    });
    expect(packageJson.peerDependencies).toEqual({
      '@ontrails/core': 'workspace:^',
      zod: 'catalog:',
    });
    expect(packageJson.dependencies).not.toHaveProperty('@ontrails/source');
    expect(packageJson.dependencies).not.toHaveProperty('@ontrails/warden');
  });
});
