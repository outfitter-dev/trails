import { test } from 'bun:test';

import { createQueueMock } from '../memory.js';
import { createQueueContractCases } from '../testing.js';

for (const example of createQueueContractCases({
  createSubject: () => {
    const client = createQueueMock();
    return {
      attempts: () => client.messages().length,
      client,
      observe: client.messages,
    };
  },
})) {
  test(example.name, example.check);
}
