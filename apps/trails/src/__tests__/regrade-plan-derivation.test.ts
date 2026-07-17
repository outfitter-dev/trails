import { describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { deriveLiveApiPreserveInventory } from '../regrade/live-api-preserve.js';
import { planRegradeTrail, previewRegradeTrail } from '../trails/regrade.js';

const write = (root: string, path: string, contents: string): void => {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
};

describe('Regrade plan derivation', () => {
  test('derives a deterministic reviewable artifact from a minimal seed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-plan-derivation-'));
    try {
      write(root, 'docs/alpha-guides.md', 'alpha alphas alphaed alphaing\n');
      write(root, 'docs/index.md', '[Alpha guide](alpha-guides.md)\n');
      write(
        root,
        'packages/app/.trails/regrade/nested/alpha-to-omega.json',
        '{"from":"alpha","to":"omega"}\n'
      );
      write(root, 'src/public.ts', 'export const alphaThing = "alpha";\n');
      write(
        root,
        'trails.lock',
        JSON.stringify({
          topoGraph: {
            entries: [{ id: 'alpha.list' }, { id: 'unrelated.list' }],
            library: { exports: [{ exportName: 'alphaList' }] },
          },
        })
      );
      const input = {
        from: 'alpha',
        policyClassified: [
          {
            disposition: 'historical-by-policy' as const,
            paths: ['**/.trails/regrade/**'],
            reason: 'Generated Regrade state is not source evidence.',
          },
        ],
        rootDir: root,
        to: 'omega',
      };
      const first = await planRegradeTrail.implementation(input, {
        cwd: root,
        dryRun: true,
        env: {},
      } as never);
      const second = await planRegradeTrail.implementation(input, {
        cwd: root,
        dryRun: true,
        env: {},
      } as never);
      expect(first.isOk()).toBe(true);
      expect(second.isOk()).toBe(true);
      if (first.isErr() || second.isErr()) {
        throw new Error('Expected Regrade plan derivation to succeed.');
      }
      const { lifecycle: firstLifecycle, ...firstArtifact } = first.value;
      const { lifecycle: secondLifecycle, ...secondArtifact } = second.value;
      expect(secondArtifact).toEqual(firstArtifact);
      expect(secondLifecycle.phases.map((phase) => phase.name)).toEqual(
        firstLifecycle.phases.map((phase) => phase.name)
      );
      expect(first.value.derivation).toMatchObject({
        fileRenames: [
          {
            from: 'docs/alpha-guides.md',
            provenance: 'derived',
            status: 'pending',
            to: 'docs/omega-guides.md',
          },
        ],
        forms: expect.arrayContaining([
          expect.objectContaining({
            from: 'alpha',
            provenance: 'authored',
            to: 'omega',
          }),
          expect.objectContaining({
            from: 'alphaed',
            kind: 'review',
            provenance: 'derived',
          }),
        ]),
        namespaces: expect.arrayContaining([
          expect.objectContaining({
            namespace: 'docs',
            provenance: 'derived',
          }),
        ]),
        preserves: expect.arrayContaining([
          expect.objectContaining({
            evidence: ['topo.entry:alpha.list'],
            provenance: 'derived',
          }),
          expect.objectContaining({
            evidence: ['topo.library:alphaList'],
            provenance: 'derived',
          }),
        ]),
        referenceClosure: {
          entries: expect.arrayContaining([
            expect.objectContaining({
              path: 'docs/index.md',
              provenance: 'derived',
            }),
          ]),
          moves: expect.arrayContaining([
            expect.objectContaining({
              from: 'docs/alpha-guides.md',
              provenance: 'derived',
              to: 'docs/omega-guides.md',
            }),
          ]),
        },
        reviews: expect.arrayContaining([
          expect.objectContaining({
            provenance: 'derived',
            status: 'pending',
            value: 'alphaThing',
          }),
        ]),
      });
      expect(first.value.derivation?.namespaces).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ namespace: 'packages' }),
        ])
      );

      const saved = await planRegradeTrail.implementation(input, {
        cwd: root,
        env: {},
      } as never);
      expect(saved.isOk()).toBe(true);
      const preview = await previewRegradeTrail.implementation(
        { rootDir: root },
        { cwd: root, env: {} } as never
      );
      expect(preview.isOk()).toBe(true);
      if (preview.isErr()) {
        throw preview.error;
      }
      expect(preview.value.plan?.status).toBe('active');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('derives current live API preserves from the saved topo', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-live-api-'));
    try {
      write(
        root,
        'trails.lock',
        JSON.stringify({
          topoGraph: {
            entries: [
              { id: 'alpha.read' },
              { id: 'alphabet.read' },
              { id: 'beta.read' },
            ],
            library: {
              exports: [
                { exportName: 'alphaRead' },
                { exportName: 'alphabetRead' },
              ],
            },
          },
        })
      );
      const inventory = await deriveLiveApiPreserveInventory(
        { from: 'alpha', kind: 'vocabulary', to: 'omega' },
        root
      );
      expect(inventory.isOk()).toBe(true);
      if (inventory.isErr()) {
        throw inventory.error;
      }
      expect(inventory.value.map((entry) => entry.evidence[0])).toEqual([
        'topo.entry:alpha.read',
        'topo.library:alphaRead',
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('preserves live API values for every derived source form', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-live-api-forms-'));
    try {
      write(
        root,
        'trails.lock',
        JSON.stringify({
          topoGraph: {
            entries: [
              { id: 'user.read' },
              { id: 'users.list' },
              { id: 'usered.audit' },
              { id: 'username.read' },
            ],
            library: {
              exports: [{ exportName: 'useringStatus' }],
            },
          },
        })
      );
      const inventory = await deriveLiveApiPreserveInventory(
        { from: 'user', kind: 'vocabulary', to: 'account' },
        root
      );
      expect(inventory.isOk()).toBe(true);
      if (inventory.isErr()) {
        throw inventory.error;
      }
      expect(inventory.value.map((entry) => entry.evidence[0])).toEqual([
        'topo.entry:user.read',
        'topo.entry:usered.audit',
        'topo.library:useringStatus',
        'topo.entry:users.list',
      ]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('inventories identifiers for derived vocabulary forms', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-derived-identifiers-'));
    try {
      write(
        root,
        'src/users.ts',
        'export const usersList = [];\nexport const userDetail = {};\n'
      );

      const result = await planRegradeTrail.implementation(
        { from: 'user', rootDir: root, to: 'account' },
        { cwd: root, dryRun: true, env: {} } as never
      );
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value.derivation?.reviews).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'userDetail' }),
          expect.objectContaining({ value: 'usersList' }),
        ])
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('rejects malformed live topo evidence instead of dropping preserves', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-live-api-invalid-'));
    try {
      write(root, 'trails.lock', '{"topoGraph":{"entries":"invalid"}}');
      const inventory = await deriveLiveApiPreserveInventory(
        { from: 'alpha', kind: 'vocabulary', to: 'omega' },
        root
      );
      expect(inventory.isErr()).toBe(true);
      if (inventory.isErr()) {
        expect(inventory.error.message).toContain('compatible TopoGraph');
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test('marks a saved plan stale when filename proposals change', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trails-plan-filename-stale-'));
    try {
      write(root, 'docs/alpha-guide.md', 'alpha\n');
      const planned = await planRegradeTrail.implementation(
        { from: 'alpha', rootDir: root, to: 'omega' },
        { cwd: root, env: {} } as never
      );
      expect(planned.isOk()).toBe(true);
      renameSync(
        join(root, 'docs/alpha-guide.md'),
        join(root, 'docs/reference.md')
      );

      const preview = await previewRegradeTrail.implementation(
        { rootDir: root },
        { cwd: root, env: {} } as never
      );
      expect(preview.isOk()).toBe(true);
      if (preview.isErr()) {
        throw preview.error;
      }
      expect(preview.value.plan?.status).toBe('stale');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
