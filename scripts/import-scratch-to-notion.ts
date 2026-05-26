#!/usr/bin/env bun

import { spawnSync } from 'node:child_process';
import { basename, dirname, extname } from 'node:path';

const docsDataSourceId = '2621b36f-46cb-801e-8d53-000b5886d356';
const trailsProjectId = '36b1b36f-46cb-8065-be9e-c4736feb7e30';

interface FrontmatterSplit {
  body: string;
  frontmatter: string | undefined;
}

interface ImportResult {
  file: string;
  id: string;
  title: string;
  url: string;
}

const help = `Import scratch Markdown files into the Notion Docs database.

Usage:
  bun scripts/import-scratch-to-notion.ts [options] <file...>

Options:
  --dry-run              Print the planned imports without creating Notion pages.
  --force                Import even when local frontmatter already has notion_id.
  --write-frontmatter    After import, write notion_id/notion_url metadata locally.
  --help                 Show this help text.

Behavior:
  - Uses the first H1 as the Notion Doc name.
  - Removes local frontmatter and the first H1 from the Notion page body.
  - Sets the Projects relation to Trails.
`;

const args = Bun.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const writeFrontmatter = args.includes('--write-frontmatter');
const wantsHelp = args.includes('--help') || args.includes('-h');
const files = args.filter((arg) => !arg.startsWith('--'));

const createNotionPage = (title: string, markdown: string) => {
  const payload = {
    markdown,
    parent: {
      data_source_id: docsDataSourceId,
      type: 'data_source_id',
    },
    properties: {
      'Doc name': {
        title: [{ text: { content: title }, type: 'text' }],
        type: 'title',
      },
      Projects: {
        relation: [{ id: trailsProjectId }],
        type: 'relation',
      },
    },
  };

  const result = spawnSync('ntn', ['api', '/v1/pages'], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || 'ntn api /v1/pages failed'
    );
  }

  const page = JSON.parse(result.stdout) as { id: string; url: string };
  return page;
};

const splitFrontmatter = (markdown: string): FrontmatterSplit => {
  if (!markdown.startsWith('---\n')) {
    return { body: markdown, frontmatter: undefined };
  }

  const end = markdown.indexOf('\n---\n', 4);
  if (end === -1) {
    return { body: markdown, frontmatter: undefined };
  }

  return {
    body: markdown.slice(end + '\n---\n'.length),
    frontmatter: markdown.slice(4, end),
  };
};

const titleFromMarkdown = (file: string, markdown: string) => {
  const match = markdown.match(/^#\s+(.+)$/m);
  if (match?.[1]) {
    return match[1].trim().slice(0, 200);
  }

  const folder = basename(dirname(file));
  const stem = basename(file, extname(file));
  return `${folder} / ${stem}`;
};

const stripFirstH1 = (markdown: string) => markdown.replace(/^#\s+.+\n+/, '');

const escapeRegExp = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readFrontmatterValue = (frontmatter: string | undefined, key: string) => {
  if (!frontmatter) {
    return;
  }

  const match = frontmatter.match(
    new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, 'm')
  );
  return match?.[1]?.trim().replaceAll(/^"|"$/g, '');
};

const writeNotionFrontmatter = async (
  file: string,
  original: string,
  result: ImportResult
) => {
  const { frontmatter, body } = splitFrontmatter(original);
  const entries = new Map<string, string>();

  if (frontmatter) {
    for (const line of frontmatter.split('\n')) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (match?.[1]) {
        entries.set(match[1], match[2] ?? '');
      }
    }
  }

  entries.set('notion_id', result.id);
  entries.set('notion_url', result.url);
  entries.set('notion_project_id', trailsProjectId);
  entries.set('notion_imported_at', new Date().toISOString());

  const nextFrontmatter = [...entries.entries()]
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');

  await Bun.write(file, `---\n${nextFrontmatter}\n---\n${body}`);
};

const importFile = async (file: string) => {
  const original = await Bun.file(file).text();
  const { frontmatter, body } = splitFrontmatter(original);
  const existingId = readFrontmatterValue(frontmatter, 'notion_id');

  if (existingId && !force) {
    console.log(
      JSON.stringify({
        file,
        id: existingId,
        reason: 'frontmatter already has notion_id',
        skipped: true,
      })
    );
    return;
  }

  const title = titleFromMarkdown(file, body);
  const markdown = stripFirstH1(body).trim();

  if (dryRun) {
    console.log(
      JSON.stringify({
        bodyBytes: new TextEncoder().encode(markdown).byteLength,
        file,
        title,
      })
    );
    return;
  }

  const result = createNotionPage(title, markdown || ' ');

  if (writeFrontmatter) {
    await writeNotionFrontmatter(file, original, {
      file,
      id: result.id,
      title,
      url: result.url,
    });
  }

  console.log(JSON.stringify({ file, id: result.id, title, url: result.url }));
};

if (wantsHelp) {
  console.log(help);
  process.exit(0);
}

if (files.length === 0) {
  console.error(help);
  process.exit(1);
}

for (const file of files) {
  await importFile(file);
}
