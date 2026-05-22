import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

export const REPO_TRAILS_SKILL_PATH = 'plugin/skills/trails';

export interface InstalledSkillCandidate {
  label: string;
  optional?: boolean;
  path: string;
}

export interface SkillFileDrift {
  changed: readonly string[];
  extra: readonly string[];
  missing: readonly string[];
}

export interface StaleVocabularyHit {
  file: string;
  line: number;
  term: string;
  text: string;
}

export interface InstalledSkillFinding {
  code:
    | 'content-drift'
    | 'current'
    | 'missing'
    | 'not-directory'
    | 'stale-vocabulary'
    | 'version-drift';
  message: string;
  severity: 'error' | 'info';
}

export interface InstalledSkillReport {
  candidate: InstalledSkillCandidate;
  drift: SkillFileDrift;
  exists: boolean;
  findings: readonly InstalledSkillFinding[];
  kind: 'copy' | 'missing' | 'other' | 'symlink';
  realPath?: string;
  staleVocabularyHits: readonly StaleVocabularyHit[];
  symlinkTarget?: string;
  version?: string;
}

export interface InstalledSkillCheckReport {
  hasErrors: boolean;
  reports: readonly InstalledSkillReport[];
  sourcePath: string;
  sourceVersion: string;
}

const staleTerm = (segments: readonly string[]): string => segments.join('');

const exactWordPattern = (segments: readonly string[], flags = ''): RegExp =>
  new RegExp(`\\b${staleTerm(segments)}\\b`, flags);

const STALE_VOCABULARY_PATTERNS: readonly {
  pattern: RegExp;
  term: string;
}[] = [
  {
    pattern: exactWordPattern(['Surface', 'Map']),
    term: staleTerm(['Surface', 'Map']),
  },
  {
    pattern: exactWordPattern(['Surface', ' maps']),
    term: staleTerm(['Surface', ' maps']),
  },
  {
    pattern: exactWordPattern(['trail', 'head'], 'i'),
    term: staleTerm(['trail', 'head']),
  },
  {
    pattern: exactWordPattern(['connect', 'or'], 'i'),
    term: staleTerm(['connect', 'or']),
  },
  {
    pattern: exactWordPattern(['trans', 'port'], 'i'),
    term: staleTerm(['trans', 'port']),
  },
  {
    pattern: exactWordPattern(['16 fixed', '-category']),
    term: staleTerm(['16 fixed', '-category']),
  },
];

const parseArgs = (
  args: readonly string[]
): { homeDir: string; rootDir: string } => {
  let homeDir = homedir();
  let rootDir = process.cwd();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--home') {
      const next = args[index + 1];
      if (!next) {
        throw new Error(
          'check-installed-trails-skill: --home requires a path.'
        );
      }
      homeDir = next;
      index += 1;
      continue;
    }

    if (arg === '--root') {
      const next = args[index + 1];
      if (!next) {
        throw new Error(
          'check-installed-trails-skill: --root requires a path.'
        );
      }
      rootDir = next;
      index += 1;
      continue;
    }

    throw new Error(`check-installed-trails-skill: unknown argument ${arg}.`);
  }

  return { homeDir, rootDir };
};

export const defaultInstalledSkillCandidates = (
  homeDir = homedir()
): readonly InstalledSkillCandidate[] => [
  {
    label: 'agents-shared',
    path: join(homeDir, '.agents/skills/trails'),
  },
  {
    label: 'claude-home',
    path: join(homeDir, '.config/claude/skills/trails'),
  },
  {
    label: 'codex-home',
    optional: true,
    path: join(homeDir, '.config/codex/skills/trails'),
  },
];

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const listRelativeFiles = async (
  rootDir: string,
  currentDir = rootDir
): Promise<readonly string[]> => {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(rootDir, absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(relative(rootDir, absolutePath));
    }
  }

  return files.toSorted((left, right) => left.localeCompare(right));
};

const hashFile = async (path: string): Promise<string> => {
  const source = await readFile(path);
  return createHash('sha256').update(source).digest('hex');
};

const compareSkillRoots = async (
  sourceDir: string,
  installedDir: string
): Promise<SkillFileDrift> => {
  const sourceFiles = await listRelativeFiles(sourceDir);
  const installedFiles = await listRelativeFiles(installedDir);
  const sourceSet = new Set(sourceFiles);
  const installedSet = new Set(installedFiles);
  const missing = sourceFiles.filter((file) => !installedSet.has(file));
  const extra = installedFiles.filter((file) => !sourceSet.has(file));
  const changed: string[] = [];

  for (const file of sourceFiles) {
    if (!installedSet.has(file)) {
      continue;
    }

    const [sourceHash, installedHash] = await Promise.all([
      hashFile(join(sourceDir, file)),
      hashFile(join(installedDir, file)),
    ]);

    if (sourceHash !== installedHash) {
      changed.push(file);
    }
  }

  return { changed, extra, missing };
};

const unquoteScalar = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
};

const parseSkillTrailsVersion = (source: string): string | undefined => {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1];
  const version = frontmatter?.match(
    /^metadata:\n(?:^[ \t]+.*\n)*?^ {2}trails:\n(?:^ {4}(?!version:).*\n)*?^ {4}version:\s*(.+)$/m
  )?.[1];

  return version ? unquoteScalar(version) : undefined;
};

const readSkillVersion = async (
  skillDir: string
): Promise<string | undefined> => {
  const skillPath = join(skillDir, 'SKILL.md');
  if (!(await pathExists(skillPath))) {
    return undefined;
  }
  return parseSkillTrailsVersion(await readFile(skillPath, 'utf8'));
};

const scanStaleVocabulary = async (
  skillDir: string
): Promise<readonly StaleVocabularyHit[]> => {
  const files = await listRelativeFiles(skillDir);
  const hits: StaleVocabularyHit[] = [];

  for (const file of files.filter((candidate) => candidate.endsWith('.md'))) {
    const source = await readFile(join(skillDir, file), 'utf8');
    const lines = source.split('\n');

    for (const [lineIndex, line] of lines.entries()) {
      for (const { pattern, term } of STALE_VOCABULARY_PATTERNS) {
        if (!pattern.test(line)) {
          continue;
        }

        hits.push({
          file,
          line: lineIndex + 1,
          term,
          text: line.trim(),
        });
      }
    }
  }

  return hits;
};

const summarizeFiles = (files: readonly string[]): string => {
  if (files.length === 0) {
    return 'none';
  }

  const sample = files.slice(0, 5).join(', ');
  const suffix = files.length > 5 ? `, +${files.length - 5} more` : '';
  return `${sample}${suffix}`;
};

const makeContentDriftFinding = (
  drift: SkillFileDrift
): InstalledSkillFinding | undefined => {
  const count =
    drift.changed.length + drift.extra.length + drift.missing.length;
  if (count === 0) {
    return undefined;
  }

  return {
    code: 'content-drift',
    message: [
      `${count} file drift item(s):`,
      `missing=${summarizeFiles(drift.missing)}`,
      `extra=${summarizeFiles(drift.extra)}`,
      `changed=${summarizeFiles(drift.changed)}`,
    ].join(' '),
    severity: 'error',
  };
};

const makeStaleVocabularyFinding = (
  hits: readonly StaleVocabularyHit[]
): InstalledSkillFinding | undefined => {
  if (hits.length === 0) {
    return undefined;
  }

  const sample = hits
    .slice(0, 5)
    .map((hit) => `${hit.file}:${hit.line} ${hit.term}`)
    .join(', ');
  const suffix = hits.length > 5 ? `, +${hits.length - 5} more` : '';

  return {
    code: 'stale-vocabulary',
    message: `${hits.length} stale vocabulary hit(s): ${sample}${suffix}`,
    severity: 'error',
  };
};

const makeVersionFinding = (
  sourceVersion: string,
  version: string | undefined
): InstalledSkillFinding | undefined => {
  if (version === sourceVersion) {
    return undefined;
  }

  return {
    code: 'version-drift',
    message: `metadata.trails.version is ${version ?? 'missing'}, expected ${sourceVersion}.`,
    severity: 'error',
  };
};

const checkCandidate = async (
  candidate: InstalledSkillCandidate,
  sourceDir: string,
  sourceVersion: string
): Promise<InstalledSkillReport> => {
  if (!(await pathExists(candidate.path))) {
    return {
      candidate,
      drift: { changed: [], extra: [], missing: [] },
      exists: false,
      findings: [
        {
          code: 'missing',
          message: candidate.optional
            ? 'Optional installed skill path is absent.'
            : 'Installed skill path is absent.',
          severity: 'info',
        },
      ],
      kind: 'missing',
      staleVocabularyHits: [],
    };
  }

  const linkStat = await lstat(candidate.path);
  const kind = linkStat.isSymbolicLink() ? 'symlink' : 'copy';
  const symlinkTarget = linkStat.isSymbolicLink()
    ? await readlink(candidate.path)
    : undefined;
  const resolvedPath = await realpath(candidate.path);
  const pathStat = await stat(candidate.path);

  if (!pathStat.isDirectory()) {
    return {
      candidate,
      drift: { changed: [], extra: [], missing: [] },
      exists: true,
      findings: [
        {
          code: 'not-directory',
          message: 'Installed skill path exists but is not a directory.',
          severity: 'error',
        },
      ],
      kind: 'other',
      realPath: resolvedPath,
      staleVocabularyHits: [],
      symlinkTarget,
    };
  }

  const drift = await compareSkillRoots(sourceDir, candidate.path);
  const version = await readSkillVersion(candidate.path);
  const staleVocabularyHits = await scanStaleVocabulary(candidate.path);
  const findings = [
    makeVersionFinding(sourceVersion, version),
    makeContentDriftFinding(drift),
    makeStaleVocabularyFinding(staleVocabularyHits),
  ].filter(Boolean) as InstalledSkillFinding[];

  return {
    candidate,
    drift,
    exists: true,
    findings:
      findings.length > 0
        ? findings
        : [
            {
              code: 'current',
              message: 'Installed skill content matches the repo plugin skill.',
              severity: 'info',
            },
          ],
    kind,
    realPath: resolvedPath,
    staleVocabularyHits,
    symlinkTarget,
    version,
  };
};

export const checkInstalledTrailsSkills = async ({
  candidates,
  sourceDir,
}: {
  candidates: readonly InstalledSkillCandidate[];
  sourceDir: string;
}): Promise<InstalledSkillCheckReport> => {
  const sourceVersion = await readSkillVersion(sourceDir);
  if (!sourceVersion) {
    throw new Error(
      `check-installed-trails-skill: expected metadata.trails.version in ${join(
        sourceDir,
        'SKILL.md'
      )}.`
    );
  }

  const reports = await Promise.all(
    candidates.map((candidate) =>
      checkCandidate(candidate, sourceDir, sourceVersion)
    )
  );

  return {
    hasErrors: reports.some((report) =>
      report.findings.some((finding) => finding.severity === 'error')
    ),
    reports,
    sourcePath: sourceDir,
    sourceVersion,
  };
};

const renderReport = (report: InstalledSkillCheckReport): string => {
  const lines = [
    'Installed Trails skill drift report',
    `Source: ${report.sourcePath}`,
    `Source metadata.trails.version: ${report.sourceVersion}`,
    '',
  ];

  for (const candidateReport of report.reports) {
    const relation =
      candidateReport.kind === 'symlink'
        ? `symlink -> ${candidateReport.symlinkTarget}`
        : candidateReport.kind;
    lines.push(
      `[${candidateReport.findings.some((finding) => finding.severity === 'error') ? 'error' : 'info'}] ${candidateReport.candidate.label}: ${candidateReport.candidate.path} (${relation})`
    );

    if (candidateReport.realPath) {
      lines.push(`  realpath: ${candidateReport.realPath}`);
    }
    if (candidateReport.version) {
      lines.push(`  metadata.trails.version: ${candidateReport.version}`);
    }

    for (const finding of candidateReport.findings) {
      lines.push(`  - ${finding.code}: ${finding.message}`);
    }
    lines.push('');
  }

  lines.push(
    'Read-only check: no installed skill files were changed. Refresh local copies only through an explicit operator action after reviewing this report.'
  );

  return `${lines.join('\n').trimEnd()}\n`;
};

const run = async (): Promise<void> => {
  const { homeDir, rootDir } = parseArgs(process.argv.slice(2));
  const sourceDir = resolve(rootDir, REPO_TRAILS_SKILL_PATH);
  const report = await checkInstalledTrailsSkills({
    candidates: defaultInstalledSkillCandidates(homeDir),
    sourceDir,
  });

  console.log(renderReport(report));

  if (report.hasErrors) {
    process.exit(1);
  }
};

if (import.meta.main) {
  await run();
}
