/* oxlint-disable max-statements -- simple YAML frontmatter parsing, splitting would obscure the logic */

export interface Frontmatter {
  id?: number;
  slug?: string;
  title?: string;
  status?: string;
  created?: string;
  updated?: string;
  owners?: string[];
  depends_on?: string[];
  superseded_by?: number;
  [key: string]: unknown;
}

export interface AdrFile {
  path: string;
  filename: string;
  frontmatter: Frontmatter;
  title: string;
  body: string;
  raw: string;
}

export const parseFrontmatter = (
  raw: string
): { frontmatter: Frontmatter; body: string } => {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { body: raw, frontmatter: {} };
  }

  const yaml = match[1] ?? '';
  const body = match[2] ?? '';
  const frontmatter: Frontmatter = {};

  for (const line of yaml.split('\n')) {
    const kv = line.match(/^(\w[\w_]*):\s*(.*)$/);
    if (!kv) {
      continue;
    }
    const [, key, value] = kv;
    if (!key || value === undefined) {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      const inner = trimmed.slice(1, -1);
      frontmatter[key] = inner.split(',').map((s) => {
        const t = s.trim().replaceAll(/^['"]|['"]$/g, '');
        return /^\d+$/.test(t) ? Number(t) : t;
      });
    } else if (/^\d+$/.test(trimmed)) {
      frontmatter[key] = Number(trimmed);
    } else {
      frontmatter[key] = trimmed.replaceAll(/^['"]|['"]$/g, '');
    }
  }

  // Normalize depends_on to strings (parser auto-coerces numeric values)
  if (Array.isArray(frontmatter.depends_on)) {
    frontmatter.depends_on = frontmatter.depends_on.map(String);
  }

  return { body, frontmatter };
};

export const serializeFrontmatter = (fm: Frontmatter): string => {
  const lines: string[] = ['---'];
  if (fm.id !== undefined) {
    lines.push(`id: ${fm.id}`);
  }
  if (fm.slug) {
    lines.push(`slug: ${fm.slug}`);
  }
  if (fm.title) {
    lines.push(`title: ${fm.title}`);
  }
  if (fm.status) {
    lines.push(`status: ${fm.status}`);
  }
  if (fm.created) {
    lines.push(`created: ${fm.created}`);
  }
  if (fm.updated) {
    lines.push(`updated: ${fm.updated}`);
  }
  if (fm.owners) {
    const ownerStr = fm.owners.map((o) => `'${o}'`).join(', ');
    lines.push(`owners: [${ownerStr}]`);
  }
  if (fm.depends_on && fm.depends_on.length > 0) {
    lines.push(`depends_on: [${fm.depends_on.join(', ')}]`);
  }
  if (fm.superseded_by !== undefined) {
    lines.push(`superseded_by: ${fm.superseded_by}`);
  }
  lines.push('---');
  return lines.join('\n');
};

export const extractTitle = (body: string): string => {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? '(untitled)';
};
