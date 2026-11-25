import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { implementationReturnsResult } from '../rules/implementation-returns-result.js';
import { noRedundantResultErrorWrap } from '../rules/no-redundant-result-error-wrap.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'trails-result-method-'));
});
afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

const fixture = (
  options: {
    signature?: string;
    expression?: string;
    setup?: string;
    localType?: string;
    methodName?: string;
    rewrap?: boolean;
    resourceTypes?: string;
  } = {}
) => {
  writeFileSync(
    join(root, 'client.ts'),
    `import * as Trails from '@ontrails/core';
export class Client {
 ${options.methodName ?? 'read'}(): ${options.signature ?? 'Trails.Result<string, Error>'} { return null as never; }
}`
  );
  writeFileSync(
    join(root, 'resource.ts'),
    `import * as Trails from '@ontrails/core';
import { Client as Store } from './client.js';
export const store = Trails.resource<${options.resourceTypes ?? 'Store'}>('store', { create: () => null });`
  );
  const source = `import { Result, trail } from '@ontrails/core';
import { store as identityStoreResource } from './resource.js';
trail('observation.import', {
 implementation: async (input, ctx) => {
  const identity = identityStoreResource.from(ctx);
  ${options.setup ?? ''}
  const station${options.localType ?? ''} = ${options.expression ?? 'identity.read()'};
  if (station.isErr()) return ${options.rewrap ? 'Result.err(station.error)' : 'station'};
  return Result.ok(station.value);
 }
});`;
  return { path: join(root, 'observation.ts'), source };
};

const check = (options: Parameters<typeof fixture>[0] = {}) => {
  const { source, path } = fixture(options);
  return {
    returns: implementationReturnsResult.check(source, path),
    wraps: noRedundantResultErrorWrap.check(source, path),
  };
};

describe('explicit resource class-method Result provenance', () => {
  test('allows narrowed direct method Results through imported resource/class aliases', () => {
    expect(check().returns).toHaveLength(0);
  });
  test('flags unannotated method Result error rewrap', () => {
    expect(check({ rewrap: true }).wraps).toHaveLength(1);
  });
  test('flags locally annotated method Result rewrap', () => {
    expect(
      check({ localType: ': Result<string, Error>', rewrap: true }).wraps
    ).toHaveLength(1);
  });
  test('allows awaited Promise<Result>', () => {
    expect(
      check({
        expression: 'await identity.read()',
        signature: 'Promise<Trails.Result<string, Error>>',
      }).returns
    ).toHaveLength(0);
  });
  test('recognizes awaited conditional methods, including mixed Result branches', () => {
    for (const alternate of ['identity.read()', "Result.ok('fallback')"]) {
      const options = {
        expression: `await (input.flag ? identity.read() : ${alternate})`,
        signature: 'Promise<Trails.Result<string, Error>>',
      };
      expect(check(options).returns).toHaveLength(0);
      expect(check({ ...options, rewrap: true }).wraps).toHaveLength(1);
    }
  });
  test('does not recognize unawaited conditional Promise<Result> branches', () => {
    const options = {
      expression: 'input.flag ? identity.read() : identity.read()',
      signature: 'Promise<Trails.Result<string, Error>>',
    };
    expect(check(options).returns).toHaveLength(1);
    expect(check({ ...options, rewrap: true }).wraps).toHaveLength(0);
  });
  test.each([
    [
      'configured resource clients',
      { resourceTypes: 'Store, { location: string }' },
    ],
    ['uncomputed quoted method names', { methodName: "'read'" }],
  ] as const)('recognizes %s', (_label, options) => {
    expect(check(options).returns).toHaveLength(0);
    expect(check({ ...options, rewrap: true }).wraps).toHaveLength(1);
  });
  test('does not infer the outer variable from a Result field in an annotation', () => {
    const { path, source } = fixture({
      expression: 'input.failure',
      localType: ': { error: Error; previous: Result<string, Error> }',
    });
    const neededWrap = source.replace(
      'if (station.isErr()) return station;\n  return Result.ok(station.value);',
      'return Result.err(station.error);'
    );
    expect(noRedundantResultErrorWrap.check(neededWrap, path)).toHaveLength(0);
    expect(implementationReturnsResult.check(neededWrap, path)).toHaveLength(0);
  });
  test('preserves a qualified Result annotation through a core namespace import', () => {
    const { source, path } = fixture({
      expression: 'input.unknown',
      localType: ': Trails.Result<string, Error>',
      rewrap: true,
    });
    const withNamespace = `import * as Trails from '@ontrails/core';\n${source}`;
    expect(noRedundantResultErrorWrap.check(withNamespace, path)).toHaveLength(
      1
    );
  });
  test('preserves a locally exported Result helper that shares its name with a type', () => {
    writeFileSync(
      join(root, 'helper.ts'),
      `import { Result } from '@ontrails/core';
const read = (): Result<string, Error> => Result.ok('ready');
type read = () => Result<string, Error>;
export { read };`
    );
    const { source, path } = fixture({ expression: 'read()' });
    const withHelper = `import { read } from './helper.js';\n${source}`;
    expect(implementationReturnsResult.check(withHelper, path)).toHaveLength(0);
  });
  test('keeps default resource imports outside method provenance', () => {
    const { source, path } = fixture();
    writeFileSync(
      join(root, 'resource.ts'),
      `import { resource } from '@ontrails/core';
import { Client } from './client.js';
export default resource<Client>('store', { create: () => null });`
    );
    const withDefaultResource = source.replace(
      '{ store as identityStoreResource }',
      'identityStoreResource'
    );
    expect(
      implementationReturnsResult.check(withDefaultResource, path)
    ).toHaveLength(1);
    expect(
      noRedundantResultErrorWrap.check(
        withDefaultResource.replace(
          'return station;',
          'return Result.err(station.error);'
        ),
        path
      )
    ).toHaveLength(0);
  });
  test('does not treat unawaited Promise<Result> as a Result', () => {
    expect(
      check({ signature: 'Promise<Trails.Result<string, Error>>' }).returns
    ).toHaveLength(1);
    expect(
      check({
        rewrap: true,
        signature: 'Promise<Trails.Result<string, Error>>',
      }).wraps
    ).toHaveLength(0);
  });
  test('does not infer raw duck-typed methods or warn on valid raw error wrapping', () => {
    const signature = '{ isErr(): boolean; error: Error; value: string }';
    expect(check({ signature }).returns).toHaveLength(1);
    expect(check({ rewrap: true, signature }).wraps).toHaveLength(0);
  });
  test('invalidates reassigned receivers', () => {
    expect(check({ setup: 'identity = input.other;' }).returns).toHaveLength(1);
  });
  test('does not infer computed or unknown receiver methods', () => {
    expect(
      check({ expression: 'identity[input.method]()' }).returns
    ).toHaveLength(1);
    expect(check({ expression: 'input.other.read()' }).returns).toHaveLength(1);
  });
  test('does not use a shadowed resource import', () => {
    const { source, path } = fixture();
    expect(
      implementationReturnsResult.check(
        source.replace(
          'const identity =',
          'const identityStoreResource = input.resource; const identity ='
        ),
        path
      )
    ).toHaveLength(1);
  });
});

describe('bounded method witness exclusions', () => {
  test('warns on awaited asynchronous Result rewrap', () => {
    expect(
      check({
        expression: 'await identity.read()',
        rewrap: true,
        signature: 'Promise<Trails.Result<string, Error>>',
      }).wraps
    ).toHaveLength(1);
  });
  test('preserves lexical receiver aliases', () => {
    expect(
      check({ expression: 'client.read()', setup: 'const client = identity;' })
        .returns
    ).toHaveLength(0);
  });
  test('does not promote branch-only receiver assignments', () => {
    expect(
      check({
        expression: 'client.read()',
        setup: 'let client; if(input.enabled) client = identity;',
      }).returns
    ).toHaveLength(1);
  });
  test('invalidates receivers after conditional reassignment', () => {
    expect(
      check({ setup: 'if(input.enabled) identity = input.other;' }).returns
    ).toHaveLength(1);
  });
  test('keeps raw method wrapping unreported under an unknown same-name class', () => {
    const { source, path } = fixture({ rewrap: true });
    writeFileSync(
      join(root, 'resource.ts'),
      `import { resource } from '@ontrails/core'; class Client { read(): { error: Error } {} } export const store = resource<Client>('store', {});`
    );
    expect(noRedundantResultErrorWrap.check(source, path)).toHaveLength(0);
  });
  test('rejects static, inherited-only, and optional methods as instance witnesses', () => {
    for (const definition of [
      `export class Client { static read(): Trails.Result<string,Error> {} }`,
      `class Base { read(): Trails.Result<string,Error> {} } export class Client extends Base {}`,
    ]) {
      const { source, path } = fixture();
      writeFileSync(
        join(root, 'client.ts'),
        `import * as Trails from '@ontrails/core'; ${definition}`
      );
      expect(implementationReturnsResult.check(source, path)).toHaveLength(1);
    }
    expect(check({ expression: 'identity.read?.()' }).returns).toHaveLength(1);
    expect(check({ expression: 'identity?.read()' }).returns).toHaveLength(1);
  });
  test('rejects non-core resource factories and missing explicit generic', () => {
    for (const definition of [
      `const resource = input.factory; import { Client } from './client.js'; export const store = resource<Client>('store', {});`,
      `import { resource } from '@ontrails/core'; export const store = resource('store', {});`,
    ]) {
      const { source, path } = fixture();
      writeFileSync(join(root, 'resource.ts'), definition);
      expect(implementationReturnsResult.check(source, path)).toHaveLength(1);
    }
  });
  test('preserves Result type import aliases in local annotation rewrap coaching', () => {
    const { source, path } = fixture({
      localType: ': LocalResult<string, Error>',
      rewrap: true,
    });
    expect(
      noRedundantResultErrorWrap.check(
        `import type { Result as LocalResult } from '@ontrails/core';\n${source}`,
        path
      )
    ).toHaveLength(1);
  });
});

describe('method witness lexical and type identities', () => {
  test.each([
    [
      'method Result',
      'class Client { read<Result = Raw>(): Result { return null as never; } }',
      'identity.read()',
    ],
    [
      'class Result',
      'class Client<Result = Raw> { read(): Result { return null as never; } }',
      'identity.read()',
    ],
    [
      'awaited method Result',
      'class Client { read<Result = Raw>(): Promise<Result> { return null as never; } }',
      'await identity.read()',
    ],
  ])(
    'does not use a type name shadowed by %s',
    (_name, definition, expression) => {
      const { source, path } = fixture({ expression });
      writeFileSync(
        join(root, 'client.ts'),
        `import type { Result } from '@ontrails/core';
import type * as Trails from '@ontrails/core';
type Raw = { error: Error };
export ${definition}`
      );
      expect(implementationReturnsResult.check(source, path)).toHaveLength(1);
      expect(
        noRedundantResultErrorWrap.check(
          source.replace(
            'return station;',
            'return Result.err(station.error);'
          ),
          path
        )
      ).toHaveLength(0);
    }
  );

  test('a type parameter does not shadow the namespace in a qualified Result', () => {
    const { source, path } = fixture();
    writeFileSync(
      join(root, 'client.ts'),
      `import type * as Trails from '@ontrails/core';
export class Client<Trails = unknown> {
  read(): Trails.Result<string, Error> { return null as never; }
}`
    );
    expect(implementationReturnsResult.check(source, path)).toHaveLength(0);
  });

  test.each([
    '({ next: identity } = input);',
    '[{ next: identity = input.other }] = input.items;',
    'for (identity of input.items) {}',
  ])('invalidates receiver bindings written by %s', (setup) => {
    const { source, path } = fixture({ setup });
    const candidate = source.replace('const identity =', 'let identity =');
    expect(implementationReturnsResult.check(candidate, path)).toHaveLength(1);
    expect(
      noRedundantResultErrorWrap.check(
        candidate.replace(
          'return station;',
          'return Result.err(station.error);'
        ),
        path
      )
    ).toHaveLength(0);
  });

  test('does not invalidate a receiver used only as a pattern key', () => {
    expect(
      check({ setup: 'let target; ({ identity: target } = input);' }).returns
    ).toHaveLength(0);
  });

  test.each([
    '(() => { identity = input.other; })();',
    '(() => { ({ next: identity } = input); })();',
    'function replace() { identity = input.other; } replace();',
  ])('invalidates captured receiver writes in %s', (setup) => {
    const { source, path } = fixture({ setup });
    const candidate = source.replace('const identity =', 'let identity =');
    expect(implementationReturnsResult.check(candidate, path)).toHaveLength(1);
    expect(
      noRedundantResultErrorWrap.check(
        candidate.replace(
          'return station;',
          'return Result.err(station.error);'
        ),
        path
      )
    ).toHaveLength(0);
  });

  test('keeps receiver provenance across a write to a nested shadow', () => {
    const { source, path } = fixture({
      rewrap: true,
      setup: '((identity) => { identity = input.other; })(input.initial);',
    });
    expect(noRedundantResultErrorWrap.check(source, path)).toHaveLength(1);
    expect(
      implementationReturnsResult.check(
        source.replace('Result.err(station.error)', 'station'),
        path
      )
    ).toHaveLength(0);
  });

  test.each([
    'function outer(identityStoreResource) {',
    'function outer() { const identityStoreResource = rawResource;',
    '{ const identityStoreResource = rawResource;',
    'namespace Outer { export const identityStoreResource = rawResource;',
    'namespace Outer { import identityStoreResource = Fixtures.rawResource;',
    'namespace Outer { if (f) { var identityStoreResource = rawResource; }',
    'function outer() {',
  ])('resolves resource shadows around nested helpers in %s', (outer) => {
    const { source, path } = fixture();
    const candidate = source
      .replace(
        "trail('observation.import', {\n implementation: async (input, ctx) => {",
        `${outer}\nasync function helper(input, ctx) {`
      )
      .replace(/\n\}\);$/, '\n}');
    expect(
      noRedundantResultErrorWrap.check(
        candidate.replace(
          'return station;',
          'return Result.err(station.error);'
        ),
        path
      )
    ).toHaveLength(outer === 'function outer() {' ? 1 : 0);
  });

  test('resolves enclosing resource shadows around trail definitions', () => {
    const { source, path } = fixture();
    const nested = source.replace(
      "trail('observation.import'",
      "function outer(identityStoreResource) { trail('observation.import'"
    );
    const candidate = `${nested}\n}`;
    expect(implementationReturnsResult.check(candidate, path)).toHaveLength(1);
  });

  test('does not trust a context written by a captured closure', () => {
    const { source, path } = fixture({ rewrap: true });
    const candidate = source.replace(
      'const identity =',
      '(() => { ctx = input.otherContext; })(); const identity ='
    );
    expect(noRedundantResultErrorWrap.check(candidate, path)).toHaveLength(0);
    expect(
      implementationReturnsResult.check(
        candidate.replace('Result.err(station.error)', 'station'),
        path
      )
    ).toHaveLength(1);
  });

  test.each(['direct export', 'aliased export', 'local'] as const)(
    'does not use a replaced module resource (%s)',
    (binding) => {
      const { source, path } = fixture();
      const declarations = `import { resource } from '@ontrails/core';
import { Client } from './client.js';
${binding === 'direct export' ? 'export ' : ''}let store = resource<Client>('store', {});
store = { from: () => ({ read: () => ({ error: new Error() }) }) };
${binding === 'aliased export' ? 'export { store };' : ''}`;
      writeFileSync(join(root, 'resource.ts'), declarations);
      const candidate =
        binding === 'local'
          ? source
              .replace(
                "import { store as identityStoreResource } from './resource.js';",
                declarations
              )
              .replace('identityStoreResource.from(ctx)', 'store.from(ctx)')
          : source;
      expect(implementationReturnsResult.check(candidate, path)).toHaveLength(
        1
      );
      expect(
        noRedundantResultErrorWrap.check(
          candidate.replace(
            'return station;',
            'return Result.err(station.error);'
          ),
          path
        )
      ).toHaveLength(0);
    }
  );

  test('rejects optional method declarations for both Result rules', () => {
    const { source, path } = fixture({ rewrap: true });
    writeFileSync(
      join(root, 'client.ts'),
      `import * as Trails from '@ontrails/core'; export declare class Client { read?(): Trails.Result<string, Error>; }`
    );
    expect(noRedundantResultErrorWrap.check(source, path)).toHaveLength(0);
    expect(
      implementationReturnsResult.check(
        source.replace('Result.err(station.error)', 'station'),
        path
      )
    ).toHaveLength(1);
  });
  test('does not interpret an imported Promise alias as the native Promise', () => {
    const { source, path } = fixture({
      expression: 'await identity.read()',
      rewrap: true,
      signature: 'Promise<Trails.Result<string, Error>>',
    });
    writeFileSync(
      join(root, 'client.ts'),
      `import * as Trails from '@ontrails/core'; import type { Promise } from './fake.js'; export class Client { read(): Promise<Trails.Result<string,Error>> {} }`
    );
    expect(noRedundantResultErrorWrap.check(source, path)).toHaveLength(0);
    expect(
      implementationReturnsResult.check(
        source.replace('Result.err(station.error)', 'station'),
        path
      )
    ).toHaveLength(1);
  });
  test('requires the actual second parameter binding at .from', () => {
    for (const from of [
      'identityStoreResource.from()',
      'identityStoreResource.from(input.other)',
      'identityStoreResource.from(ctx, input.other)',
    ]) {
      const { source, path } = fixture();
      const candidate = source.replace('identityStoreResource.from(ctx)', from);
      expect(implementationReturnsResult.check(candidate, path)).toHaveLength(
        1
      );
      expect(
        noRedundantResultErrorWrap.check(
          candidate.replace(
            'return station;',
            'return Result.err(station.error);'
          ),
          path
        )
      ).toHaveLength(0);
    }
  });
  test('rejects a shadowed or reassigned second parameter', () => {
    for (const prefix of [
      '{ const ctx = input.otherContext;',
      '{ ctx = input.otherContext;',
    ]) {
      const { source, path } = fixture();
      const candidate = source
        .replace('const identity =', `${prefix} const identity =`)
        .replace('\n }\n});', '\n } }\n});');
      expect(implementationReturnsResult.check(candidate, path)).toHaveLength(
        1
      );
    }
  });
});

test('does not collapse overloaded method signatures to an arbitrary Result witness', () => {
  const { source, path } = fixture({ rewrap: true });
  writeFileSync(
    join(root, 'client.ts'),
    `import * as Trails from '@ontrails/core'; export declare class Client { 'read'(mode: true): Trails.Result<string,Error>; read(mode: false): { error: Error; isErr(): boolean }; }`
  );
  expect(noRedundantResultErrorWrap.check(source, path)).toHaveLength(0);
  expect(
    implementationReturnsResult.check(
      source.replace('Result.err(station.error)', 'station'),
      path
    )
  ).toHaveLength(1);
});
