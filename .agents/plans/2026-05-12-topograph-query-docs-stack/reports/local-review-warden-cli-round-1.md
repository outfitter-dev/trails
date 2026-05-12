# Local Review Round 1 - Warden/CLI Polish Lane

Date: 2026-05-12
Cwd: `/Users/mg/Developer/outfitter/trails`
Stack tip reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements` at `7720a0d76`

Scope reviewed: TRL-692, TRL-690, TRL-691, TRL-693, TRL-694.

## Result

No P0/P1/P2 findings.

The Warden guide manifest/schema naming, generated guide source-of-truth, plain-text link rendering, shared diagnostic schema projection, CLI value-alias ambiguity handling, and static resource accessor shadowing behavior all match the packet intent at stack tip.

## Findings

None.

## Evidence Reviewed

### TRL-692 - Manifest/schema naming

Severity: none
Owning branch: `trl-692-clarify-warden-guide-manifest-category-naming-before`
Action: none

The public guide entry type exposes `concern`, not `category`.

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

The manifest builder sources that field directly from rule metadata.

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

The Trails app output schema also expects `concern`, preserving the surface contract.

`apps/trails/src/trails/warden-guide.ts:29-44`

```ts
const wardenRuleGuideEntrySchema = z.object({
  concern: z.enum(wardenRuleConcerns),
  depth: z.enum(wardenDepthValues),
  description: z.string(),
  docs: z.array(wardenGuidanceLinkSchema).readonly(),
  guidance: wardenGuidanceSchema.optional(),
  id: z.string(),
  invariant: z.string(),
  lifecycle: z.object({
    retireWhen: z.string().optional(),
    state: z.enum(wardenRuleLifecycleStates),
  }),
  scope: z.enum(wardenRuleScopes),
  severity: z.enum(['error', 'warn']),
  tier: z.enum(wardenRuleTiers),
});
```

Validation command:

```bash
bun apps/trails/bin/trails.ts warden guide --manifest | jq '.rules[0] | keys'
```

Result included `concern` and did not include `category`.

### TRL-690 - Link rendering and schema reuse

Severity: none
Owning branch: `trl-690-polish-warden-guidance-link-rendering-and-schema-reuse`
Action: none

Plain report output renders label plus copyable target for links, while preserving label-only references.

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

The regression test covers paths, URLs, and label-only docs.

`packages/warden/src/__tests__/cli.test.ts:1161-1190`

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

The Trails app Warden output now reuses the shared Warden diagnostic schema instead of locally duplicating diagnostic fields.

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

### TRL-691 - Generated guide source-of-truth

Severity: none
Owning branch: `trl-691-polish-generated-warden-guide-headers-and-generator-tests`
Action: none

The generated AGENTS block points at the Warden manifest command as its guide input.

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

The generated skill guide points at the agent-json command and tells prompts to reference the generated file instead of copying rule prose.

`scripts/sync-skill-warden-guide.ts:43-53`

```ts
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
```

The generated checked-in blocks are current:

`AGENTS.md:88-90`

```md
This section is generated from the live `@ontrails/warden` rule manifest. Keep the human-authored guidance above as orientation; use this block as the enforceable-rule index.

- Guide input command: `bun apps/trails/bin/trails.ts warden guide --manifest`
```

`.claude/skills/clark/references/warden-guide.md:5-7`

```md
This file is generated from the live `@ontrails/warden` rule manifest. Repo-tracked skills, agents, and plugin prompts should reference this file instead of copying rule prose by hand.

- Guide input command: `bun apps/trails/bin/trails.ts warden guide --agent-json`
```

### TRL-693 - CLI value-alias ambiguity

Severity: none
Owning branch: `trl-693-tighten-cli-value-alias-conflicts-for-non-commander-callers`
Action: none

Non-Commander callers that do not pass user-supplied key tracking now fail loudly when an active alias is combined with any parsed canonical key.

`packages/cli/src/flags.ts:186-200`

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
```

Commander preserves its existing behavior by passing explicit user-supplied key tracking into alias application.

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

The direct package test covers the non-Commander ambiguity path.

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

The Commander adapter test still rejects a user-supplied canonical flag plus alias at the surface boundary.

`adapters/commander/src/__tests__/to-commander.test.ts:969-982`

```ts
await withMockedProcess(async () => {
  await expect(
    program.parseAsync([
      'node',
      'test',
      'render',
      '--json',
      '--format',
      'text',
    ])
  ).rejects.toThrow('EXIT');
});

expect(received).toBeUndefined();
```

### TRL-694 - Static resource accessor shadowing

Severity: none
Owning branch: `trl-694-suppress-static-resource-accessor-warnings-when-string`
Action: none

The rule tracks declared resource names through scoped walking and records whether a declared static resource binding is shadowed at the lookup site.

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

It suppresses only after resolving the lookup to a declared resource whose declared binding is shadowed.

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

The tests cover both identifier shadowing and string lookup shadowing.

`packages/warden/src/__tests__/static-resource-accessor-preference.test.ts:168-205`

```ts
test('does not warn when a local binding shadows a declared resource name', () => {
  const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});
```

```ts
test('does not warn when a string resource lookup resolves to a shadowed declared name', () => {
  const code = `
import { Result, resource, trail } from '@ontrails/core';

const db = resource('db.main', {
  create: () => Result.ok({ source: 'factory' }),
});
```

## Focused Validation

Passed:

```bash
bun test packages/warden/src/__tests__/guide.test.ts packages/warden/src/__tests__/cli.test.ts apps/trails/src/__tests__/warden.test.ts scripts/__tests__/sync-agents-warden-guide.test.ts scripts/__tests__/sync-skill-warden-guide.test.ts packages/cli/src/__tests__/flags.test.ts adapters/commander/src/__tests__/to-commander.test.ts packages/warden/src/__tests__/static-resource-accessor-preference.test.ts
```

Result: 142 pass, 0 fail, 393 expectations.

Passed:

```bash
bun run warden:agents:check
bun run warden:skills:check
bun run typecheck
```

`bun run typecheck` reported 21 successful tasks, 21 cached.

Passed:

```bash
bun apps/trails/bin/trails.ts warden guide --manifest | jq '.rules[0] | keys'
bun apps/trails/bin/trails.ts warden guide --agent-json | jq '.kind, (.rules[0] | keys)'
```

The manifest output exposed `concern` and no `category`; the agent-json output reported kind `trails-warden-agent-guide` and exposed `concern`.

## Unknowns

- I did not inspect remote CI or bot review output in this lane.
- I did not run the full repository verification matrix; this lane ran focused Warden/CLI tests, generated guide checks, guide command smoke checks, and typecheck.
