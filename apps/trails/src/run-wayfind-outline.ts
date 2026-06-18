import { deriveOutputMode, output } from '@ontrails/cli';
import type { ActionResultContext } from '@ontrails/cli';
import { outlineOutputSchema } from '@ontrails/wayfinder';
import type { OutlineFeature, OutlineOutput } from '@ontrails/wayfinder';

const includesFeature = (
  outline: OutlineOutput,
  feature: OutlineFeature
): boolean => outline.features.included.includes(feature);

const formatLine = (
  line: number,
  kind: string,
  name: string,
  suffix = ''
): string => `${line.toString().padStart(4, ' ')}: ${kind} ${name}${suffix}`;

const appendGraphCount = (lines: string[], outline: OutlineOutput): void => {
  if (
    includesFeature(outline, 'graph') &&
    outline.counts.graphMatches !== undefined
  ) {
    lines.push(`  graph matches: ${outline.counts.graphMatches.toString()}`);
  }
};

const appendDiagnosticCount = (
  lines: string[],
  outline: OutlineOutput
): void => {
  if (
    includesFeature(outline, 'diagnostics') &&
    outline.counts.diagnostics > 0
  ) {
    lines.push(`  diagnostics: ${outline.counts.diagnostics.toString()}`);
  }
};

const appendSourceDeclarations = (
  lines: string[],
  outline: OutlineOutput
): void => {
  if (!includesFeature(outline, 'source')) {
    return;
  }
  const declarations = outline.source?.declarations ?? [];
  if (declarations.length === 0) {
    return;
  }
  lines.push('');
  for (const declaration of declarations.slice(0, 40)) {
    lines.push(
      formatLine(declaration.line, declaration.kind, declaration.name)
    );
  }
};

type TrailOutline = NonNullable<OutlineOutput['trails']>[number];

const contractFactLabel = (
  contracts: TrailOutline['contracts']
): string | undefined => {
  if (contracts === undefined) {
    return undefined;
  }
  if (contracts.input && contracts.output) {
    return 'input+output';
  }
  if (contracts.input) {
    return 'input';
  }
  if (contracts.output) {
    return 'output';
  }
  return 'no schemas';
};

const exampleCountLabel = (count: number): string =>
  `${count.toString()} ${count === 1 ? 'example' : 'examples'}`;

const trailFactSuffix = (trail: TrailOutline): string => {
  const facts = [
    trail.graph?.intent,
    contractFactLabel(trail.contracts),
    trail.graph === undefined
      ? undefined
      : exampleCountLabel(trail.graph.exampleCount),
  ].filter((fact): fact is string => fact !== undefined);

  return facts.length === 0 ? '' : ` (${facts.join(', ')})`;
};

const appendTrails = (lines: string[], outline: OutlineOutput): void => {
  if (!includesFeature(outline, 'trails')) {
    return;
  }
  const trails = outline.trails ?? [];
  if (trails.length === 0) {
    return;
  }
  lines.push('');
  for (const trail of trails) {
    lines.push(
      formatLine(trail.line, 'trail', trail.id, trailFactSuffix(trail))
    );
  }
};

const appendApps = (lines: string[], outline: OutlineOutput): void => {
  if (!includesFeature(outline, 'apps')) {
    return;
  }
  const apps = outline.apps ?? [];
  if (apps.length === 0) {
    return;
  }
  lines.push('');
  for (const app of apps) {
    lines.push(formatLine(app.line, 'app', app.name, ` (${app.callee})`));
  }
};

const appendDiagnostics = (lines: string[], outline: OutlineOutput): void => {
  if (!includesFeature(outline, 'diagnostics')) {
    return;
  }
  for (const diagnostic of outline.diagnostics ?? []) {
    lines.push(
      `  ${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}`
    );
  }
};

export const formatWayfindOutlineText = (outline: OutlineOutput): string => {
  const lines = [
    outline.file,
    `  trails: ${outline.counts.trails.toString()}`,
    `  apps: ${outline.counts.apps.toString()}`,
    `  declarations: ${outline.counts.declarations.toString()}`,
  ];

  appendGraphCount(lines, outline);
  appendDiagnosticCount(lines, outline);
  appendSourceDeclarations(lines, outline);
  appendTrails(lines, outline);
  appendApps(lines, outline);
  appendDiagnostics(lines, outline);

  return lines.join('\n');
};

export const tryWayfindOutlineOutput = (ctx: ActionResultContext): boolean => {
  if (ctx.trail.id !== 'wayfind.outline' || ctx.result.isErr()) {
    return false;
  }
  const { mode } = deriveOutputMode(ctx.flags, ctx.topoName);
  if (mode !== 'text') {
    return false;
  }
  const parsed = outlineOutputSchema.safeParse(ctx.result.value);
  if (!parsed.success) {
    return false;
  }
  output(formatWayfindOutlineText(parsed.data), mode);
  return true;
};
