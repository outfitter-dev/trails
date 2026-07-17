const structuredOutputValues = new Set(['json', 'jsonl']);

/** Whether the current CLI invocation reserves output channels for JSON. */
export const usesStructuredCliOutput = (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>
): boolean => {
  const optionTerminator = argv.indexOf('--');
  const optionArguments =
    optionTerminator === -1 ? argv : argv.slice(0, optionTerminator);
  if (
    optionArguments.includes('--json') ||
    optionArguments.includes('--jsonl')
  ) {
    return true;
  }

  let outputValue: string | undefined;
  for (const [index, argument] of optionArguments.entries()) {
    if (argument === '--output') {
      const next = optionArguments[index + 1];
      outputValue =
        next === undefined || next.startsWith('-') ? undefined : next;
      continue;
    }
    const longAttached = argument.match(/^--output=(.*)$/)?.[1];
    if (longAttached !== undefined) {
      outputValue = longAttached === '' ? undefined : longAttached;
      continue;
    }
    const shortOutput = argument.match(/^-q*o=?(.*)$/)?.[1];
    if (shortOutput !== undefined) {
      if (shortOutput !== '') {
        outputValue = shortOutput;
        continue;
      }
      const next = optionArguments[index + 1];
      outputValue =
        next === undefined || next.startsWith('-') ? undefined : next;
    }
  }

  if (outputValue !== undefined) {
    return structuredOutputValues.has(outputValue);
  }
  return env['TRAILS_JSON'] === '1' || env['TRAILS_JSONL'] === '1';
};
