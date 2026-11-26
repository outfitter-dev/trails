import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../adr.ts');
const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const document = (draft: boolean) => `---
status: ${draft ? 'draft' : 'accepted'}
created: 2026-10-28
updated: 2026-10-28
owners: ['test']
slug: decision
title: Decision
${draft ? '' : 'id: 0\n'}---

# ADR${draft ? '' : '-0000'}: Decision

## Context

## Decision

Keep current doctrine.

## Consequences

## References
`;

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'adr-archive-'));
  fixtures.push(root);
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'docs/adr/drafts'), { recursive: true });
  mkdirSync(join(root, 'docs/adr/historical/drafts'), { recursive: true });
  writeFileSync(
    join(root, 'docs/adr/README.md'),
    '# Architecture Decision Records'
  );
  writeFileSync(
    join(root, 'docs/adr/historical/X999-history.md'),
    'Historical content without active metadata.'
  );
  writeFileSync(
    join(root, 'docs/adr/historical/9999-history.md'),
    document(false)
  );
  writeFileSync(
    join(root, 'docs/adr/historical/drafts/20261028-decision.md'),
    document(true)
  );
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

describe('archive-aware ADR operations', () => {
  test('ignores historical metadata and high ordinals while starting the active canon at0001', () => {
    const root = fixture();
    expect(run(root, 'map').code).toBe(0);
    expect(run(root, 'check').code).toBe(0);
    expect(
      run(root, 'create', '--title', 'Decision', '--slug', 'decision').code
    ).toBe(0);
    expect(run(root, 'promote', 'decision', '--yes').code).toBe(0);
    expect(
      readFileSync(join(root, 'docs/adr/0001-decision.md'), 'utf8')
    ).toContain('id: 1');
    expect(
      readFileSync(join(root, 'docs/adr/decision-map.json'), 'utf8')
    ).not.toContain('history');
    expect(
      readFileSync(join(root, 'docs/adr/README.md'), 'utf8')
    ).not.toContain('history');
    expect(run(root, 'check').code).toBe(0);
  });

  test('keeps the current0000-based canon valid before the reset', () => {
    const root = fixture();
    writeFileSync(join(root, 'docs/adr/0000-decision.md'), document(false));
    writeFileSync(join(root, 'docs/adr/README.md'), '[0000](0000-decision.md)');
    expect(run(root, 'map').code).toBe(0);
    expect(run(root, 'check').code).toBe(0);
  });

  test.each(
    [
      ['update', 'docs/adr/historical/9999-history.md', '--title', 'Changed'],
      ['update', 'docs/adr/historical/9999-history.md', '--renumber', '0002'],
      ['demote', 'docs/adr/historical/9999-history.md'],
      ['promote', 'docs/adr/historical/drafts/20261028-decision.md'],
      [
        'update',
        'docs/adr/drafts/../historical/9999-history.md',
        '--status',
        'rejected',
      ],
    ].map((args) => ({ args }))
  )('rejects historical input %#', ({ args }) => {
    const root = fixture();
    const numbered = join(root, 'docs/adr/historical/9999-history.md');
    const draft = join(root, 'docs/adr/historical/drafts/20261028-decision.md');
    const before = [
      readFileSync(numbered, 'utf8'),
      readFileSync(draft, 'utf8'),
    ];
    const result = run(root, ...args, '--yes');
    expect(result.code).toBe(1);
    expect(result.output).toBe(
      `Error: use a regular active ADR file directly under docs/adr/ or docs/adr/drafts/; historical paths and symlink aliases are read-only: ${args[1]}\n`
    );
    expect([
      readFileSync(numbered, 'utf8'),
      readFileSync(draft, 'utf8'),
    ]).toEqual(before);
  });

  test('excludes symlink aliases into history from discovery and explicit mutation', () => {
    const root = fixture();
    const historical = join(root, 'docs/adr/historical/9999-history.md');
    symlinkSync(historical, join(root, 'docs/adr/0000-alias.md'));
    expect(run(root, 'map').code).toBe(0);
    expect(
      readFileSync(join(root, 'docs/adr/decision-map.json'), 'utf8')
    ).not.toContain('alias');
    expect(
      run(
        root,
        'update',
        'docs/adr/0000-alias.md',
        '--title',
        'Changed',
        '--yes'
      ).code
    ).toBe(1);
    expect(readFileSync(historical, 'utf8')).toBe(document(false));
  });

  test('reference rewrites skip documentation aliases into historical records', () => {
    const root = fixture();
    const historical = join(root, 'docs/adr/historical/9999-history.md');
    const content = `${document(false)}\n[Future](drafts/20261028-decision.md)\n`;
    writeFileSync(historical, content);
    writeFileSync(
      join(root, 'docs/adr/drafts/20261028-decision.md'),
      document(true)
    );
    symlinkSync(historical, join(root, 'docs/history-alias.md'));
    symlinkSync(historical, join(root, 'AGENTS.md'));
    expect(run(root, 'map').code).toBe(0);
    expect(
      readFileSync(join(root, 'docs/adr/drafts/decision-map.json'), 'utf8')
    ).not.toContain('AGENTS.md');
    expect(run(root, 'promote', 'decision', '--yes').code).toBe(0);
    expect(readFileSync(historical, 'utf8')).toBe(content);
  });

  test('only retargets links resolving to the active draft when an archived draft has the same name', () => {
    const root = fixture();
    const filename = '20261028-decision.md';
    const draftPath = join(root, 'docs/adr/drafts', filename);
    const historicalPath = join(root, 'docs/adr/historical/drafts', filename);
    const guide = join(root, 'docs/guide.md');
    const peer = join(root, 'docs/adr/drafts/20261029-peer.md');
    const peerContent = document(true)
      .replace('slug: decision', 'slug: peer')
      .replace('## Context', `## Context\n\n[Sibling](${filename}#decision)`);
    writeFileSync(draftPath, document(true));
    writeFileSync(peer, peerContent);
    const untouched = [
      `[Historical](adr/historical/drafts/${filename}#decision)`,
      `[External](https://example.com/adr/drafts/${filename})`,
      `\`[Code](adr/drafts/${filename})\``,
    ];
    writeFileSync(
      guide,
      [
        String.raw`[Active](<adr/drafts/${filename}\?view=plain#decision> "Title")`,
        '',
        `[Root relative](/docs/adr/drafts/${filename})`,
        '',
        ...untouched,
      ].join('\n')
    );

    expect(run(root, 'promote', 'decision', '--yes').code).toBe(0);
    expect(readFileSync(guide, 'utf8')).toBe(
      [
        String.raw`[Active](<adr/0001-decision.md\?view=plain#decision> "Title")`,
        '',
        '[Root relative](/docs/adr/0001-decision.md)',
        '',
        ...untouched,
      ].join('\n')
    );
    expect(readFileSync(peer, 'utf8')).toBe(
      peerContent.replace(filename, '../0001-decision.md')
    );
    expect(readFileSync(historicalPath, 'utf8')).toBe(document(true));
    expect(run(root, 'check').code).toBe(0);
  });

  test('attributes inbound references by resolved active path, not filename', () => {
    const root = fixture();
    const filename = '20261028-decision.md';
    writeFileSync(join(root, 'docs/adr/drafts', filename), document(true));
    writeFileSync(
      join(root, 'docs/history-guide.md'),
      `[History](adr/historical/drafts/${filename})\n\`[Code](adr/drafts/${filename})\`\n`
    );
    writeFileSync(
      join(root, 'docs/active-guide.md'),
      '[Active](/docs/adr/drafts/20261028-decisio&#110;.md#decision)'
    );
    expect(run(root, 'map').code).toBe(0);
    const map = JSON.parse(
      readFileSync(join(root, 'docs/adr/drafts/decision-map.json'), 'utf8')
    );
    expect(map.entries[0].inbound).toEqual([
      {
        context:
          '[Active](/docs/adr/drafts/20261028-decisio&#110;.md#decision)',
        from: 'active-guide',
        fromPath: 'docs/active-guide.md',
      },
    ]);
  });

  test('rejects rename destinations escaping the active directory before any source write', () => {
    const root = fixture();
    const source = join(root, 'docs/adr/0000-decision.md');
    writeFileSync(source, document(false));
    mkdirSync(join(root, 'docs/adr/0000-..'));
    const result = run(
      root,
      'update',
      '0000',
      '--slug',
      '../../historical/changed',
      '--yes'
    );
    expect(result.code).toBe(1);
    expect(readFileSync(source, 'utf8')).toBe(document(false));
  });
  test('rejects absolute outside input without modifying its contents', () => {
    const root = fixture();
    const outside = join(root, 'outside.md');
    writeFileSync(outside, document(false));
    expect(
      run(root, 'update', outside, '--title', 'Changed', '--yes').code
    ).toBe(1);
    expect(readFileSync(outside, 'utf8')).toBe(document(false));
  });

  test('rejects a symlinked draft directory before create writes to history', () => {
    const root = fixture();
    rmSync(join(root, 'docs/adr/drafts'), { recursive: true });
    symlinkSync(
      join(root, 'docs/adr/historical/drafts'),
      join(root, 'docs/adr/drafts')
    );
    expect(
      run(root, 'create', '--title', 'New decision', '--slug', 'new-decision')
        .code
    ).toBe(1);
    expect(
      readFileSync(
        join(root, 'docs/adr/historical/drafts/20261028-decision.md'),
        'utf8'
      )
    ).toBe(document(true));
  });

  test('rejects generated-output aliases, including dangling symlinks, before map writes', () => {
    const root = fixture();
    const index = readFileSync(join(root, 'docs/adr/README.md'), 'utf8');
    symlinkSync(
      join(root, 'docs/adr/historical/missing-map.json'),
      join(root, 'docs/adr/decision-map.json')
    );
    expect(run(root, 'map').code).toBe(1);
    expect(readFileSync(join(root, 'docs/adr/README.md'), 'utf8')).toBe(index);
  });

  test('fix pads active decisions without rewriting historical records', () => {
    const root = fixture();
    const historical = join(root, 'docs/adr/historical/9999-history.md');
    writeFileSync(join(root, 'docs/adr/0-decision.md'), document(false));
    expect(run(root, 'fix', '--yes').code).toBe(0);
    expect(
      readFileSync(join(root, 'docs/adr/0000-decision.md'), 'utf8')
    ).toContain('Keep current doctrine.');
    expect(readFileSync(historical, 'utf8')).toBe(document(false));
    expect(run(root, 'check').code).toBe(0);
  });
});
