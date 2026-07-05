import { surface } from '@ontrails/library';
import { app } from 'switchback';

const lib = await surface(app);
console.log(
  await lib.call.flagEvaluate({
    context: { subjectId: 'user-1' },
    key: 'checkout-v2',
  })
);
