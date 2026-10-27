import { z } from 'zod';

import { syncPluginMetadata } from './sync-plugin-metadata.js';

const METADATA_REASON =
  'Framework target metadata only; plugin behavior is unchanged.';
const METADATA_SCOPES = ['plugin.trails.skill:trails', 'plugin:trails'];

const changeListSchema = z.object({
  data: z.object({
    entries: z.array(
      z.object({
        bump: z.enum(['major', 'minor', 'none', 'patch']).optional(),
        id: z.string().refine((id) => id.trim().length > 0),
        ignored: z.boolean(),
        reason: z.string(),
        scopes: z.array(z.string()),
        status: z.enum(['pending', 'history']),
      })
    ),
  }),
  ok: z.literal(true),
});

type RunSkillset = (args: readonly string[]) => Promise<string>;

const runSkillset: RunSkillset = async (args) => {
  const child = Bun.spawn(['skillset', ...args], {
    stderr: 'inherit',
    stdout: 'pipe',
  });
  const [exitCode, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `skillset ${args.join(' ')} failed (${exitCode}): ${stdout}`
    );
  }
  return stdout;
};

/** Refresh only this repo's metadata-only evidence, adding it on first use. */
export const recordPluginMetadata = async (
  run: RunSkillset = runSkillset
): Promise<void> => {
  const result = changeListSchema.parse(
    JSON.parse(await run(['change', 'list', '--root', '.', '--json']))
  );

  for (const scope of METADATA_SCOPES) {
    const existing = result.data.entries.filter(
      (entry) =>
        entry.status === 'pending' &&
        !entry.ignored &&
        entry.bump === 'none' &&
        entry.reason === METADATA_REASON &&
        entry.scopes.length === 1 &&
        entry.scopes[0] === scope
    );
    if (existing.length === 0) {
      await run([
        'change',
        'add',
        '--scope',
        scope,
        '--bump',
        'none',
        '--reason',
        METADATA_REASON,
        '--root',
        '.',
      ]);
      continue;
    }
    for (const entry of existing) {
      await run(['change', 'refresh', `@${entry.id}`, '--yes', '--root', '.']);
    }
  }
};

/** Carry valid pending evidence across the versioner's metadata-only write. */
export const syncAndRecordPluginMetadata = async (
  run: RunSkillset = runSkillset,
  sync: typeof syncPluginMetadata = syncPluginMetadata
): Promise<void> => {
  const result = changeListSchema.parse(
    JSON.parse(await run(['change', 'list', '--root', '.', '--json']))
  );
  z.object({ ok: z.literal(true) }).parse(
    JSON.parse(await run(['change', 'check', '--root', '.', '--json']))
  );

  const { changedPaths } = await sync();
  if (changedPaths.length > 0) {
    for (const entry of result.data.entries) {
      if (
        entry.status === 'pending' &&
        !entry.ignored &&
        entry.scopes.some((scope) => METADATA_SCOPES.includes(scope))
      ) {
        await run([
          'change',
          'refresh',
          `@${entry.id}`,
          '--yes',
          '--root',
          '.',
        ]);
      }
    }
  }
  await recordPluginMetadata(run);
};

if (import.meta.main) {
  await (process.argv.includes('--sync')
    ? syncAndRecordPluginMetadata()
    : recordPluginMetadata());
}
