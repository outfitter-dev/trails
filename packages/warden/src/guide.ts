import type {
  WardenGuidance,
  WardenGuidanceLink,
  WardenRuleConcern,
  WardenRuleLifecycle,
  WardenRuleScope,
  WardenRuleTier,
  WardenSeverity,
} from './rules/index.js';
import {
  listWardenRuleMetadata,
  wardenRules,
  wardenTopoRules,
} from './rules/index.js';
import type { WardenDepth } from './config.js';

export const wardenGuideFormatValues = [
  'markdown',
  'agent-json',
  'manifest',
] as const;

export type WardenGuideFormat = (typeof wardenGuideFormatValues)[number];

export interface WardenRuleGuideEntry {
  readonly concern: WardenRuleConcern;
  readonly depth: WardenDepth;
  readonly description: string;
  readonly docs: readonly WardenGuidanceLink[];
  readonly guidance?: WardenGuidance | undefined;
  readonly id: string;
  readonly invariant: string;
  readonly lifecycle: WardenRuleLifecycle;
  readonly scope: WardenRuleScope;
  readonly severity: WardenSeverity;
  readonly tier: WardenRuleTier;
}

export interface WardenGuideManifest {
  readonly generatedFrom: {
    readonly package: '@ontrails/warden';
    readonly registries: readonly ['wardenRules', 'wardenTopoRules'];
    readonly source: 'builtin-rule-metadata';
  };
  readonly kind: 'trails-warden-guide-manifest';
  readonly ruleCount: number;
  readonly rules: readonly WardenRuleGuideEntry[];
  readonly version: 1;
}

interface WardenAgentRuleGuide {
  readonly appliesAt: {
    readonly depth: WardenDepth;
    readonly scope: WardenRuleScope;
    readonly tier: WardenRuleTier;
  };
  readonly concern: WardenRuleConcern;
  readonly guidance?: WardenGuidance | undefined;
  readonly id: string;
  readonly invariant: string;
  readonly severity: WardenSeverity;
}

interface WardenAgentGuide {
  readonly instructions: readonly string[];
  readonly kind: 'trails-warden-agent-guide';
  readonly rules: readonly WardenAgentRuleGuide[];
  readonly version: 1;
}

const lookupRule = (id: string) =>
  wardenRules.get(id) ?? wardenTopoRules.get(id);

const compareRuleEntries = (
  [left]: readonly [string, unknown],
  [right]: readonly [string, unknown]
): number => left.localeCompare(right);

export const buildWardenGuideManifest = (): WardenGuideManifest => {
  const rules = listWardenRuleMetadata()
    .toSorted(compareRuleEntries)
    .map(([id, metadata]) => {
      const rule = lookupRule(id);
      const docs = metadata.guidance?.docs ?? [];
      return {
        concern: metadata.concern,
        depth: metadata.depth,
        description: rule?.description ?? '',
        docs,
        guidance: metadata.guidance,
        id,
        invariant: metadata.invariant,
        lifecycle: metadata.lifecycle,
        scope: metadata.scope,
        severity: rule?.severity ?? 'warn',
        tier: metadata.tier,
      } satisfies WardenRuleGuideEntry;
    });

  return {
    generatedFrom: {
      package: '@ontrails/warden',
      registries: ['wardenRules', 'wardenTopoRules'],
      source: 'builtin-rule-metadata',
    },
    kind: 'trails-warden-guide-manifest',
    ruleCount: rules.length,
    rules,
    version: 1,
  };
};

const formatGuideLink = (link: WardenGuidanceLink): string => {
  if (link.path) {
    return `[${link.label}](${link.path})`;
  }
  if (link.url) {
    return `[${link.label}](${link.url})`;
  }
  return link.label;
};

const renderOptionalList = (
  lines: string[],
  label: string,
  items: readonly string[] | undefined
): void => {
  if (items === undefined || items.length === 0) {
    return;
  }

  lines.push(`- ${label}:`);
  for (const [index, item] of items.entries()) {
    lines.push(`  ${index + 1}. ${item}`);
  }
};

const renderRuleMarkdown = (rule: WardenRuleGuideEntry): readonly string[] => {
  const lines = [
    `### \`${rule.id}\``,
    '',
    `- Severity: \`${rule.severity}\``,
    `- Concern: \`${rule.concern}\``,
    `- Depth: \`${rule.depth}\``,
    `- Tier: \`${rule.tier}\``,
    `- Scope: \`${rule.scope}\``,
    `- Lifecycle: \`${rule.lifecycle.state}\``,
    `- Invariant: ${rule.invariant}`,
    `- Description: ${rule.description}`,
  ];

  if (rule.lifecycle.retireWhen) {
    lines.push(`- Retire when: ${rule.lifecycle.retireWhen}`);
  }

  if (rule.guidance) {
    lines.push('', `Guidance: ${rule.guidance.summary}`);
    renderOptionalList(lines, 'Steps', rule.guidance.steps);
    renderOptionalList(lines, 'Commands', rule.guidance.commands);
    if (rule.docs.length > 0) {
      lines.push(`- Docs: ${rule.docs.map(formatGuideLink).join(', ')}`);
    }
    if (rule.guidance.relatedRules && rule.guidance.relatedRules.length > 0) {
      lines.push(
        `- Related rules: ${rule.guidance.relatedRules.map((id) => `\`${id}\``).join(', ')}`
      );
    }
  }

  return lines;
};

export const formatWardenGuideMarkdown = (
  manifest: WardenGuideManifest
): string => {
  const lines = [
    '# Trails Warden Guide',
    '',
    'Generated from `@ontrails/warden` built-in rule metadata and live rule registries.',
    '',
    '## Summary',
    '',
    `- Rules: ${manifest.ruleCount}`,
    `- Guided rules: ${manifest.rules.filter((rule) => rule.guidance).length}`,
    '',
    '## Rules',
    '',
  ];

  for (const rule of manifest.rules) {
    lines.push(...renderRuleMarkdown(rule), '');
  }

  return lines.join('\n').trimEnd();
};

export const buildWardenAgentGuide = (
  manifest: WardenGuideManifest
): WardenAgentGuide => ({
  instructions: [
    'Treat Warden rules as enforceable Trails doctrine when working in this repository.',
    'Prefer the rule guidance summary and ordered steps over diagnostic prose when deciding how to remediate a finding.',
    'When guidance is absent, use the invariant, concern, tier, and scope as classification metadata rather than inventing a rule-specific fix.',
  ],
  kind: 'trails-warden-agent-guide',
  rules: manifest.rules.map((rule) => ({
    appliesAt: {
      depth: rule.depth,
      scope: rule.scope,
      tier: rule.tier,
    },
    concern: rule.concern,
    guidance: rule.guidance,
    id: rule.id,
    invariant: rule.invariant,
    severity: rule.severity,
  })),
  version: 1,
});

export const formatWardenGuide = (
  manifest: WardenGuideManifest,
  format: WardenGuideFormat
): string => {
  if (format === 'markdown') {
    return formatWardenGuideMarkdown(manifest);
  }

  if (format === 'agent-json') {
    return JSON.stringify(buildWardenAgentGuide(manifest), null, 2);
  }

  return JSON.stringify(manifest, null, 2);
};
