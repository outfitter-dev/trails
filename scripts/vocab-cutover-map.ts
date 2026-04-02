export interface VocabAuditRule {
  readonly id: string;
  readonly description: string;
  readonly pattern: string;
}

export const auditRoots = ['README.md', 'apps/', 'docs/', 'packages/'] as const;

export const auditRules: readonly VocabAuditRule[] = [
  {
    description:
      'Old trail implementation field still uses run: instead of blaze:',
    id: 'run-field',
    pattern: String.raw`\brun\s*:`,
  },
  {
    description: 'Old direct execution helper still uses dispatch(...)',
    id: 'dispatch-call',
    pattern: String.raw`\bdispatch\(`,
  },
  {
    description: 'Old composition declaration still uses follow: [...]',
    id: 'follow-field',
    pattern: String.raw`\bfollow\s*:`,
  },
  {
    description: 'Old composition runtime still uses ctx.follow(...)',
    id: 'follow-call',
    pattern: String.raw`\bctx\.follow\(`,
  },
  {
    description: 'Old infrastructure primitive still uses service(...)',
    id: 'service-factory',
    pattern: String.raw`\bservice\(`,
  },
  {
    description: 'Old infrastructure declarations still use services: [...]',
    id: 'services-field',
    pattern: String.raw`\bservices\s*:`,
  },
  {
    description: 'Old notification primitive still uses event(...)',
    id: 'event-factory',
    pattern: String.raw`\bevent\(`,
  },
  {
    description: 'Old surface entrypoint still uses blaze(...)',
    id: 'blaze-call',
    pattern: String.raw`\bblaze\(`,
  },
  {
    description: 'Old telemetry package name still references crumbs',
    id: 'crumbs-term',
    pattern: String.raw`\bcrumbs\b|@ontrails/crumbs`,
  },
  {
    description: 'Old wrapper primitive still uses Layer',
    id: 'layer-type',
    pattern: String.raw`\bLayer\b`,
  },
  {
    description: 'Old wrapper collections still use layers',
    excludePaths: ['plugin/rules/vocabulary.md'],
    id: 'layers-term',
    pattern: String.raw`\blayers\b`,
  },
  {
    description: 'Old transport terminology still uses surface',
    excludePaths: ['docs/vocabulary.md'],
    id: 'surface-term',
    pattern: String.raw`\bsurface\b|\bsurfaces\b|SURFACE_KEY`,
  },
  {
    description: 'Old integration terminology still uses adapter',
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
