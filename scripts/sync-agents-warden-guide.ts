import { resolve } from 'node:path';

import type {
  WardenGuideManifest,
  WardenRuleConcern,
  WardenRuleGuideEntry,
} from '@ontrails/warden';
import { buildWardenGuideManifest } from '@ontrails/warden';

export const WARDEN_GUIDE_START = '<!-- warden-guide:start -->';
export const WARDEN_GUIDE_END = '<!-- warden-guide:end -->';

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

const renderGeneratedHeader = (
  manifest: WardenGuideManifest
): readonly string[] => [
  WARDEN_GUIDE_START,
  '<!-- GENERATED: run `bun run warden:agents:sync`; check with `bun run warden:agents:check`. -->',
  '',
  'This section is generated from the live `@ontrails/warden` rule manifest. Keep the human-authored guidance above as orientation; use this block as the enforceable-rule index.',
  '',
  `- Guide input command: \`bun apps/trails/bin/trails.ts warden guide --manifest\``,
  `- Rule count: ${manifest.ruleCount}`,
];

const groupRulesByConcern = (
  rules: readonly WardenRuleGuideEntry[]
): ReadonlyMap<WardenRuleConcern, readonly WardenRuleGuideEntry[]> => {
  const grouped = new Map<WardenRuleConcern, WardenRuleGuideEntry[]>();
  for (const rule of rules) {
    grouped.set(rule.concern, [...(grouped.get(rule.concern) ?? []), rule]);
  }
  return grouped;
};

const renderRule = (rule: WardenRuleGuideEntry): string =>
  `- \`${rule.id}\` (${rule.severity}, ${rule.depth}/${rule.tier}, ${rule.scope}): ${rule.invariant}`;

const renderCategorySections = (
  manifest: WardenGuideManifest
): readonly string[] => {
  const grouped = groupRulesByConcern(manifest.rules);
  const lines = ['', '### Rule Index', ''];

  for (const category of Object.keys(CATEGORY_LABELS) as WardenRuleConcern[]) {
    const rules = grouped.get(category) ?? [];
    if (rules.length === 0) {
      continue;
    }
    lines.push(`#### ${CATEGORY_LABELS[category]}`, '');
    lines.push(...rules.map(renderRule), '');
  }

  return lines;
};

const renderGuidedRule = (rule: WardenRuleGuideEntry): string =>
  `- \`${rule.id}\`: ${rule.guidance?.summary ?? ''}`;

const renderGuidanceSummaries = (
  manifest: WardenGuideManifest
): readonly string[] => {
  const guidedRules = manifest.rules.filter((rule) => rule.guidance);
  if (guidedRules.length === 0) {
    return [];
  }

  return [
    '### Structured Guidance Summaries',
    '',
    ...guidedRules.map(renderGuidedRule),
    '',
  ];
};

export const renderAgentsWardenGuideBlock = (
  manifest: WardenGuideManifest = buildWardenGuideManifest()
): string =>
  [
    ...renderGeneratedHeader(manifest),
    ...renderCategorySections(manifest),
    ...renderGuidanceSummaries(manifest),
    WARDEN_GUIDE_END,
  ].join('\n');

export const replaceAgentsWardenGuideBlock = (
  source: string,
  block: string
): string => {
  const start = source.indexOf(WARDEN_GUIDE_START);
  const end = source.indexOf(WARDEN_GUIDE_END, start);

  if (start !== -1 && end !== -1) {
    return `${source.slice(0, start)}${block}${source.slice(end + WARDEN_GUIDE_END.length)}`;
  }
  if (start !== -1 || end !== -1) {
    throw new Error(
      'sync-agents-warden-guide: found only one Warden guide marker; repair the generated block markers before syncing'
    );
  }

  const draftHeading = '\n## Draft State\n';
  const insertAt = source.indexOf(draftHeading);
  if (insertAt === -1) {
    throw new Error(
      'sync-agents-warden-guide: could not find "## Draft State" insertion point in AGENTS.md'
    );
  }

  const section = `\n## Warden Rule Guide\n\n${block}\n`;
  return `${source.slice(0, insertAt)}${section}${source.slice(insertAt)}`;
};

const run = async (): Promise<void> => {
  const check = process.argv.includes('--check');
  const agentsPath = resolve(process.cwd(), 'AGENTS.md');
  const source = await Bun.file(agentsPath).text();
  const expected = replaceAgentsWardenGuideBlock(
    source,
    renderAgentsWardenGuideBlock()
  );

  if (check) {
    if (source !== expected) {
      console.error(
        'sync-agents-warden-guide: AGENTS.md Warden guide block is out of date. Run `bun run warden:agents:sync`.'
      );
      process.exit(1);
    }
    return;
  }

  if (source !== expected) {
    await Bun.write(agentsPath, expected);
    console.log(`Wrote ${agentsPath}`);
  }
};

if (import.meta.main) {
  await run();
}
