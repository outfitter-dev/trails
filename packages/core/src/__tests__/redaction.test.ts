import { describe, test, expect } from 'bun:test';

import { DEFAULT_SENSITIVE_KEYS, createRedactor } from '../redaction/index.js';

// ---------------------------------------------------------------------------
// DEFAULT_PATTERNS
// ---------------------------------------------------------------------------

describe('DEFAULT_PATTERNS', () => {
  test('matches credit card numbers', () => {
    const input = 'card: 4111-1111-1111-1111 end';
    const redactor = createRedactor();
    expect(redactor.redact(input)).toBe('card: [REDACTED] end');
  });

  test('matches credit card numbers with spaces', () => {
    const input = 'card: 4111 1111 1111 1111 end';
    const redactor = createRedactor();
    expect(redactor.redact(input)).toBe('card: [REDACTED] end');
  });

  test('matches SSNs', () => {
    const input = 'ssn is 123-45-6789';
    const redactor = createRedactor();
    expect(redactor.redact(input)).toBe('ssn is [REDACTED]');
  });

  test('matches bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9';
    const redactor = createRedactor();
    expect(redactor.redact(input)).toBe('Authorization: [REDACTED]');
  });

  test('matches basic auth', () => {
    const input = 'Authorization: Basic dXNlcjpwYXNz';
    const redactor = createRedactor();
    expect(redactor.redact(input)).toBe('Authorization: [REDACTED]');
  });

  test('matches API keys with sk- prefix', () => {
    const input = 'key: sk-abc123def456ghi';
    const redactor = createRedactor();
    expect(redactor.redact(input)).toBe('key: [REDACTED]');
  });

  test('matches API keys with pk_ prefix', () => {
    const input = 'key: pk_live_abc123def456';
    const redactor = createRedactor();
    expect(redactor.redact(input)).toBe('key: [REDACTED]');
  });

  test('matches API keys with sk_ prefix', () => {
    const input = 'key: sk_test_abc123def456';
    const redactor = createRedactor();
    expect(redactor.redact(input)).toBe('key: [REDACTED]');
  });

  test('matches JWT tokens', () => {
    const input =
      'jwt: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456';
    const redactor = createRedactor();
    expect(redactor.redact(input)).toBe('jwt: [REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SENSITIVE_KEYS
// ---------------------------------------------------------------------------

describe('DEFAULT_SENSITIVE_KEYS', () => {
  test('includes expected keys', () => {
    const expected = [
      'password',
      'secret',
      'token',
      'apiKey',
      'api_key',
      'authorization',
      'cookie',
      'ssn',
      'creditCard',
      'credit_card',
    ];
    for (const key of expected) {
      expect(DEFAULT_SENSITIVE_KEYS).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// createRedactor().redact()
// ---------------------------------------------------------------------------

describe('createRedactor().redact()', () => {
  test('replaces all matching patterns in a string', () => {
    const redactor = createRedactor();
    const input = 'cc: 4111-1111-1111-1111 ssn: 123-45-6789';
    const result = redactor.redact(input);
    expect(result).toBe('cc: [REDACTED] ssn: [REDACTED]');
  });

  test('returns string unchanged when no patterns match', () => {
    const redactor = createRedactor();
    const input = 'just a normal string';
    expect(redactor.redact(input)).toBe('just a normal string');
  });

  test('works correctly when called multiple times (regex lastIndex reset)', () => {
    const redactor = createRedactor();
    const input = 'key: sk-abc123def456ghi';
    expect(redactor.redact(input)).toBe('key: [REDACTED]');
    expect(redactor.redact(input)).toBe('key: [REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// createRedactor().redactObject()
// ---------------------------------------------------------------------------

describe('createRedactor().redactObject()', () => {
  test('redacts values for sensitive keys', () => {
    const redactor = createRedactor();
    const obj = { password: 's3cret', username: 'alice' };
    const result = redactor.redactObject(obj);
    expect(result.password).toBe('[REDACTED]');
    expect(result.username).toBe('alice');
  });

  test('matches sensitive keys case-insensitively', () => {
    const redactor = createRedactor();
    const obj = { Authorization: 'Bearer xyz', PASSWORD: 's3cret' };
    const result = redactor.redactObject(obj);
    expect(result.PASSWORD).toBe('[REDACTED]');
    expect(result.Authorization).toBe('[REDACTED]');
  });

  test('applies pattern matching to non-sensitive string values', () => {
    const redactor = createRedactor();
    const obj = { message: 'card 4111-1111-1111-1111 found' };
    const result = redactor.redactObject(obj);
    expect(result.message).toBe('card [REDACTED] found');
  });

  test('does not modify the original object', () => {
    const redactor = createRedactor();
    const obj = { password: 's3cret' };
    redactor.redactObject(obj);
    expect(obj.password).toBe('s3cret');
  });

  test('preserves non-string values', () => {
    const redactor = createRedactor();
    const obj = { count: 42, enabled: true, tags: null as unknown };
    const result = redactor.redactObject(obj);
    expect(result.count).toBe(42);
    expect(result.enabled).toBe(true);
    expect(result.tags).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Nested objects
// ---------------------------------------------------------------------------

describe('nested objects', () => {
  test('redacts deeply nested sensitive keys', () => {
    const redactor = createRedactor();
    const obj = {
      user: {
        credentials: {
          password: 's3cret',
          token: 'tok_abc123',
        },
        name: 'alice',
      },
    };
    const result = redactor.redactObject(obj);
    expect(result.user.name).toBe('alice');
    expect(result.user.credentials.password).toBe('[REDACTED]');
    expect(result.user.credentials.token).toBe('[REDACTED]');
  });

  test('redacts values inside arrays', () => {
    const redactor = createRedactor();
    const obj = {
      headers: [
        { key: 'Authorization', value: 'Bearer abc123' },
        { key: 'Content-Type', value: 'application/json' },
      ],
    };
    const result = redactor.redactObject(obj);
    expect(result.headers).toHaveLength(2);
    expect(result.headers[0]?.value).toBe('[REDACTED]');
    expect(result.headers[1]?.value).toBe('application/json');
  });

  test('handles deeply nested pattern matches', () => {
    const redactor = createRedactor();
    const obj = {
      data: {
        nested: {
          info: 'ssn: 123-45-6789',
        },
      },
    };
    const result = redactor.redactObject(obj);
    expect(result.data.nested.info).toBe('ssn: [REDACTED]');
  });
});

// ---------------------------------------------------------------------------
// Custom config
// ---------------------------------------------------------------------------

describe('custom config', () => {
  test('custom patterns work', () => {
    const redactor = createRedactor({
      patterns: [/secret-\w+/g],
    });
    expect(redactor.redact('found secret-banana here')).toBe(
      'found [REDACTED] here'
    );
    // Default patterns should not apply
    expect(redactor.redact('4111-1111-1111-1111')).toBe('4111-1111-1111-1111');
  });

  test('custom replacement string works', () => {
    const redactor = createRedactor({ replacement: '***' });
    const obj = { password: 's3cret' };
    const result = redactor.redactObject(obj);
    expect(result.password).toBe('***');
  });

  test('custom sensitive keys work', () => {
    const redactor = createRedactor({
      sensitiveKeys: ['myCustomKey'],
    });
    const obj = { myCustomKey: 'hidden', password: 'visible' };
    const result = redactor.redactObject(obj);
    expect(result.myCustomKey).toBe('[REDACTED]');
    // "password" is not in custom keys, so not redacted by key match
    expect(result.password).toBe('visible');
  });
});
