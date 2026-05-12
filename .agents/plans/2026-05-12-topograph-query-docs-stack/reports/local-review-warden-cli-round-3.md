# Local Review Round 3 - Warden/CLI Polish Lane

Date: 2026-05-12
Cwd: `/Users/mg/Developer/outfitter/trails`
Stack tip reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements` at `971ccec06`

Scope reviewed: TRL-692, TRL-690, TRL-691, TRL-693, and TRL-694 at the current stack tip. The current tree has `packages/warden/src/guide.ts`; there is no `packages/warden/src/guide/` directory.

## Result

P3-only. No P0/P1/P2 remain in this lane.

The concern/category manifest rename is coherent, generated guide source-of-truth is current, focused guide/header/CLI/resource tests pass, non-Commander value-alias conflicts fail loudly, and static resource accessor suppression is limited to the resolved helper name being shadowed. I found one non-blocking schema-drift cleanup to consider in TRL-690.

## Findings

| Severity | Owning branch | Finding | Recommended action |
| --- | --- | --- | --- |
| P3 | `trl-690-polish-warden-guidance-link-rendering-and-schema-reuse` | The `warden.guide` app trail still carries local Zod copies of Warden guide/guidance schema shape while the package owns the corresponding guide manifest TypeScript shape and guidance schemas. Current behavior is passing, but this leaves future manifest or guidance-link additions dependent on humans remembering to update the app schema. | After the stack is otherwise clear, consider exporting a package-owned `wardenGuideManifestSchema` or at least public `guidanceLinkSchema` / `guidanceSchema` from `@ontrails/warden`, then reuse it in `apps/trails/src/trails/warden-guide.ts`. Add an app-level output-schema parse test for the manifest returned by `buildWardenGuideManifest()`. |

No P0/P1/P2 findings.

## Evidence

### Predicate 1 - manifest taxonomy uses `concern`

`packages/warden/src/guide.ts:25-36`

```ts
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
```

`packages/warden/src/guide.ts:85-97`

```ts
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
```

`packages/warden/src/__tests__/guide.test.ts:22-29`

```ts
expect(throwRule).toMatchObject({
  concern: 'results',
  depth: 'source',
  severity: 'error',
  tier: 'source-static',
});
expect(throwRule).not.toHaveProperty('category');
```

Command output:

```text
$ bun apps/trails/bin/trails.ts warden guide --manifest | jq '.rules[0] | keys, has("category"), has("concern")'
[
  "concern",
  "depth",
  "description",
  "docs",
  "id",
  "invariant",
  "lifecycle",
  "scope",
  "severity",
  "tier"
]
false
true
```

### Predicate 2 - guide rendering and schema reuse

The plain Warden report link rendering keeps both useful labels and copyable targets.

`packages/warden/src/cli.ts:1327-1333`

```ts
const formatPlainGuidanceLink = (link: WardenGuidanceLink): string => {
  const target = link.path ?? link.url;
  if (target === undefined || target === link.label) {
    return link.label;
  }
  return `${link.label} (${target})`;
};
```

`packages/warden/src/__tests__/cli.test.ts:1161-1191`

```ts
test('formats guidance docs with labels and copyable targets in the lint section', () => {
  const output = formatWardenReport({
    diagnostics: [
      {
        filePath: 'src/trails/entity.ts',
        guidance: {
          docs: [
            { label: 'Trail Rules', path: 'AGENTS.md#trail-rules' },
            {
              label: 'Warden docs',
              url: 'https://docs.example.test/warden',
            },
            { label: 'Label-only reference' },
          ],
          summary: 'Use the Warden guidance.',
        },
```

The app `warden` trail reuses the shared diagnostic schema instead of duplicating the diagnostic/guidance shape.

`apps/trails/src/trails/warden.ts:8-16`

```ts
import {
  diagnosticSchema,
  runWardenCommand,
  wardenDepthValues,
  wardenDraftsValues,
  wardenFailOnValues,
  wardenFormatValues,
  wardenLockValues,
} from '@ontrails/warden';
```

`apps/trails/src/trails/warden.ts:178-181`

```ts
output: z.object({
  diagnostics: z.array(
    diagnosticSchema.extend({ topoName: z.string().optional() })
  ),
```

P3 evidence: `warden.guide` still duplicates schema shape locally.

`apps/trails/src/trails/warden-guide.ts:15-27`

```ts
const wardenGuidanceLinkSchema = z.object({
  label: z.string(),
  path: z.string().optional(),
  url: z.string().optional(),
});

const wardenGuidanceSchema = z.object({
  commands: z.array(z.string()).readonly().optional(),
  docs: z.array(wardenGuidanceLinkSchema).readonly().optional(),
  relatedRules: z.array(z.string()).readonly().optional(),
  steps: z.array(z.string()).readonly().optional(),
  summary: z.string(),
});
```

`apps/trails/src/trails/warden-guide.ts:46-59`

```ts
const wardenGuideManifestSchema = z.object({
  generatedFrom: z.object({
    package: z.literal('@ontrails/warden'),
    registries: z.tuple([
      z.literal('wardenRules'),
      z.literal('wardenTopoRules'),
    ]),
    source: z.literal('builtin-rule-metadata'),
  }),
  kind: z.literal('trails-warden-guide-manifest'),
  ruleCount: z.number(),
  rules: z.array(wardenRuleGuideEntrySchema).readonly(),
  version: z.literal(1),
});
```

The package already owns adjacent guidance schemas and the guide manifest type/builder.

`packages/warden/src/trails/schema.ts:13-25`

```ts
export const guidanceLinkSchema = z.object({
  label: z.string(),
  path: z.string().optional(),
  url: z.string().optional(),
});

export const guidanceSchema = z.object({
  commands: z.array(z.string()).readonly().optional(),
  docs: z.array(guidanceLinkSchema).readonly().optional(),
  relatedRules: z.array(z.string()).readonly().optional(),
  steps: z.array(z.string()).readonly().optional(),
  summary: z.string(),
});
```

`packages/warden/src/guide.ts:39-49`

```ts
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
```

### Predicate 3 - generated guide headers and orphan markers

`scripts/sync-agents-warden-guide.ts:24-33`

```ts
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
```

`scripts/__tests__/sync-agents-warden-guide.test.ts:38-50`

```ts
test('renders a generated block from the Warden manifest', () => {
  const block = renderAgentsWardenGuideBlock(manifestFixture);

  expect(block).toStartWith(WARDEN_GUIDE_START);
  expect(block).toContain(
    '- Guide input command: `bun apps/trails/bin/trails.ts warden guide --manifest`'
  );
  expect(block).toContain('- Rule count: 1');
  expect(block).toContain('#### Results');
  expect(block).toMatch(
    /- `no-throw-in-implementation` \(error, source\/source-static, external\): Trail implementations return Result values\./
  );
  expect(block).toEndWith(WARDEN_GUIDE_END);
});
```

`scripts/__tests__/sync-agents-warden-guide.test.ts:115-129`

```ts
test('rejects orphaned end-only generated block markers', () => {
  const replacement = `${WARDEN_GUIDE_START}\nnew\n${WARDEN_GUIDE_END}`;
  const source = [
    '# AGENTS.md',
    '',
    WARDEN_GUIDE_END,
    '',
    '## Draft State',
    '',
    'Drafts.',
  ].join('\n');

  expect(() => replaceAgentsWardenGuideBlock(source, replacement)).toThrow(
    'found only one Warden guide marker'
  );
});
```

Checked-in generated guide blocks point at the right source commands.

`AGENTS.md:85-91`

```md
<!-- warden-guide:start -->
<!-- GENERATED: run `bun run warden:agents:sync`; check with `bun run warden:agents:check`. -->

This section is generated from the live `@ontrails/warden` rule manifest. Keep the human-authored guidance above as orientation; use this block as the enforceable-rule index.

- Guide input command: `bun apps/trails/bin/trails.ts warden guide --manifest`
- Rule count: 49
```

`.claude/skills/clark/references/warden-guide.md:3-8`

```md
<!-- GENERATED: run `bun run warden:skills:sync`; check with `bun run warden:skills:check`. -->

This file is generated from the live `@ontrails/warden` rule manifest. Repo-tracked skills, agents, and plugin prompts should reference this file instead of copying rule prose by hand.

- Guide input command: `bun apps/trails/bin/trails.ts warden guide --agent-json`
- Rule count: 49
```

`plugin/skills/trails/references/warden-guide.md:3-8`

```md
<!-- GENERATED: run `bun run warden:skills:sync`; check with `bun run warden:skills:check`. -->

This file is generated from the live `@ontrails/warden` rule manifest. Repo-tracked skills, agents, and plugin prompts should reference this file instead of copying rule prose by hand.

- Guide input command: `bun apps/trails/bin/trails.ts warden guide --agent-json`
- Rule count: 49
```

### Predicate 4 - non-Commander value alias conflicts

`packages/cli/src/flags.ts:186-204`

```ts
const canonicalKey = toCamel(flag.name);
// Adapters should pass the exact user-supplied key set when they preserve
// defaulted canonical values in parsed flags. Without that set, an active
// value alias plus any parsed canonical key is ambiguous and must fail
// loudly instead of guessing whether the canonical value was a default.
const canonicalWasSupplied =
  userSuppliedFlagKeys?.has(canonicalKey) ??
  Object.hasOwn(normalized, canonicalKey);
const [activeAlias] = activeAliases;
if (!activeAlias) {
  continue;
}
if (canonicalWasSupplied) {
  throw new ValidationError(
    `CLI flag "--${flag.name}" cannot be combined with value alias "--${activeAlias.name}"`
  );
}

normalized[canonicalKey] = activeAlias.value;
```

`packages/cli/src/__tests__/flags.test.ts:147-160`

```ts
test('rejects ambiguous canonical defaults combined with aliases without caller-supplied key tracking', () => {
  const flags = deriveFlags(
    z.object({ outputFormat: z.enum(['json', 'text']).default('text') }),
    { outputFormat: { aliases: { json: 'json-output' } } }
  );

  expect(() =>
    applyCliFlagValueAliases(flags, {
      jsonOutput: true,
      outputFormat: 'text',
    })
  ).toThrow(
    'CLI flag "--output-format" cannot be combined with value alias "--json-output"'
  );
});
```

`adapters/commander/src/to-commander.ts:175-185`

```ts
const getUserSuppliedFlagKeys = (
  command: Command,
  flags: readonly CliCommand['flags'][number][]
): ReadonlySet<string> => {
  const userSupplied = new Set<string>();
  for (const key of getFlagOptionKeys(flags)) {
    if (isUserSuppliedOption(command, key)) {
      userSupplied.add(key);
    }
  }
  return userSupplied;
};
```

`adapters/commander/src/to-commander.ts:291-298`

```ts
await action.command.execute(
  action.parsedArgs,
  applyCliFlagValueAliases(
    action.command.flags,
    action.parsedFlags,
    action.userSuppliedFlagKeys
  )
);
```

### Predicate 5 - static resource accessor warning suppression

`packages/warden/src/rules/static-resource-accessor-preference.ts:328-335`

```ts
const buildDeclaredNameById = (
  resources: readonly DeclaredStaticResource[]
): ReadonlyMap<string, string> =>
  new Map(
    resources.flatMap((resource) =>
      resource.id ? [[resource.id, resource.name] as const] : []
    )
  );
```

`packages/warden/src/rules/static-resource-accessor-preference.ts:350-358`

```ts
walkWithScopes(
  body,
  (node, scopes) => {
    const lookup = extractResourceLookup(node, ctxNames, resourceAliases);
    if (lookup && !isShadowedModuleBinding(lookup.name, scopes)) {
      lookups.push({
        ...lookup,
        shadowedDeclaredNames: collectShadowedNames(declaredNames, scopes),
      });
```

`packages/warden/src/rules/static-resource-accessor-preference.ts:544-553`

```ts
for (const lookup of lookups) {
  const resourceName =
    (lookup.name && declaredNames.has(lookup.name) ? lookup.name : null) ??
    (lookup.id ? (declaredNameById.get(lookup.id) ?? null) : null);

  if (!resourceName) {
    continue;
  }
  if (lookup.shadowedDeclaredNames.has(resourceName)) {
    continue;
```

Tests keep both sides of the behavior.

`packages/warden/src/__tests__/static-resource-accessor-preference.test.ts:8-30`

```ts
test('warns when a same-file resource definition is looked up by id', () => {
  const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});
```

`packages/warden/src/__tests__/static-resource-accessor-preference.test.ts:188-205`

```ts
test('does not warn when a string resource lookup resolves to a shadowed declared name', () => {
  const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});
```

### Predicate 6 - prior Round 1/2 blocker follow-up

Rounds 1 and 2 reported no P0/P1/P2 in this lane, so there were no prior blocker findings to re-check as unresolved.

`.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-warden-cli-round-1.md:9-13`

```md
## Result

No P0/P1/P2 findings.

The Warden guide manifest/schema naming, generated guide source-of-truth, plain-text link rendering, shared diagnostic schema projection, CLI value-alias ambiguity handling, and static resource accessor shadowing behavior all match the packet intent at stack tip.
```

`.agents/plans/2026-05-12-topograph-query-docs-stack/reports/local-review-warden-cli-round-2.md:8-12`

```md
## Result

Clean for P0/P1/P2.

No Warden/CLI P0, P1, or P2 regressions found. I also did not identify a new P3 worth carrying in this lane.
```

## Commands Run

Passed:

```bash
bun test packages/warden/src/__tests__/guide.test.ts packages/warden/src/__tests__/cli.test.ts apps/trails/src/__tests__/warden.test.ts scripts/__tests__/sync-agents-warden-guide.test.ts scripts/__tests__/sync-skill-warden-guide.test.ts packages/cli/src/__tests__/flags.test.ts adapters/commander/src/__tests__/to-commander.test.ts packages/warden/src/__tests__/static-resource-accessor-preference.test.ts
```

Result:

```text
142 pass
0 fail
393 expect() calls
Ran 142 tests across 8 files. [15.30s]
```

Passed:

```bash
bun run warden:agents:check
bun run warden:skills:check
```

Passed with the output shown in Predicate 1:

```bash
bun apps/trails/bin/trails.ts warden guide --manifest | jq '.rules[0] | keys, has("category"), has("concern")'
bun apps/trails/bin/trails.ts warden guide --agent-json | jq '.kind, (.rules[0] | keys), (.rules[0] | has("category")), (.rules[0] | has("concern"))'
```

Agent JSON smoke output:

```text
"trails-warden-agent-guide"
[
  "appliesAt",
  "concern",
  "id",
  "invariant",
  "severity"
]
false
true
```

Passed:

```bash
bun run typecheck
```

Result:

```text
Tasks:    21 successful, 21 total
Cached:    21 cached, 21 total
```

Passed:

```bash
bun run format:check
```

Result:

```text
All matched files use the correct format.
Found 0 warnings and 0 errors.
```

Passed:

```bash
/usr/bin/git diff --check
```

Read-only inspection commands included `rg`, `fd`, `nl -ba ... | sed ...`, `/usr/bin/git status --short`, `/usr/bin/git branch --show-current`, and `/usr/bin/git rev-parse --short HEAD`. I did not run any source-control write command.

## Unknowns

- I did not inspect remote CI or bot review output.
- I did not run the full repository matrix (`bun run test`, `bun run lint`, `bun run build`, `bun run check`, or `bun run dead-code`). This round used the focused Warden/CLI lane suite, generated guide checks, manifest smoke probes, full typecheck, format check, and whitespace check.
