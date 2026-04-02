import { auditRules, auditSelfExclusions } from './vocab-cutover-map';
import {
  formatScopeSummary,
  getScopeOptions,
  hasFlag,
  listScopedRepoFiles,
  parseFlagValues,
} from './vocab-cutover-utils';

interface MatchDetail {
  readonly count: number;
  readonly excerpt: string;
  readonly line: number;
  readonly path: string;
}

interface RuleResult {
  readonly id: string;
  readonly description: string;
  readonly fileCount: number;
  readonly matches: readonly MatchDetail[];
  readonly total: number;
}

const json = hasFlag('--json');
const listRules = hasFlag('--list-rules');
const selectedRules = parseFlagValues('--rule');
const scopeOptions = getScopeOptions();

const globallyExcludedPaths = new Set(auditSelfExclusions);

const isExcludedFromRule = (path: string, rule: (typeof auditRules)[number]) =>
  globallyExcludedPaths.has(path) ||
  (rule.excludePaths?.some(
    (excludedPath) =>
      path === excludedPath || path.startsWith(`${excludedPath}/`)
  ) ??
    false);

const getSelectedRules = () =>
  selectedRules.length > 0
    ? auditRules.filter((rule) => selectedRules.includes(rule.id))
    : auditRules;

const countMatches = (content: string, pattern: string) => {
  const matcher = new RegExp(pattern, 'g');
  return [...content.matchAll(matcher)].length;
};

const formatExcerpt = (line: string) => {
  const normalized = line.trim().replaceAll(/\s+/g, ' ');
  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117)}...`;
};

const findMatchDetail = async (
  path: string,
  pattern: string
): Promise<MatchDetail[] | undefined> => {
  const content = await Bun.file(path).text();
  const matches = content.split(/\r?\n/).flatMap((line, index) => {
    const count = countMatches(line, pattern);
    if (count === 0) {
      return [];
    }

    return [
      {
        count,
        excerpt: formatExcerpt(line),
        line: index + 1,
        path,
      },
    ];
  });

  return matches.length === 0 ? undefined : matches;
};

const findRuleResult = async (
  rule: (typeof auditRules)[number],
  files: readonly string[]
): Promise<RuleResult> => {
  const scopedFiles = files.filter((path) => !isExcludedFromRule(path, rule));
  const matches = await Promise.all(
    scopedFiles.map((path) => findMatchDetail(path, rule.pattern))
  );
  const details = matches.flatMap((match) => match ?? []);
  const fileCount = matches.reduce(
    (sum, match) => sum + (match === undefined ? 0 : 1),
    0
  );

  return {
    description: rule.description,
    fileCount,
    id: rule.id,
    matches: details,
    total: details.reduce((sum, match) => sum + match.count, 0),
  };
};

const findRuleResults = () => {
  const files = listScopedRepoFiles(scopeOptions);
  return Promise.all(
    getSelectedRules().map((rule) => findRuleResult(rule, files))
  );
};

const printRuleList = () => {
  console.log('Available vocab audit rules:\n');
  for (const rule of auditRules) {
    const exclusions =
      (rule.excludePaths?.length ?? 0)
        ? ` (excludes: ${rule.excludePaths?.join(', ')})`
        : '';
    console.log(`- ${rule.id}: ${rule.description}${exclusions}`);
  }
};

const printText = (results: readonly RuleResult[]) => {
  const failing = results.filter((result) => result.total > 0);

  if (failing.length === 0) {
    console.log(
      `vocab-cutover audit passed for ${formatScopeSummary(scopeOptions)}: no legacy patterns found.`
    );
    return;
  }

  for (const result of failing) {
    console.log(`\n${result.id} — ${result.description}`);
    for (const match of result.matches) {
      console.log(
        `  ${match.path}:${match.line.toString().padStart(4, ' ')}  x${match.count.toString().padStart(2, ' ')}  ${match.excerpt}`
      );
    }
  }

  console.log(
    `\nFound ${failing.length} failing rule${failing.length === 1 ? '' : 's'} across ${failing.reduce((sum, result) => sum + result.fileCount, 0)} files and ${failing.reduce((sum, result) => sum + result.matches.length, 0)} matching lines.`
  );
};

if (listRules) {
  printRuleList();
  process.exit(0);
}

const results = await findRuleResults();

if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  printText(results);
}

if (results.some((result) => result.total > 0)) {
  process.exitCode = 1;
}
