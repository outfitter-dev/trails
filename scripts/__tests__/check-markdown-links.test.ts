import { describe, expect, test } from 'bun:test';

import {
  checkMarkdownDocumentLinks,
  collectAnchors,
  extractMarkdownLinks,
} from '../check-markdown-links.ts';

describe('extractMarkdownLinks', () => {
  test('skips fenced code blocks while collecting markdown links', () => {
    const links = extractMarkdownLinks(`See [Guide](guide.md).

\`\`\`ts
const fake = "[Broken](missing.md)";
\`\`\`

[ADR]: docs/adr.md "Decision record"
`);

    expect(links).toEqual([
      { line: 1, target: 'guide.md', text: 'Guide' },
      { line: 7, target: 'docs/adr.md', text: 'ADR' },
    ]);
  });

  test('strips inline code before scanning links', () => {
    const links = extractMarkdownLinks(
      'Use `[fake](missing.md)` but keep [real](docs/index.md).'
    );

    expect(links).toEqual([{ line: 1, target: 'docs/index.md', text: 'real' }]);
  });
});

describe('collectAnchors', () => {
  test('matches GitHub-style heading anchors and duplicates', () => {
    const anchors = collectAnchors(`# Hello, World!

## Hello World

## \`deriveCliCommands()\`
`);

    expect([...anchors]).toEqual([
      'hello-world',
      'hello-world-1',
      'deriveclicommands',
    ]);
  });

  test('skips fenced code blocks while collecting heading anchors', () => {
    const anchors = collectAnchors(`# Real

\`\`\`md
# Not Real
\`\`\`

## Also Real
`);

    expect([...anchors]).toEqual(['real', 'also-real']);
  });
});

describe('checkMarkdownDocumentLinks', () => {
  test('reports missing relative targets with source line detail', () => {
    const failures = checkMarkdownDocumentLinks(
      'docs/example.md',
      '[Missing](missing.md)'
    );

    expect(failures).toEqual([
      {
        line: 1,
        message: 'target does not exist: docs/missing.md',
        sourcePath: 'docs/example.md',
        target: 'missing.md',
        text: 'Missing',
      },
    ]);
  });

  test('checks anchors in existing target documents', () => {
    const documents = new Map([['docs/index.md', '# New to Trails\n']]);
    const failures = checkMarkdownDocumentLinks(
      'docs/example.md',
      '[Good](index.md#new-to-trails)\n[Bad](index.md#not-here)',
      {
        readAnchors: (path) => collectAnchors(documents.get(path) ?? ''),
        targetExists: (path) => documents.has(path),
      }
    );

    expect(failures).toEqual([
      {
        line: 2,
        message: 'anchor does not exist in docs/index.md: #not-here',
        sourcePath: 'docs/example.md',
        target: 'index.md#not-here',
        text: 'Bad',
      },
    ]);
  });
});
