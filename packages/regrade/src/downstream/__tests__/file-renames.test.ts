import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as nodeFs from 'node:fs';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  deriveFileRenameCandidates,
  runFileRenameRegrade,
} from '../file-renames.js';

const roots: string[] = [];

const createRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'trails-file-renames-'));
  roots.push(root);
  return root;
};

const write = (root: string, path: string, source: string): void => {
  const absolutePath = join(root, path);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, source);
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('governed file renames', () => {
  test('hashes exact preflight source bytes deterministically', () => {
    const root = createRoot();
    write(root, 'docs/old.md', '# Before\n');
    write(root, 'src/reference.ts', 'export const guide = "../docs/old.md";\n');
    const input = {
      renames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
      root,
      scope: { extensions: ['.ts'], include: ['src/**'] },
    };

    const prepared = runFileRenameRegrade(input);
    expect(prepared.isOk()).toBe(true);
    if (prepared.isErr()) {
      throw prepared.error;
    }
    expect(prepared.value.sourceStateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(runFileRenameRegrade(input).unwrap().sourceStateHash).toBe(
      prepared.value.sourceStateHash
    );

    write(root, 'docs/old.md', '# Changed after preflight\n');
    expect(runFileRenameRegrade(input).unwrap().sourceStateHash).not.toBe(
      prepared.value.sourceStateHash
    );
  });

  test('derives review-only filename candidates outside policy paths', () => {
    const root = createRoot();
    write(root, 'docs/surface-facets.md', '# Surface facets\n');
    write(root, 'history/facets.md', '# Historical facets\n');

    expect(
      deriveFileRenameCandidates({
        plan: {
          from: 'facet',
          kind: 'vocabulary',
          scope: {
            policyClassified: [
              {
                disposition: 'historical-by-policy',
                paths: ['history/**'],
                reason: 'Published history is immutable.',
              },
            ],
          },
          to: 'trailhead',
        },
        root,
      })
    ).toEqual([
      {
        evidence: ['docs/surface-facets.md'],
        from: 'docs/surface-facets.md',
        to: 'docs/surface-trailheads.md',
      },
    ]);
  });

  test('previews and applies the facet tracer move with classified history', () => {
    const root = createRoot();
    write(root, 'docs/surfaces/surface-facets.md', '# Surface facets\n');
    write(root, 'docs/index.md', '[Facets](docs/surfaces/surface-facets.md)\n');
    write(root, 'docs/surfaces/mcp.md', '[Facets](surface-facets.md)\n');
    write(
      root,
      'CHANGELOG.md',
      'Moved docs/surfaces/surface-facets.md in the next release.\n'
    );
    write(
      root,
      '.trails/regrade/plan.json',
      '{"from":"docs/surfaces/surface-facets.md"}\n'
    );
    write(
      root,
      '.trails/regrade/history/prior.json',
      '{"from":"docs/surfaces/surface-facets.md"}\n'
    );
    write(
      root,
      '.trails/cache.json',
      '{"from":"docs/surfaces/surface-facets.md"}\n'
    );

    const input = {
      renames: [
        {
          from: 'docs/surfaces/surface-facets.md',
          to: 'docs/surfaces/surface-trailheads.md',
        },
      ],
      root,
      scope: {
        policyClassified: [
          {
            disposition: 'historical-by-policy' as const,
            paths: ['CHANGELOG.md'],
            reason: 'Published history is immutable.',
          },
          {
            disposition: 'historical-by-policy' as const,
            paths: ['.trails/regrade/**'],
            reason: 'Saved transition evidence is immutable.',
          },
        ],
      },
    };
    const preview = runFileRenameRegrade(input);
    expect(preview.isOk()).toBe(true);
    if (preview.isErr()) {
      throw preview.error;
    }
    expect(preview.value.evidence).toEqual([
      expect.objectContaining({
        historical: 2,
        rewritten: 2,
        skipped: 2,
      }),
    ]);
    const [rename] = input.renames;
    if (rename === undefined) {
      throw new Error('Expected file rename fixture.');
    }
    expect(existsSync(join(root, rename.from))).toBe(true);

    const applied = runFileRenameRegrade({ ...input, apply: true });
    expect(applied.isOk()).toBe(true);
    if (applied.isErr()) {
      throw applied.error;
    }
    expect(existsSync(join(root, rename.from))).toBe(false);
    expect(existsSync(join(root, rename.to))).toBe(true);
    expect(readFileSync(join(root, 'docs/index.md'), 'utf8')).toContain(
      'docs/surfaces/surface-trailheads.md'
    );
    expect(readFileSync(join(root, 'docs/surfaces/mcp.md'), 'utf8')).toContain(
      'surface-trailheads.md'
    );
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain(
      'docs/surfaces/surface-facets.md'
    );
    expect(
      readFileSync(join(root, '.trails/regrade/history/prior.json'), 'utf8')
    ).toContain('docs/surfaces/surface-facets.md');

    const completion = runFileRenameRegrade(input);
    expect(completion.isOk()).toBe(true);
    if (completion.isErr()) {
      throw completion.error;
    }
    expect(completion.value.report.rewritten).toBe(0);
    expect(completion.value.evidence[0]).toMatchObject({
      historical: 2,
      rewritten: 0,
    });
  });

  test('moves every file before deriving one reference pass from final paths', () => {
    const root = createRoot();
    write(root, 'docs/old/a.md', '[B](b.md)\n');
    write(root, 'docs/old/b.md', '# B\n');

    const input = {
      renames: [
        { from: 'docs/old/a.md', to: 'docs/new/a.md' },
        { from: 'docs/old/b.md', to: 'docs/reference/b.md' },
      ],
      root,
      scope: { include: ['docs/old/**'] },
    };
    const preview = runFileRenameRegrade(input);
    expect(preview.isOk()).toBe(true);
    if (preview.isErr()) {
      throw preview.error;
    }
    expect(preview.value.evidence[1]).toMatchObject({ rewritten: 1 });

    const result = runFileRenameRegrade({ ...input, apply: true });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(readFileSync(join(root, 'docs/new/a.md'), 'utf8')).toBe(
      '[B](../reference/b.md)\n'
    );
    expect(result.value.evidence[1]).toMatchObject({ rewritten: 1 });
  });

  test('projects chained targets to their direct source scope', () => {
    const root = createRoot();
    write(root, 'docs/a.md', '# A\n');
    write(root, 'docs/b.md', '[A](a.md)\n');

    const input = {
      renames: [
        { from: 'docs/a.md', to: 'docs/b.md' },
        { from: 'docs/b.md', to: 'docs/c.md' },
      ],
      root,
      scope: { include: ['docs/b.md'] },
    };
    const preview = runFileRenameRegrade(input);
    expect(preview.isOk()).toBe(true);
    if (preview.isErr()) {
      throw preview.error;
    }
    expect(preview.value.evidence[0]).toMatchObject({ rewritten: 1 });

    const applied = runFileRenameRegrade({ ...input, apply: true });
    expect(applied.isOk()).toBe(true);
    if (applied.isErr()) {
      throw applied.error;
    }
    expect(readFileSync(join(root, 'docs/c.md'), 'utf8')).toBe('[A](b.md)\n');
    expect(applied.value.evidence[0]).toMatchObject({ rewritten: 1 });
  });

  test('collects moved sources through their projected target extensions', () => {
    const root = createRoot();
    write(root, 'docs/old/a.md', '[B](b.md)\n');
    write(root, 'docs/old/b.md', '# B\n');
    write(root, 'docs/unrelated.rst', '[B](old/b.md)\n');

    const result = runFileRenameRegrade({
      apply: true,
      renames: [
        { from: 'docs/old/a.md', to: './docs/new/a.rst' },
        { from: 'docs/old/b.md', to: 'docs/reference/b.md' },
      ],
      root,
      scope: { extensions: ['.md'] },
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(readFileSync(join(root, 'docs/new/a.rst'), 'utf8')).toBe(
      '[B](../reference/b.md)\n'
    );
    expect(readFileSync(join(root, 'docs/unrelated.rst'), 'utf8')).toBe(
      '[B](old/b.md)\n'
    );
    expect(result.value.evidence[1]).toMatchObject({ rewritten: 1 });
  });

  test('collects an in-scope moved source inside an ignored target directory', () => {
    const root = createRoot();
    write(root, 'docs/a.md', '[B](b.md)\n');
    write(root, 'docs/b.md', '# B\n');
    write(root, 'packages/noise/dist/unrelated.md', '# Generated\n');

    const result = runFileRenameRegrade({
      apply: true,
      renames: [
        { from: 'docs/a.md', to: 'dist/a.md' },
        { from: 'docs/b.md', to: 'docs/reference/b.md' },
      ],
      root,
      scope: { include: ['docs/**'] },
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(readFileSync(join(root, 'dist/a.md'), 'utf8')).toBe(
      '[B](../docs/reference/b.md)\n'
    );
    expect(result.value.evidence[1]).toMatchObject({ rewritten: 1 });
    expect(result.value.report.skipsByReason['ignored-directory']).toBe(2);
  });

  test('projects source exclusions onto moved targets during apply', () => {
    const root = createRoot();
    write(root, 'docs/old/a.md', '[B](b.md)\n');
    write(root, 'docs/old/b.md', '# B\n');
    const input = {
      renames: [
        { from: 'docs/old/a.md', to: 'docs/new/a.md' },
        { from: 'docs/old/b.md', to: 'docs/reference/b.md' },
      ],
      root,
      scope: {
        exclude: ['docs/old/a.md'],
        include: ['docs/old/**'],
      },
    };

    const preview = runFileRenameRegrade(input);
    expect(preview.isOk()).toBe(true);
    if (preview.isErr()) {
      throw preview.error;
    }
    expect(preview.value.evidence[1]?.rewritten).toBe(0);

    const applied = runFileRenameRegrade({ ...input, apply: true });
    expect(applied.isOk()).toBe(true);
    if (applied.isErr()) {
      throw applied.error;
    }
    expect(readFileSync(join(root, 'docs/new/a.md'), 'utf8')).toBe(
      '[B](b.md)\n'
    );
    expect(applied.value.evidence[1]?.rewritten).toBe(0);
  });

  test('preserves source policy classification after files move', () => {
    const root = createRoot();
    write(root, 'docs/old/a.md', '[B](b.md)\n');
    write(root, 'docs/old/b.md', '# B\n');
    const input = {
      renames: [
        { from: 'docs/old/a.md', to: 'docs/new/a.md' },
        { from: 'docs/old/b.md', to: 'docs/reference/b.md' },
      ],
      root,
      scope: {
        policyClassified: [
          {
            disposition: 'explicit-preserve' as const,
            paths: ['docs/old/a.md'],
            reason: 'Preserve protected history.',
          },
        ],
      },
    };

    const preview = runFileRenameRegrade(input);
    expect(preview.isOk()).toBe(true);
    if (preview.isErr()) {
      throw preview.error;
    }
    expect(preview.value.evidence[1]?.preserved).toBe(1);

    const applied = runFileRenameRegrade({ ...input, apply: true });
    expect(applied.isOk()).toBe(true);
    if (applied.isErr()) {
      throw applied.error;
    }
    expect(readFileSync(join(root, 'docs/new/a.md'), 'utf8')).toBe(
      '[B](b.md)\n'
    );
    expect(applied.value.evidence[1]?.preserved).toBe(1);
    expect(applied.value.evidence[1]?.rewritten).toBe(0);
  });

  test('applies multi-hop rename maps that reuse intermediate paths', () => {
    const root = createRoot();
    write(root, 'docs/a.md', '# A\n');
    write(root, 'docs/b.md', '# B\n');
    write(root, 'docs/index.md', '[A](a.md) [B](b.md)\n');

    const input = {
      apply: true,
      renames: [
        { from: 'docs/a.md', to: './docs/b.md' },
        { from: 'docs/b.md', to: 'docs/c.md' },
      ],
      root,
    };
    const result = runFileRenameRegrade(input);
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(existsSync(join(root, 'docs/a.md'))).toBe(false);
    expect(readFileSync(join(root, 'docs/b.md'), 'utf8')).toBe('# A\n');
    expect(readFileSync(join(root, 'docs/c.md'), 'utf8')).toBe('# B\n');
    expect(readFileSync(join(root, 'docs/index.md'), 'utf8')).toBe(
      '[A](b.md) [B](c.md)\n'
    );

    const completion = runFileRenameRegrade({ ...input, apply: false });
    expect(completion.isOk()).toBe(true);
    if (completion.isErr()) {
      throw completion.error;
    }
    expect(completion.value.report.rewritten).toBe(0);
  });

  test('rejects cycles after rename paths are normalized', () => {
    const root = createRoot();
    write(root, 'docs/a.md', '# A\n');
    write(root, 'docs/b.md', '# B\n');

    const result = runFileRenameRegrade({
      renames: [
        { from: 'docs/a.md', to: './docs/b.md' },
        { from: 'docs/b.md', to: 'docs/a.md' },
      ],
      root,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected normalized rename cycle to fail.');
    }
    expect(result.error.message).toContain('contains a cycle');
  });

  test('preserves importer lineage across completed multi-hop moves', () => {
    const root = createRoot();
    write(
      root,
      'src/a/consumer.ts',
      "import { dep } from './dep';\nexport const value = dep;\n"
    );
    write(root, 'src/one/mid/consumer.ts', 'export const prior = true;\n');
    write(root, 'src/a/dep.ts', 'export const dep = true;\n');

    const renames = [
      { from: 'src/a/consumer.ts', to: 'src/one/mid/consumer.ts' },
      {
        from: 'src/one/mid/consumer.ts',
        to: 'src/final/consumer.ts',
      },
      { from: 'src/a/dep.ts', to: 'src/one/dep.ts' },
    ];
    const applied = runFileRenameRegrade({ apply: true, renames, root });
    expect(applied.isOk()).toBe(true);
    if (applied.isErr()) {
      throw applied.error;
    }
    expect(
      readFileSync(join(root, 'src/one/mid/consumer.ts'), 'utf8')
    ).toContain("from '../dep'");

    const completion = runFileRenameRegrade({ renames, root });
    expect(completion.isOk()).toBe(true);
    if (completion.isErr()) {
      throw completion.error;
    }
    expect(completion.value.report.rewritten).toBe(0);
    expect(
      readFileSync(join(root, 'src/one/mid/consumer.ts'), 'utf8')
    ).toContain("from '../dep'");
  });

  test('routes ambiguous short basenames to review without rewriting', () => {
    const root = createRoot();
    write(root, 'docs/a/guide.md', '# A\n');
    write(root, 'docs/b/guide.md', '# B\n');
    write(root, 'docs/index.md', 'See guide.md for details.\n');

    const result = runFileRenameRegrade({
      renames: [
        { from: 'docs/a/guide.md', to: 'docs/a/new-guide.md' },
        { from: 'docs/b/guide.md', to: 'docs/b/new-guide.md' },
      ],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.report.review).toBe(1);
    expect(result.value.evidence).toEqual([
      expect.objectContaining({ deferred: 1, rewritten: 0 }),
      expect.objectContaining({ deferred: 1, rewritten: 0 }),
    ]);
  });

  test('rewrites exact code string literals and defers raw code contexts', () => {
    const root = createRoot();
    write(root, 'docs/old.md', '# Old\n');
    write(
      root,
      'src/reference.ts',
      'export const exact = "docs/old.md";\n// docs/old.md\n'
    );

    const result = runFileRenameRegrade({
      renames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.evidence[0]).toMatchObject({
      deferred: 1,
      rewritten: 1,
    });
    expect(result.value.report.review).toBe(1);
    expect(result.value.occurrencePaths).toEqual([
      'src/reference.ts',
      'src/reference.ts',
    ]);
  });

  test('closes references already projected by the vocabulary pass', () => {
    const root = createRoot();
    write(root, 'docs/old.md', '# Old\n');
    write(root, 'README.md', 'See docs/new.md\n');

    const result = runFileRenameRegrade({
      apply: true,
      renames: [{ from: 'docs/old.md', to: 'guides/new.md' }],
      root,
      vocabularyPlan: {
        from: 'old',
        kind: 'vocabulary',
        to: 'new',
      },
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(existsSync(join(root, 'docs/old.md'))).toBe(false);
    expect(existsSync(join(root, 'guides/new.md'))).toBe(true);
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(
      'See guides/new.md\n'
    );
    expect(result.value.evidence[0]?.rewritten).toBe(1);
  });

  test('closes case-preserving references projected by the vocabulary pass', () => {
    const root = createRoot();
    write(root, 'docs/Old.md', '# Old\n');
    write(root, 'README.md', 'See docs/New.md\n');

    const result = runFileRenameRegrade({
      apply: true,
      renames: [{ from: 'docs/Old.md', to: 'guides/New.md' }],
      root,
      vocabularyPlan: {
        from: 'old',
        kind: 'vocabulary',
        to: 'new',
      },
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(
      'See guides/New.md\n'
    );
    expect(result.value.evidence[0]?.rewritten).toBe(1);
  });

  test('rewrites CommonJS source references for governed file moves', () => {
    const root = createRoot();
    write(root, 'src/old.cjs', 'module.exports = true;\n');
    write(root, 'src/consumer.cjs', "module.exports = require('./old.cjs');\n");

    const result = runFileRenameRegrade({
      apply: true,
      renames: [{ from: 'src/old.cjs', to: 'src/new.cjs' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(readFileSync(join(root, 'src/consumer.cjs'), 'utf8')).toBe(
      "module.exports = require('./new.cjs');\n"
    );
  });

  test('rewrites extensionless module specifiers for source file moves', () => {
    const root = createRoot();
    write(root, 'src/old.ts', 'export const old = true;\n');
    write(
      root,
      'src/consumer.ts',
      [
        "import { old } from './old';",
        "import 'old';",
        "export { old } from './old';",
        "export const lazy = import('./old');",
        'export const label = "old";',
        '',
      ].join('\n')
    );

    const result = runFileRenameRegrade({
      apply: true,
      renames: [{ from: 'src/old.ts', to: 'src/new.ts' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(existsSync(join(root, 'src/old.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/new.ts'))).toBe(true);
    expect(readFileSync(join(root, 'src/consumer.ts'), 'utf8')).toBe(
      [
        "import { old } from './new';",
        "import 'old';",
        "export { old } from './new';",
        "export const lazy = import('./new');",
        'export const label = "old";',
        '',
      ].join('\n')
    );
    expect(result.value.evidence[0]).toMatchObject({ rewritten: 3 });
  });

  test('rewrites emitted module specifiers for TypeScript source moves', () => {
    const root = createRoot();
    write(root, 'src/old.ts', 'export const old = true;\n');
    write(root, 'src/consumer.ts', "import { old } from './old.js';\n");

    const result = runFileRenameRegrade({
      apply: true,
      renames: [{ from: 'src/old.ts', to: 'src/new.ts' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(readFileSync(join(root, 'src/consumer.ts'), 'utf8')).toBe(
      "import { old } from './new.js';\n"
    );
    expect(result.value.evidence[0]).toMatchObject({ rewritten: 1 });
  });

  test('rewrites directory specifiers when index modules move', () => {
    const root = createRoot();
    write(root, 'src/old/index.ts', 'export const old = true;\n');
    write(root, 'src/consumer.ts', "import { old } from './old';\n");

    const result = runFileRenameRegrade({
      apply: true,
      renames: [{ from: 'src/old/index.ts', to: 'src/new/index.ts' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(readFileSync(join(root, 'src/consumer.ts'), 'utf8')).toBe(
      "import { old } from './new';\n"
    );
    expect(result.value.evidence[0]).toMatchObject({ rewritten: 1 });
  });

  test('defers escaped module specifiers whose token span is unsafe', () => {
    const root = createRoot();
    write(root, 'src/old.ts', 'export const old = true;\n');
    write(
      root,
      'src/consumer.ts',
      "export const lazy = import('./ol\\u0064');\nexport const eager = import('./ol\\u0064');\n"
    );

    const result = runFileRenameRegrade({
      apply: true,
      renames: [{ from: 'src/old.ts', to: 'src/new.ts' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(readFileSync(join(root, 'src/consumer.ts'), 'utf8')).toBe(
      "export const lazy = import('./ol\\u0064');\nexport const eager = import('./ol\\u0064');\n"
    );
    expect(result.value.evidence[0]).toMatchObject({
      deferred: 2,
      rewritten: 0,
    });
    expect(result.value.report.review).toBe(1);
  });

  test('counts exact module specifiers when an adjacent route blocks rewriting', () => {
    const root = createRoot();
    write(root, 'src/old.ts', 'export const old = true;\n');
    write(
      root,
      'src/consumer.ts',
      "import { old } from './old';\nimport { nested } from './old/sub';\n"
    );

    const result = runFileRenameRegrade({
      apply: true,
      renames: [{ from: 'src/old.ts', to: 'src/new.ts' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(readFileSync(join(root, 'src/consumer.ts'), 'utf8')).toBe(
      "import { old } from './old';\nimport { nested } from './old/sub';\n"
    );
    expect(result.value.evidence[0]).toMatchObject({
      deferred: 2,
      rewritten: 0,
    });
    expect(result.value.report.review).toBe(1);
  });

  test('defers escaped path literals whose token span is unsafe', () => {
    const root = createRoot();
    write(root, 'docs/old.md', '# Old\n');
    write(
      root,
      'src/reference.ts',
      'export const path = "docs/ol\\u0064.md";\n'
    );

    const result = runFileRenameRegrade({
      apply: true,
      renames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(readFileSync(join(root, 'src/reference.ts'), 'utf8')).toBe(
      'export const path = "docs/ol\\u0064.md";\n'
    );
    expect(result.value.evidence[0]).toMatchObject({
      deferred: 1,
      rewritten: 0,
    });
    expect(result.value.report.review).toBe(1);
  });

  test('defers extensionless module specifiers when AST parsing fails', () => {
    const root = createRoot();
    write(root, 'src/old.ts', 'export const old = true;\n');
    write(
      root,
      'src/consumer.ts',
      "import { old } from './old';\nexport const broken = ;\n"
    );

    const result = runFileRenameRegrade({
      renames: [{ from: 'src/old.ts', to: 'src/new.ts' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.evidence[0]).toMatchObject({
      deferred: 1,
      rewritten: 0,
    });
    expect(result.value.report.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: 'needs-review',
          path: 'src/consumer.ts',
        }),
      ])
    );
    expect(result.value.occurrencePaths).toEqual(['src/consumer.ts']);
  });

  test('ignores unrelated parse failures without matching module specifiers', () => {
    const root = createRoot();
    write(root, 'src/old.ts', 'export const old = true;\n');
    write(root, 'src/unrelated.ts', 'export const broken = ;\n');

    const result = runFileRenameRegrade({
      renames: [{ from: 'src/old.ts', to: 'src/new.ts' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.evidence[0]).toMatchObject({
      deferred: 0,
      rewritten: 0,
    });
    expect(result.value.report.entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/unrelated.ts' }),
      ])
    );
    expect(result.value.occurrencePaths).toEqual([]);
  });

  test('does not project vocabulary aliases through hyphenated path tokens', () => {
    const root = createRoot();
    write(root, 'docs/old-guide.md', '# Old guide\n');
    write(root, 'docs/new-guide.md', '# Existing new guide\n');
    write(root, 'docs/reference.md', 'See docs/new-guide.md.\n');

    const result = runFileRenameRegrade({
      renames: [{ from: 'docs/old-guide.md', to: 'guides/new-guide.md' }],
      root,
      vocabularyPlan: { from: 'old', kind: 'vocabulary', to: 'new' },
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.evidence[0]).toMatchObject({ rewritten: 0 });
    expect(result.value.occurrencePaths).not.toContain('docs/reference.md');
  });

  test('preserves pre-existing simultaneous-rewrite placeholder text', () => {
    const root = createRoot();
    write(root, 'docs/old.md', '# Old\n');
    write(
      root,
      'docs/reference.md',
      '__TRAILS_FILE_RENAME_REFERENCE_0_0__ docs/old.md\n'
    );
    write(
      root,
      'src/reference.ts',
      [
        'export const sentinel = "__TRAILS_FILE_RENAME_LITERAL_0_0__";',
        'export const target = "docs/old.md";',
        '',
      ].join('\n')
    );

    const result = runFileRenameRegrade({
      apply: true,
      renames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
      root,
    });
    expect(result.isOk()).toBe(true);
    expect(readFileSync(join(root, 'docs/reference.md'), 'utf8')).toBe(
      '__TRAILS_FILE_RENAME_REFERENCE_0_0__ docs/new.md\n'
    );
    expect(readFileSync(join(root, 'src/reference.ts'), 'utf8')).toContain(
      '"__TRAILS_FILE_RENAME_LITERAL_0_0__"'
    );
    expect(readFileSync(join(root, 'src/reference.ts'), 'utf8')).toContain(
      '"docs/new.md"'
    );
  });

  test('counts explicit policy preserves separately from historical skips', () => {
    const root = createRoot();
    write(root, 'docs/old.md', '# Old\n');
    write(root, 'docs/preserved.md', 'See docs/old.md\n');

    const result = runFileRenameRegrade({
      renames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
      root,
      scope: {
        policyClassified: [
          {
            disposition: 'explicit-preserve',
            paths: ['docs/preserved.md'],
            reason: 'The old path is an intentional compatibility example.',
          },
        ],
      },
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }
    expect(result.value.evidence[0]).toMatchObject({
      historical: 1,
      preserved: 1,
      skipped: 0,
    });
  });

  test('rolls earlier file moves back when a later move fails', () => {
    const root = createRoot();
    write(root, 'docs/one.md', '# One\n');
    write(root, 'docs/two.md', '# Two\n');
    mkdirSync(join(root, 'docs/two-target.md'));

    const result = runFileRenameRegrade({
      apply: true,
      renames: [
        { from: 'docs/one.md', to: 'docs/one-target.md' },
        { from: 'docs/two.md', to: 'docs/two-target.md' },
      ],
      root,
    });
    expect(result.isErr()).toBe(true);
    expect(existsSync(join(root, 'docs/one.md'))).toBe(true);
    expect(existsSync(join(root, 'docs/one-target.md'))).toBe(false);
    expect(existsSync(join(root, 'docs/two.md'))).toBe(true);
  });

  test('rejects duplicate normalized targets before moving files', () => {
    const root = createRoot();
    write(root, 'docs/a.md', '# A\n');
    write(root, 'docs/b.md', '# B\n');

    const result = runFileRenameRegrade({
      apply: true,
      renames: [
        { from: 'docs/a.md', to: 'docs/c.md' },
        { from: 'docs/b.md', to: './docs/c.md' },
      ],
      root,
    });

    expect(result.isErr()).toBe(true);
    expect(existsSync(join(root, 'docs/a.md'))).toBe(true);
    expect(existsSync(join(root, 'docs/b.md'))).toBe(true);
    expect(existsSync(join(root, 'docs/c.md'))).toBe(false);
  });

  test('resolves moved importer directories from normalized target paths', () => {
    const root = createRoot();
    write(root, 'docs/old/a.md', '[B](b.md)\n');
    write(root, 'docs/old/b.md', '# B\n');
    const renames = [
      { from: 'docs/old/a.md', to: './docs/new/a.md' },
      { from: 'docs/old/b.md', to: 'docs/ref/b.md' },
    ];

    const preview = runFileRenameRegrade({ renames, root });
    expect(preview.isOk()).toBe(true);
    if (preview.isErr()) {
      throw preview.error;
    }
    expect(preview.value.evidence[1]?.rewritten).toBe(1);

    const applied = runFileRenameRegrade({ apply: true, renames, root });
    expect(applied.isOk()).toBe(true);
    if (applied.isErr()) {
      throw applied.error;
    }
    expect(readFileSync(join(root, 'docs/new/a.md'), 'utf8')).toBe(
      '[B](../ref/b.md)\n'
    );
    expect(applied.value.evidence[1]?.rewritten).toBe(1);
  });

  test('rolls back only reference writes that succeeded', () => {
    const root = createRoot();
    write(root, 'docs/old.md', '# Old\n');
    write(root, 'docs/a-reference.md', '[Old](old.md)\n');
    write(root, 'docs/b-reference.md', '[Old](old.md)\n');
    const failingPath = join(root, 'docs/b-reference.md');
    const originalWriteFileSync = nodeFs.writeFileSync;
    const writeSpy = spyOn(nodeFs, 'writeFileSync').mockImplementation(((
      path,
      data,
      options
    ) => {
      if (path === failingPath) {
        throw new Error('simulated reference write failure');
      }
      return originalWriteFileSync(path, data, options);
    }) as typeof nodeFs.writeFileSync);

    try {
      const result = runFileRenameRegrade({
        apply: true,
        renames: [{ from: 'docs/old.md', to: 'docs/new.md' }],
        root,
      });
      expect(result.isErr()).toBe(true);
      expect(existsSync(join(root, 'docs/old.md'))).toBe(true);
      expect(existsSync(join(root, 'docs/new.md'))).toBe(false);
      expect(readFileSync(join(root, 'docs/a-reference.md'), 'utf8')).toBe(
        '[Old](old.md)\n'
      );
      expect(readFileSync(failingPath, 'utf8')).toBe('[Old](old.md)\n');
      expect(
        writeSpy.mock.calls.filter(([path]) => path === failingPath)
      ).toHaveLength(1);
    } finally {
      writeSpy.mockRestore();
    }
  });
});
