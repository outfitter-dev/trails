import { outputModePreset } from '@ontrails/cli';

import { surface } from '../../../../../adapters/commander/src/index.js';
import { app } from './cli-flags-app.js';

await surface(app, {
  presets: process.env['CLI_OUTPUT_PRESET'] === '1' ? [outputModePreset()] : [],
});
