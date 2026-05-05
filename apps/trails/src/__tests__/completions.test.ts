import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeTrail, ValidationError } from '@ontrails/core';

import {
  renderCompletionScript,
  renderTrailIdCompletions,
} from '../completions.js';
import { completionsTrail } from '../trails/completions.js';
import { completionsCompleteTrail } from '../trails/completions-complete.js';

interface AppSpec {
  readonly name: string;
  readonly trailIds: readonly string[];
}

const writeFile = (filePath: string, contents: string): void => {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, contents);
};

const writeWorkspace = (root: string, apps: readonly AppSpec[]): void => {
  writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'completions-test-fixture',
        private: true,
        type: 'module',
        workspaces: ['apps/*'],
      },
      null,
      2
    )}\n`
  );
  for (const spec of apps) {
    const appDir = join(root, 'apps', spec.name);
    writeFile(
      join(appDir, 'package.json'),
      `${JSON.stringify(
        {
          name: spec.name,
          private: true,
          trails: { module: 'src/app.ts' },
          type: 'module',
        },
        null,
        2
      )}\n`
    );
    writeFile(
      join(appDir, 'src/app.ts'),
      [
        `const trailIds = ${JSON.stringify(spec.trailIds)};`,
        `export const app = {`,
        `  name: '${spec.name}',`,
        `  ids: () => trailIds,`,
        `};`,
        '',
      ].join('\n')
    );
  }
};

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = join(
    tmpdir(),
    `completions-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workspaceRoot, { force: true, recursive: true });
});

describe('renderCompletionScript', () => {
  test('emits a bash completion script that registers a complete handler', () => {
    const script = renderCompletionScript('bash', 'trails').unwrap();
    expect(script).toContain('_trails_complete');
    expect(script).toContain('complete -F');
    expect(script).toContain('trails');
    expect(script).toContain('completions __complete');
    expect(script).toContain('while IFS= read -r suggestion');
    expect(script).not.toContain('readarray');
  });

  test('emits a zsh completion script with a compdef handler', () => {
    const script = renderCompletionScript('zsh', 'trails').unwrap();
    expect(script).toContain('#compdef trails');
    expect(script).toContain('_trails_complete');
    expect(script).toContain('completions __complete');
    expect(script).toContain('trail_words');
    expect(script).toContain('if [[ -n "$output" ]]');
  });

  test('emits a fish completion script that uses complete -c', () => {
    const script = renderCompletionScript('fish', 'trails').unwrap();
    expect(script).toContain('complete -c trails');
    expect(script).toContain('completions __complete');
  });

  test('substitutes the bin name into bash idioms', () => {
    const script = renderCompletionScript('bash', 'mybin').unwrap();
    expect(script).toContain('complete -F _mybin_complete mybin');
  });

  test('returns a validation error for unsafe bin names', () => {
    const result = renderCompletionScript('bash', 'trails;rm');
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain('binName must match');
    }
  });
});

describe('renderTrailIdCompletions', () => {
  test('returns trail ids matching the prefix, sorted', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read', 'book.write', 'guide.list'],
      },
    ]);

    const matches = await renderTrailIdCompletions(workspaceRoot, 'book');
    expect(matches).toEqual(['book.read', 'book.write']);
  });

  test('empty prefix returns all trail ids sorted', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['guide.list', 'book.read'],
      },
    ]);

    const matches = await renderTrailIdCompletions(workspaceRoot, '');
    expect(matches).toEqual(['book.read', 'guide.list']);
  });

  test('unknown prefix returns an empty list', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read', 'guide.list'],
      },
    ]);

    const matches = await renderTrailIdCompletions(workspaceRoot, 'xyz');
    expect(matches).toEqual([]);
  });

  test('indexing failures degrade to an empty suggestion list', async () => {
    const matches = await renderTrailIdCompletions(
      join(workspaceRoot, 'missing'),
      ''
    );
    expect(matches).toEqual([]);
  });

  test('includes ids from collisions across multiple apps', async () => {
    writeWorkspace(workspaceRoot, [
      { name: 'app-a', trailIds: ['shared.id', 'a.only'] },
      { name: 'app-b', trailIds: ['shared.id', 'b.only'] },
    ]);

    const matches = await renderTrailIdCompletions(workspaceRoot, '');
    expect(matches).toEqual(['a.only', 'b.only', 'shared.id']);
  });
});

describe('completionsTrail', () => {
  test('returns a bash script for shell=bash', async () => {
    const result = await executeTrail(completionsTrail, { shell: 'bash' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('_trails_complete');
      expect(result.value).toContain('complete -F');
    }
  });

  test('returns a zsh script for shell=zsh', async () => {
    const result = await executeTrail(completionsTrail, { shell: 'zsh' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('#compdef trails');
    }
  });

  test('returns a fish script for shell=fish', async () => {
    const result = await executeTrail(completionsTrail, { shell: 'fish' });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('complete -c trails');
    }
  });
});

describe('completionsCompleteTrail', () => {
  test('returns trail-id suggestions for `trails run <prefix>`', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read', 'book.write', 'guide.list'],
      },
    ]);

    const result = await executeTrail(completionsCompleteTrail, {
      args: ['run', 'book'],
      rootDir: workspaceRoot,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('book.read\nbook.write');
    }
  });

  test('returns all ids when prefix is empty after `run`', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read', 'guide.list'],
      },
    ]);

    const result = await executeTrail(completionsCompleteTrail, {
      args: ['run', ''],
      rootDir: workspaceRoot,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('book.read\nguide.list');
    }
  });

  test('does not suggest trail ids when cursor is past the trail-id slot', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read', 'guide.list'],
      },
    ]);

    const result = await executeTrail(completionsCompleteTrail, {
      args: ['run', 'book.read', ''],
      rootDir: workspaceRoot,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('');
    }
  });

  test('returns no suggestions when args do not target a known position', async () => {
    writeWorkspace(workspaceRoot, [
      {
        name: 'docs',
        trailIds: ['book.read'],
      },
    ]);

    const result = await executeTrail(completionsCompleteTrail, {
      args: ['unknown-subcommand'],
      rootDir: workspaceRoot,
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe('');
    }
  });
});
