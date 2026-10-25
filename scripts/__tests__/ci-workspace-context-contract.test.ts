import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

const workflowPath = new URL('../../.github/workflows/ci.yml', import.meta.url);
const ciCheckPath = new URL('../ci-check.sh', import.meta.url);
const stableCutoverPath = new URL(
  '../../docs/releases/stable-cutover.md',
  import.meta.url
);

interface Workflow {
  concurrency: { group: string; 'cancel-in-progress': string };
  jobs: Record<
    string,
    {
      if?: string;
      name: string;
      needs?: string[];
      steps: {
        env?: Record<string, string>;
        if?: string;
        name?: string;
        run?: string;
      }[];
    }
  >;
  on: Record<string, { branches?: string[]; types?: string[] } | null>;
}

const ciWorkflow = Bun.YAML.parse(
  await readFile(workflowPath, 'utf8')
) as Workflow;
const jobFor = (name: string) => {
  const job = ciWorkflow.jobs[name];
  if (!job) {
    throw new Error(`CI must declare the ${name} job`);
  }
  return job;
};
const ciGate = jobFor('ci-gate');
const gate = ciGate.steps.find(
  (step) => step.name === 'Require all jobs to pass'
);
if (!(gate?.run && ciGate.needs)) {
  throw new Error('CI must declare its required checks and executable gate');
}
const gateScript = gate.run;
const requiredJobs = ciGate.needs;
const prOnlyJobs = new Set(['changeset', 'release-pack']);

test('merge groups run the normal CI checks on main with ref-isolated cancellation', () => {
  expect(ciWorkflow.on['merge_group']).toEqual({
    branches: ['main'],
    types: ['checks_requested'],
  });
  expect(ciWorkflow.concurrency.group).toMatch(/^ci-\$\{\{ github.ref \}\}$/);
  expect(ciWorkflow.concurrency['cancel-in-progress']).toMatch(
    /^\$\{\{ github.ref != 'refs\/heads\/main' \}\}$/
  );
  expect(ciGate.if).toBe('always()');
  expect(ciGate.needs?.toSorted()).toEqual(
    Object.keys(ciWorkflow.jobs)
      .filter((name) => name !== 'ci-gate')
      .toSorted()
  );
  expect(gate.env?.['JOB_RESULTS']).toMatch(/^\$\{\{ toJSON\(needs\) \}\}$/);
  expect(gate.if).toBeUndefined();
  for (const name of requiredJobs) {
    expect(jobFor(name).if).toBe(
      prOnlyJobs.has(name) ? "github.event_name == 'pull_request'" : undefined
    );
  }
  expect(jobFor('governance').steps).toContainEqual({
    name: 'CI workflow contract',
    run: 'bun test scripts/__tests__/ci-workspace-context-contract.test.ts',
  });
});

for (const event of [
  'pull_request',
  'merge_group',
  'push',
  'workflow_dispatch',
]) {
  const results = Object.fromEntries(
    requiredJobs.map((job) => [
      job,
      {
        result:
          event !== 'pull_request' && prOnlyJobs.has(job)
            ? 'skipped'
            : 'success',
      },
    ])
  );
  const runGate = (jobs: typeof results) =>
    Bun.spawnSync(['bash', '-eu', '-o', 'pipefail', '-c', gateScript], {
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: event,
        JOB_RESULTS: JSON.stringify(jobs),
      },
      stderr: 'pipe',
      stdout: 'pipe',
    }).exitCode;

  test(`CI accepts the expected ${event} job results`, () => {
    expect(runGate(results)).toBe(0);
  });

  for (const [job, expected] of Object.entries(results)) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      if (result === expected.result) {
        continue;
      }
      test(`CI rejects ${event} ${job}=${result}`, () => {
        expect(runGate({ ...results, [job]: { result } })).not.toBe(0);
      });
    }
  }
}

test('version preparation records or refreshes framework-only Skillset changes before rendering', async () => {
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
  expect(scripts['plugin:metadata:record']).toBe(
    'bun scripts/record-plugin-metadata.ts'
  );
});

test('release runs every generated-version preflight before dispatching CI', async () => {
  const workflow = await Bun.file(
    new URL('../../.github/workflows/release.yml', import.meta.url)
  ).text();
  const validation = workflow.slice(
    workflow.indexOf('- name: Validate version PR'),
    workflow.indexOf('- name: Dispatch version PR CI')
  );
  let previous = -1;
  for (const command of [
    'bun run changeset:check',
    'bun run release-pack:check -- --lockfile-only',
    'bun run skillset:check',
    'bun run publish:check',
  ]) {
    const position = validation.indexOf(command);
    expect(position).toBeGreaterThan(previous);
    previous = position;
  }
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
