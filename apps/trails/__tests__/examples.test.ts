/* oxlint-disable eslint-plugin-jest/require-hook -- testExamples registers tests at module scope */
import { testExamples } from '@ontrails/testing';

import { app } from '../src/app.js';

testExamples(app);
