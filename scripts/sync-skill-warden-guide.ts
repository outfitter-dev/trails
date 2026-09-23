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

export const SKILLSET_SKILL_WARDEN_GUIDE_PATH =
  '.skillset/skills/be-clark/references/warden-guide.md';
export const PLUGIN_SKILL_WARDEN_GUIDE_PATH =
  '.skillset/plugins/trails/skills/trails/references/warden-guide.md';
export const SKILL_WARDEN_GUIDE_PATHS = [
  SKILLSET_SKILL_WARDEN_GUIDE_PATH,
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
  '<!-- GENERATED from the bundled @ontrails/warden manifest. Do not edit. -->',
  '',
  'This file is generated from the `@ontrails/warden` rule manifest bundled with this skill. Skills, agents, and plugin prompts should reference this file instead of copying rule prose by hand.',
  '',
  '- Source: bundled `@ontrails/warden` rule manifest',
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
    "- Use the inspected project's governing guidance as higher-authority orientation when prose conflicts with generated rule summaries.",
    '- Do not manually duplicate the rule index into skill prompts. Refresh the bundled guide when Warden metadata changes.',
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

interface SyncSkillWardenGuidesOptions {
  readonly check?: boolean;
  readonly manifest?: WardenGuideManifest;
  readonly rootDir?: string;
}

export const syncSkillWardenGuides = async ({
  check = false,
  manifest = buildWardenGuideManifest(),
  rootDir = process.cwd(),
}: SyncSkillWardenGuidesOptions = {}): Promise<readonly string[]> => {
  const expected = renderSkillWardenGuide(manifest);
  let stale = false;
  const changedPaths: string[] = [];

  for (const guidePath of SKILL_WARDEN_GUIDE_PATHS) {
    const targetPath = resolve(rootDir, guidePath);
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
      changedPaths.push(guidePath);
      console.log(`Wrote ${targetPath}`);
    }
  }

  if (check && stale) {
    throw new Error('Warden skill guidance is out of date.');
  }

  return changedPaths;
};

const run = async (): Promise<void> => {
  try {
    await syncSkillWardenGuides({
      check: process.argv.includes('--check'),
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

if (import.meta.main) {
  await run();
}
