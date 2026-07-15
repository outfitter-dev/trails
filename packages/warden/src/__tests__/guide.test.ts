import { describe, expect, test } from 'bun:test';

import {
  buildWardenAgentGuide,
  buildWardenGuideManifest,
  formatWardenGuide,
  formatWardenGuideMarkdown,
} from '../guide.js';

describe('warden guide manifest', () => {
  test('projects live Warden rule metadata into a deterministic manifest', () => {
    const manifest = buildWardenGuideManifest();
    const ids = manifest.rules.map((rule) => rule.id);

    expect(manifest.kind).toBe('trails-warden-guide-manifest');
    expect(manifest.ruleCount).toBe(manifest.rules.length);
    expect(ids).toEqual([...ids].toSorted());

    const throwRule = manifest.rules.find(
      (rule) => rule.id === 'no-throw-in-implementation'
    );
    expect(throwRule).toMatchObject({
      concern: 'results',
      depth: 'source',
      severity: 'error',
      tier: 'source-static',
    });
    expect(throwRule).not.toHaveProperty('category');
    expect(throwRule?.guidance?.summary).toBe(
      'Convert thrown failures in implementations into explicit Result.err() outcomes.'
    );
  });

  test('markdown rendering includes stable guidance sections', () => {
    const markdown = formatWardenGuideMarkdown(buildWardenGuideManifest());

    expect(markdown).toContain('# Trails Warden Guide');
    expect(markdown).toContain('### `no-throw-in-implementation`');
    expect(markdown).toContain('- Concern: `results`');
    expect(markdown).not.toContain('- Category: `results`');
    expect(markdown).toContain(
      'Guidance: Convert thrown failures in implementations into explicit Result.err() outcomes.'
    );
    expect(markdown).toContain('- Docs: [Trail Rules](AGENTS.md#trail-rules)');
  });

  test('projects Regrade-first governed transition guidance', () => {
    const rule = buildWardenGuideManifest().rules.find(
      (candidate) => candidate.id === 'governed-symbol-residue'
    );

    expect(rule).toMatchObject({
      guidance: {
        summary:
          'Require committed Regrade evidence before completing a governed vocabulary migration.',
      },
      tier: 'source-static',
    });
    expect(rule?.guidance?.steps).toContain(
      'Use manual edits only for review or cleanup after Regrade exhausts the safe slice.'
    );
  });

  test('agent-json rendering is stable and parseable', () => {
    const manifest = buildWardenGuideManifest();
    const agentGuide = buildWardenAgentGuide(manifest);
    const formatted = formatWardenGuide(manifest, 'agent-json');
    const parsed = JSON.parse(formatted) as typeof agentGuide;

    expect(parsed.kind).toBe('trails-warden-agent-guide');
    expect(parsed.rules).toHaveLength(manifest.ruleCount);
    expect(parsed.rules[0]?.id).toBe(manifest.rules[0]?.id);
    expect(parsed.rules[0]).toHaveProperty('concern');
    expect(parsed.rules[0]).not.toHaveProperty('category');
  });

  test('manifest rendering is stable and parseable', () => {
    const manifest = buildWardenGuideManifest();
    const formatted = formatWardenGuide(manifest, 'manifest');
    const parsed = JSON.parse(formatted) as typeof manifest;

    expect(parsed.kind).toBe('trails-warden-guide-manifest');
    expect(parsed.ruleCount).toBe(manifest.ruleCount);
    expect(parsed.rules.at(-1)?.id).toBe(manifest.rules.at(-1)?.id);
    expect(parsed.rules.at(-1)).toHaveProperty('concern');
    expect(parsed.rules.at(-1)).not.toHaveProperty('category');
  });

  test('projects rule fix capability faithfully (TRL-831/832)', () => {
    // The fix field projects exactly the rules that declare a capability.
    // no-legacy-layer-imports is the first fixable rule (TRL-832): a
    // review-required term-rewrite. Rules without a capability omit the field.
    const manifest = buildWardenGuideManifest();

    const legacy = manifest.rules.find(
      (rule) => rule.id === 'no-legacy-layer-imports'
    );
    expect(legacy?.fix).toEqual({ class: 'term-rewrite', safety: 'review' });
    expect(
      buildWardenAgentGuide(manifest).rules.find(
        (rule) => rule.id === 'no-legacy-layer-imports'
      )?.fix
    ).toEqual({ class: 'term-rewrite', safety: 'review' });

    const throwRule = manifest.rules.find(
      (rule) => rule.id === 'no-throw-in-implementation'
    );
    expect(throwRule?.fix).toBeUndefined();

    // A fixable rule advertises a Fix line in the rendered guide markdown.
    expect(formatWardenGuideMarkdown(manifest)).toContain(
      '- Fix: `term-rewrite`'
    );
  });
});
