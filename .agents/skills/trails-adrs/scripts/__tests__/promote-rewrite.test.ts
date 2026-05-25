import { describe, expect, test } from 'bun:test';

import { parseFrontmatter, serializeFrontmatter } from '../lib/frontmatter.ts';
import type { Frontmatter } from '../lib/frontmatter.ts';
import { rewriteSlugRefsInFrontmatter } from '../lib/references.ts';

describe('rewriteSlugRefsInFrontmatter', () => {
  test('rewrites a slug reference in depends_on to the numeric id', () => {
    const fm: Frontmatter = {
      depends_on: [
        '9',
        '14',
        'connector-extraction-and-the-with-packaging-model',
      ],
      slug: 'some-draft',
      status: 'draft',
      title: 'Some Draft',
    };

    const { frontmatter, changed } = rewriteSlugRefsInFrontmatter(
      fm,
      'connector-extraction-and-the-with-packaging-model',
      29
    );

    expect(changed).toBe(true);
    expect(frontmatter.depends_on).toEqual(['9', '14', '29']);
    // Ensure we did not mutate the input
    expect(fm.depends_on).toEqual([
      '9',
      '14',
      'connector-extraction-and-the-with-packaging-model',
    ]);
  });

  test('returns unchanged when the slug is not referenced', () => {
    const fm: Frontmatter = {
      depends_on: ['9', '14', 'other-slug'],
      slug: 'some-draft',
      status: 'draft',
    };

    const { frontmatter, changed } = rewriteSlugRefsInFrontmatter(
      fm,
      'connector-extraction-and-the-with-packaging-model',
      29
    );

    expect(changed).toBe(false);
    expect(frontmatter.depends_on).toEqual(['9', '14', 'other-slug']);
  });

  test('rewrites slug references in superseded_by', () => {
    const fm: Frontmatter = {
      status: 'draft',
      superseded_by: ['old-slug'],
    };

    const { frontmatter, changed } = rewriteSlugRefsInFrontmatter(
      fm,
      'old-slug',
      42
    );

    expect(changed).toBe(true);
    expect(frontmatter.superseded_by).toEqual(['42']);
  });

  test('rewrites multiple fields in a single pass', () => {
    const fm: Frontmatter = {
      depends_on: ['target-slug'],
      status: 'draft',
      superseded_by: ['target-slug'],
    };

    const { frontmatter, changed } = rewriteSlugRefsInFrontmatter(
      fm,
      'target-slug',
      7
    );

    expect(changed).toBe(true);
    expect(frontmatter.depends_on).toEqual(['7']);
    expect(frontmatter.superseded_by).toEqual(['7']);
  });

  test('handles missing depends_on gracefully', () => {
    const fm: Frontmatter = {
      slug: 'some-draft',
      status: 'draft',
    };

    const { frontmatter, changed } = rewriteSlugRefsInFrontmatter(
      fm,
      'anything',
      1
    );

    expect(changed).toBe(false);
    expect(frontmatter.depends_on).toBeUndefined();
  });
});

const RAW_DRAFT = `---
slug: backend-agnostic-store-schemas
title: Backend-Agnostic Store Schemas
status: draft
created: 2026-04-09
updated: 2026-04-09
owners: ['[galligan](https://github.com/galligan)']
depends_on: [9, 14, 16, 22, connector-extraction-and-the-with-packaging-model]
---

# ADR: Backend-Agnostic Store Schemas

## Context
`;

const REWRITTEN_NUMERIC = ['9', '14', '16', '22', '29'];

describe('frontmatter round-trip after slug rewrite', () => {
  test('parseFrontmatter captures the raw slug depends_on list', () => {
    const { frontmatter } = parseFrontmatter(RAW_DRAFT);
    expect(frontmatter.depends_on).toEqual([
      '9',
      '14',
      '16',
      '22',
      'connector-extraction-and-the-with-packaging-model',
    ]);
  });

  test('rewriteSlugRefsInFrontmatter + serialize produces numeric depends_on', () => {
    const { frontmatter } = parseFrontmatter(RAW_DRAFT);
    const { frontmatter: rewritten, changed } = rewriteSlugRefsInFrontmatter(
      frontmatter,
      'connector-extraction-and-the-with-packaging-model',
      29
    );
    expect(changed).toBe(true);
    expect(rewritten.depends_on).toEqual(REWRITTEN_NUMERIC);
    const serialized = serializeFrontmatter(rewritten);
    expect(serialized).toContain('depends_on: [9, 14, 16, 22, 29]');
    expect(serialized).not.toContain('connector-extraction');
  });

  test('re-parsing the rewritten document preserves body and slug', () => {
    const { frontmatter, body } = parseFrontmatter(RAW_DRAFT);
    const { frontmatter: rewritten } = rewriteSlugRefsInFrontmatter(
      frontmatter,
      'connector-extraction-and-the-with-packaging-model',
      29
    );
    const reassembled = `${serializeFrontmatter(rewritten)}\n${body}`;
    const reparsed = parseFrontmatter(reassembled);
    expect(reparsed.frontmatter.depends_on).toEqual(REWRITTEN_NUMERIC);
    expect(reparsed.frontmatter.slug).toBe('backend-agnostic-store-schemas');
    expect(reparsed.body).toContain('# ADR: Backend-Agnostic Store Schemas');
  });
});
