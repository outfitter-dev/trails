/* oxlint-disable max-statements, no-plusplus, no-non-null-assertion -- CLI arg parsing with many flag branches */

export interface Args {
  _: string[];
  title?: string;
  slug?: string;
  created?: string;
  status?: string;
  supersedes?: string;
  renumber?: string;
  dryRun?: boolean;
  yes?: boolean;
  help?: boolean;
}

export const parseArgs = (argv: string[]): Args => {
  const args: Args = { _: [] };
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '--title' && argv[i + 1]) {
      args.title = argv[++i];
    } else if (arg === '--slug' && argv[i + 1]) {
      args.slug = argv[++i];
    } else if (arg === '--created' && argv[i + 1]) {
      args.created = argv[++i];
    } else if (arg === '--status' && argv[i + 1]) {
      args.status = argv[++i];
    } else if (arg === '--supersedes' && argv[i + 1]) {
      args.supersedes = argv[++i];
    } else if (arg === '--renumber' && argv[i + 1]) {
      args.renumber = argv[++i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--yes' || arg === '-y') {
      args.yes = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!arg.startsWith('--')) {
      args._.push(arg);
    }
    i++;
  }

  return args;
};

/** Check if we should apply changes. Returns true for apply, false for preview-only. */
export const shouldApply = (args: Args): boolean => {
  if (args.yes) {
    return true;
  }
  if (args.dryRun) {
    return false;
  }
  return false;
};

export const previewBanner = (args: Args): void => {
  if (!args.yes) {
    console.log('Preview mode. Pass --yes to apply changes.\n');
  }
};

export const printHelp = (): void => {
  console.log(`
Trails ADR Management

Usage: bun .claude/skills/trails-adrs/scripts/adr.ts <command> [options]

Commands:
  create    Create a new draft ADR
  promote   Move a draft to a numbered ADR
  demote    Move a numbered ADR back to drafts
  update    Change title, slug, status, or number of an ADR
  check     Validate ADR format and consistency
  fix       Auto-fix common issues (number padding, cross-refs)
  map       Regenerate decision-map.json

Options:
  --title <title>           ADR title (create, update)
  --slug <slug>             URL slug (create, update)
  --created <YYYY-MM-DD>    Override creation date (create)
  --status <status>         Status (promote, update)
  --supersedes <ref>        Mark another ADR as superseded (promote)
  --renumber <NNNN>         Change ADR number (update)
  --yes, -y                 Apply changes (default: preview only)
  --help                    Show this help

Examples:
  bun scripts/adr.ts create --title "Reactive Trail Activation"
  bun scripts/adr.ts promote events-runtime
  bun scripts/adr.ts promote events-runtime --supersedes 0013
  bun scripts/adr.ts update 013 --renumber 0013
  bun scripts/adr.ts update core-premise --title "Core Premise — Contract-First Design"
  bun scripts/adr.ts update events-runtime --slug events-runtime-v2
  bun scripts/adr.ts fix --dry-run
  bun scripts/adr.ts fix
  bun scripts/adr.ts check
`);
};
