import { test } from 'bun:test';

import { createBlobMock } from '../memory.js';
import { createBlobContractCases } from '../testing.js';

for (const example of createBlobContractCases({
  createSubject: () => ({ client: createBlobMock() }),
})) {
  test(example.name, example.check);
}
