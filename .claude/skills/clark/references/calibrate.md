# Calibrate: Precision Pass

Vocabulary, naming conventions, API consistency, documentation alignment. Trail posture at its most exacting. The instruments must be true.

## What to Examine

### 1. Vocabulary Compliance

Scan all changed or new files for vocabulary violations. Highest-priority check.

**Code files (.ts, .js):** Variable names, function names, class names, type names, string literals in error messages and log statements, JSDoc comments and inline comments.

**Documentation files (.md):** All prose, headings, and code examples. README files, guides, and any new docs.

**Configuration and metadata:** Package names, descriptions. Trail descriptions and example names. Commit messages in the range being reviewed.

**What to flag:**

| Violation | Correct Term |
|-----------|-------------|
| handler, action, endpoint | trail |
| route (for composition) | cross |
| registry, collection, manifest | topo |
| serve, start, wire up | trailhead |
| call, invoke, dispatch (for cross) | cross |
| transport, adapter, interface | trailhead |
| impl, fn, handler (for run function) | blaze |
| annotations, tags | metadata |
| fallbacks, retries, recovery | detours |
| linter, checker, validator | warden |
| introspect, inspect, describe | survey |
| docs, help, manual | guide |
| middleware, layer | gate |
| service, dependency | provision |

Also check that standard terms stay standard. `config` is not "settings." `Result` is not "response."

### 2. Naming Convention Compliance

Check against ADR-0001's thirteen conventions. Focus on new or changed exports:

- **Convention 1 (clarity without context):** Can you understand the name on line 200 without scrolling to the import?
- **Convention 2 (branded vs standard):** Are Trails terms used only for Trails concepts? Are standard terms left standard?
- **Convention 3 (test prefix):** Do testing helpers use `test*`?
- **Convention 4 (expect prefix):** Do assert-and-return helpers use `expect*`?
- **Convention 5 (bare nouns):** Do definition functions use bare singular nouns?
- **Convention 6 (create prefix):** Do runtime factories use `create*`?
- **Convention 7 (derive prefix):** Do derivation functions use `derive*`?
- **Convention 8 (validate prefix):** Do verification functions use `validate*`?
- **Convention 9 (build prefix):** Do trailhead derivation builders use `build*`?
- **Convention 10 (gate suffix):** Do gates follow the `*Gate` pattern?
- **Convention 11 (of suffix):** Do schema extractors use `*Of`?
- **Convention 12 (Zod boundary):** Does Zod leak past schema definitions?

### 3. Trail ID Compliance

Check all trail IDs against the naming rules:

- Lowercase only, no camelCase
- Dots for namespacing, verb-last
- Two segments typical, three max
- Hyphens for multi-word verbs
- Realistic, descriptive example data (no "foo", "bar", "test")

### 4. Documentation-Code Alignment

For any docs that were changed or should have been changed:

- Do code examples in docs match the actual API?
- Do descriptions match current behavior?
- Are new features documented?
- Are removed features cleaned up?

### 5. Error Taxonomy

For any new error usage:

- Are errors from the Trails error taxonomy?
- Are error messages clear and actionable?
- Do error types match the intent (NotFoundError for missing things, ValidationError for bad input)?

## Output

```markdown
## Calibrate: [scope]

### Vocabulary
- [file:line] `handler` should be `blaze`
- [file:line] Comment says "invoke" should say "cross"

### Naming Conventions
- [export name] violates Convention N: [explanation and correction]

### Trail IDs
- [trail ID] violates [rule]: [correction]

### Documentation Drift
- [doc file] references [old API/term]: should be [current]

### Error Taxonomy
- [file:line] uses generic Error, should use [specific TrailsError subclass]

### Clean
- [areas that passed with no issues]
```

Every finding includes: the file, the violation, and the correction. Do not flag without fixing.

## Reference

- `docs/lexicon.md` — the full lexicon
- `docs/adr/0001-naming-conventions.md` — the thirteen conventions with examples
- `packages/core/src/errors.ts` — the error taxonomy (verify current classes)
