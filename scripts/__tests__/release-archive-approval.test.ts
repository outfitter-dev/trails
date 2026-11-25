import { expect, test } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface WorkflowJob {
  readonly environment?: { readonly name: string };
  readonly if?: string;
  readonly needs?: readonly string[];
  readonly permissions?: Record<string, string>;
  readonly steps: readonly {
    readonly env?: Record<string, string>;
    readonly if?: string;
    readonly name?: string;
    readonly run?: string;
    readonly with?: Record<string, unknown>;
  }[];
}

const workflow = Bun.YAML.parse(
  await Bun.file(
    new URL('../../.github/workflows/release.yml', import.meta.url)
  ).text()
) as { jobs: Record<string, WorkflowJob> };

const releaseStep = (job: string, name: string): string => {
  const step = workflow.jobs[job]?.steps.find(
    (candidate) => candidate.name === name
  );
  if (!step?.run) {
    throw new Error(`Missing workflow step ${job}: ${name}`);
  }
  return step.run;
};

test('retains npm review only for the manual release path', () => {
  const stage = workflow.jobs['release-assets'];
  const publish = workflow.jobs['github-release'];
  const approve = workflow.jobs['archive-approval'];

  expect(stage?.needs).toContain('build-release-assets');
  expect(stage?.if).toContain("needs.build-release-assets.result == 'success'");
  expect(workflow.jobs.publish?.needs).toContain('release-assets');
  expect(approve?.needs).toContain('release-assets');
  expect(approve?.if).toContain(
    "needs.publish-policy.outputs.decision == 'manual'"
  );
  expect(approve?.environment?.name).toBe('npm');
  expect(approve?.permissions).toEqual({});
  const protection = workflow.jobs['release-asset-policy']?.steps.find(
    ({ name }) => name === 'Require a protected npm approval environment'
  );
  expect(protection?.if).toContain(
    "needs.publish-policy.outputs.decision == 'manual'"
  );
  expect(publish?.environment).toBeUndefined();
  expect(publish?.permissions).not.toHaveProperty('id-token');
  expect(publish?.needs).toContain('publish-auto');
  expect(publish?.if).toContain("needs.publish-policy.result == 'success'");
  expect(publish?.if).toContain('github.ref_protected');
  expect(publish?.if).toContain(
    'needs.publish-policy.outputs.attempt == github.run_attempt'
  );
});

test('automatic authorization uses GitHub CI proof and the npm registry verification job', () => {
  const policy = workflow.jobs['publish-policy']?.steps.find(
    ({ name }) => name === 'Resolve publish policy'
  );
  expect(policy?.env?.TRAILS_RELEASE_POLICY_ASSUME_CI_PASSED).toBe('0');
  expect(workflow.jobs['publish-auto']?.steps.at(-1)?.run).toContain(
    'bun run publish:registry-check:published'
  );
});

test('verifies approval, extracts the exact artifact, and then publishes', () => {
  const publish = workflow.jobs['github-release'];
  expect(publish?.if).toContain(
    'needs.release-assets.outputs.attempt == github.run_attempt'
  );
  const stepNames = publish?.steps.map(({ name }) => name) ?? [];
  const verify = stepNames.indexOf('Verify archive authorization');
  const download = stepNames.indexOf(
    'Download only the authorized archive artifact'
  );
  const upload = stepNames.indexOf(
    'Stage, populate, and publish GitHub release'
  );
  expect(verify).toBeGreaterThanOrEqual(0);
  expect(verify).toBeLessThan(download);
  expect(download).toBeLessThan(upload);
  expect(publish?.steps[download]?.with).toEqual({
    'artifact-ids': `\${{ needs.release-assets.outputs.artifact_id }}`,
    'merge-multiple': true,
    path: 'release-assets',
  });
});

const digest = 'a'.repeat(64);
const environment = {
  id: 31,
  name: 'npm',
  protection_rules: [
    {
      reviewers: [{ reviewer: { id: 7 }, type: 'User' }],
      type: 'required_reviewers',
    },
  ],
};
const review = {
  comment: `approve-trails-archives 42/2/51 ${digest}`,
  environments: [{ id: 31, name: 'npm' }],
  state: 'approved',
  user: { id: 7 },
};

const withAuthorization = (
  check: (
    execute: (
      overrides?: Record<string, string>
    ) => ReturnType<typeof Bun.spawnSync>
  ) => void
) => {
  const root = mkdtempSync(join(tmpdir(), 'trails-archive-approval-'));
  try {
    writeFileSync(
      join(root, 'gh'),
      `#!/bin/bash
set -eu
case "$2" in
  */environments/npm) printf '%s\\n' "$ENVIRONMENT"; exit "$CONFIG_EXIT" ;;
  */actions/runs/"$GITHUB_RUN_ID"/approvals) printf '%s\\n' "$REVIEWS" ;;
  *) exit 9 ;;
esac
`,
      { mode: 0o700 }
    );

    const run = (overrides: Record<string, string> = {}) =>
      Bun.spawnSync(
        [
          'bash',
          '-euo',
          'pipefail',
          '-c',
          releaseStep('github-release', 'Verify archive authorization'),
        ],
        {
          cwd: root,
          env: {
            ARCHIVE_APPROVAL_RESULT: 'skipped',
            ARTIFACT_ID: '51',
            AUTO_PUBLISH_ATTEMPT: '',
            AUTO_PUBLISH_RESULT: 'skipped',
            CONFIG_EXIT: '0',
            CREATE_GITHUB_RELEASE: 'true',
            ENVIRONMENT: JSON.stringify(environment),
            GITHUB_REPOSITORY: 'example/trails',
            GITHUB_RUN_ATTEMPT: '2',
            GITHUB_RUN_ID: '42',
            MANIFEST_DIGEST: digest,
            MANUAL_PUBLISH_RESULT: 'success',
            PATH: `${root}:${process.env.PATH ?? ''}`,
            POLICY_ATTEMPT: '2',
            POLICY_DECISION: 'manual',
            POLICY_RESULT: 'success',
            REVIEWS: JSON.stringify([review]),
            SHOULD_PUBLISH: 'true',
            STAGED_ATTEMPT: '2',
            STAGED_RUN_ID: '42',
            ...overrides,
          },
        }
      );

    check(run);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
};

test('only a configured reviewer can approve these exact archives in this run and attempt', () => {
  withAuthorization((run) => {
    const approved = run();
    expect(approved.exitCode, approved.stderr.toString()).toBe(0);
    const denied = {
      'different artifact': { ARTIFACT_ID: '52' },
      'different manifest': { MANIFEST_DIGEST: 'b'.repeat(64) },
      'different run': { GITHUB_RUN_ID: '43', STAGED_RUN_ID: '43' },
      'earlier stage on a failed-job rerun': { STAGED_ATTEMPT: '1' },
      'missing environment': { CONFIG_EXIT: '1', ENVIRONMENT: '' },
      'no approval': { REVIEWS: '[]' },
      'no required reviewers': {
        ENVIRONMENT: JSON.stringify({ ...environment, protection_rules: [] }),
      },
      'no successful manual job': { MANUAL_PUBLISH_RESULT: 'skipped' },
      'npm-only approval': {
        REVIEWS: JSON.stringify([{ ...review, comment: '' }]),
      },
      'old approval even if the manifest is identical': {
        GITHUB_RUN_ATTEMPT: '3',
        POLICY_ATTEMPT: '3',
        STAGED_ATTEMPT: '3',
      },
      'unlisted reviewer': {
        REVIEWS: JSON.stringify([{ ...review, user: { id: 8 } }]),
      },
      'wrong environment': {
        REVIEWS: JSON.stringify([
          { ...review, environments: [{ id: 32, name: 'npm-auto' }] },
        ]),
      },
    };
    for (const [scenario, overrides] of Object.entries(denied)) {
      expect(run(overrides).exitCode, scenario).not.toBe(0);
    }
  });
});

test('a registry-complete manual release still needs an archive-only review', () => {
  withAuthorization((run) => {
    const complete = {
      ARCHIVE_APPROVAL_RESULT: 'success',
      MANUAL_PUBLISH_RESULT: 'skipped',
      SHOULD_PUBLISH: 'false',
    };
    expect(run(complete).exitCode).toBe(0);
    expect(run({ ...complete, REVIEWS: '[]' }).exitCode).not.toBe(0);
    expect(
      run({ ...complete, ARCHIVE_APPROVAL_RESULT: 'skipped' }).exitCode
    ).not.toBe(0);
  });
});

test('current auto policy needs no reviewer after npm succeeds or is already complete', () => {
  withAuthorization((run) => {
    const auto = {
      AUTO_PUBLISH_ATTEMPT: '2',
      AUTO_PUBLISH_RESULT: 'success',
      CONFIG_EXIT: '1',
      MANUAL_PUBLISH_RESULT: 'skipped',
      POLICY_DECISION: 'auto',
      REVIEWS: '[]',
    };
    const complete = {
      ...auto,
      AUTO_PUBLISH_ATTEMPT: '',
      AUTO_PUBLISH_RESULT: 'skipped',
      SHOULD_PUBLISH: 'false',
    };
    expect(run(auto).exitCode).toBe(0);
    expect(run(complete).exitCode).toBe(0);
    const denied = {
      'different run stage': { STAGED_RUN_ID: '41' },
      'failed npm': { AUTO_PUBLISH_RESULT: 'failure' },
      'failed release policy': { POLICY_RESULT: 'failure' },
      'missing artifact ID': { ARTIFACT_ID: '' },
      'missing manifest digest': { MANIFEST_DIGEST: '' },
      'missing policy decision': { POLICY_DECISION: '' },
      'no registry decision': { SHOULD_PUBLISH: '' },
      'no release authorization': { CREATE_GITHUB_RELEASE: 'false' },
      'skipped npm': { AUTO_PUBLISH_RESULT: 'skipped' },
      'stale npm result': { AUTO_PUBLISH_ATTEMPT: '1' },
      'stale policy': { POLICY_ATTEMPT: '1' },
      'stale stage': { STAGED_ATTEMPT: '1' },
    };
    for (const [scenario, overrides] of Object.entries(denied)) {
      expect(run({ ...auto, ...overrides }).exitCode, scenario).not.toBe(0);
    }
  });
});

test('uploads precisely the staged files and refuses digest or draft mismatches', () => {
  const root = mkdtempSync(join(tmpdir(), 'trails-approved-archives-'));
  try {
    const bin = join(root, 'bin');
    const assets = join(root, 'release-assets');
    mkdirSync(bin);
    mkdirSync(assets);
    const version = '0.0.1';
    const platforms = [
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
    ];
    const archives = platforms.map(
      (platform) => `trails-v${version}-${platform}.tar.gz`
    );
    for (const archive of archives) {
      writeFileSync(join(assets, archive), archive);
    }

    const sha = 'a'.repeat(40);
    const shims = {
      bun: '#!/bin/bash\nprintf "Fixture release notes\\n"\n',
      gh: `#!/bin/bash
set -euo pipefail
case "$1 $2" in
  'release view')
    if [[ "$4 $5" == '--json isDraft,assets' ]]; then
      jq -Rn --arg extra "$EXTRA_ASSET" '
        {isDraft: true, assets: ([inputs | split("  ") |
          {name: (.[1] | split("/") | last), digest: ("sha256:" + .[0])}] +
          (if $extra == "true" then [{name: "unexpected.tgz", digest: "sha256:extra"}] else [] end))}
      ' < "$RUNNER_TEMP/uploaded"
    elif [[ "$#" == "7" ]]; then
      printf '%s\\n' "$IS_DRAFT"
    elif [[ "$NO_RELEASE" == "true" ]]; then
      exit 1
    else
      printf '{"isDraft": %s}\\n' "$IS_DRAFT"
    fi
    ;;
  'release create') printf 'create\\n' >> "$RUNNER_TEMP/events" ;;
  'release upload')
    printf 'upload\\n' >> "$RUNNER_TEMP/events"
    shift 3
    for path in "$@"; do
      if [[ "$path" != '--clobber' ]]; then sha256sum -- "$path"; fi
    done > "$RUNNER_TEMP/uploaded"
    ;;
  'release edit') printf 'publish\\n' >> "$RUNNER_TEMP/events" ;;
  *) exit 9 ;;
esac
`,
      git: `#!/bin/bash
case "$1 $2" in
  'cat-file -e'|'fetch --force'|'rev-parse -q') exit 0 ;;
  "rev-parse refs/tags/v$VERSION^{commit}") printf '%s\\n' "$VERSION_TARGET" ;;
  *) exit 9 ;;
esac
`,
    };
    for (const [name, script] of Object.entries(shims)) {
      writeFileSync(join(bin, name), script, { mode: 0o700 });
    }
    const output = join(root, 'output');
    const events = join(root, 'events');
    const manifest = `trails-v${version}-SHA256SUMS`;
    const run = (
      job: string,
      step: string,
      cwd: string,
      overrides: Record<string, string> = {}
    ) =>
      Bun.spawnSync(
        ['bash', '-euo', 'pipefail', '-c', releaseStep(job, step)],
        {
          cwd,
          env: {
            DIST_TAG: 'latest',
            EXTRA_ASSET: 'false',
            GITHUB_OUTPUT: output,
            IS_DRAFT: 'true',
            NO_RELEASE: 'false',
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            RUNNER_TEMP: root,
            VERSION: version,
            VERSION_TARGET: sha,
            ...overrides,
          },
        }
      );

    const staged = run(
      'release-assets',
      'Assemble CLI checksum manifest',
      assets
    );
    expect(staged.exitCode, staged.stderr.toString()).toBe(0);
    const manifestDigest = readFileSync(output, 'utf8')
      .trim()
      .replace('digest=', '');
    const publish = (overrides: Record<string, string> = {}) => {
      writeFileSync(events, '');
      const proof = {
        ARTIFACT_ID: '51',
        CREATE_GITHUB_RELEASE: 'true',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_RUN_ID: '42',
        MANIFEST_DIGEST: manifestDigest,
        POLICY_ATTEMPT: '2',
        POLICY_DECISION: 'auto',
        POLICY_RESULT: 'success',
        SHOULD_PUBLISH: 'false',
        STAGED_ATTEMPT: '2',
        STAGED_RUN_ID: '42',
        ...overrides,
      };
      const authorization = run(
        'github-release',
        'Verify archive authorization',
        root,
        proof
      );
      if (authorization.exitCode !== 0) {
        return authorization;
      }
      return run(
        'github-release',
        'Stage, populate, and publish GitHub release',
        root,
        proof
      );
    };

    const release = publish({ NO_RELEASE: 'true' });
    expect(release.exitCode, release.stderr.toString()).toBe(0);
    expect(readFileSync(events, 'utf8')).toBe('create\nupload\npublish\n');
    const uploaded = readFileSync(join(root, 'uploaded'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.slice(66));
    expect(uploaded).toEqual(
      [manifest, ...archives].map((name) => `release-assets/${name}`)
    );

    const retry = publish();
    expect(retry.exitCode, retry.stderr.toString()).toBe(0);
    expect(readFileSync(events, 'utf8')).toBe('upload\npublish\n');

    expect(publish({ EXTRA_ASSET: 'true' }).exitCode).not.toBe(0);
    expect(readFileSync(events, 'utf8')).toBe('upload\n');
    expect(publish({ IS_DRAFT: 'false' }).exitCode).not.toBe(0);
    expect(readFileSync(events, 'utf8')).toBe('');
    expect(publish({ POLICY_ATTEMPT: '1' }).exitCode).not.toBe(0);
    expect(readFileSync(events, 'utf8')).toBe('');
    expect(publish({ MANIFEST_DIGEST: 'b'.repeat(64) }).exitCode).not.toBe(0);
    expect(readFileSync(events, 'utf8')).toBe('');

    writeFileSync(join(assets, archives[0] ?? ''), 'different bytes');
    expect(publish().exitCode).not.toBe(0);
    expect(readFileSync(events, 'utf8')).toBe('');
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
