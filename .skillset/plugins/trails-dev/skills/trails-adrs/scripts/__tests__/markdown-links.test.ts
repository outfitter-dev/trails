import { describe, expect, test } from 'bun:test';

import {
  extractMarkdownLinks,
  rewriteMarkdownLinks,
} from '../lib/markdown-links.ts';

describe('Markdown destination spans', () => {
  test.each([
    [
      'list content after a nested quote',
      '- item\n  > quote\n\n  [live](./target.md)',
    ],
    [
      'list content after a quoted fence',
      '- item\n  > ```\n  > [literal](missing.md)\n  > ```\n\n  [live](./target.md)',
    ],
    ['invalid backtick fence', '```bad`info\n[live](./target.md)'],
    [
      'literal backticks in a title',
      '[live](./target.md "a`title")\n\n`unmatched',
    ],
    [
      'literal backticks across blocks',
      '`unmatched\n\n# [live](./target.md)\n\n`unmatched',
    ],
    ['a table cell', '| Heading |\n| --- |\n| [live](./target.md) |'],
    ['a footnote', 'See[^1].\n\n[^1]: [live](./target.md)'],
    ['a multiline label', '[live\nlabel](./target.md)'],
    ['a multiline reference definition', '> [live]:\n>   <./target.md>'],
    ['CRLF and astral characters', '📍\r\n[live](<./target.md> "title")\r\n'],
    ['a UTF-8 BOM', '\uFEFF[live](./target.md)'],
  ])('rewrites only a real target: %s', (_name, markdown) => {
    expect(extractMarkdownLinks(markdown).map(({ target }) => target)).toEqual([
      './target.md',
    ]);
    expect(rewriteMarkdownLinks(markdown, () => '../target.md')).toBe(
      markdown.replace('./target.md', '../target.md')
    );
  });

  test.each([
    [
      'paragraph text that resembles a definition',
      'Paragraph\n[fake]:./target.md',
    ],
    ['indented code in a list', '- item\n\n      [fake](./target.md)'],
    ['quoted fenced code', '> ```\n> [fake](./target.md)\n> ```'],
    ['an HTML comment', '<!-- [fake](./target.md) -->'],
    ['an inline code span', '`[fake](./target.md)`'],
  ])('leaves literal content alone: %s', (_name, markdown) => {
    expect(extractMarkdownLinks(markdown)).toEqual([]);
    expect(rewriteMarkdownLinks(markdown, () => '../target.md')).toBe(markdown);
  });

  test('reports labels and lines for nested images and definitions', () => {
    const markdown =
      '[![Photo](<pic.png>)](page.md)\r\n\r\n  [guide]:\r\n    guide.md\r\n';
    expect(extractMarkdownLinks(markdown)).toEqual([
      { line: 1, target: 'pic.png', text: 'Photo' },
      { line: 1, target: 'page.md', text: '![Photo](<pic.png>)' },
      { line: 4, target: 'guide.md', text: 'guide' },
    ]);
  });
});
