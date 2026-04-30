export const crudOperations = [
  'create',
  'read',
  'update',
  'delete',
  'list',
] as const;

export type CrudOperation = (typeof crudOperations)[number];

export interface CrudAccessorExpectation {
  readonly fallback?: string | undefined;
  readonly preferred: string;
  readonly severityWhenNoFallback: 'error';
  readonly severityWhenPreferredMissingWithFallback?: 'warn' | undefined;
}

export const crudAccessorExpectations = {
  create: {
    fallback: 'upsert',
    preferred: 'insert',
    severityWhenNoFallback: 'error',
    severityWhenPreferredMissingWithFallback: 'warn',
  },
  delete: {
    preferred: 'remove',
    severityWhenNoFallback: 'error',
  },
  list: {
    preferred: 'list',
    severityWhenNoFallback: 'error',
  },
  read: {
    preferred: 'get',
    severityWhenNoFallback: 'error',
  },
  update: {
    fallback: 'upsert',
    preferred: 'update',
    severityWhenNoFallback: 'error',
    severityWhenPreferredMissingWithFallback: 'warn',
  },
} as const satisfies Record<CrudOperation, CrudAccessorExpectation>;
