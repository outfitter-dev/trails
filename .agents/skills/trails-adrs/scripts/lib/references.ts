/* oxlint-disable max-statements -- cross-reference scanning and rewriting */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADR_DIR, ROOT } from './paths.ts';
import { listNumberedAdrs, listDrafts } from './discovery.ts';
import { serializeFrontmatter } from './frontmatter.ts';
import type { Frontmatter } from './frontmatter.ts';

/**
 * Fix cross-references after number padding changes.
 * Scans all ADR and draft files, replacing old short-padded filenames with new ones.
 */
export const fixCrossReferences = (): void => {
  const allFiles = [...listNumberedAdrs(), ...listDrafts()];
  const oldToNew = new Map<string, string>();

  for (const adr of readdirSync(ADR_DIR).filter((f) =>
    /^\d+-.*\.md$/.test(f)
  )) {
    const match = adr.match(/^(\d+)-(.+)$/);
    if (!match) {
      continue;
    }
    const [, numStr, rest] = match;
    if (!numStr || !rest) {
      continue;
    }
    const shortNum = String(Number(numStr));
    if (shortNum !== numStr) {
      oldToNew.set(`${shortNum}-${rest}`, adr);
    }
  }

  // Sort old names by length descending to avoid substring collisions
  const sortedEntries = [...oldToNew.entries()].toSorted(
    ([a], [b]) => b.length - a.length
  );

  for (const file of allFiles) {
    let content = readFileSync(file.path, 'utf8');
    let fileChanged = false;
    for (const [oldName, newName] of sortedEntries) {
      const pattern = new RegExp(
        `(?<![\\d])${oldName.replaceAll('.', '\\.')}`,
        'g'
      );
      const before = content;
      content = content.replaceAll(pattern, newName);
      if (content !== before) {
        fileChanged = true;
        console.log(`  ${file.filename}: ${oldName} → ${newName}`);
      }
    }
    if (fileChanged) {
      writeFileSync(file.path, content, 'utf8');
    }
  }
};

/** All files that might contain ADR cross-references. */
const allReferencingFiles = (): { path: string; filename: string }[] => {
  const files: { path: string; filename: string }[] = [];

  // ADR and draft files
  for (const f of [...listNumberedAdrs(), ...listDrafts()]) {
    files.push({ filename: f.filename, path: f.path });
  }

  // Non-ADR docs
  const docsDir = join(ROOT, 'docs');
  for (const f of readdirSync(docsDir)) {
    if (f.endsWith('.md')) {
      files.push({ filename: f, path: join(docsDir, f) });
    }
  }

  // AGENTS.md
  const agentsPath = join(ROOT, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    files.push({ filename: 'AGENTS.md', path: agentsPath });
  }

  return files;
};

/**
 * Rewrite references from a draft filename to a new numbered filename.
 * Called during promote to update all cross-references.
 *
 * Handles both relative references (`drafts/YYYYMMDD-slug.md`) and
 * bare references (`YYYYMMDD-slug.md`).
 */
export const rewriteDraftLinks = (
  oldDraftFilename: string,
  newNumberedFilename: string
): void => {
  const draftRef = `drafts/${oldDraftFilename}`;

  for (const file of allReferencingFiles()) {
    let content = readFileSync(file.path, 'utf8');
    let changed = false;

    // Replace "drafts/YYYYMMDD-slug.md" with the numbered filename
    // In ADR files, the relative path from docs/adr/ is just the filename
    // In docs/ files, the path is "adr/NNNN-slug.md" instead of "adr/drafts/YYYYMMDD-slug.md"
    if (content.includes(draftRef)) {
      content = content.replaceAll(draftRef, newNumberedFilename);
      changed = true;
    }

    // Replace bare "YYYYMMDD-slug.md" references (not preceded by "drafts/")
    const barePattern = new RegExp(
      `(?<!drafts/)${oldDraftFilename.replaceAll('.', '\\.')}`,
      'g'
    );
    const before = content;
    content = content.replaceAll(barePattern, newNumberedFilename);
    if (content !== before) {
      changed = true;
    }

    if (changed) {
      writeFileSync(file.path, content, 'utf8');
      console.log(
        `  ${file.filename}: ${oldDraftFilename} → ${newNumberedFilename}`
      );
    }
  }
};

/** Fields in frontmatter that may contain slug references to other ADRs. */
const SLUG_REF_FIELDS = ['depends_on', 'superseded_by'] as const;

/**
 * Rewrite a single frontmatter object's slug-based references to numeric
 * references. Returns a new frontmatter object and a `changed` flag so
 * callers can decide whether to rewrite the file on disk.
 *
 * Pure helper extracted for testability.
 */
export const rewriteSlugRefsInFrontmatter = (
  fm: Frontmatter,
  promotedSlug: string,
  promotedNumber: number
): { frontmatter: Frontmatter; changed: boolean } => {
  const numericRef = String(promotedNumber);
  const updated: Frontmatter = { ...fm };
  let changed = false;

  for (const field of SLUG_REF_FIELDS) {
    const current = updated[field];
    if (!Array.isArray(current)) {
      continue;
    }
    const rewritten = current.map((entry) =>
      typeof entry === 'string' && entry === promotedSlug ? numericRef : entry
    );
    const hasChange = rewritten.some((entry, idx) => entry !== current[idx]);
    if (hasChange) {
      (updated as Record<string, unknown>)[field] = rewritten;
      changed = true;
    }
  }

  return { changed, frontmatter: updated };
};

/**
 * Rewrite frontmatter references from a promoted draft's slug to its new
 * numeric id. Scans all remaining drafts and rewrites entries in their
 * `depends_on`, `superseded_by`, and any array fields that may reference
 * ADRs by slug.
 *
 * The rewrite is a structural fix: without it, promoting a draft leaves
 * every other draft that referenced it by slug pointing at a decision the
 * generated decision map can no longer resolve.
 */
export const rewriteFrontmatterSlugRefs = (
  promotedSlug: string,
  promotedNumber: number
): void => {
  for (const draft of listDrafts()) {
    const { frontmatter, changed } = rewriteSlugRefsInFrontmatter(
      draft.frontmatter,
      promotedSlug,
      promotedNumber
    );
    if (!changed) {
      continue;
    }
    const content = `${serializeFrontmatter(frontmatter)}\n${draft.body}`;
    writeFileSync(draft.path, content, 'utf8');
    console.log(
      `  ${draft.filename}: frontmatter refs ${promotedSlug} → ${promotedNumber}`
    );
  }
};
