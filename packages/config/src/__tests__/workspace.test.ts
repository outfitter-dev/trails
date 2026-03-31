import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ensureWorkspace } from '../workspace.js';

describe('ensureWorkspace', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'trails-ws-'));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  describe('directory creation', () => {
    test('creates .trails/ directory', async () => {
      await ensureWorkspace(root);
      const entries = await readdir(join(root, '.trails'));
      expect(entries).toContain('config');
      expect(entries).toContain('dev');
      expect(entries).toContain('generated');
    });

    test('creates all expected subdirectories', async () => {
      await ensureWorkspace(root);
      const config = await readdir(join(root, '.trails', 'config'));
      expect(config).toBeDefined();
      const dev = await readdir(join(root, '.trails', 'dev'));
      expect(dev).toBeDefined();
      const generated = await readdir(join(root, '.trails', 'generated'));
      expect(generated).toBeDefined();
    });
  });

  describe('.gitignore', () => {
    test('writes .gitignore on first run', async () => {
      await ensureWorkspace(root);
      const content = await readFile(
        join(root, '.trails', '.gitignore'),
        'utf8'
      );
      expect(content).toContain('config/');
      expect(content).toContain('dev/');
      expect(content).toContain('generated/');
    });

    test('does not overwrite existing .gitignore', async () => {
      await ensureWorkspace(root);
      const customContent = '# custom\n*\n';
      await Bun.write(join(root, '.trails', '.gitignore'), customContent);

      await ensureWorkspace(root);
      const content = await readFile(
        join(root, '.trails', '.gitignore'),
        'utf8'
      );
      expect(content).toBe(customContent);
    });
  });
});
