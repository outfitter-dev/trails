import { afterEach, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Step {
  readonly id?: string;
  readonly name?: string;
  readonly run?: string;
  readonly env?: Record<string, string>;
}
const workflow = Bun.YAML.parse(
  readFileSync(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  )
) as {
  jobs: { governance: { steps: Step[] } };
};
const { steps } = workflow.jobs.governance;
const pin = steps.find((step) => step.id === 'docs-trunk');
const check = steps.find((step) => step.name === 'Documentation checks');
const fixtures: string[] = [];
afterEach(() => {
  for (const path of fixtures.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

test('the actual CI shells fetch/pin main and select the event comparison base', () => {
  if (!(pin?.run && check?.run)) {
    throw new Error('Missing documentation CI steps');
  }
  expect(check.env?.['DOCS_EVENT']).toMatch(/^\$\{\{ github\.event_name \}\}$/);
  expect(check.env?.['DOCS_TRUNK_SHA']).toMatch(
    /^\$\{\{ steps\.docs-trunk\.outputs\.sha \}\}$/
  );
  expect(check.env?.['DOCS_PUSH_BASE']).toMatch(
    /^\$\{\{ github\.event\.before \}\}$/
  );
  const root = mkdtempSync(join(tmpdir(), 'trails-docs-ci-'));
  fixtures.push(root);
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', ...args], { cwd: root });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString());
    }
    return result.stdout.toString().trim();
  };
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('commit', '--quiet', '--allow-empty', '-m', 'trunk');
  const trunk = git('rev-parse', 'HEAD');
  git('remote', 'add', 'origin', root);
  git('switch', '--quiet', '-c', 'upper');
  git('commit', '--quiet', '--allow-empty', '-m', 'upper');
  expect(git('rev-parse', 'HEAD')).not.toBe(trunk);
  const output = join(root, 'output');
  const pinned = Bun.spawnSync(['bash', '-e', '-c', pin.run], {
    cwd: root,
    env: { ...process.env, GITHUB_OUTPUT: output },
  });
  expect(pinned.exitCode).toBe(0);
  expect(readFileSync(output, 'utf8')).toBe(`sha=${trunk}\n`);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'bun'),
    '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$DOCS_TEST_ARGS"\n'
  );
  chmodSync(join(bin, 'bun'), 0o755);
  for (const event of [
    'pull_request',
    'merge_group',
    'workflow_dispatch',
    'push',
  ]) {
    const args = join(root, event);
    const result = Bun.spawnSync(['bash', '-e', '-c', check.run], {
      cwd: root,
      env: {
        ...process.env,
        DOCS_EVENT: event,
        DOCS_PUSH_BASE: 'previous-push-head',
        DOCS_TEST_ARGS: args,
        DOCS_TRUNK_SHA: trunk,
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      },
    });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(args, 'utf8').split('\n')).toEqual([
      'run',
      'docs:check',
      '--',
      '--base-ref',
      event === 'push' ? 'previous-push-head' : trunk,
      '',
    ]);
  }
  const missing = Bun.spawnSync(['bash', '-e', '-c', check.run], {
    cwd: root,
    env: { ...process.env, DOCS_EVENT: 'push', DOCS_PUSH_BASE: '' },
  });
  expect(missing.exitCode).not.toBe(0);
  expect(missing.stderr.toString()).toContain('Missing push comparison base');
});
