import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const findRepoRoot = (): string => {
  let dir = process.cwd();
  while (dir !== '/') {
    if (existsSync(join(dir, '.git'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  throw new Error('Not inside a git repository');
};

export const ROOT = findRepoRoot();
export const ADR_DIR = join(ROOT, 'docs/adr');
export const DRAFTS_DIR = join(ADR_DIR, 'drafts');
export const INDEX_PATH = join(ADR_DIR, 'README.md');
export const MAP_PATH = join(ADR_DIR, 'decision-map.json');
export const DRAFTS_MAP_PATH = join(DRAFTS_DIR, 'decision-map.json');
export const DRAFTS_INDEX_PATH = join(DRAFTS_DIR, 'README.md');
export const SKILL_PATH = join(ROOT, '.claude/skills/trails-adrs/SKILL.md');
