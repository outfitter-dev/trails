export interface VocabAuditRule {
  readonly id: string;
  readonly description: string;
  readonly excludePaths?: readonly string[];
  readonly pattern: string;
}

export const auditRoots = [
  'AGENTS.md',
  'README.md',
  'apps/',
  'docs/',
  'packages/',
  'plugin/',
  'scripts/',
] as const;

const scriptSelfExclusions = [
  'scripts/vocab-cutover-audit.ts',
  'scripts/vocab-cutover-map.ts',
  'scripts/vocab-cutover-rewrite.ts',
  'scripts/vocab-cutover-utils.ts',
] as const;

export const auditRules: readonly VocabAuditRule[] = [
  {
    description:
      'Old trail implementation field still uses run: arrow/function bodies instead of blaze:',
    excludePaths: ['packages/testing/src/harness-cli.ts'],
    id: 'run-field',
    pattern: String.raw`\brun\s*:\s*(?:(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|function\s*\()`,
  },
  {
    description: 'Old direct execution helper still uses dispatch(...)',
    id: 'dispatch-call',
    pattern: String.raw`\bdispatch\(`,
  },
  {
    description: 'Old composition declaration still uses follow: [...]',
    excludePaths: ['scripts/vocab-cutover-map.ts'],
    id: 'crosses-field',
    pattern: String.raw`\bfollow\s*:`,
  },
  {
    description: 'Old composition runtime still uses ctx.follow(...)',
    excludePaths: ['scripts/vocab-cutover-map.ts'],
    id: 'cross-call',
    pattern: String.raw`\bctx\.follow\(`,
  },
  {
    description:
      'Old infrastructure primitive still uses service(...) instead of resource(...)',
    id: 'service-factory',
    pattern: String.raw`\bservice\(`,
  },
  {
    description:
      'Old infrastructure declarations still use services: [...] instead of resources: [...]',
    id: 'services-field',
    pattern: String.raw`\bservices\s*:`,
  },
  {
    description:
      'Old notification primitive still uses event(...) instead of signal(...)',
    id: 'event-factory',
    pattern: String.raw`\bevent\(`,
  },
  {
    description:
      'Old notification runtime still uses ctx.emit(...) instead of ctx.fire(...)',
    id: 'emit-call',
    pattern: String.raw`\bctx\.emit\(`,
  },
  {
    // The noun is "signal"; the declaration field is `fires: [...]` (verb-form,
    // matching the runtime call `ctx.fire(...)`). Map rewrites the old
    // `emits: [...]` field name to the current `fires: [...]` field name.
    description:
      'Old notification declarations still use emits: [...] instead of fires: [...]',
    id: 'emits-field',
    pattern: String.raw`\bemits\s*:`,
  },
  {
    description:
      'Old activation syntax still uses trigger(...) instead of fires: [...]',
    id: 'trigger-call',
    pattern: String.raw`\btrigger\(`,
  },
  {
    description:
      'Semantic split from legacy consumer-side `fires:` to current `on:` requires manual review; mechanical matching is disabled.',
    excludePaths: ['docs/adr/drafts/20260401-entity-trail-factories.md'],
    id: 'on-field',
    pattern: String.raw`(?!)`,
  },
  {
    description:
      'Old domain factory still uses entity(...) instead of contour(...)',
    id: 'entity-factory',
    pattern: String.raw`\bentity\(`,
  },
  {
    description:
      'Old trailhead entrypoint still imports or calls the top-level blaze helper',
    id: 'blaze-call',
    pattern: String.raw`from\s+['"][^'"]*/blaze(?:\.js)?['"]|\bimport\s*{[^}]*\bblaze\b[^}]*}|\bexport\s*{[^}]*\bblaze\b[^}]*}`,
  },
  {
    description: 'Old telemetry package name still references crumbs',
    id: 'crumbs-term',
    pattern: String.raw`\bcrumbs\b|@ontrails/crumbs`,
  },
  {
    description: 'Old wrapper primitive still uses Gate instead of Layer',
    id: 'layer-type',
    pattern: String.raw`\bGate\b(?!\s+\d)`,
  },
  {
    description:
      'Old wrapper collections still use gates or middleware instead of layers',
    excludePaths: ['plugin/rules/vocabulary.md'],
    id: 'layers-term',
    pattern: String.raw`\bgates\b|\bmiddleware\b`,
  },
  {
    description:
      'Old boundary terminology still uses trailhead instead of surface',
    id: 'surface-term',
    pattern: String.raw`\b[Tt]railhead(s)?\b|TRAILHEAD_KEY|__trails_trailhead`,
  },
  {
    description:
      'Old integration terminology still uses adapter instead of connector',
    excludePaths: ['plugin/rules/vocabulary.md'],
    id: 'adapter-term',
    pattern: String.raw`\badapter\b|\badapters\b`,
  },
  {
    description:
      'Abort propagation still uses TrailContext.signal instead of abortSignal',
    id: 'abort-signal-field',
    pattern: String.raw`\bsignal\s*:\s*AbortSignal|readonly signal: AbortSignal`,
  },
] as const;

export const auditSelfExclusions = scriptSelfExclusions;
