import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const resourceScaffoldPermit = {
  actors: [],
  id: 'scaffold-test',
  scopes: ['project:write'],
};

export const createResourceProject = (): string => {
  const parent = resolve(import.meta.dir, '../../.tmp-tests');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'add-resource-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        rootDir: '.',
        typeRoots: [
          resolve(import.meta.dir, '../../../../node_modules/@types'),
        ],
        types: ['bun'],
      },
      extends: resolve(import.meta.dir, '../../../../tsconfig.json'),
      include: ['src/**/*.ts', '__tests__/**/*.ts'],
    })
  );
  return dir;
};
