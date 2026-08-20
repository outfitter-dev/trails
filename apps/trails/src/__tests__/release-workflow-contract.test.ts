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
    expect(release?.needs).toContain('release-assets');

    const homebrew = workflow.jobs?.homebrew;
    expect(homebrew?.needs).toBe('github-release');
    expect(homebrew?.uses).toBe('./.github/workflows/publish-homebrew.yml');
    expect(homebrew?.with?.tag).toBe(releaseTag);
    expect(homebrew?.secrets?.HOMEBREW_TAP_TOKEN).toBe(homebrewTapToken);
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

    const serialized = JSON.stringify(workflow);
    expect(serialized).not.toContain('gh pr merge');
    expect(serialized).not.toContain('npm publish');
  });
});
