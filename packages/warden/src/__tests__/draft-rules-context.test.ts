import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { draftFileMarking } from '../rules/draft-file-marking.js';
import { draftVisibleDebt } from '../rules/draft-visible-debt.js';

/**
 * Absolute paths to the two real framework files that define the draft-prefix
 * constants. The exemption in `collectFrameworkDraftPrefixConstantOffsets` is
 * keyed on absolute-path equality against these two paths.
 */
const CORE_DRAFT_PATH = resolve(
  fileURLToPath(new URL('../../../core/src/draft.ts', import.meta.url))
);
const WARDEN_DRAFT_PATH = resolve(
  fileURLToPath(new URL('../draft.ts', import.meta.url))
);

/** Any file outside the two framework files — exemption must NOT apply here. */
const NORMAL_FILE = 'packages/example/src/ordinary.ts';

describe('draft-file-marking context-awareness', () => {
  test('ignores framework DRAFT_ID_PREFIX in packages/core/src/draft.ts', () => {
    const code = `export const DRAFT_ID_PREFIX = '_draft.';\n`;
    expect(draftFileMarking.check(code, CORE_DRAFT_PATH)).toEqual([]);
  });

  test('ignores framework DRAFT_FILE_PREFIX in packages/warden/src/draft.ts', () => {
    const code = `export const DRAFT_FILE_PREFIX = '_draft.';\n`;
    expect(draftFileMarking.check(code, WARDEN_DRAFT_PATH)).toEqual([]);
  });

  test('fires when DRAFT_ID_PREFIX is reused in a non-framework file (false-negative closed)', () => {
    // Before TRL-334 follow-up: identifier-name-only match silently suppressed
    // this as "framework declaration". After: the path gate rejects the
    // consumer file and the leak fires.
    const code = `const DRAFT_ID_PREFIX = '_draft.user-leak';\n`;
    const diagnostics = draftFileMarking.check(code, NORMAL_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('error');
  });

  test('fires when DRAFT_FILE_PREFIX is reused in a non-framework file', () => {
    const code = `const DRAFT_FILE_PREFIX = '_draft.other-leak';\n`;
    const diagnostics = draftFileMarking.check(code, NORMAL_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('error');
  });

  test('fires when framework file declares the constant with a non-_draft. value (value invariant)', () => {
    // Same file path, same identifier, but wrong literal — exemption must
    // require the exact '_draft.' value.
    const code = `export const DRAFT_ID_PREFIX = '_draft.something-else';\n`;
    const diagnostics = draftFileMarking.check(code, CORE_DRAFT_PATH);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('error');
  });

  test('still flags draft ids in arbitrary const declarations', () => {
    const code = `const something = '_draft.foo';\n`;
    const diagnostics = draftFileMarking.check(code, NORMAL_FILE);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('error');
  });

  test('warden-ignore-next-line pragma suppresses diagnostic', () => {
    const code = `// warden-ignore-next-line\nconst x = '_draft.intentional';\n`;
    expect(draftFileMarking.check(code, NORMAL_FILE)).toEqual([]);
  });

  test('pragma with trailing whitespace still suppresses diagnostic', () => {
    const code = `// warden-ignore-next-line   \nconst x = '_draft.intentional';\n`;
    expect(draftFileMarking.check(code, NORMAL_FILE)).toEqual([]);
  });

  test('pragma with blank line between does not suppress', () => {
    const code = `// warden-ignore-next-line\n\nconst x = '_draft.intentional';\n`;
    const diagnostics = draftFileMarking.check(code, NORMAL_FILE);
    expect(diagnostics.length).toBe(1);
  });

  test('does not falsely flag "marked without ids" when all draft ids are pragma-suppressed', () => {
    // In a draft-marked file, pragma-suppressed draft ids still justify the
    // filename marker — the user intentionally silenced them, not removed
    // them. The "marked without ids" cleanup nudge must not fire.
    const code = `// warden-ignore-next-line\nconst x = '_draft.intentional';\n`;
    const diagnostics = draftFileMarking.check(
      code,
      'packages/example/src/thing._draft.ts'
    );
    expect(diagnostics).toEqual([]);
  });
});

describe('draft-visible-debt context-awareness', () => {
  test('ignores framework DRAFT_ID_PREFIX in packages/core/src/draft.ts', () => {
    const code = `export const DRAFT_ID_PREFIX = '_draft.';\n`;
    expect(draftVisibleDebt.check(code, CORE_DRAFT_PATH)).toEqual([]);
  });

  test('ignores framework DRAFT_FILE_PREFIX in packages/warden/src/draft.ts', () => {
    const code = `export const DRAFT_FILE_PREFIX = '_draft.';\n`;
    expect(draftVisibleDebt.check(code, WARDEN_DRAFT_PATH)).toEqual([]);
  });

  test('fires when DRAFT_ID_PREFIX is reused in a non-framework file (false-negative closed)', () => {
    const code = `const DRAFT_ID_PREFIX = '_draft.user-leak';\n`;
    const diagnostics = draftVisibleDebt.check(code, '_draft.something.ts');
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('warn');
  });

  test('fires when DRAFT_FILE_PREFIX is reused in a non-framework file', () => {
    const code = `const DRAFT_FILE_PREFIX = '_draft.other-leak';\n`;
    const diagnostics = draftVisibleDebt.check(code, '_draft.something.ts');
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('warn');
  });

  test('fires when framework file declares the constant with a non-_draft. value (value invariant)', () => {
    const code = `export const DRAFT_ID_PREFIX = '_draft.something-else';\n`;
    const diagnostics = draftVisibleDebt.check(code, CORE_DRAFT_PATH);
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('warn');
  });

  test('still flags draft ids in arbitrary const declarations', () => {
    const code = `const something = '_draft.foo';\n`;
    const diagnostics = draftVisibleDebt.check(code, '_draft.something.ts');
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0]?.severity).toBe('warn');
  });

  test('warden-ignore-next-line pragma suppresses diagnostic', () => {
    const code = `// warden-ignore-next-line\nconst x = '_draft.intentional';\n`;
    expect(draftVisibleDebt.check(code, '_draft.something.ts')).toEqual([]);
  });

  test('pragma with trailing whitespace still suppresses diagnostic', () => {
    const code = `// warden-ignore-next-line   \nconst x = '_draft.intentional';\n`;
    expect(draftVisibleDebt.check(code, '_draft.something.ts')).toEqual([]);
  });

  test('pragma with blank line between does not suppress', () => {
    const code = `// warden-ignore-next-line\n\nconst x = '_draft.intentional';\n`;
    const diagnostics = draftVisibleDebt.check(code, '_draft.something.ts');
    expect(diagnostics.length).toBe(1);
  });
});
