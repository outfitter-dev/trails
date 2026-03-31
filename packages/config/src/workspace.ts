/**
 * Ensure the `.trails/` workspace directory exists with proper structure.
 *
 * Auto-creates on first framework operation. The workspace holds local
 * config overrides, development state, and generated artifacts that
 * should not be committed to source control.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const WORKSPACE_DIRS = ['config', 'dev', 'generated'] as const;

const GITIGNORE_CONTENT = [
  '# Local config overrides',
  'config/',
  '',
  '# Development state',
  'dev/',
  '',
].join('\n');

/**
 * Write `.gitignore` inside the workspace directory if it does not already exist.
 */
const writeGitignoreIfMissing = async (trailsDir: string): Promise<void> => {
  const gitignorePath = join(trailsDir, '.gitignore');
  const file = Bun.file(gitignorePath);
  if (!(await file.exists())) {
    await Bun.write(gitignorePath, GITIGNORE_CONTENT);
  }
};

/**
 * Ensure the `.trails/` workspace directory exists with proper structure.
 *
 * Creates `config/`, `dev/`, and `generated/` subdirectories plus a
 * `.gitignore` that excludes local-only files. Safe to call repeatedly —
 * existing files are never overwritten.
 */
export const ensureWorkspace = async (root: string): Promise<void> => {
  const trailsDir = join(root, '.trails');

  await Promise.all(
    WORKSPACE_DIRS.map((d) => mkdir(join(trailsDir, d), { recursive: true }))
  );

  await writeGitignoreIfMissing(trailsDir);
};
