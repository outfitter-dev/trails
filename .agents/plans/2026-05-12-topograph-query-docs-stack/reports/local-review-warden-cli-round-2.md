# Local Review Round 2 - Warden/CLI Polish Lane

Date: 2026-05-12
Cwd: `/Users/mg/Developer/outfitter/trails`
Stack tip reviewed: `trl-637-audit-release-process-and-beta-to-10-cutover-requirements` at `137521982`
Scope reviewed: TRL-692, TRL-690, TRL-691, TRL-693, TRL-694 after downstack restacks and round 1 fixes.

## Result

Clean for P0/P1/P2.

No Warden/CLI P0, P1, or P2 regressions found. I also did not identify a new P3 worth carrying in this lane.

## Findings

None.

## Evidence Reviewed

### TRL-692 - Warden guide manifest concern naming

Severity: none
Owning branch: `trl-692-clarify-warden-guide-manifest-category-naming-before`
Recommended action: none

The public guide manifest entry exposes `concern`, not `category`.

`packages/warden/src/guide.ts:25-37`

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

The manifest builder sources the field directly from rule metadata.

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

The Trails wrapper schema preserves the same public field.

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

Regression tests assert that both manifest and agent JSON omit `category`.

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

### TRL-690 - Warden guidance link rendering and schema reuse

Severity: none
Owning branch: `trl-690-polish-warden-guidance-link-rendering-and-schema-reuse`
Recommended action: none

Plain Warden output renders a copyable target when the guidance link has a path or URL.

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

The report formatter test covers path, URL, and label-only guidance docs.

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
```

The Trails `warden` trail reuses the shared Warden diagnostic schema and only extends it with the app-specific optional `topoName`.

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

### TRL-691 - Generated guide source of truth

Severity: none
Owning branch: `trl-691-polish-generated-warden-guide-headers-and-generator-tests`
Recommended action: none

The generated AGENTS block names the manifest-producing command as its guide input.

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

The skill guide names the agent-json command and tells prompts to reference the generated file instead of copying rule prose.

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

Both guide generators group by `rule.concern`, so the generated sections are derived from the renamed manifest field.

`scripts/sync-agents-warden-guide.ts:36-43`

```ts
const groupRulesByConcern = (
  rules: readonly WardenRuleGuideEntry[]
): ReadonlyMap<WardenRuleConcern, readonly WardenRuleGuideEntry[]> => {
  const grouped = new Map<WardenRuleConcern, WardenRuleGuideEntry[]>();
  for (const rule of rules) {
    grouped.set(rule.concern, [...(grouped.get(rule.concern) ?? []), rule]);
  }
  return grouped;
};
```

### TRL-693 - CLI value alias ambiguity

Severity: none
Owning branch: `trl-693-tighten-cli-value-alias-conflicts-for-non-commander-callers`
Recommended action: none

Non-Commander callers without explicit user-supplied key tracking now treat an active value alias plus any canonical parsed key as ambiguous.

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

The direct package regression test covers the non-Commander ambiguity path.

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

Commander still preserves its caller-supplied key tracking boundary.

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

### TRL-694 - Static resource accessor shadowing

Severity: none
Owning branch: `trl-694-suppress-static-resource-accessor-warnings-when-string`
Recommended action: none

The rule records whether a declared resource name is shadowed at the lookup site.

`packages/warden/src/rules/static-resource-accessor-preference.ts:315-325`

```ts
const collectShadowedNames = (
  names: ReadonlySet<string>,
  scopes: readonly ReadonlySet<string>[]
): ReadonlySet<string> => {
  const shadowed = new Set<string>();
  for (const name of names) {
    if (isShadowedModuleBinding(name, scopes)) {
      shadowed.add(name);
    }
  }
  return shadowed;
};
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

The diagnostic is suppressed only after resolving the lookup to a declared resource whose declared binding is shadowed.

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

The regression tests cover identifier and string lookup shadowing.

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

## Validation

Passed:

```bash
bun test packages/warden/src/__tests__/guide.test.ts packages/warden/src/__tests__/cli.test.ts apps/trails/src/__tests__/warden.test.ts scripts/__tests__/sync-agents-warden-guide.test.ts scripts/__tests__/sync-skill-warden-guide.test.ts packages/cli/src/__tests__/flags.test.ts adapters/commander/src/__tests__/to-commander.test.ts packages/warden/src/__tests__/static-resource-accessor-preference.test.ts
```

Result: 142 pass, 0 fail, 393 expectations.

Passed:

```bash
bun run warden:agents:check
bun run warden:skills:check
```

Passed:

```bash
bun apps/trails/bin/trails.ts warden guide --manifest | jq '.rules[0] | keys, has("category"), has("concern")'
bun apps/trails/bin/trails.ts warden guide --agent-json | jq '.kind, (.rules[0] | keys), (.rules[0] | has("category")), (.rules[0] | has("concern"))'
```

The manifest smoke check showed `concern`, did not show `category`, and returned `false` for `has("category")` / `true` for `has("concern")`. The agent-json smoke check returned `kind = "trails-warden-agent-guide"`, exposed `concern`, and returned `false` for `category` / `true` for `concern`.

Passed:

```bash
/usr/bin/git diff --check
```

## Unknowns

- I did not inspect remote CI or bot review output in this lane.
- I did not run the full repository verification matrix; this round was limited to focused Warden/CLI tests, generated guide freshness checks, guide command smoke checks, and whitespace validation.
- I did not run any source-control write commands.
