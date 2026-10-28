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
});
