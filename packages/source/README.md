# @ontrails/source

Shared source-code machinery for Trails packages and repo tooling.

`source` means source code: TypeScript and JavaScript text parsed into an OXC AST. It does not mean activation source, signal source, data source, event source, or execution source.

## What It Owns

`@ontrails/source` owns reusable source-code mechanics:

- AST node guards and accessors for the OXC node shapes Trails tooling uses.
- `parse` and `parseWithDiagnostics` wrappers over `oxc-parser`.
- `walk`, parent-aware walking, and scope-aware walking over `oxc-walker`.
- Source locations, source edits, literal extraction, and generic Trails syntax recognition.
- Generic trail/entity discovery helpers such as `findTrailDefinitions`, `findImplementationBodies`, `findEntityDefinitions`, and `isImplementationCall`.

The package root is the public API. Import from `@ontrails/source`; there are no supported `/ast`, `/trails`, or `/utils` subpaths.

## Package Admission Test

`@ontrails/source` exists because the same source-code contract is reused by independent toolchain owners:

- Warden uses it to implement source-static governance without owning the parser facade.
- Regrade uses it for safe downstream source rewrites.
- The Trails operator uses it to assemble live source-file outlines.
- The `trails` operator uses it for draft promotion and version-lifecycle support.

The package is admitted only for reusable source machinery with at least two independent toolchain owners and a genuinely shared contract. It must not absorb product verdicts, release plans, query semantics, rendering, Warden rule policy, Regrade engines, Topography artifact assembly, or Wayfinder answer composition.

This boundary follows the package-worthiness rule in [ADR-0051: Package Ownership Follows Natural Altitude](../../docs/adr/0051-package-ownership-follows-natural-altitude.md): move code when the natural owner is above one consumer, not when a file merely feels crowded.

## Examples

Parse source and inspect trail declarations:

```ts
import { findTrailDefinitions, parse } from '@ontrails/source';

const ast = parse(
  'example.ts',
  "import { trail } from '@ontrails/core';\nexport const show = trail('user.show', {});\n"
);

const trailIds = ast ? findTrailDefinitions(ast).map((trail) => trail.id) : [];
```

Walk source with parent context:

```ts
import { parse, walkWithParents } from '@ontrails/source';

const ast = parse('example.ts', 'const value = trail("demo.show", {});\n');
const callParents: string[] = [];

if (ast) {
  walkWithParents(ast, (node, context) => {
    if (node.type === 'CallExpression') {
      callParents.push(`${context.parent?.type ?? 'root'}:${String(context.key)}`);
    }
  });
}
```

Apply source edits:

```ts
import { applySourceEdits, createSourceEdit } from '@ontrails/source';

const updated = applySourceEdits('const name = "old";\n', [
  createSourceEdit(14, 17, 'new'),
]);
```

## Non-Goals

- Warden rule policy and rule-specific facts remain in `@ontrails/warden`.
- Regrade migration planning and execution remain in `@ontrails/regrade`.
- Topography graph artifacts and outline assembly remain outside this package.
- Wayfind query trails and answer rendering remain in `@ontrails/topography`.
- Runtime Trails contracts remain in `@ontrails/core`.
