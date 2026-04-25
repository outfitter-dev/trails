Convert direct function calls into trail composition with crosses declarations.

## Before

```typescript
async function createOrder(items: CartItem[], customerId: string) {
  const customer = await getCustomer(customerId);
  if (!customer) throw new Error('Customer not found');

  const inventory = await checkInventory(items);
  if (!inventory.available) throw new Error('Items out of stock');

  const order = await insertOrder({ customerId, items, total: inventory.total });

  try {
    await sendConfirmation(customer.email, order);
  } catch (err) {
    console.warn('Email failed, order still created');
  }

  return order;
}

// No visibility into what calls what. Errors handled inconsistently.
// Testing requires mocking every dependency.
```

## After

```typescript
// resources/db.ts
import { resource, Result } from '@ontrails/core';

export const db = resource('db.main', {
  create: (svc) => Result.ok(openDatabase(svc.env?.DATABASE_URL)),
  dispose: (conn) => conn.close(),
  mock: () => createInMemoryDb(),
  description: 'Primary database connection',
});

// trails/customer.ts
import { z } from 'zod';
import { trail, Result, NotFoundError } from '@ontrails/core';
import { db } from '../resources/db.js';

export const get = trail('customer.get', {
  input: z.object({ id: z.string().describe('Customer ID') }),
  output: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  intent: 'read',
  resources: [db],
  examples: [{ name: 'existing', input: { id: 'cust_123' } }],
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const customer = await conn.customers.findById(input.id);
    if (!customer) return Result.err(new NotFoundError('Customer not found'));
    return Result.ok(customer);
  },
});

// trails/inventory.ts
import { db } from '../resources/db.js';

export const check = trail('inventory.check', {
  input: z.object({ items: z.array(CartItemSchema).describe('Cart items to check') }),
  output: z.object({ available: z.boolean(), total: z.number() }),
  intent: 'read',
  resources: [db],
  examples: [{ name: 'in stock', input: { items: [{ sku: 'TRAIL-001', qty: 1 }] } }],
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const result = await conn.warehouse.check(input.items);
    return Result.ok(result);
  },
});

// trails/order.ts — the composition trail
import { InternalError, ValidationError } from '@ontrails/core';
import { db } from '../resources/db.js';

export const create = trail('order.create', {
  input: z.object({
    customerId: z.string().describe('Customer ID'),
    items: z.array(CartItemSchema).describe('Cart items to order'),
  }),
  output: z.object({ orderId: z.string(), total: z.number() }),
  intent: 'write',
  crosses: ['customer.get', 'inventory.check'],
  resources: [db],
  examples: [
    { name: 'happy path', input: { customerId: 'cust_123', items: [{ sku: 'TRAIL-001', qty: 1 }] } },
  ],
  blaze: async (input, ctx) => {
    if (!ctx.cross) {
      return Result.err(new InternalError('order.create requires ctx.cross'));
    }

    const customer = await ctx.cross<{ id: string; email: string }>('customer.get', { id: input.customerId });
    if (customer.isErr()) return customer;

    const stock = await ctx.cross<{ available: boolean; total: number }>('inventory.check', { items: input.items });
    if (stock.isErr()) return stock;
    if (!stock.value.available) return Result.err(new ValidationError('Items out of stock'));

    const conn = db.from(ctx);
    const order = await conn.orders.insert({ customerId: input.customerId, items: input.items, total: stock.value.total });
    return Result.ok({ orderId: order.id, total: stock.value.total });
  },
});
```

`testAll` checks that every declared cross was actually called:

```typescript
// __tests__/governance.test.ts
import { testAll } from '@ontrails/testing';
import { topo } from '@ontrails/core';
import * as customer from '../trails/customer.js';
import * as inventory from '../trails/inventory.js';
import * as order from '../trails/order.js';
import * as resources from '../resources/db.js';

const graph = topo('shop', customer, inventory, order, resources);
testAll(graph);
// Validates topo structure, runs all examples, checks cross coverage,
// and uses db.mock() automatically for resource resolution
```
