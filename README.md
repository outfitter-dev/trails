# Trails

**Agent-native, contract-first TypeScript framework. Define once, surface on CLI, MCP, HTTP, and WebSocket. The rest is on Trails.**

```typescript
import { trail, trailhead, Result } from "@ontrails/core";
import { blaze } from "@ontrails/cli/commander";
import { z } from "zod";

// Define a trail
const hello = trail("hello", {
  input: z.object({ name: z.string().describe("Who to greet") }),
  implementation: async (input) => Result.ok(`Hello, ${input.name}!`),
});

// Collect and blaze
const app = trailhead("myapp", { hello });
blaze(app);
```

```bash
$ myapp hello --name world
Hello, world!
```

Add MCP? One line:

```typescript
import { blaze as blazeMcp } from "@ontrails/mcp";
blazeMcp(app, { stdio: true });
```

Same trails. Same implementation. Every surface.

---

> **Status:** Pre-release. Design docs at [outfitter-dev/stack/.scratch/next/](https://github.com/outfitter-dev/stack/tree/main/.scratch/next).
