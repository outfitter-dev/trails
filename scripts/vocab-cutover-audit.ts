import { auditRoots, auditRules } from './vocab-cutover-map';

interface MatchDetail {
  readonly count: number;
  readonly path: string;
}

interface RuleResult {
  readonly id: string;
  readonly description: string;
  readonly matches: readonly MatchDetail[];
  readonly total: number;
}

const args = new Set(Bun.argv.slice(2));
const json = args.has('--json');
const selectedRuleIndex = Bun.argv.indexOf('--rule');
const selectedRule =
  selectedRuleIndex === -1 ? undefined : Bun.argv[selectedRuleIndex + 1];

const isAuditTarget = (path: string) =>
  auditRoots.some((root) => path === root || path.startsWith(root));

const listRepoFiles = () => {
  const result = Bun.spawnSync(['git', 'ls-files'], {
    cwd: process.cwd(),
    stderr: 'pipe',
    stdout: 'pipe',
  });

  if (result.exitCode !== 0) {
    const error = new Error(result.stderr.toString());
    error.name = 'GitLsFilesError';
    throw error;
  }

  return result.stdout
    .toString()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isAuditTarget);
};

const getSelectedRules = () =>
  selectedRule
    ? auditRules.filter((rule) => rule.id === selectedRule)
    : auditRules;

const countMatches = (content: string, matcher: RegExp) =>
  [...content.matchAll(matcher)].length;

const findMatchDetail = async (path: string, matcher: RegExp) => {
  const content = await Bun.file(path).text();
  const count = countMatches(content, matcher);
  return count === 0 ? undefined : { count, path };
};

const findRuleResult = async (
  rule: (typeof auditRules)[number],
  files: readonly string[]
): Promise<RuleResult> => {
  const matcher = new RegExp(rule.pattern, 'g');
  const matches = await Promise.all(
    files.map((path) => findMatchDetail(path, matcher))
  );
  const details = matches.filter((match) => match !== undefined);

  return {
    description: rule.description,
    id: rule.id,
    matches: details,
    total: details.reduce((sum, match) => sum + match.count, 0),
  };
};

const findRuleResults = () => {
  const files = listRepoFiles();
  return Promise.all(
    getSelectedRules().map((rule) => findRuleResult(rule, files))
  );
};

const printText = (results: readonly RuleResult[]) => {
  const failing = results.filter((result) => result.total > 0);

  if (failing.length === 0) {
    console.log('vocab-cutover audit passed: no legacy patterns found.');
    return;
  }

  for (const result of failing) {
    console.log(`\n${result.id} — ${result.description}`);
    for (const match of result.matches) {
      console.log(
        `  ${match.count.toString().padStart(4, ' ')}  ${match.path}`
      );
    }
  }

  console.log(
    `\nFound ${failing.length} failing rule${failing.length === 1 ? '' : 's'} across ${failing.reduce((sum, result) => sum + result.matches.length, 0)} files.`
  );
};

const results = await findRuleResults();

if (json) {
  console.log(JSON.stringify(results, null, 2));
} else {
  printText(results);
}

if (results.some((result) => result.total > 0)) {
  process.exitCode = 1;
}
