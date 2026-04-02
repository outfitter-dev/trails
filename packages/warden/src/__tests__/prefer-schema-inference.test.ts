import { describe, expect, test } from 'bun:test';

import { preferSchemaInference } from '../rules/prefer-schema-inference.js';

describe('prefer-schema-inference', () => {
  test('warns when a fields label only repeats the derived humanized label', () => {
    const code = `
trail("entity.show", {
  input: z.object({ firstName: z.string() }),
  fields: {
    firstName: { label: "First Name" },
  },
  blaze: (input) => Result.ok(input),
})`;

    const diagnostics = preferSchemaInference.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.rule).toBe('prefer-schema-inference');
    expect(diagnostics[0]?.message).toContain('firstName');
  });

  test('warns when enum options only repeat schema-derived values', () => {
    const code = `
trail("entity.paint", {
  input: z.object({
    color: z.enum(["red", "green"]),
  }),
  fields: {
    color: {
      options: [{ value: "red" }, { value: "green" }],
    },
  },
  blaze: (input) => Result.ok(input),
})`;

    const diagnostics = preferSchemaInference.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('schema-derived options');
  });

  test('allows custom labels and enriched enum options', () => {
    const code = `
trail("entity.paint", {
  input: z.object({
    color: z.enum(["red", "green"]),
    displayName: z.string().describe("Display name"),
  }),
  fields: {
    color: {
      options: [
        { value: "red", label: "Red" },
        { value: "green", hint: "Safe default" },
      ],
    },
    displayName: { label: "Public name" },
  },
  blaze: (input) => Result.ok(input),
})`;

    const diagnostics = preferSchemaInference.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(0);
  });

  test('does not warn when the override carries other field metadata', () => {
    const code = `
trail("entity.show", {
  input: z.object({ firstName: z.string() }),
  fields: {
    firstName: {
      label: "First Name",
      message: "Who should we greet?",
    },
  },
  blaze: (input) => Result.ok(input),
})`;

    const diagnostics = preferSchemaInference.check(code, 'src/entity.ts');

    expect(diagnostics).toHaveLength(0);
  });
});
