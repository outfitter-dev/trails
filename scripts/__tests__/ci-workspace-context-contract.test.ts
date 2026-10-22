import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/ci.yml', import.meta.url);
const ciCheckPath = new URL('../ci-check.sh', import.meta.url);
const stableCutoverPath = new URL(
  '../../docs/releases/stable-cutover.md',
  import.meta.url
);

test('version preparation records framework-only Skillset changes before rendering', async () => {
  const { scripts } = await Bun.file(
    new URL('../../package.json', import.meta.url)
  ).json();
  const steps = scripts['version:packages'].split(' && ');
  const sync = steps.indexOf('bun run plugin:metadata:sync');
  const record = steps.indexOf('bun run plugin:metadata:record');
  const render = steps.indexOf('bun run skillset:sync');

  expect(sync).toBeGreaterThan(-1);
  expect(record).toBeGreaterThan(sync);
  expect(render).toBeGreaterThan(record);
  for (const scope of ['plugin.trails.skill:trails', 'plugin:trails']) {
    expect(scripts['plugin:metadata:record']).toContain(
      `skillset change add --scope ${scope} --bump none --reason`
    );
  }
  expect(scripts['plugin:metadata:record']).toContain(
    'Framework target metadata only; plugin behavior is unchanged.'
  );
});

test('CI Warden uses the operator workspace context', async () => {
  const [workflow, wrapper] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readFile(ciCheckPath, 'utf8'),
  ]);
  const governance = workflow.slice(
    workflow.indexOf('  governance:'),
    workflow.indexOf('  changeset:')
  );

  expect(governance).toContain(
    'run: bun apps/trails/bin/trails.ts warden --ci'
  );
  expect(wrapper).toContain(
    'bun apps/trails/bin/trails.ts warden --ci --summary "$@"'
  );
  for (const surface of [governance, wrapper]) {
    expect(surface).not.toContain('packages/warden/bin/warden.ts');
  }
});

test('stable cutover keeps the configured app and committed lock contract', async () => {
  const runbook = await readFile(stableCutoverPath, 'utf8');

  expect(runbook.match(/warden .*--root-dir \. --app trails/g)).toHaveLength(2);
  expect(runbook).not.toContain(
    'warden --pre-push --depth all --lock skip --root-dir apps/trails --apps'
  );
  expect(runbook).not.toContain('rm -f apps/trails/trails.lock');
  expect(runbook).toContain('never remove it as temporary evidence');
});
