/**
 * Mirrors core's cron normalization (`packages/core/src/schedule.ts:41-42`):
 * trimmed, single-spaced fields, so a firing cron compares equal to the
 * schedule that declared it however either was spelled.
 */
export const normalizeCron = (cron: string): string =>
  cron.trim().replaceAll(/\s+/g, ' ');
