import { resolve } from 'node:path';

import type {
  WardenGuideManifest,
  WardenRuleConcern,
  WardenRuleGuideEntry,
} from '@ontrails/warden';
import {
  buildWardenAgentGuide,
  buildWardenGuideManifest,
} from '@ontrails/warden';

export const CLAUDE_SKILL_WARDEN_GUIDE_PATH =
  '.claude/skills/clark/references/warden-guide.md';
export const AGENTS_SKILL_WARDEN_GUIDE_PATH =
  '.agents/skills/clark/references/warden-guide.md';
export const PLUGIN_SKILL_WARDEN_GUIDE_PATH =
  'plugin/skills/trails/references/warden-guide.md';
export const SKILL_WARDEN_GUIDE_PATHS = [
  CLAUDE_SKILL_WARDEN_GUIDE_PATH,
  AGENTS_SKILL_WARDEN_GUIDE_PATH,
  PLUGIN_SKILL_WARDEN_GUIDE_PATH,
] as const;

const CATEGORY_LABELS: Record<WardenRuleConcern, string> = {
  composition: 'Composition',
  general: 'General',
  lifecycle: 'Lifecycle',
  meta: 'Meta',
  permits: 'Permits',
  resources: 'Resources',
  results: 'Results',
  signals: 'Signals',
};

const groupRulesByConcern = (
  rules: readonly WardenRuleGuideEntry[]
): ReadonlyMap<WardenRuleConcern, readonly WardenRuleGuideEntry[]> => {
  const grouped = new Map<WardenRuleConcern, WardenRuleGuideEntry[]>();
  for (const rule of rules) {
    grouped.set(rule.concern, [...(grouped.get(rule.concern) ?? []), rule]);
  }
  return grouped;
};

const renderGeneratedHeader = (
  manifest: WardenGuideManifest
): readonly string[] => [
  '# Warden Guidance For Trails Skills',
  '',
  '<!-- GENERATED: run `bun run warden:skills:sync`; check with `bun run warden:skills:check`. -->',
  '',
  'This file is generated from the live `@ontrails/warden` rule manifest. Repo-tracked skills, agents, and plugin prompts should reference this file instead of copying rule prose by hand.',
  '',
  `- Guide input command: \`bun apps/trails/bin/trails.ts warden guide --agent-json\``,
  `- Rule count: ${manifest.ruleCount}`,
  '',
];

const renderAgentInstructions = (
  manifest: WardenGuideManifest
): readonly string[] => {
  const guide = buildWardenAgentGuide(manifest);

  return [
    '## Agent Instructions',
    '',
    ...guide.instructions.map((instruction) => `- ${instruction}`),
    '- Treat `docs/tenets.md`, `docs/lexicon.md`, and `AGENTS.md` as higher-authority orientation when prose conflicts with generated rule summaries.',
    '- Do not manually duplicate the rule index into skill prompts. Refresh this file when Warden metadata changes.',
    '',
  ];
};

const renderRule = (rule: WardenRuleGuideEntry): string => {
  const guidance = rule.guidance ? ` Guidance: ${rule.guidance.summary}` : '';

  return `- \`${rule.id}\` (${rule.severity}, ${rule.depth}/${rule.tier}, ${rule.scope}): ${rule.invariant}${guidance}`;
};

const renderRuleIndex = (manifest: WardenGuideManifest): readonly string[] => {
  const grouped = groupRulesByConcern(manifest.rules);
  const lines = ['## Rule Index', ''];

  for (const category of Object.keys(CATEGORY_LABELS) as WardenRuleConcern[]) {
    const rules = grouped.get(category) ?? [];
    if (rules.length === 0) {
      continue;
    }
    lines.push(`### ${CATEGORY_LABELS[category]}`, '');
    lines.push(...rules.map(renderRule), '');
  }

  return lines;
};

export const renderSkillWardenGuide = (
  manifest: WardenGuideManifest = buildWardenGuideManifest()
): string =>
  `${[
    ...renderGeneratedHeader(manifest),
    ...renderAgentInstructions(manifest),
    ...renderRuleIndex(manifest),
  ]
    .join('\n')
    .trimEnd()}\n`;

export const isSkillWardenGuideCurrent = (
  source: string,
  manifest: WardenGuideManifest = buildWardenGuideManifest()
): boolean => source === renderSkillWardenGuide(manifest);

const readCurrentGuide = async (targetPath: string): Promise<string> => {
  const target = Bun.file(targetPath);
  if (!(await target.exists())) {
    return '';
  }
  return target.text();
};

const run = async (): Promise<void> => {
  const check = process.argv.includes('--check');
  const expected = renderSkillWardenGuide();
  let stale = false;

  for (const guidePath of SKILL_WARDEN_GUIDE_PATHS) {
    const targetPath = resolve(process.cwd(), guidePath);
    const source = await readCurrentGuide(targetPath);

    if (check) {
      if (source !== expected) {
        stale = true;
        console.error(
          `sync-skill-warden-guide: ${guidePath} is out of date. Run \`bun run warden:skills:sync\`.`
        );
      }
      continue;
    }

    if (source !== expected) {
      await Bun.write(targetPath, expected);
      console.log(`Wrote ${targetPath}`);
    }
  }

  if (check && stale) {
    process.exit(1);
  }
};

if (import.meta.main) {
  await run();
}
