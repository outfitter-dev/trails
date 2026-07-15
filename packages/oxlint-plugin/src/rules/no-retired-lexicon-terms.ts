import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  asIdentifierName,
  asLiteralString,
  getImportSourceFromImportDeclaration,
  getImportSourceFromReExportDeclaration,
  getImportSourceFromRequire,
  isRepoSourceFile,
  reportNode,
} from './shared.js';
import type { RuleModule } from './shared.js';

interface RetiredLexiconTerm {
  readonly concept: string;
  readonly replacement?: string;
  readonly term: string;
}

const RESERVED_TERMS_HEADING = '## Reserved Terms';
const NEXT_HEADING_PATTERN = /^## /mu;
const TABLE_ROW_PATTERN = /^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/u;
const TERM_OPTION_KEY = 'retiredTerms';

let retiredTermsCache: readonly RetiredLexiconTerm[] | undefined;
let lexiconPathCache: string | undefined;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object');

const extractReservedTermsSection = (content: string): string => {
  const headingIndex = content.indexOf(RESERVED_TERMS_HEADING);

  if (headingIndex === -1) {
    return '';
  }

  const afterHeading = content.slice(
    headingIndex + RESERVED_TERMS_HEADING.length
  );
  const nextHeadingIndex = afterHeading.search(NEXT_HEADING_PATTERN);

  return nextHeadingIndex === -1
    ? afterHeading
    : afterHeading.slice(0, nextHeadingIndex);
};

const extractReplacement = (concept: string): string | undefined =>
  concept.match(/\bUse\s+`([^`]+)`/iu)?.[1];

const findLexiconPath = (
  startDirectory = process.cwd()
): string | undefined => {
  let currentDirectory = startDirectory;

  while (true) {
    const candidate = join(currentDirectory, 'docs', 'lexicon.md');

    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = parentDirectory;
  }
};

export const parseRetiredLexiconTerms = (
  content: string
): readonly RetiredLexiconTerm[] =>
  extractReservedTermsSection(content)
    .split(/\r?\n/u)
    .flatMap((line): RetiredLexiconTerm[] => {
      const match = line.match(TABLE_ROW_PATTERN);

      if (!match) {
        return [];
      }

      const [, term, concept] = match;

      if (!term || !concept || !/\b(?:historical|retired)\b/iu.test(concept)) {
        return [];
      }

      const replacement = extractReplacement(concept);
      const base = {
        concept,
        term,
      };

      return [replacement ? { ...base, replacement } : base];
    });

const loadRetiredLexiconTerms = (): readonly RetiredLexiconTerm[] => {
  if (retiredTermsCache) {
    return retiredTermsCache;
  }

  lexiconPathCache = findLexiconPath();
  retiredTermsCache = lexiconPathCache
    ? parseRetiredLexiconTerms(readFileSync(lexiconPathCache, 'utf8'))
    : [];

  return retiredTermsCache;
};

const resolveRetiredTerms = (
  options: readonly unknown[]
): readonly RetiredLexiconTerm[] => {
  const configured = (options[0] as Record<string, unknown> | undefined)?.[
    TERM_OPTION_KEY
  ];

  if (!Array.isArray(configured)) {
    return loadRetiredLexiconTerms();
  }

  return configured.flatMap((candidate): RetiredLexiconTerm[] => {
    if (!isObject(candidate) || typeof candidate['term'] !== 'string') {
      return [];
    }

    const concept =
      typeof candidate['concept'] === 'string'
        ? candidate['concept']
        : 'configured';
    const base = {
      concept,
      term: candidate['term'],
    };

    return typeof candidate['replacement'] === 'string'
      ? [{ ...base, replacement: candidate['replacement'] }]
      : [base];
  });
};

const normalizeForMatch = (value: string): string => value.toLowerCase();

const findRetiredTerm = (
  value: string,
  terms: readonly RetiredLexiconTerm[]
): RetiredLexiconTerm | undefined => {
  const normalized = normalizeForMatch(value);
  return terms.find((term) =>
    normalized.includes(normalizeForMatch(term.term))
  );
};

const isLocalOrOnTrailsImport = (importSource: string): boolean =>
  importSource.startsWith('.') ||
  importSource.startsWith('/') ||
  importSource.startsWith('@ontrails/');

const getPropertyName = (node: unknown): string | undefined => {
  if (!isObject(node) || node['type'] !== 'Property') {
    return undefined;
  }

  if (node['computed']) {
    return undefined;
  }

  return asLiteralString(node['key']);
};

const getLiteralMemberPropertyName = (node: unknown): string | undefined => {
  if (!isObject(node) || node['type'] !== 'MemberExpression') {
    return undefined;
  }

  const { property } = node;

  if (!isObject(property) || property['type'] !== 'Literal') {
    return undefined;
  }

  return asLiteralString(property);
};

const shouldCheckFile = (filePath: string | undefined): boolean =>
  isRepoSourceFile(filePath);

const formatReplacement = (term: RetiredLexiconTerm): string =>
  term.replacement ? ` Use '${term.replacement}'.` : '';

export const noRetiredLexiconTermsRule: RuleModule = {
  create(context) {
    if (!shouldCheckFile(context.filename)) {
      return {};
    }

    const retiredTerms = resolveRetiredTerms(context.options);

    if (retiredTerms.length === 0) {
      return {};
    }

    const reportIfRetiredTerm = (
      node: unknown,
      value: string | undefined,
      role: string
    ): void => {
      if (!value) {
        return;
      }

      const retiredTerm = findRetiredTerm(value, retiredTerms);

      if (!retiredTerm) {
        return;
      }

      reportNode({
        context,
        data: {
          replacement: formatReplacement(retiredTerm),
          role,
          term: retiredTerm.term,
          value,
        },
        messageId: 'noRetiredLexiconTerms',
        node,
      });
    };

    const reportIfRetiredImport = (
      node: unknown,
      importSource: string | undefined
    ): void => {
      if (!importSource || !isLocalOrOnTrailsImport(importSource)) {
        return;
      }

      reportIfRetiredTerm(node, importSource, 'import path');
    };

    return {
      CallExpression(node) {
        reportIfRetiredImport(node, getImportSourceFromRequire(node));
      },
      ExportAllDeclaration(node) {
        reportIfRetiredImport(
          node,
          getImportSourceFromReExportDeclaration(node)
        );
      },
      ExportNamedDeclaration(node) {
        reportIfRetiredImport(
          node,
          getImportSourceFromReExportDeclaration(node)
        );
      },
      Identifier(node) {
        reportIfRetiredTerm(node, asIdentifierName(node), 'identifier');
      },
      ImportDeclaration(node) {
        reportIfRetiredImport(node, getImportSourceFromImportDeclaration(node));
      },
      MemberExpression(node) {
        reportIfRetiredTerm(
          node,
          getLiteralMemberPropertyName(node),
          'literal member property'
        );
      },
      Property(node) {
        reportIfRetiredTerm(node, getPropertyName(node), 'object key');
      },
    };
  },
  meta: {
    docs: {
      description:
        'Warn when source identifiers, import paths, or literal symbols use retired Trails lexicon terms.',
      recommended: true,
    },
    messages: {
      noRetiredLexiconTerms:
        "Retired Trails vocabulary '{{term}}' appears in a source {{role}} ('{{value}}').{{replacement}} Keep historical or external mentions out of source symbol slots.",
    },
    schema: [
      {
        additionalProperties: false,
        properties: {
          [TERM_OPTION_KEY]: {
            items: {
              additionalProperties: false,
              properties: {
                concept: {
                  type: 'string',
                },
                replacement: {
                  type: 'string',
                },
                term: {
                  type: 'string',
                },
              },
              required: ['term'],
              type: 'object',
            },
            type: 'array',
          },
        },
        type: 'object',
      },
    ],
    type: 'suggestion',
  },
};
