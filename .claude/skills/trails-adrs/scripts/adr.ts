#!/usr/bin/env bun
/* oxlint-disable max-statements, complexity, no-plusplus, no-lonely-if, prefer-destructuring, require-hook -- CLI command implementations */
/**
 * ADR management script for the Trails project.
 *
 * Commands:
 *   create   — scaffold a new draft ADR
 *   promote  — move a draft to numbered ADR
 *   demote   — move a numbered ADR back to drafts
 *   update   — change title, slug, status, or number of an ADR
 *   check    — validate ADR format and consistency
 *   fix      — auto-fix common issues (number padding, cross-refs)
 *   map      — regenerate decision-map.json
 *
 * Usage:
 *   bun .claude/skills/trails-adrs/scripts/adr.ts create --title "My Decision" --slug my-decision
 *   bun .claude/skills/trails-adrs/scripts/adr.ts promote 20260401-my-decision
 *   bun .claude/skills/trails-adrs/scripts/adr.ts demote 0014-my-decision
 *   bun .claude/skills/trails-adrs/scripts/adr.ts check
 *   bun .claude/skills/trails-adrs/scripts/adr.ts map
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parseArgs, shouldApply, previewBanner, printHelp } from './lib/cli.ts';
import type { Args } from './lib/cli.ts';
import { writeDecisionMap } from './lib/decision-map.ts';
import {
  listNumberedAdrs,
  listDrafts,
  nextAdrNumber,
  padNumber,
  parseAdrNumber,
  resolveAdr,
  today,
  todayCompact,
} from './lib/discovery.ts';
import { extractTitle, serializeFrontmatter } from './lib/frontmatter.ts';
import type { Frontmatter } from './lib/frontmatter.ts';
import { gitMove } from './lib/git.ts';
import { rebuildIndex } from './lib/index.ts';
import { ADR_DIR, DRAFTS_DIR, INDEX_PATH, MAP_PATH } from './lib/paths.ts';
import {
  fixCrossReferences,
  rewriteDraftLinks,
  rewriteFrontmatterSlugRefs,
} from './lib/references.ts';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const cmdCreate = (args: Args): void => {
  const { title } = args;
  const slug =
    args.slug ??
    title
      ?.toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '');
  const created = args.created ?? today();

  if (!title) {
    console.error('Error: --title is required');
    process.exit(1);
  }
  if (!slug) {
    console.error('Error: --slug is required (or derived from --title)');
    process.exit(1);
  }

  mkdirSync(DRAFTS_DIR, { recursive: true });

  const filename = `${todayCompact()}-${slug}.md`;
  const path = join(DRAFTS_DIR, filename);

  if (existsSync(path)) {
    console.error(`Error: ${path} already exists`);
    process.exit(1);
  }

  const frontmatter = serializeFrontmatter({
    created,
    owners: ['[galligan](https://github.com/galligan)'],
    slug,
    status: 'draft',
    title,
    updated: created,
  });

  const content = `${frontmatter}

# ADR: ${title}

## Context

## Decision

## Consequences

## References
`;

  writeFileSync(path, content, 'utf8');
  console.log(`Created ${path}`);

  writeDecisionMap();
};

const cmdPromote = (args: Args): void => {
  const ref = args._[1];
  if (!ref) {
    console.error('Error: provide a slug, path, or filename to promote');
    process.exit(1);
  }

  const adr = resolveAdr(ref);
  if (!adr) {
    console.error(`Error: could not find ADR "${ref}"`);
    process.exit(1);
  }

  if (!adr.path.includes('/drafts/')) {
    console.error(`Error: ${adr.filename} is not a draft`);
    process.exit(1);
  }

  const apply = shouldApply(args);
  previewBanner(args);

  const status = args.status ?? 'accepted';
  const num = nextAdrNumber();
  const padded = padNumber(num);
  const slug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
  const newFilename = `${padded}-${slug}.md`;
  const newPath = join(ADR_DIR, newFilename);

  console.log(`Promote: ${adr.filename} → ${newFilename} (${status})`);

  if (args.supersedes) {
    const oldAdr = resolveAdr(args.supersedes);
    if (oldAdr) {
      console.log(`Supersede: ${oldAdr.filename} → superseded by ${padded}`);
    } else {
      console.warn(
        `Warning: could not find ADR "${args.supersedes}" to supersede`
      );
    }
  }

  if (!apply) {
    return;
  }

  const cleanTitle =
    adr.frontmatter.title ??
    extractTitle(adr.body)
      .replace(/^ADR(?:-\d+)?:\s*/, '')
      .trim();

  const updatedFm = {
    ...adr.frontmatter,
    id: num,
    slug,
    status,
    title: cleanTitle,
    updated: today(),
  };

  const updatedBody = adr.body.replace(/^#\s+ADR:\s*/m, `# ADR-${padded}: `);
  const content = `${serializeFrontmatter(updatedFm as Frontmatter)}\n${updatedBody}`;
  writeFileSync(adr.path, content, 'utf8');

  gitMove(adr.path, newPath);

  // Rewrite all references from draft filename to new numbered filename
  console.log('Rewriting draft references...');
  rewriteDraftLinks(adr.filename, newFilename);

  // Rewrite frontmatter depends_on/superseded_by references in peer drafts
  // from the promoted slug to the new numeric id, so the decision map keeps
  // resolving the dependency after promotion.
  console.log('Rewriting peer draft frontmatter references...');
  rewriteFrontmatterSlugRefs(slug, num);

  if (args.supersedes) {
    const oldAdr = resolveAdr(args.supersedes);
    if (oldAdr) {
      const oldFm = {
        ...oldAdr.frontmatter,
        status: 'superseded',
        superseded_by: [String(num)],
        updated: today(),
      };
      const oldContent = `${serializeFrontmatter(oldFm as Frontmatter)}\n${oldAdr.body}`;
      writeFileSync(oldAdr.path, oldContent, 'utf8');
    }
  }

  rebuildIndex();
  writeDecisionMap();
};

const cmdDemote = (args: Args): void => {
  const ref = args._[1];
  if (!ref) {
    console.error('Error: provide a slug, path, number, or filename to demote');
    process.exit(1);
  }

  const adr = resolveAdr(ref);
  if (!adr) {
    console.error(`Error: could not find ADR "${ref}"`);
    process.exit(1);
  }

  if (adr.path.includes('/drafts/')) {
    console.error(`Error: ${adr.filename} is already a draft`);
    process.exit(1);
  }

  const apply = shouldApply(args);
  previewBanner(args);

  const slug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
  const newFilename = `${todayCompact()}-${slug}.md`;

  console.log(`Demote: ${adr.filename} → drafts/${newFilename}`);

  if (!apply) {
    return;
  }

  mkdirSync(DRAFTS_DIR, { recursive: true });
  const newPath = join(DRAFTS_DIR, newFilename);

  const updatedFm = {
    ...adr.frontmatter,
    id: undefined,
    status: 'draft',
    updated: today(),
  };

  const updatedBody = adr.body.replace(/^#\s+ADR-\d+:\s*/m, '# ADR: ');
  const content = `${serializeFrontmatter(updatedFm as Frontmatter)}\n${updatedBody}`;
  writeFileSync(adr.path, content, 'utf8');

  gitMove(adr.path, newPath);

  rebuildIndex();
  writeDecisionMap();
};

const cmdCheck = (args: Args): void => {
  let errors = 0;
  let warnings = 0;
  let fixes = 0;
  const fix = args.yes === true;

  const report = (level: 'error' | 'warn', file: string, msg: string) => {
    const prefix = level === 'error' ? '✗' : '⚠';
    console.log(`  ${prefix} ${file}: ${msg}`);
    if (level === 'error') {
      errors++;
    } else {
      warnings++;
    }
  };

  const checkAdr = (
    adr: {
      filename: string;
      path: string;
      frontmatter: Frontmatter;
      title: string;
      body: string;
    },
    isDraft: boolean
  ) => {
    const fm = adr.frontmatter;

    if (!fm.status) {
      report('error', adr.filename, 'missing status in frontmatter');
    }
    if (!fm.created) {
      report('error', adr.filename, 'missing created date');
    }
    if (!fm.updated) {
      report('error', adr.filename, 'missing updated date');
    }
    if (!fm.owners || (fm.owners as string[]).length === 0) {
      report('warn', adr.filename, 'missing owners');
    }

    if (isDraft) {
      if (/^ADR-\d+:/.test(adr.title)) {
        report(
          'warn',
          adr.filename,
          'draft has a numbered title — should be "ADR: Title"'
        );
      }
    } else {
      if (!/^ADR-\d+:/.test(adr.title)) {
        report(
          'error',
          adr.filename,
          'numbered ADR missing "ADR-NNNN:" prefix in title'
        );
      }
    }

    const requiredSections = [
      '## Context',
      '## Decision',
      '## Consequences',
      '## References',
    ];
    for (const section of requiredSections) {
      if (!adr.body.includes(section)) {
        report('error', adr.filename, `missing required section: ${section}`);
      }
    }

    if (isDraft && fm.status !== 'draft') {
      report(
        'warn',
        adr.filename,
        `file in drafts/ but status is "${fm.status}"`
      );
    }
    if (!isDraft && fm.status === 'draft') {
      report(
        'error',
        adr.filename,
        'numbered ADR has status "draft" — should be proposed/accepted/rejected/superseded'
      );
    }

    // --- Alignment checks for id/slug/title ---
    const h1Clean = adr.title.replace(/^ADR(?:-\d+)?:\s*/, '').trim();
    const fileSlug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
    const fileNum = parseAdrNumber(adr.filename);

    // fm.title vs H1
    if (fm.title) {
      if (fm.title !== h1Clean) {
        report(
          'warn',
          adr.filename,
          `fm.title "${fm.title}" does not match H1 "${h1Clean}"`
        );
        if (fix) {
          const num = parseAdrNumber(adr.filename);
          const prefix = isDraft ? 'ADR:' : `ADR-${padNumber(num ?? 0)}:`;
          const newBody = adr.body.replace(
            /^#\s+ADR(?:-\d+)?:\s*.+$/m,
            `# ${prefix} ${fm.title}`
          );
          const content = `${serializeFrontmatter(fm as Frontmatter)}\n${newBody}`;
          writeFileSync(adr.path, content, 'utf8');
          console.log(`    fixed: rewrote H1 from fm.title`);
          fixes++;
        }
      }
    } else {
      report(
        'warn',
        adr.filename,
        'missing title in frontmatter (backfill recommended)'
      );
    }

    // fm.slug vs filename slug
    if (fm.slug) {
      if (fm.slug !== fileSlug) {
        report(
          'warn',
          adr.filename,
          `fm.slug "${fm.slug}" does not match filename slug "${fileSlug}"`
        );
        if (fix) {
          const numPrefix = adr.filename.match(/^(\d+)-/)?.[1] ?? '';
          const newFilename = `${numPrefix}-${fm.slug}.md`;
          const newPath = join(dirname(adr.path), newFilename);
          gitMove(adr.path, newPath);
          console.log(`    fixed: renamed ${adr.filename} → ${newFilename}`);
          fixes++;
        }
      }
    } else {
      report(
        'warn',
        adr.filename,
        'missing slug in frontmatter (backfill recommended)'
      );
    }

    // fm.id vs filename number (numbered ADRs only)
    if (!isDraft) {
      if (fm.id === undefined) {
        report(
          'warn',
          adr.filename,
          'missing id in frontmatter — backfill recommended'
        );
      } else if (fileNum !== null && fm.id !== fileNum) {
        report(
          'warn',
          adr.filename,
          `fm.id ${fm.id} does not match filename number ${fileNum}`
        );
        if (fix) {
          const padded = padNumber(fm.id);
          const slugPart = adr.filename
            .replace(/^\d+-/, '')
            .replace(/\.md$/, '');
          const newFilename = `${padded}-${slugPart}.md`;
          const newPath = join(ADR_DIR, newFilename);
          gitMove(adr.path, newPath);
          console.log(`    fixed: renamed ${adr.filename} → ${newFilename}`);
          fixes++;
        }
      }
    }
  };

  console.log('Checking numbered ADRs...');
  for (const adr of listNumberedAdrs()) {
    checkAdr(adr, false);
  }

  console.log('Checking drafts...');
  for (const adr of listDrafts()) {
    checkAdr(adr, true);
  }

  console.log('Checking index...');
  if (existsSync(INDEX_PATH)) {
    const indexContent = readFileSync(INDEX_PATH, 'utf8');
    for (const adr of listNumberedAdrs()) {
      if (!indexContent.includes(adr.filename)) {
        report(
          'error',
          'README.md',
          `numbered ADR ${adr.filename} missing from index`
        );
      }
    }
  } else {
    report('error', 'README.md', 'index file does not exist');
  }

  console.log('Checking decision map...');
  if (!existsSync(MAP_PATH)) {
    report(
      'warn',
      'decision-map.json',
      'decision map does not exist — run "adr map" to generate'
    );
  }

  if (fix && fixes > 0) {
    console.log(`\nApplied ${fixes} fixes. Rebuilding index and map...`);
    rebuildIndex();
    writeDecisionMap();
  }

  console.log(`\n${errors} errors, ${warnings} warnings`);
  if (errors > 0) {
    process.exit(1);
  }
};

const cmdMap = (): void => {
  writeDecisionMap();
};

const cmdUpdate = (args: Args): void => {
  const ref = args._[1];
  if (!ref) {
    console.error('Error: provide a slug, path, number, or filename to update');
    process.exit(1);
  }

  const adr = resolveAdr(ref);
  if (!adr) {
    console.error(`Error: could not find ADR "${ref}"`);
    process.exit(1);
  }

  const apply = shouldApply(args);
  previewBanner(args);

  const changes: string[] = [];
  let newSlugFilename: string | undefined;
  let newRenumberFilename: string | undefined;

  if (args.title) {
    changes.push(`Title → "${args.title}"`);
  }
  if (args.slug) {
    const isDraft = adr.path.includes('/drafts/');
    const numPrefix = isDraft
      ? (adr.filename.match(/^(\d+)-/)?.[1] ?? todayCompact())
      : (adr.filename.match(/^(\d+)-/)?.[1] ?? '0000');
    newSlugFilename = `${numPrefix}-${args.slug}.md`;
    changes.push(`Slug → "${args.slug}" (${newSlugFilename})`);
  }
  if (args.status) {
    changes.push(`Status → "${args.status}"`);
  }
  if (args.renumber) {
    if (adr.path.includes('/drafts/')) {
      console.error('Error: cannot renumber a draft — promote it first');
      process.exit(1);
    }
    const newNum = Number(args.renumber);
    if (Number.isNaN(newNum)) {
      console.error(`Error: invalid number "${args.renumber}"`);
      process.exit(1);
    }
    const padded = padNumber(newNum);
    const slug = adr.filename.replace(/^\d+-/, '').replace(/\.md$/, '');
    newRenumberFilename = `${padded}-${slug}.md`;
    changes.push(`Renumber → ${padded} (${newRenumberFilename})`);
  }

  if (changes.length === 0) {
    console.error(
      'Error: no changes specified. Use --title, --slug, --status, or --renumber'
    );
    process.exit(1);
  }

  console.log(`Update: ${adr.filename}`);
  for (const change of changes) {
    console.log(`  ${change}`);
  }

  if (!apply) {
    return;
  }

  let { body } = adr;
  const fm = { ...adr.frontmatter };
  let currentPath = adr.path;

  if (args.title) {
    const isDraft = currentPath.includes('/drafts/');
    const num = parseAdrNumber(adr.filename);
    const prefix = isDraft ? 'ADR:' : `ADR-${padNumber(num ?? 0)}:`;
    body = body.replace(
      /^#\s+ADR(?:-\d+)?:\s*.+$/m,
      `# ${prefix} ${args.title}`
    );
    fm.title = args.title;
    fm.updated = today();
  }

  if (args.slug) {
    fm.slug = args.slug;
  }

  if (args.status) {
    fm.status = args.status;
    fm.updated = today();
  }

  const content = `${serializeFrontmatter(fm as Frontmatter)}\n${body}`;
  writeFileSync(currentPath, content, 'utf8');

  if (args.slug && newSlugFilename) {
    const newPath = join(dirname(currentPath), newSlugFilename);
    gitMove(currentPath, newPath);
    currentPath = newPath;
  }

  if (args.renumber && newRenumberFilename) {
    const newNum = Number(args.renumber);
    const padded = padNumber(newNum);
    body = body.replace(/^#\s+ADR-\d+:/m, `# ADR-${padded}:`);
    fm.id = newNum;
    fm.updated = today();
    const updatedContent = `${serializeFrontmatter(fm as Frontmatter)}\n${body}`;
    writeFileSync(currentPath, updatedContent, 'utf8');

    const newPath = join(ADR_DIR, newRenumberFilename);
    gitMove(currentPath, newPath);
  }

  rebuildIndex();
  writeDecisionMap();
};

const cmdFix = (args: Args): void => {
  const apply = shouldApply(args);
  previewBanner(args);
  let fixes = 0;

  console.log('Checking number padding...');
  for (const adr of listNumberedAdrs()) {
    const match = adr.filename.match(/^(\d+)-(.+)$/);
    if (!match) {
      continue;
    }
    const [, numStr, rest] = match;
    if (!numStr || !rest) {
      continue;
    }
    const num = Number(numStr);
    const padded = padNumber(num);

    if (numStr !== padded) {
      const newFilename = `${padded}-${rest}`;
      const newPath = join(ADR_DIR, newFilename);
      console.log(`  ${adr.filename} → ${newFilename}`);

      if (apply) {
        let { body } = adr;
        body = body.replace(
          new RegExp(`^#\\s+ADR-${numStr}:`, 'm'),
          `# ADR-${padded}:`
        );
        const fm = { ...adr.frontmatter, updated: today() };
        const content = `${serializeFrontmatter(fm as Frontmatter)}\n${body}`;
        writeFileSync(adr.path, content, 'utf8');

        gitMove(adr.path, newPath);
      }
      fixes++;
    }
  }

  if (apply && fixes > 0) {
    console.log('Updating cross-references...');
    fixCrossReferences();
    rebuildIndex();
    writeDecisionMap();
  }

  console.log(`\n${fixes} fixes ${apply ? '' : 'would be '}applied`);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args._.length === 0) {
    printHelp();
    process.exit(0);
  }

  const command = args._[0];

  switch (command) {
    case 'create': {
      cmdCreate(args);
      break;
    }
    case 'promote': {
      cmdPromote(args);
      break;
    }
    case 'demote': {
      cmdDemote(args);
      break;
    }
    case 'update': {
      cmdUpdate(args);
      break;
    }
    case 'fix': {
      cmdFix(args);
      break;
    }
    case 'check': {
      cmdCheck(args);
      break;
    }
    case 'map': {
      cmdMap();
      break;
    }
    default: {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
    }
  }
};

main();
