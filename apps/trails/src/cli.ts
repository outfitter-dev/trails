import { outputModePreset } from '@ontrails/cli';
import { surface } from '@ontrails/cli/commander';

import { app } from './app.js';
import { resolveInputWithClack } from './clack.js';

// oxlint-disable-next-line require-hook -- CLI entry point
await surface(app, {
  description: 'Agent-native, contract-first TypeScript framework',
  name: 'trails',
  presets: [outputModePreset()],
  resolveInput: resolveInputWithClack,
  version: '0.1.0',
});
