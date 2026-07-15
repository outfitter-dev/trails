import { describe, expect, test } from 'bun:test';

import { deriveLibraryApi } from '../derive.js';
import { collisionApp } from './fixtures/collision.js';
import { fixtureApp } from './fixtures/app.js';

describe('deriveLibraryApi', () => {
  test('renders established public current-version trails as exports', () => {
    const rendering = deriveLibraryApi(fixtureApp);

    expect(rendering.app).toBe('library-fixture');
    expect(rendering.exports.map((entry) => entry.exportName)).toEqual([
      'widgetAdd',
      'widgetAudited',
      'widgetCheck',
      'widgetGet',
      'widgetGreet',
      'widgetPing',
    ]);
    expect(rendering.collisions).toEqual([]);
  });

  test('excludes draft, internal, and activation trails, with the reason', () => {
    const rendering = deriveLibraryApi(fixtureApp);

    const byTrail = new Map(
      rendering.excluded.map((entry) => [entry.trailId, entry.reason])
    );
    expect(byTrail.get('_draft.widget.experiment')).toBe('draft');
    expect(byTrail.get('widget.diagnose')).toBe('internal');
    expect(byTrail.get('widget.onCreated')).toBe('activation');
    // Precedence: a draft+internal trail reports 'draft' (checked first).
    expect(byTrail.get('_draft.widget.secret')).toBe('draft');

    const exportedIds = new Set(
      rendering.exports.map((entry) => entry.trailId)
    );
    expect(exportedIds.has('_draft.widget.experiment')).toBe(false);
    expect(exportedIds.has('widget.diagnose')).toBe(false);
    expect(exportedIds.has('widget.onCreated')).toBe(false);
  });

  test('carries contract facts the emitter needs onto each export', () => {
    const rendering = deriveLibraryApi(fixtureApp);
    const byName = new Map(
      rendering.exports.map((entry) => [entry.exportName, entry])
    );

    // Resource ids drive factory grouping; stateless trails carry none.
    expect(byName.get('widgetGet')?.resources).toEqual(['widget.store']);
    expect(byName.get('widgetAdd')?.resources).toEqual(['widget.store']);
    expect(byName.get('widgetPing')?.resources).toEqual([]);
    expect(byName.get('widgetCheck')?.resources).toEqual([]);
    expect(byName.get('widgetAudited')?.layerInputs).toHaveLength(1);
    expect(
      byName
        .get('widgetAudited')
        ?.layerInputs[0]?.fields.map((field) => [
          field.claimedName,
          field.routingTarget,
        ])
    ).toEqual([
      ['auditMessage', 'message'],
      ['auditToken', 'token'],
    ]);

    // Intent is carried verbatim (no fallback); write/read preserved.
    expect(byName.get('widgetAdd')?.intent).toBe('write');
    expect(byName.get('widgetPing')?.intent).toBe('read');

    // Versioned trail reports its current version; unversioned is undefined.
    expect(byName.get('widgetGreet')?.version).toBe(2);
    expect(byName.get('widgetPing')?.version).toBeUndefined();

    // Schema references and description are carried for signatures/JSDoc.
    for (const entry of rendering.exports) {
      expect(entry.input).toBeDefined();
      expect(entry.output).toBeDefined();
      expect(typeof entry.description).toBe('string');
      expect(entry.nameSource).toBe('derived');
    }
  });

  test('narrows with an include selector without widening drafts or internal', () => {
    const rendering = deriveLibraryApi(fixtureApp, {
      include: ['widget.get', 'widget.ping'],
    });
    expect(rendering.exports.map((entry) => entry.exportName)).toEqual([
      'widgetGet',
      'widgetPing',
    ]);
  });

  test('drops trails matching an exclude selector', () => {
    const rendering = deriveLibraryApi(fixtureApp, {
      exclude: ['widget.add'],
    });
    const names = rendering.exports.map((entry) => entry.exportName);
    expect(names).not.toContain('widgetAdd');
    expect(names).toContain('widgetGet');
  });

  test('applies include and exclude together', () => {
    const rendering = deriveLibraryApi(fixtureApp, {
      exclude: ['widget.add'],
      include: ['widget.*'],
    });
    expect(rendering.exports.map((entry) => entry.exportName)).toEqual([
      'widgetAudited',
      'widgetCheck',
      'widgetGet',
      'widgetGreet',
      'widgetPing',
    ]);
  });

  test('yields an empty rendering when nothing matches', () => {
    const rendering = deriveLibraryApi(fixtureApp, {
      include: ['nonexistent.*'],
    });
    expect(rendering.exports).toEqual([]);
  });

  test('detects export-name collisions: first-by-id wins, both recorded', () => {
    const rendering = deriveLibraryApi(collisionApp);

    const colliding = rendering.exports.filter(
      (entry) => entry.exportName === 'widgetGetThing'
    );
    expect(colliding).toHaveLength(1);

    expect(rendering.collisions).toHaveLength(1);
    const [collision] = rendering.collisions;
    expect(collision?.exportName).toBe('widgetGetThing');
    expect(collision?.trailIds.toSorted()).toEqual([
      'widget.get-thing',
      'widget.get.thing',
    ]);
    // The winner is the sorted-first id, and it is the one that is callable.
    const [expectedWinner] = ['widget.get-thing', 'widget.get.thing'].toSorted(
      (left, right) => left.localeCompare(right)
    );
    expect(colliding[0]?.trailId).toBe(expectedWinner);
  });
});
