import { normalizeFilePath, reportNode } from './shared.js';
import type { RuleModule } from './shared.js';

const SNAPSHOT_FILE_PATTERN = /\.snap$/u;
const SNAPSHOT_DIRECTORY_PATTERN = /(?:^|\/)__snapshots__\//u;

export const snapshotLocationRule: RuleModule = {
  create(context) {
    return {
      Program(node) {
        const filePath = normalizeFilePath(context.filename);

        if (!SNAPSHOT_FILE_PATTERN.test(filePath)) {
          return;
        }

        if (SNAPSHOT_DIRECTORY_PATTERN.test(filePath)) {
          return;
        }

        reportNode({
          context,
          messageId: 'snapshotLocation',
          node,
        });
      },
    };
  },
  meta: {
    docs: {
      description:
        'Warn when snapshot files are not placed in __snapshots__ directories.',
      recommended: true,
    },
    messages: {
      snapshotLocation:
        'Place snapshot files inside a __snapshots__/ directory.',
    },
    schema: [],
    type: 'suggestion',
  },
};
