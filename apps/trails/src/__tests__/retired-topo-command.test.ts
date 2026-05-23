import { describe, expect, test } from 'bun:test';

import { getRetiredTopoCommandDiagnostic } from '../retired-topo-command.js';

describe('retired topo artifact command diagnostics', () => {
  test('points retired topo artifact commands at top-level replacements', () => {
    const cases = [
      ['compile', 'trails compile'],
      ['verify', 'trails validate'],
      ['check', 'trails validate'],
    ] as const;

    for (const [command, replacement] of cases) {
      const diagnostic = getRetiredTopoCommandDiagnostic([
        'bun',
        'trails',
        'topo',
        command,
      ]);

      expect(diagnostic).toMatchObject({
        attempted: `trails topo ${command}`,
        replacement,
      });
      expect(diagnostic?.message).toContain(
        `"trails topo ${command}" was retired`
      );
      expect(diagnostic?.message).toContain(`Use "${replacement}" instead`);
      expect(diagnostic?.message).toContain('"trails diff"');
      expect(diagnostic?.message).toContain('history, pin, and unpin');
    }
  });

  test('leaves current topo and top-level artifact commands alone', () => {
    for (const argv of [
      ['bun', 'trails', 'compile'],
      ['bun', 'trails', 'validate'],
      ['bun', 'trails', 'diff'],
      ['bun', 'trails', 'topo'],
      ['bun', 'trails', 'topo', 'history'],
      ['bun', 'trails', 'topo', 'pin'],
      ['bun', 'trails', 'topo', 'unpin'],
    ]) {
      expect(getRetiredTopoCommandDiagnostic(argv)).toBeNull();
    }
  });
});
