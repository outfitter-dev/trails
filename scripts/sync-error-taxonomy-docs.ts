import {
  codesByCategory,
  errorCategories,
  errorClasses,
  retryableMap,
} from '@ontrails/core';
import type {
  DynamicErrorClassRegistryEntry,
  ErrorCategory,
  ErrorClassRegistryEntry,
  FixedErrorClassRegistryEntry,
} from '@ontrails/core';

const START = '<!-- error-taxonomy:start -->';
const END = '<!-- error-taxonomy:end -->';

type Variant = 'behavior' | 'category' | 'class' | 'http';

const targets: readonly {
  readonly path: string;
  readonly variant: Variant;
}[] = [
  { path: 'docs/architecture.md', variant: 'category' },
  { path: 'docs/surfaces/http.md', variant: 'http' },
  { path: 'packages/core/README.md', variant: 'category' },
  {
    path: 'docs/adr/0002-built-in-result-type.md',
    variant: 'class',
  },
  {
    path: 'docs/adr/0026-error-taxonomy-as-transport-independent-behavior-contract.md',
    variant: 'behavior',
  },
];

const isCheck = process.argv.includes('--check');

const isFixedEntry = (
  entry: ErrorClassRegistryEntry
): entry is FixedErrorClassRegistryEntry => entry.category !== 'dynamic';

const fixedEntries = errorClasses.filter(isFixedEntry);
const dynamicEntries = errorClasses.filter(
  (entry): entry is DynamicErrorClassRegistryEntry =>
    entry.category === 'dynamic'
);

const boolLabel = (value: boolean): 'No' | 'Yes' => (value ? 'Yes' : 'No');

const classesForCategory = (category: ErrorCategory): string =>
  fixedEntries
    .filter((entry) => entry.category === category)
    .map((entry) => `\`${entry.name}\``)
    .join(', ');

const queueBehaviorForCategory = (category: ErrorCategory): string => {
  if (category === 'cancelled') {
    return 'nack -> discard';
  }
  if (category === 'rate_limit') {
    return 'nack -> retry (with backoff)';
  }
  if (retryableMap[category]) {
    return 'nack -> retry';
  }
  return 'nack -> dead-letter';
};

const signalBehaviorForCategory = (category: ErrorCategory): string => {
  if (category === 'cancelled') {
    return 'discard';
  }
  if (category === 'rate_limit') {
    return 'retry (with backoff)';
  }
  if (retryableMap[category]) {
    return 'retry';
  }
  return 'drop + dead-event';
};

const renderDynamicBehaviorRows = (): readonly string[] =>
  dynamicEntries.map(
    (entry) =>
      `| \`${entry.name}\` | wrapped error category | ${boolLabel(entry.retryable)} | wrapped status | wrapped exit | wrapped code | wrapped category behavior | wrapped category behavior |`
  );

const renderDynamicNotes = (): readonly string[] => [
  '',
  'Dynamic classes:',
  ...dynamicEntries.map(
    (entry) =>
      `- \`${entry.name}\` inherits category and surface codes from its wrapped \`TrailsError\`; retryable is always ${boolLabel(entry.retryable)}.`
  ),
];

const renderHeader = (variant: Variant): readonly string[] => [
  START,
  `<!-- GENERATED: run \`bun run error-taxonomy:sync\`; check with \`bun run error-taxonomy:check\`. Variant: ${variant}. -->`,
  '',
];

const renderCategoryBlock = (): string =>
  [
    ...renderHeader('category'),
    '| Category | CLI Exit | HTTP | JSON-RPC | Retryable | Fixed Classes |',
    '| --- | --- | --- | --- | --- | --- |',
    ...errorCategories.map((category) => {
      const codes = codesByCategory[category];
      return `| \`${category}\` | ${codes.exit} | ${codes.http} | ${codes.jsonRpc} | ${boolLabel(retryableMap[category])} | ${classesForCategory(category)} |`;
    }),
    ...renderDynamicNotes(),
    END,
  ].join('\n');

const renderHttpBlock = (): string =>
  [
    ...renderHeader('http'),
    '| Category | HTTP Status | Retryable | Fixed Classes |',
    '| --- | --- | --- | --- |',
    ...errorCategories.map((category) => {
      const codes = codesByCategory[category];
      return `| \`${category}\` | ${codes.http} | ${boolLabel(retryableMap[category])} | ${classesForCategory(category)} |`;
    }),
    ...renderDynamicNotes(),
    END,
  ].join('\n');

const renderClassBlock = (): string =>
  [
    ...renderHeader('class'),
    '| Error class | Category | HTTP | CLI Exit | JSON-RPC | Retryable |',
    '| --- | --- | --- | --- | --- | --- |',
    ...fixedEntries.map((entry) => {
      const codes = codesByCategory[entry.category];
      return `| \`${entry.name}\` | \`${entry.category}\` | ${codes.http} | ${codes.exit} | ${codes.jsonRpc} | ${boolLabel(entry.retryable)} |`;
    }),
    ...renderDynamicNotes(),
    END,
  ].join('\n');

const renderBehaviorBlock = (): string =>
  [
    ...renderHeader('behavior'),
    '| Error class | Category | Retryable | HTTP | CLI | JSON-RPC | Queue | Signal delivery |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...fixedEntries.map((entry) => {
      const codes = codesByCategory[entry.category];
      return `| \`${entry.name}\` | \`${entry.category}\` | ${boolLabel(entry.retryable)} | ${codes.http} | ${codes.exit} | ${codes.jsonRpc} | ${queueBehaviorForCategory(entry.category)} | ${signalBehaviorForCategory(entry.category)} |`;
    }),
    ...renderDynamicBehaviorRows(),
    END,
  ].join('\n');

const renderBlock = (variant: Variant): string => {
  switch (variant) {
    case 'behavior': {
      return renderBehaviorBlock();
    }
    case 'category': {
      return renderCategoryBlock();
    }
    case 'class': {
      return renderClassBlock();
    }
    case 'http': {
      return renderHttpBlock();
    }
    default: {
      const exhaustive: never = variant;
      throw new Error(`Unknown error taxonomy docs variant: ${exhaustive}`);
    }
  }
};

const replaceBlock = (
  source: string,
  expected: string,
  path: string
): string => {
  const start = source.indexOf(START);
  const end = source.indexOf(END, start);
  if (start === -1 || end === -1) {
    throw new Error(
      `sync-error-taxonomy-docs: ${path} is missing error taxonomy block markers`
    );
  }
  return `${source.slice(0, start)}${expected}${source.slice(end + END.length)}`;
};

let failed = false;

for (const target of targets) {
  const file = Bun.file(target.path);
  const source = await file.text();
  const expected = renderBlock(target.variant);
  const updated = replaceBlock(source, expected, target.path);

  if (isCheck) {
    if (updated !== source) {
      console.error(
        `sync-error-taxonomy-docs: ${target.path} is out of date. Run \`bun run error-taxonomy:sync\`.`
      );
      failed = true;
    }
    continue;
  }

  if (updated !== source) {
    await Bun.write(target.path, updated);
    console.log(`Wrote ${target.path}`);
  }
}

if (failed) {
  process.exit(1);
}
