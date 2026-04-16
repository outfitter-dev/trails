import { describe, expect, test } from 'bun:test';

import { logtapeSink } from '../index.js';
import type { LogtapeLoggerLike } from '../index.js';

const createRecordingLogger = () => {
  const calls: {
    level: string;
    message: string;
    props?: Record<string, unknown>;
  }[] = [];

  const logger: LogtapeLoggerLike = {
    debug(message, props) {
      calls.push({ level: 'debug', message, props });
    },
    error(message, props) {
      calls.push({ level: 'error', message, props });
    },
    fatal(message, props) {
      calls.push({ level: 'fatal', message, props });
    },
    info(message, props) {
      calls.push({ level: 'info', message, props });
    },
    trace(message, props) {
      calls.push({ level: 'trace', message, props });
    },
    warn(message, props) {
      calls.push({ level: 'warn', message, props });
    },
  };

  return { calls, logger };
};

describe('logtapeSink', () => {
  test('forwards records to the underlying logtape logger by level', () => {
    const { calls, logger } = createRecordingLogger();
    const sink = logtapeSink({ logger });

    sink.write({
      category: 'app.http',
      level: 'info',
      message: 'request received',
      metadata: { path: '/greet' },
      timestamp: new Date(),
    });

    expect(calls).toEqual([
      {
        level: 'info',
        message: 'request received',
        props: { category: 'app.http', path: '/greet' },
      },
    ]);
  });

  test('ignores records whose level does not map to a logtape method', () => {
    const { calls, logger } = createRecordingLogger();
    const sink = logtapeSink({ logger });

    sink.write({
      category: 'app',
      // @ts-expect-error -- exercising unexpected level handling
      level: 'unknown',
      message: 'should not forward',
      metadata: {},
      timestamp: new Date(),
    });

    expect(calls).toEqual([]);
  });
});
