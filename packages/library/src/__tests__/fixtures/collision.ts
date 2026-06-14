/**
 * Collision fixture: two distinct trail ids that derive the same export name
 * (`widgetGetThing`), to exercise `deriveLibraryApi`'s collision handling —
 * first-by-sorted-id wins in `exports`, both ids recorded in `collisions`.
 * `widget.get-thing` sorts before `widget.get.thing` ('-' < '.'), so it wins.
 */
import { Result, topo, trail } from '@ontrails/core';
import { z } from 'zod';

export const dotted = trail('widget.get.thing', {
  blaze: () => Result.ok({ via: 'dotted' }),
  description: 'Collides via a dotted id.',
  input: z.object({}),
  intent: 'read',
  output: z.object({ via: z.string() }),
});

export const kebab = trail('widget.get-thing', {
  blaze: () => Result.ok({ via: 'kebab' }),
  description: 'Collides via a hyphenated tail segment.',
  input: z.object({}),
  intent: 'read',
  output: z.object({ via: z.string() }),
});

export const collisionApp = topo('collision-fixture', { dotted, kebab });
