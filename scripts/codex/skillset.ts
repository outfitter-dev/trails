#!/usr/bin/env bun

import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

type FrontmatterScalar = boolean | number | string;
type FrontmatterValue =
  | FrontmatterScalar
  | FrontmatterScalar[]
  | { [key: string]: FrontmatterValue };
type Frontmatter = Record<string, FrontmatterValue>;

interface SkillOverride {
  readonly append?: string;
  readonly frontmatter?: Frontmatter;
  readonly prepend?: string;
}

interface AgentConfig {
  readonly append?: string;
  readonly description: string;
  readonly model: string;
  readonly modelReasoningEffort?: string;
  readonly name: string;
  readonly nicknameCandidates?: readonly string[];
  readonly prepend?: string;
  readonly sandboxMode?: string;
  readonly sourceSkill: string;
  readonly target: string;
}

interface SkillsetConfig {
  readonly agents: ReadonlyMap<string, AgentConfig>;
  readonly configPath: string;
  readonly frontmatterMetadata: Frontmatter;
  readonly frontmatterPreserveRemovedUnder?: readonly string[];
  readonly frontmatterRemove: readonly string[];
  readonly frontmatterValueReplacements: ReadonlyMap<
    string,
    ReadonlyMap<string, string>
  >;
  readonly replacements: ReadonlyMap<string, string>;
  readonly skillOverrides: ReadonlyMap<string, SkillOverride>;
  readonly sourceDir: string;
  readonly targetDir: string;
}

interface RunOptions {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly only?: 'agents' | 'all' | 'skills';
}

interface ParsedArgs {
  readonly check: boolean;
  readonly configPath: string;
  readonly only: 'agents' | 'all' | 'skills';
}

interface MarkdownParts {
  readonly body: string;
  readonly frontmatter: Frontmatter;
}

const DEFAULT_CONFIG_PATH = 'scripts/codex/skillset.config.toml';
const SKILL_FILE = 'SKILL.md';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new TypeError(`skillset: expected ${label} to be a string`);
  }
  return value;
};

const asOptionalString = (
  value: unknown,
  label: string
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return asString(value, label);
};

const asStringArray = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`skillset: expected ${label} to be a string array`);
  }
  return value;
};

const asDottedPath = (value: unknown, label: string): readonly string[] => {
  const path = asString(value, label)
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
  if (path.length === 0) {
    throw new Error(`skillset: expected ${label} to be a non-empty path`);
  }
  return path;
};

const toFrontmatter = (value: unknown, label: string): Frontmatter => {
  if (!isRecord(value)) {
    throw new Error(`skillset: expected ${label} to be a table`);
  }
  return value as Frontmatter;
};

const normalizeNewlines = (value: string): string =>
  value.replaceAll(/\r\n?/g, '\n');

const parseArgs = (argv: readonly string[]): ParsedArgs => {
  let check = false;
  let configPath = DEFAULT_CONFIG_PATH;
  let only: ParsedArgs['only'] = 'all';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--check': {
        check = true;
        break;
      }
      case '--config': {
        index += 1;
        if (!argv[index]) {
          throw new Error('skillset: --config requires a path');
        }
        configPath = argv[index];
        break;
      }
      case '--only': {
        index += 1;
        if (!['agents', 'all', 'skills'].includes(argv[index] ?? '')) {
          throw new Error(
            'skillset: --only requires one of agents, all, or skills'
          );
        }
        only = argv[index] as ParsedArgs['only'];
        break;
      }
      default: {
        throw new Error(`skillset: unknown argument ${arg}`);
      }
    }
  }

  return { check, configPath, only };
};

const resolveInside = (root: string, path: string): string => {
  const resolved = resolve(root, path);
  const relativePath = relative(root, resolved);
  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    relativePath.includes(`..${sep}`)
  ) {
    throw new Error(`skillset: refusing to operate outside repo root: ${path}`);
  }
  return resolved;
};

const readFrontmatterValueReplacements = (
  frontmatter: Record<string, unknown>
): ReadonlyMap<string, ReadonlyMap<string, string>> => {
  const valueReplacementTables = isRecord(frontmatter.value_replacements)
    ? frontmatter.value_replacements
    : {};
  const frontmatterValueReplacements = new Map<
    string,
    ReadonlyMap<string, string>
  >();

  for (const [field, replacements] of Object.entries(valueReplacementTables)) {
    if (!isRecord(replacements)) {
      throw new Error(
        `skillset: expected frontmatter.value_replacements.${field} to be a table`
      );
    }
    frontmatterValueReplacements.set(
      field,
      new Map(
        Object.entries(replacements).map(([from, to]) => [
          from,
          asString(to, `frontmatter.value_replacements.${field}.${from}`),
        ])
      )
    );
  }

  return frontmatterValueReplacements;
};

const readReplacements = (
  rawReplacements: unknown
): ReadonlyMap<string, string> => {
  const replacements = new Map<string, string>();
  if (rawReplacements === undefined) {
    return replacements;
  }
  if (!isRecord(rawReplacements)) {
    throw new Error('skillset: expected replacements to be a table');
  }
  for (const [from, to] of Object.entries(rawReplacements)) {
    replacements.set(from, asString(to, `replacements.${from}`));
  }
  return replacements;
};

const readSkillOverrides = (
  rawOverrides: unknown
): ReadonlyMap<string, SkillOverride> => {
  const skillOverrides = new Map<string, SkillOverride>();
  if (rawOverrides === undefined) {
    return skillOverrides;
  }
  if (!isRecord(rawOverrides)) {
    throw new Error('skillset: expected skill_overrides to be a table');
  }
  for (const [name, override] of Object.entries(rawOverrides)) {
    if (!isRecord(override)) {
      throw new Error(
        `skillset: expected skill_overrides.${name} to be a table`
      );
    }
    skillOverrides.set(name, {
      append: asOptionalString(
        override.append,
        `skill_overrides.${name}.append`
      ),
      frontmatter:
        override.frontmatter === undefined
          ? undefined
          : toFrontmatter(
              override.frontmatter,
              `skill_overrides.${name}.frontmatter`
            ),
      prepend: asOptionalString(
        override.prepend,
        `skill_overrides.${name}.prepend`
      ),
    });
  }
  return skillOverrides;
};

const readAgents = (rawAgents: unknown): ReadonlyMap<string, AgentConfig> => {
  const agents = new Map<string, AgentConfig>();
  if (rawAgents === undefined) {
    return agents;
  }
  if (!isRecord(rawAgents)) {
    throw new Error('skillset: expected agents to be a table');
  }
  for (const [id, agent] of Object.entries(rawAgents)) {
    if (!isRecord(agent)) {
      throw new Error(`skillset: expected agents.${id} to be a table`);
    }
    agents.set(id, {
      append: asOptionalString(agent.append, `agents.${id}.append`),
      description: asString(agent.description, `agents.${id}.description`),
      model: asString(agent.model, `agents.${id}.model`),
      modelReasoningEffort: asOptionalString(
        agent.model_reasoning_effort,
        `agents.${id}.model_reasoning_effort`
      ),
      name: asString(agent.name, `agents.${id}.name`),
      nicknameCandidates:
        agent.nickname_candidates === undefined
          ? undefined
          : asStringArray(
              agent.nickname_candidates,
              `agents.${id}.nickname_candidates`
            ),
      prepend: asOptionalString(agent.prepend, `agents.${id}.prepend`),
      sandboxMode: asOptionalString(
        agent.sandbox_mode,
        `agents.${id}.sandbox_mode`
      ),
      sourceSkill: asString(agent.source_skill, `agents.${id}.source_skill`),
      target: asString(agent.target, `agents.${id}.target`),
    });
  }
  return agents;
};

const readConfig = async (
  cwd: string,
  configPath: string
): Promise<SkillsetConfig> => {
  const absoluteConfigPath = resolveInside(cwd, configPath);
  const raw = Bun.TOML.parse(
    await Bun.file(absoluteConfigPath).text()
  ) as Record<string, unknown>;

  const paths = isRecord(raw.paths) ? raw.paths : {};
  const sourceDir = asString(paths.source, 'paths.source');
  const targetDir = asString(paths.target, 'paths.target');

  const frontmatter = isRecord(raw.frontmatter) ? raw.frontmatter : {};
  const frontmatterRemove =
    frontmatter.remove === undefined
      ? []
      : asStringArray(frontmatter.remove, 'frontmatter.remove');
  const frontmatterPreserveRemovedUnder =
    frontmatter.preserve_removed_under === undefined
      ? undefined
      : asDottedPath(
          frontmatter.preserve_removed_under,
          'frontmatter.preserve_removed_under'
        );

  const metadata = isRecord(frontmatter.metadata) ? frontmatter.metadata : {};
  const skillsetMetadata = isRecord(metadata.skillset)
    ? (metadata.skillset as Frontmatter)
    : (metadata as Frontmatter);

  return {
    agents: readAgents(raw.agents),
    configPath,
    frontmatterMetadata: skillsetMetadata,
    frontmatterPreserveRemovedUnder,
    frontmatterRemove,
    frontmatterValueReplacements: readFrontmatterValueReplacements(frontmatter),
    replacements: readReplacements(raw.replacements),
    skillOverrides: readSkillOverrides(raw.skill_overrides),
    sourceDir,
    targetDir,
  };
};

const parseQuotedScalar = (value: string): string => {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch (error) {
      throw new Error(`skillset: unsupported double-quoted scalar ${value}`, {
        cause: error,
      });
    }
  }

  return value.slice(1, -1).replaceAll("''", "'");
};

const splitInlineArray = (inner: string): readonly string[] => {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const char of inner) {
    if (quote === '"' && escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote === '"' && char === '\\') {
      current += char;
      escaped = true;
      continue;
    }

    if (quote !== undefined) {
      current += char;
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }

    if (char === ',') {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (quote !== undefined) {
    throw new Error(`skillset: unterminated quoted array item in [${inner}]`);
  }

  parts.push(current.trim());
  return parts;
};

const stripInlineComment = (rawValue: string): string => {
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const [index, char] of [...rawValue].entries()) {
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }

    if (quote === '"' && char === '\\') {
      escaped = true;
      continue;
    }

    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (
      char === '#' &&
      (index === 0 || /\s/u.test(rawValue[index - 1] ?? ''))
    ) {
      return rawValue.slice(0, index);
    }
  }

  return rawValue;
};

const parseScalar = (
  rawValue: string
): FrontmatterScalar | FrontmatterScalar[] => {
  const value = stripInlineComment(rawValue).trim();

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (inner === '') {
      return [];
    }
    return splitInlineArray(inner).map(
      (part) => parseScalar(part) as FrontmatterScalar
    );
  }

  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return Number(value);
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return parseQuotedScalar(value);
  }

  return value;
};

const parseFrontmatter = (source: string): Frontmatter => {
  const root: Frontmatter = {};
  const stack: { indent: number; target: Frontmatter }[] = [
    { indent: -1, target: root },
  ];

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const match = /^(?<indent>\s*)(?<key>[^:#]+):(?:\s*(?<value>.*))?$/u.exec(
      line
    );
    if (!match?.groups) {
      throw new Error(`skillset: unsupported frontmatter line: ${line}`);
    }

    const indent = match.groups.indent.length;
    const key = match.groups.key.trim();
    const rawValue = stripInlineComment(match.groups.value ?? '');

    while (stack.length > 1) {
      const current = stack.at(-1);
      if (!current || indent > current.indent) {
        break;
      }
      stack.pop();
    }

    const parent = stack.at(-1)?.target;
    if (!parent) {
      throw new Error('skillset: invalid frontmatter indentation state');
    }
    if (rawValue.trim() === '') {
      const child: Frontmatter = {};
      parent[key] = child;
      stack.push({ indent, target: child });
      continue;
    }

    parent[key] = parseScalar(rawValue);
  }

  return root;
};

const splitMarkdown = (source: string, sourcePath: string): MarkdownParts => {
  const normalized = normalizeNewlines(source);
  if (!normalized.startsWith('---\n')) {
    return { body: normalized.trim(), frontmatter: {} };
  }

  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error(
      `skillset: ${sourcePath} starts with frontmatter but has no closing delimiter`
    );
  }

  return {
    body: normalized.slice(end + '\n---\n'.length).trim(),
    frontmatter: parseFrontmatter(normalized.slice(4, end)),
  };
};

const isFrontmatterMap = (
  value: FrontmatterValue | undefined
): value is Frontmatter => isRecord(value) && !Array.isArray(value);

const cloneFrontmatterValue = (value: FrontmatterValue): FrontmatterValue => {
  if (Array.isArray(value)) {
    return [...value];
  }
  if (isFrontmatterMap(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        cloneFrontmatterValue(child),
      ])
    );
  }
  return value;
};

const cloneFrontmatter = (frontmatter: Frontmatter): Frontmatter =>
  Object.fromEntries(
    Object.entries(frontmatter).map(([key, value]) => [
      key,
      cloneFrontmatterValue(value),
    ])
  );

const mergeFrontmatter = (
  target: Frontmatter,
  source: Frontmatter
): Frontmatter => {
  for (const [key, value] of Object.entries(source)) {
    if (isFrontmatterMap(value) && isFrontmatterMap(target[key])) {
      mergeFrontmatter(target[key], value);
      continue;
    }
    target[key] = cloneFrontmatterValue(value);
  }
  return target;
};

const setFrontmatterPath = (
  target: Frontmatter,
  path: readonly string[],
  value: Frontmatter
): void => {
  let cursor = target;
  for (const part of path.slice(0, -1)) {
    const next = cursor[part];
    if (isFrontmatterMap(next)) {
      cursor = next;
      continue;
    }
    const child: Frontmatter = {};
    cursor[part] = child;
    cursor = child;
  }
  cursor[path.at(-1) ?? ''] = cloneFrontmatterValue(value);
};

const applyReplacements = (
  source: string,
  replacements: ReadonlyMap<string, string>
): string => {
  let next = source;
  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }
  return next;
};

const transformFrontmatter = (
  source: Frontmatter,
  skillName: string,
  config: SkillsetConfig
): Frontmatter => {
  const keysToRemove = new Set(config.frontmatterRemove);
  const clonedSource = cloneFrontmatter(source);
  const removed = Object.fromEntries(
    Object.entries(clonedSource).filter(([key]) => keysToRemove.has(key))
  );
  const next = Object.fromEntries(
    Object.entries(clonedSource).filter(([key]) => !keysToRemove.has(key))
  );

  for (const [field, replacements] of config.frontmatterValueReplacements) {
    const value = next[field];
    if (typeof value !== 'string') {
      continue;
    }
    next[field] = replacements.get(value) ?? value;
  }

  const metadata = isFrontmatterMap(next.metadata) ? next.metadata : {};
  const skillset = isFrontmatterMap(metadata.skillset) ? metadata.skillset : {};
  mergeFrontmatter(skillset, config.frontmatterMetadata);
  mergeFrontmatter(skillset, {
    source: `${config.sourceDir}/${skillName}`,
    'source-file': `${config.sourceDir}/${skillName}/${SKILL_FILE}`,
  });
  metadata.skillset = skillset;
  next.metadata = metadata;

  if (
    config.frontmatterPreserveRemovedUnder &&
    Object.keys(removed).length > 0
  ) {
    setFrontmatterPath(next, config.frontmatterPreserveRemovedUnder, removed);
  }

  const override = config.skillOverrides.get(skillName);
  if (override?.frontmatter) {
    mergeFrontmatter(next, override.frontmatter);
  }

  return next;
};

const renderScalar = (value: FrontmatterScalar): string => {
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  if (/^[A-Za-z0-9_./@-]+$/u.test(value)) {
    return value;
  }
  return JSON.stringify(value);
};

const renderFrontmatterLines = (
  frontmatter: Frontmatter,
  indent = 0
): readonly string[] => {
  const lines: string[] = [];
  const prefix = ' '.repeat(indent);

  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${prefix}${key}: [${value.map(renderScalar).join(', ')}]`);
      continue;
    }
    if (isFrontmatterMap(value)) {
      lines.push(`${prefix}${key}:`);
      lines.push(...renderFrontmatterLines(value, indent + 2));
      continue;
    }
    lines.push(`${prefix}${key}: ${renderScalar(value)}`);
  }

  return lines;
};

const renderMarkdown = (frontmatter: Frontmatter, body: string): string =>
  `---\n${renderFrontmatterLines(frontmatter).join('\n')}\n---\n\n${body.trim()}\n`;

const transformSkillMarkdown = (
  source: string,
  sourcePath: string,
  skillName: string,
  config: SkillsetConfig
): string => {
  const parts = splitMarkdown(source, sourcePath);
  const override = config.skillOverrides.get(skillName);
  const body = [override?.prepend, parts.body, override?.append]
    .filter(
      (part): part is string => typeof part === 'string' && part.trim() !== ''
    )
    .join('\n\n');

  return renderMarkdown(
    transformFrontmatter(parts.frontmatter, skillName, config),
    applyReplacements(body, config.replacements)
  );
};

const listFiles = async (
  dir: string,
  base = dir
): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path, base)));
      continue;
    }
    if (entry.isFile()) {
      files.push(relative(base, path));
    }
  }

  return files.toSorted();
};

const listSkillNames = async (
  sourceDir: string
): Promise<readonly string[]> => {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const names: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillPath = join(sourceDir, entry.name, SKILL_FILE);
    try {
      const fileStat = await stat(skillPath);
      if (fileStat.isFile()) {
        names.push(entry.name);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }
  }

  return names.toSorted();
};

const isTextBuffer = (buffer: Buffer): boolean => !buffer.includes(0);

const expectedSkillFiles = async (
  repoRoot: string,
  skillName: string,
  config: SkillsetConfig
): Promise<ReadonlyMap<string, string | Uint8Array>> => {
  const sourceSkillDir = resolveInside(
    repoRoot,
    `${config.sourceDir}/${skillName}`
  );
  const files = await listFiles(sourceSkillDir);
  const expected = new Map<string, string | Uint8Array>();

  for (const file of files) {
    const sourcePath = join(sourceSkillDir, file);
    const buffer = await readFile(sourcePath);

    if (file === SKILL_FILE) {
      expected.set(
        file,
        transformSkillMarkdown(
          buffer.toString('utf8'),
          sourcePath,
          skillName,
          config
        )
      );
      continue;
    }

    if (isTextBuffer(buffer)) {
      expected.set(
        file,
        applyReplacements(
          normalizeNewlines(buffer.toString('utf8')),
          config.replacements
        )
      );
      continue;
    }

    expected.set(file, buffer);
  }

  return expected;
};

const readExistingFile = async (
  path: string,
  expected: string | Uint8Array
): Promise<string | Uint8Array | undefined> => {
  try {
    const buffer = await readFile(path);
    return typeof expected === 'string'
      ? normalizeNewlines(buffer.toString('utf8'))
      : buffer;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

const valuesEqual = (
  left: string | Uint8Array | undefined,
  right: string | Uint8Array
): boolean => {
  if (left === undefined) {
    return false;
  }
  if (typeof left === 'string' || typeof right === 'string') {
    return left === right;
  }
  return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0;
};

const syncSkill = async (
  repoRoot: string,
  skillName: string,
  config: SkillsetConfig,
  check: boolean
): Promise<boolean> => {
  const targetSkillDir = resolveInside(
    repoRoot,
    `${config.targetDir}/${skillName}`
  );
  const sourceSkillDir = resolveInside(
    repoRoot,
    `${config.sourceDir}/${skillName}`
  );
  const expected = await expectedSkillFiles(repoRoot, skillName, config);
  let currentFiles: readonly string[] = [];
  let stale = false;

  try {
    const targetStat = await lstat(targetSkillDir);
    if (targetStat.isSymbolicLink()) {
      stale = true;
      if (check) {
        console.error(
          `skillset: ${config.targetDir}/${skillName} is a symlink; expected generated directory.`
        );
      }
    } else if (!targetStat.isDirectory()) {
      stale = true;
    }
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error;
    }
    stale = true;
  }

  if (check) {
    try {
      currentFiles = await listFiles(targetSkillDir);
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      ) {
        throw error;
      }
    }
  } else {
    await rm(targetSkillDir, { force: true, recursive: true });
    await mkdir(targetSkillDir, { recursive: true });
  }

  for (const [file, expectedContent] of expected) {
    const targetPath = join(targetSkillDir, file);
    const sourcePath = join(sourceSkillDir, file);

    if (check) {
      const current = await readExistingFile(targetPath, expectedContent);
      if (!valuesEqual(current, expectedContent)) {
        stale = true;
        console.error(
          `skillset: ${config.targetDir}/${skillName}/${file} is stale.`
        );
      }
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, expectedContent);
    const sourceStats = await stat(sourcePath);
    const mode = Number.parseInt(sourceStats.mode.toString(8).slice(-3), 8);
    await chmod(targetPath, mode);
  }

  if (check) {
    const expectedFileSet = new Set(expected.keys());
    for (const file of currentFiles) {
      if (!expectedFileSet.has(file)) {
        stale = true;
        console.error(
          `skillset: ${config.targetDir}/${skillName}/${file} is not generated from source.`
        );
      }
    }
  }

  return stale;
};

const stripFrontmatter = (markdown: string, sourcePath: string): string =>
  splitMarkdown(markdown, sourcePath).body;

const tomlString = (value: string): string => JSON.stringify(value);

const tomlStringArray = (values: readonly string[]): string =>
  `[${values.map(tomlString).join(', ')}]`;

const renderAgent = async (
  repoRoot: string,
  agent: AgentConfig,
  config: SkillsetConfig
): Promise<string> => {
  const skillPath = resolveInside(
    repoRoot,
    `${config.sourceDir}/${agent.sourceSkill}/${SKILL_FILE}`
  );
  const skillMarkdown = transformSkillMarkdown(
    await Bun.file(skillPath).text(),
    skillPath,
    agent.sourceSkill,
    config
  );
  const skillBody = stripFrontmatter(skillMarkdown, skillPath);
  const developerInstructions = [agent.prepend, skillBody, agent.append]
    .filter(
      (part): part is string => typeof part === 'string' && part.trim() !== ''
    )
    .join('\n\n')
    .trim();

  if (developerInstructions.includes("'''")) {
    throw new Error(
      `skillset: agent ${agent.name} instructions contain TOML literal-string delimiter '''`
    );
  }

  const lines = [
    '# Generated by scripts/codex/skillset.ts.',
    `# Source skill: ${config.sourceDir}/${agent.sourceSkill}/${SKILL_FILE}`,
    '',
    `name = ${tomlString(agent.name)}`,
    `description = ${tomlString(agent.description)}`,
    `model = ${tomlString(agent.model)}`,
  ];

  if (agent.modelReasoningEffort) {
    lines.push(
      `model_reasoning_effort = ${tomlString(agent.modelReasoningEffort)}`
    );
  }
  if (agent.sandboxMode) {
    lines.push(`sandbox_mode = ${tomlString(agent.sandboxMode)}`);
  }
  if (agent.nicknameCandidates) {
    lines.push(
      `nickname_candidates = ${tomlStringArray(agent.nicknameCandidates)}`
    );
  }

  lines.push(
    '',
    "developer_instructions = '''",
    developerInstructions,
    "'''",
    ''
  );

  return lines.join('\n');
};

const syncAgent = async (
  repoRoot: string,
  agent: AgentConfig,
  config: SkillsetConfig,
  check: boolean
): Promise<boolean> => {
  const agentPath = resolveInside(repoRoot, agent.target);
  const expected = await renderAgent(repoRoot, agent, config);

  if (check) {
    const current = await readExistingFile(agentPath, expected);
    if (current !== expected) {
      console.error(`skillset: ${agent.target} is stale.`);
      return true;
    }
    return false;
  }

  await mkdir(dirname(agentPath), { recursive: true });
  await writeFile(agentPath, expected);
  return false;
};

export const runSkillset = async (options: RunOptions = {}): Promise<void> => {
  const cwd = options.cwd ?? process.cwd();
  const parsed = parseArgs(options.argv ?? process.argv.slice(2));
  const only = options.only ?? parsed.only;
  const config = await readConfig(cwd, parsed.configPath);
  let stale = false;

  if (only === 'all' || only === 'skills') {
    const sourceDir = resolveInside(cwd, config.sourceDir);
    const skillNames = await listSkillNames(sourceDir);
    for (const skillName of skillNames) {
      stale = (await syncSkill(cwd, skillName, config, parsed.check)) || stale;
    }
  }

  if (only === 'all' || only === 'agents') {
    for (const agent of config.agents.values()) {
      stale = (await syncAgent(cwd, agent, config, parsed.check)) || stale;
    }
  }

  if (parsed.check) {
    if (stale) {
      console.error(
        'skillset: generated output is stale. Run `bun run skillset:sync`.'
      );
      process.exitCode = 1;
      return;
    }
    console.log('skillset: generated output is up to date.');
  }
};

if (import.meta.main) {
  await runSkillset();
}
