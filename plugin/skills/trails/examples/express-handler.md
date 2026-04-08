Convert Express CRUD handlers to trails that work on any trailhead.

## Before

```typescript
import express from 'express';

const app = express();

app.get('/projects/:id', async (req, res) => {
  try {
    const project = await db.projects.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    return res.json(project);
  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
});

app.delete('/projects/:id', async (req, res) => {
  try {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const deleted = await db.projects.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Project not found' });
    }
    return res.json({ deleted: true });
  } catch (err) {
    return res.status(500).json({ error: 'Internal error' });
  }
});
```

## After

```typescript
// resources/db.ts
import { resource, Result } from '@ontrails/core';

export const db = resource('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  health: (conn) => conn.ping(),
  mock: () => createInMemoryDb(),
  description: 'Primary database connection',
});
```

```typescript
// trails/project.ts
import { z } from 'zod';
import { trail, Result, NotFoundError, PermissionError } from '@ontrails/core';
import { db } from '../resources/db.js';

const ProjectId = z.object({ id: z.string().uuid() });
const Project = z.object({ id: z.string(), name: z.string(), status: z.string() });

export const show = trail('project.show', {
  input: ProjectId,
  output: Project,
  intent: 'read',
  resources: [db],
  description: 'Get a project by ID',
  examples: [{ name: 'existing', input: { id: '550e8400-e29b-41d4-a716-446655440000' } }],
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const project = await conn.projects.findById(input.id);
    if (!project) return Result.err(new NotFoundError('Project not found'));
    return Result.ok(project);
  },
});

export const destroy = trail('project.destroy', {
  input: ProjectId,
  output: z.object({ deleted: z.boolean() }),
  intent: 'destroy',
  resources: [db],
  description: 'Delete a project',
  blaze: async (input, ctx) => {
    if (!ctx.permit) return Result.err(new PermissionError('Admin required'));
    const conn = db.from(ctx);
    const deleted = await conn.projects.delete(input.id);
    if (!deleted) return Result.err(new NotFoundError('Project not found'));
    return Result.ok({ deleted: true });
  },
});
```

Wire to CLI or MCP with the same trails. The `db.mock()` factory is used automatically by `testAll`.

```typescript
// cli.ts
import { topo } from '@ontrails/core';
import { trailhead } from '@ontrails/cli/commander';
import * as project from './trails/project.js';
import * as resources from './resources/db.js';

const app = topo('myapp', project, resources);
trailhead(app); // "myapp project show --id ..."

// mcp.ts
import { trailhead } from '@ontrails/mcp';
trailhead(app); // tool: myapp_project_show, myapp_project_destroy
```
