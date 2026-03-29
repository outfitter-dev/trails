Convert Express CRUD handlers to trails that work on any surface.

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
// trails/project.ts
import { z } from 'zod';
import { trail, Result, NotFoundError, PermissionError } from '@ontrails/core';

const ProjectId = z.object({ id: z.string().uuid() });
const Project = z.object({ id: z.string(), name: z.string(), status: z.string() });

export const show = trail('project.show', {
  input: ProjectId,
  output: Project,
  intent: 'read',
  description: 'Get a project by ID',
  examples: [{ name: 'existing', input: { id: '550e8400-e29b-41d4-a716-446655440000' } }],
  run: async (input) => {
    const project = await db.projects.findById(input.id);
    if (!project) return Result.err(new NotFoundError('Project not found'));
    return Result.ok(project);
  },
});

export const destroy = trail('project.destroy', {
  input: ProjectId,
  output: z.object({ deleted: z.boolean() }),
  intent: 'destroy',
  description: 'Delete a project',
  run: async (input, ctx) => {
    if (!ctx.permit) return Result.err(new PermissionError('Admin required'));
    const deleted = await db.projects.delete(input.id);
    if (!deleted) return Result.err(new NotFoundError('Project not found'));
    return Result.ok({ deleted: true });
  },
});
```

Wire to CLI or MCP with the same trails:

```typescript
// cli.ts
import { topo } from '@ontrails/core';
import { blaze } from '@ontrails/cli/commander';
import * as project from './trails/project.js';

const app = topo('myapp', project);
blaze(app); // "myapp project show --id ..."

// mcp.ts
import { blaze } from '@ontrails/mcp';
blaze(app); // tool: myapp_project_show, myapp_project_destroy
```
