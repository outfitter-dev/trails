import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../adr.ts');
const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    rmSync(fixture, { force: true, recursive: true });
  }
});

const document = (draft: boolean, body: string) => `---
status: ${draft ? 'draft' : 'accepted'}
created: 2026-10-28
updated: 2026-10-28
owners: ['test']
slug: ${draft ? 'moving' : 'existing'}
title: ${draft ? 'Moving' : 'Existing'}
${draft ? '' : 'id: 1\n'}---

# ADR${draft ? '' : '-0001'}: ${draft ? 'Moving' : 'Existing'}

## Context

${body}

## Decision

Keep targets.

## Consequences

Links resolve.

## References
`;

const fixture = (body: string) => {
  const root = mkdtempSync(join(tmpdir(), 'adr-relative-links-'));
  fixtures.push(root);
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'docs/adr/drafts'), { recursive: true });
  writeFileSync(join(root, 'docs/adr/0001-existing.md'), document(false, ''));
  writeFileSync(
    join(root, 'docs/adr/drafts/20261028-moving.md'),
    document(true, body)
  );
  writeFileSync(
    join(root, 'docs/adr/README.md'),
    '[Existing](0001-existing.md)'
  );
  writeFileSync(join(root, 'docs/tenets.md'), '# Tenets');
  writeFileSync(join(root, 'docs/a guide.md'), '# Guide');
  writeFileSync(join(root, 'docs/guide(v2).md'), '# Guide');
  writeFileSync(join(root, 'docs/diagram.png'), 'image fixture');
  writeFileSync(join(root, 'docs/guide#v.md'), '# Hash');
  writeFileSync(join(root, 'docs/guide?v.md'), '# Query');
  writeFileSync(join(root, 'docs/a>guide.md'), '# Guide');
  return root;
};

const run = (root: string, ...args: string[]) => {
  const result = Bun.spawnSync([process.execPath, script, ...args], {
    cwd: root,
  });
  return {
    code: result.exitCode,
    output: result.stdout.toString() + result.stderr.toString(),
  };
};

const body = `[Sibling](../0001-existing.md#context "Sibling title")
[Tenets](../../tenets.md?view=plain#tenets)
![Image](../../a%20guide.md)
![](../../a%20guide.md) [](../../tenets.md)
[Guide][guide]
[guide]: <../../a guide.md> "Guide title"
[Local](#decision) [Root](/docs/tenets.md) [Web](https://example.com/x)
[Mail](mailto:reader@example.com) [Protocol](//example.com/x)
\`[Example](../../not-a-target.md)\`
\`\`[Double](../../not-a-target.md)\`\`
Use \`\`\`[Triple](../../not-a-target.md)\`\`\`
\`\`multiline
[Multiline](../../not-a-target.md)
\`\`

\`\`\`md
[Example](../../not-a-target.md)
\`\`\`
`;

describe('ADR relative links', () => {
  test('promotion preserves targets and demotion restores relative destinations', () => {
    const root = fixture(body);
    expect(run(root, 'map').code).toBe(0);
    expect(run(root, 'check').code).toBe(0);
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    const promoted = readFileSync(
      join(root, 'docs/adr/0002-moving.md'),
      'utf8'
    );
    expect(promoted).toContain(
      '[Sibling](0001-existing.md#context "Sibling title")'
    );
    expect(promoted).toContain('[Tenets](../tenets.md?view=plain#tenets)');
    expect(promoted).toContain('![Image](../a%20guide.md)');
    expect(promoted).toContain('![](../a%20guide.md) [](../tenets.md)');
    expect(promoted).toContain('``[Double](../../not-a-target.md)``');
    expect(promoted).toContain('Use ```[Triple](../../not-a-target.md)```');
    expect(promoted).toContain(
      '``multiline\n[Multiline](../../not-a-target.md)\n``'
    );
    expect(promoted).toContain('[guide]: <../a guide.md> "Guide title"');
    expect(promoted).toContain(
      '[Local](#decision) [Root](/docs/tenets.md) [Web](https://example.com/x)'
    );
    expect(promoted).toContain('`[Example](../../not-a-target.md)`');
    expect(promoted).toContain('```md\n[Example](../../not-a-target.md)');
    expect(run(root, 'check')).toEqual({
      code: 0,
      output: expect.stringContaining('0 errors'),
    });
    expect(run(root, 'demote', '0002', '--yes').code).toBe(0);
    const filename = readdirSync(join(root, 'docs/adr/drafts')).find((name) =>
      name.endsWith('-moving.md')
    );
    if (!filename) {
      throw new Error('Demoted ADR missing');
    }
    expect(
      readFileSync(join(root, 'docs/adr/drafts', filename), 'utf8')
    ).toContain(body);
    expect(run(root, 'check').code).toBe(0);
  });

  test('explicit self links follow the moved decision in both directions', () => {
    const root = fixture('[Self](20261028-moving.md#decision)');
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    expect(
      readFileSync(join(root, 'docs/adr/0002-moving.md'), 'utf8')
    ).toContain('[Self](0002-moving.md#decision)');
    expect(run(root, 'check').code).toBe(0);
    expect(run(root, 'demote', '0002', '--yes').code).toBe(0);
    const filename = readdirSync(join(root, 'docs/adr/drafts')).find((name) =>
      name.endsWith('-moving.md')
    );
    if (!filename) {
      throw new Error('Demoted ADR missing');
    }
    expect(
      readFileSync(join(root, 'docs/adr/drafts', filename), 'utf8')
    ).toContain(`[Self](${filename}#decision)`);
    expect(run(root, 'check').code).toBe(0);
  });

  test('escaped backticks leave visible links available to rebase and check', () => {
    const root = fixture('\\`[Visible](../../tenets.md)\\`');
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    const path = join(root, 'docs/adr/0002-moving.md');
    expect(readFileSync(path, 'utf8')).toContain(
      '\\`[Visible](../tenets.md)\\`'
    );
    expect(run(root, 'check').code).toBe(0);
    writeFileSync(
      path,
      `${readFileSync(path, 'utf8')}\n\\\`[Missing](../missing.md)\\\`\n`
    );
    expect(run(root, 'map').code).toBe(0);
    const checked = run(root, 'check');
    expect(checked.code).toBe(1);
    expect(checked.output).toContain('missing.md');
  });

  test('even backslashes open code spans and backslashes inside spans stay literal', () => {
    const code = '\\\\`[Code](../../missing.md)`\n`[Code](../../missing.md)\\`';
    const root = fixture(code);
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    expect(
      readFileSync(join(root, 'docs/adr/0002-moving.md'), 'utf8')
    ).toContain(code);
    expect(run(root, 'check').code).toBe(0);
  });

  test.each([true, false])(
    'check rejects dead local targets in draft=%s without writing',
    (draft) => {
      const root = fixture(draft ? '![](../../missing.md)' : '');
      const path = join(
        root,
        draft
          ? 'docs/adr/drafts/20261028-moving.md'
          : 'docs/adr/0001-existing.md'
      );
      if (!draft) {
        writeFileSync(path, document(false, '[](../missing.md)'));
      }
      expect(run(root, 'map').code).toBe(0);
      const before = readFileSync(path, 'utf8');
      const result = run(root, 'check');
      expect(result.code).toBe(1);
      expect(result.output).toContain('missing.md');
      expect(readFileSync(path, 'utf8')).toBe(before);
    }
  );
  test('linked images preserve both destinations through promotion and demotion', () => {
    const links = '[![Diagram](../../diagram.png)](../../tenets.md)';
    const root = fixture(links);
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    const path = join(root, 'docs/adr/0002-moving.md');
    expect(readFileSync(path, 'utf8')).toContain(
      '[![Diagram](../diagram.png)](../tenets.md)'
    );
    expect(run(root, 'check').code).toBe(0);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('](../tenets.md)', '](../missing.md)')
    );
    expect(run(root, 'map').code).toBe(0);
    expect(run(root, 'check').code).toBe(1);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('](../missing.md)', '](../tenets.md)')
    );
    expect(run(root, 'demote', '0002', '--yes').code).toBe(0);
    const filename = readdirSync(join(root, 'docs/adr/drafts')).find((name) =>
      name.endsWith('-moving.md')
    );
    if (!filename) {
      throw new Error('Demoted ADR missing');
    }
    expect(
      readFileSync(join(root, 'docs/adr/drafts', filename), 'utf8')
    ).toContain(links);
    expect(run(root, 'check').code).toBe(0);
  });

  test('checks and rebases balanced and escaped parentheses in destinations', () => {
    const links = String.raw`[Guide](../../guide(v2).md) [Escaped](../../guide\(v2\).md)`;
    const root = fixture(links);
    expect(run(root, 'map').code).toBe(0);
    expect(run(root, 'check').code).toBe(0);
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    expect(
      readFileSync(join(root, 'docs/adr/0002-moving.md'), 'utf8')
    ).toContain(
      String.raw`[Guide](../guide(v2).md) [Escaped](../guide\(v2\).md)`
    );
    expect(run(root, 'check').code).toBe(0);
  });

  test('fence-like content with an info string does not conceal links below the real closer', () => {
    const example = [
      '```text',
      '```ts',
      '[Example](../../missing.md)',
      '```',
      '[Tenets](../../tenets.md)',
    ].join('\n');
    const root = fixture(example);
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    const promoted = readFileSync(
      join(root, 'docs/adr/0002-moving.md'),
      'utf8'
    );
    expect(promoted).toContain('[Example](../../missing.md)');
    expect(promoted).toContain('[Tenets](../tenets.md)');
    expect(run(root, 'check').code).toBe(0);
  });
  test('escaped link delimiters distinguish literal prose from rendered links', () => {
    const links = String.raw`\[Literal](../../missing.md) [Bracket \]](../../tenets.md)`;
    const root = fixture(links);
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    expect(
      readFileSync(join(root, 'docs/adr/0002-moving.md'), 'utf8')
    ).toContain(
      String.raw`\[Literal](../../missing.md) [Bracket \]](../tenets.md)`
    );
    expect(run(root, 'check').code).toBe(0);
  });

  test('demotion refuses a same-day draft collision without changing either decision', () => {
    const root = fixture('[Tenets](../../tenets.md)');
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    const source = join(root, 'docs/adr/0002-moving.md');
    const before = readFileSync(source, 'utf8');
    expect(
      run(root, 'create', '--title', 'Unrelated sentinel', '--slug', 'moving')
        .code
    ).toBe(0);
    const filename = readdirSync(join(root, 'docs/adr/drafts')).find((name) =>
      name.endsWith('-moving.md')
    );
    if (!filename) {
      throw new Error('Collision fixture missing');
    }
    const destination = join(root, 'docs/adr/drafts', filename);
    const sentinel = readFileSync(destination, 'utf8');
    expect(run(root, 'demote', '0002', '--yes').code).toBe(1);
    expect(readFileSync(source, 'utf8')).toBe(before);
    expect(readFileSync(destination, 'utf8')).toBe(sentinel);
  });

  test('forced move failure preserves source and an unrelated destination sentinel', () => {
    const root = fixture('[Tenets](../../tenets.md)');
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    const source = join(root, 'docs/adr/0002-moving.md');
    const before = readFileSync(source, 'utf8');
    const sentinel = join(root, 'docs/adr/drafts/sentinel.md');
    writeFileSync(sentinel, 'Unrelated destination sentinel');
    const preload = join(root, 'fail-move.ts');
    writeFileSync(
      preload,
      `import { mock } from 'bun:test';
import * as fs from 'node:fs';
const actual = { ...fs };
mock.module('node:fs', () => ({ ...actual,
  linkSync: () => { throw new Error('forced move failure'); },
  renameSync: () => { throw new Error('forced move failure'); },
}));`
    );
    const failed = Bun.spawnSync(
      [
        process.execPath,
        '--preload',
        preload,
        script,
        'demote',
        '0002',
        '--yes',
      ],
      { cwd: root }
    );
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr.toString()).toContain('forced move failure');
    expect(readFileSync(source, 'utf8')).toBe(before);
    expect(readFileSync(sentinel, 'utf8')).toBe(
      'Unrelated destination sentinel'
    );
  });
  test('escaped reference labels and escaped URL separators preserve rendered links', () => {
    const links = String.raw`[Bracket \]][Bracket \]]
[Bracket \]]: ../../tenets.md
[Tenets](../../tenets.md\#tenets)
[Hash filename](../../guide%23v.md) [Query filename](../../guide%3Fv.md)`;
    const root = fixture(links);
    expect(run(root, 'map').code).toBe(0);
    expect(run(root, 'check').code).toBe(0);
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    const path = join(root, 'docs/adr/0002-moving.md');
    expect(readFileSync(path, 'utf8')).toContain(
      String.raw`[Bracket \]]: ../tenets.md`
    );
    expect(readFileSync(path, 'utf8')).toContain(
      String.raw`[Tenets](../tenets.md\#tenets)`
    );
    expect(run(root, 'check').code).toBe(0);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(']: ../tenets.md', ']: ../missing.md')
    );
    expect(run(root, 'map').code).toBe(0);
    expect(run(root, 'check').code).toBe(1);
  });
  test('same-slug and same-number updates keep their no-op move behavior', () => {
    const root = fixture('');
    expect(
      run(
        root,
        'update',
        'existing',
        '--slug',
        'existing',
        '--title',
        'Changed',
        '--yes'
      ).code
    ).toBe(0);
    const source = join(root, 'docs/adr/0001-existing.md');
    expect(readFileSync(source, 'utf8')).toContain('# ADR-0001: Changed');
    expect(
      run(
        root,
        'update',
        '0001',
        '--renumber',
        '0001',
        '--status',
        'proposed',
        '--yes'
      ).code
    ).toBe(0);
    expect(readFileSync(source, 'utf8')).toContain('status: proposed');
    expect(run(root, 'check').code).toBe(0);
  });
  test('directory links retain their target, slash, query and fragment on a round trip', () => {
    const links =
      '[ADRs](../) [Fragment](../#section) [Query](../?sort=name) [Here](./)';
    const root = fixture(links);
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    expect(
      readFileSync(join(root, 'docs/adr/0002-moving.md'), 'utf8')
    ).toContain(
      '[ADRs](./) [Fragment](./#section) [Query](./?sort=name) [Here](drafts/)'
    );
    expect(run(root, 'check').code).toBe(0);
    expect(run(root, 'demote', '0002', '--yes').code).toBe(0);
    const filename = readdirSync(join(root, 'docs/adr/drafts')).find((name) =>
      name.endsWith('-moving.md')
    );
    if (!filename) {
      throw new Error('Demoted ADR missing');
    }
    expect(
      readFileSync(join(root, 'docs/adr/drafts', filename), 'utf8')
    ).toContain(links);
    expect(run(root, 'check').code).toBe(0);
  });
  test('reference destinations share escaped angle parsing and leave invalid bare-space prose intact', () => {
    const links = String.raw`[Use][Bracket \]]
[Bracket \]]: <../../a\>guide.md>
[Not a definition]: ../../a\ guide.md`;
    const root = fixture(links);
    expect(run(root, 'map').code).toBe(0);
    expect(run(root, 'check').code).toBe(0);
    expect(run(root, 'promote', 'moving', '--yes').code).toBe(0);
    const promoted = readFileSync(
      join(root, 'docs/adr/0002-moving.md'),
      'utf8'
    );
    expect(promoted).toContain(String.raw`[Bracket \]]: <../a\>guide.md>`);
    expect(promoted).toContain(
      String.raw`[Not a definition]: ../../a\ guide.md`
    );
    expect(run(root, 'check').code).toBe(0);
  });
});
