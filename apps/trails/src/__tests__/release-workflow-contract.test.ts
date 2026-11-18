import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Record<string, unknown>;
}

interface WorkflowJob {
  readonly environment?: { readonly name: string };
  readonly permissions?: Record<string, string>;
  readonly if?: string;
  readonly needs?: string | readonly string[];
  readonly secrets?: Record<string, string>;
  readonly steps?: readonly WorkflowStep[];
  readonly uses?: string;
  readonly with?: Record<string, string>;
}

interface Workflow {
  readonly jobs?: Record<string, WorkflowJob>;
  readonly on?: Record<string, unknown>;
}

const workflowPath = (name: string): string =>
  join(import.meta.dir, '../../../../.github/workflows', name);

const readWorkflow = (name: string): Workflow =>
  Bun.YAML.parse(readFileSync(workflowPath(name), 'utf8')) as Workflow;

const homebrewTapToken = `\${{ secrets.HOMEBREW_TAP_TOKEN }}`;
const releaseTag = `\${{ needs.github-release.outputs.tag }}`;

describe('TRL-1291 release workflow contract', () => {
  test('hands off after skipped npm ancestors only when release succeeds and the run is not cancelled', () => {
    const homebrew = readWorkflow('release.yml').jobs?.homebrew;
    // An explicit status function avoids Actions' implicit success() check
    // propagating skipped npm ancestors through a successful release job.
    expect(homebrew?.if).toBe(
      `\${{ !cancelled() && needs.github-release.result == 'success' }}`
    );
  });

  test('stages assets on a draft before publishing and invokes Homebrew directly', () => {
    const workflow = readWorkflow('release.yml');
    const release = workflow.jobs?.['github-release'];
    const publish = release?.steps?.find(
      ({ name }) => name === 'Stage, populate, and publish GitHub release'
    );
    const script = publish?.run ?? '';

    expect(script).toContain('create_args=(--draft --latest=false)');
    expect(script.indexOf('gh release create')).toBeLessThan(
      script.indexOf('gh release upload')
    );
    expect(script.indexOf('gh release upload')).toBeLessThan(
      script.indexOf('gh release edit')
    );
    expect(release?.needs).toContain('stage-release-assets');

    const homebrew = workflow.jobs?.homebrew;
    expect(homebrew?.needs).toBe('github-release');
    expect(homebrew?.uses).toBe('./.github/workflows/publish-homebrew.yml');
    expect(homebrew?.with?.tag).toBe(releaseTag);
    expect(homebrew?.secrets?.HOMEBREW_TAP_TOKEN).toBe(homebrewTapToken);
  });

  test('reuses manual npm approval or asks once in a job with no npm privileges', () => {
    const workflow = readWorkflow('release.yml');
    const stage = workflow.jobs?.['stage-release-assets'];
    const publish = workflow.jobs?.['github-release'];

    expect(stage?.needs).toContain('release-assets');
    expect(stage?.if).toContain("needs.release-assets.result == 'success'");
    const approve = workflow.jobs?.['archive-approval'];
    expect(workflow.jobs?.publish?.needs).toContain('stage-release-assets');
    expect(approve?.needs).toContain('stage-release-assets');
    expect(approve?.environment?.name).toBe('npm');
    expect(approve?.permissions).toEqual({});
    expect(publish?.environment).toBeUndefined();
    expect(publish?.permissions).not.toHaveProperty('id-token');
    expect(publish?.if).toContain(
      "needs.publish.result == 'success' || needs.archive-approval.result == 'success'"
    );
  });

  test('requires the staged artifact from this attempt and verifies approval before upload', () => {
    const publish = readWorkflow('release.yml').jobs?.['github-release'];
    expect(publish?.if).toContain(
      'needs.stage-release-assets.outputs.attempt == github.run_attempt'
    );
    expect(
      publish?.steps?.find(({ uses }) => uses?.includes('download-artifact'))
        ?.with?.['artifact-ids']
    ).toBe(`\${{ needs.stage-release-assets.outputs.artifact_id }}`);
    const stepNames = publish?.steps?.map(({ name }) => name) ?? [];
    const verify = stepNames.indexOf('Verify exact archive approval');
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(verify).toBeLessThan(
      stepNames.indexOf('Stage, populate, and publish GitHub release')
    );
  });

  test('proves the checked-out tag version and release assets before tap checkout', () => {
    const workflow = readWorkflow('publish-homebrew.yml');
    const steps = workflow.jobs?.homebrew?.steps ?? [];
    const versionIndex = steps.findIndex(
      ({ name }) => name === 'Verify tag matches package version'
    );
    const validateIndex = steps.findIndex(
      ({ name }) => name === 'Validate published release assets'
    );
    const tapIndex = steps.findIndex(
      ({ name }) => name === 'Checkout Homebrew tap'
    );

    expect(workflow.on).toHaveProperty('release');
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.on).toHaveProperty('workflow_call');
    expect(versionIndex).toBeGreaterThan(-1);
    expect(steps[versionIndex]?.run).toContain('apps/trails/package.json');
    expect(validateIndex).toBeGreaterThan(versionIndex);
    expect(tapIndex).toBeGreaterThan(validateIndex);
    expect(steps[tapIndex]?.with?.repository).toBe(
      'outfitter-dev/homebrew-tap'
    );
    expect(steps[tapIndex]?.with?.token).toBe(homebrewTapToken);

    const openPr = steps.find(({ name }) => name === 'Open or update tap PR');
    const prBody = String(openPr?.with?.body ?? '');
    expect(openPr?.with?.draft).toBe('always-true');
    expect(prBody).toContain('Keep this pull request in draft');
    expect(prBody).toContain('Do not mark it ready or merge it through GitHub');
    expect(prBody).toContain(
      'dispatch the tap `brew pr-pull` workflow from `main`'
    );
    expect(prBody).toContain(
      'owns both landing the formula and publishing its bottles'
    );

    const serialized = JSON.stringify(workflow);
    expect(serialized).not.toContain('gh pr merge');
    expect(serialized).not.toContain('npm publish');
  });
});
