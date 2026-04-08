/**
 * Resource-backed notification store for the trails-demo app.
 *
 * Demonstrates that consumer trails activated via `on:` can access
 * resources registered on the producer's context. The notification
 * store is the side-effect sink for the entity.notify-updated trail.
 */

import { Result, resource } from '@ontrails/core';

export interface Notification {
  readonly action: 'created' | 'updated' | 'deleted';
  readonly entityId: string;
  readonly entityName: string;
  readonly timestamp: string;
}

export interface NotificationStore {
  push(notification: Notification): void;
  list(): readonly Notification[];
  clear(): void;
}

export const createNotificationStore = (): NotificationStore => {
  const log: Notification[] = [];
  return {
    clear() {
      log.length = 0;
    },
    list() {
      return [...log];
    },
    push(notification: Notification) {
      log.push(notification);
    },
  };
};

export const notificationStoreProvision = resource('demo.notification-store', {
  create: () => Result.ok(createNotificationStore()),
  description:
    'In-memory notification store consumed by the entity.notify-updated trail.',
  mock: () => createNotificationStore(),
});
