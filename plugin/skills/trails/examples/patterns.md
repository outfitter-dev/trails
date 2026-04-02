Common before/after patterns when converting imperative code to Trails.

## Throwing errors to Result.err

```typescript
// Before
const user = await db.findUser(id);
if (!user) throw new Error('User not found');

// After
import { Result, NotFoundError } from '@ontrails/core';

const user = await db.findUser(input.id);
if (!user) return Result.err(new NotFoundError('User not found'));
return Result.ok(user);
```

## console.log to structured output

### Before

```typescript
const result = await computeReport(params);
console.log(JSON.stringify(result, null, 2));
```

### After

```typescript
// The implementation returns data. The trailhead decides how to render it.
const result = await computeReport(input);
return Result.ok(result);
// CLI prints JSON, MCP returns content[], HTTP sends application/json
```

## process.exit to error taxonomy

### Before

```typescript
if (!valid) {
  console.error('Invalid input');
  process.exit(1);
}
```

### After

```typescript
import { ValidationError } from '@ontrails/core';

// ValidationError maps to exit code 1, HTTP 400, JSON-RPC -32602 automatically
if (!valid) return Result.err(new ValidationError('Invalid input'));
```

## try/catch wrapping to Result

```typescript
// Before
try {
  const resp = await fetch(url);
  return await resp.json();
} catch (e) {
  throw new Error('Fetch failed');
}

// After
import { Result, NetworkError } from '@ontrails/core';

const resp = await Result.fromFetch(url);
if (resp.isErr()) return Result.err(new NetworkError('Fetch failed'));
return Result.ok(await resp.value.json());
```

## Boolean flags to intent enum

### Before

```typescript
// What does this even mean together?
{ readOnly: true, destructive: false, safe: true }
```

### After

```typescript
// One field, three values, no ambiguity
{ intent: 'read' }    // GET, readOnlyHint: true
{ intent: 'write' }   // POST/PUT, default
{ intent: 'destroy' } // DELETE, destructiveHint: true
```
