#!/usr/bin/env bun

interface CheckCommand {
  name: string;
  cmd: readonly string[];
}

const checks: readonly CheckCommand[] = [
  { cmd: ['bun', 'trails', 'warden', '--pre-push'], name: 'warden' },
  { cmd: ['bun', 'scripts/adr.ts', 'check'], name: 'adr' },
  { cmd: ['bun', 'run', 'test'], name: 'test' },
  { cmd: ['bun', 'run', 'typecheck'], name: 'typecheck' },
  { cmd: ['bun', 'run', 'lint'], name: 'lint' },
  { cmd: ['bun', 'run', 'lint:ast-grep'], name: 'lint-ast-grep' },
  { cmd: ['bun', 'run', 'format:check'], name: 'format' },
  {
    cmd: ['bun', 'run', 'release-pack:check', '--', '--lockfile-only'],
    name: 'release-pack',
  },
  { cmd: ['bun', 'run', 'dead-code'], name: 'dead-code' },
];

for (const check of checks) {
  console.error(`pre-push: ${check.name}`);
  const proc = Bun.spawnSync({
    cmd: check.cmd,
    env: { ...process.env, GIT_PAGER: 'cat' },
    stderr: 'inherit',
    stdin: 'inherit',
    stdout: 'inherit',
  });

  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode ?? 1);
  }
}
