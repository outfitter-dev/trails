import { describe, expect, test } from 'bun:test';

import { errorMappingCompleteness } from '../rules/error-mapping-completeness.js';

const TEST_FILE = 'transport-error-map.ts';

describe('error-mapping-completeness', () => {
  test('passes complete mapper registrations', () => {
    const code = `
import { createTransportErrorMapper } from '@ontrails/core';

const cliMapper = createTransportErrorMapper({
  auth: 9,
  cancelled: 130,
  conflict: 3,
  internal: 8,
  network: 7,
  not_found: 2,
  permission: 4,
  rate_limit: 6,
  timeout: 5,
  validation: 1,
});
`;

    const diagnostics = errorMappingCompleteness.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(0);
  });

  test('catches incomplete mapper registrations resolved through object properties', () => {
    const code = `
import { createTransportErrorMapper } from '@ontrails/core';

const transportErrorMap = {
  cli: {
    conflict: 3,
    internal: 8,
    not_found: 2,
    validation: 1,
  },
};

const cliMapper = createTransportErrorMapper(transportErrorMap.cli);
`;

    const diagnostics = errorMappingCompleteness.check(code, TEST_FILE);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('error-mapping-completeness');
    expect(diagnostics[0]?.severity).toBe('error');
    expect(diagnostics[0]?.message).toContain('auth');
    expect(diagnostics[0]?.message).toContain('cancelled');
    expect(diagnostics[0]?.line).toBeGreaterThan(0);
  });
});
