import { describe, expect, test } from 'bun:test';

import { fetchGitHubWithRetry } from '../release/policy.js';

const url =
  'https://api.github.com/repos/outfitter-dev/trails/commits/abc/pulls';

const scripted = (steps: readonly (number | Error)[]) => {
  const calls: string[] = [];
  let index = 0;
  const fetch = async (requestUrl: string): Promise<Response> => {
    calls.push(requestUrl);
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (step instanceof Error) {
      throw step;
    }
    return new Response('[]', { status: step });
  };
  return { calls, fetch };
};

const recordSleeps = () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => {
    waits.push(ms);
  };
  return { sleep, waits };
};

describe('fetchGitHubWithRetry', () => {
  test('retries a transient 5xx and returns the later success', async () => {
    const { calls, fetch } = scripted([500, 502, 200]);
    const { sleep, waits } = recordSleeps();

    const response = await fetchGitHubWithRetry(url, {}, { fetch, sleep });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
  });

  test('retries a network failure', async () => {
    const { calls, fetch } = scripted([new Error('socket hang up'), 200]);
    const { sleep } = recordSleeps();

    const response = await fetchGitHubWithRetry(url, {}, { fetch, sleep });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  test('returns the final 5xx after exhausting attempts', async () => {
    const { calls, fetch } = scripted([500]);
    const { sleep, waits } = recordSleeps();

    const response = await fetchGitHubWithRetry(
      url,
      {},
      { attempts: 3, fetch, sleep }
    );

    expect(response.status).toBe(500);
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);
  });

  test('rethrows a network failure on the last attempt', async () => {
    const { fetch } = scripted([new Error('offline')]);
    const { sleep } = recordSleeps();

    await expect(
      fetchGitHubWithRetry(url, {}, { attempts: 2, fetch, sleep })
    ).rejects.toThrow('offline');
  });

  test.each([200, 404, 422])('does not retry a %d response', async (status) => {
    const { calls, fetch } = scripted([status]);
    const { sleep, waits } = recordSleeps();

    const response = await fetchGitHubWithRetry(url, {}, { fetch, sleep });

    expect(response.status).toBe(status);
    expect(calls).toHaveLength(1);
    expect(waits).toEqual([]);
  });
});
