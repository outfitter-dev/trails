import { z } from 'zod';

/** Portable metadata describes stored bytes, without reading their body. */
export const blobInfoSchema = z.strictObject({
  key: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

/** Omitted MIME metadata defaults to application/octet-stream; no sniffing. */
export const blobPutOptionsSchema = z.strictObject({
  mimeType: z.string().optional(),
});

/** Limit bounds a page; explicit completion, never page length, ends a query. */
export const blobListOptionsSchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
  prefix: z.string().optional(),
});

/** Cursors are opaque and scoped to the binding and prefix that issued them. */
export const blobListPageSchema = z.discriminatedUnion('complete', [
  z.strictObject({
    complete: z.literal(true),
    objects: z.array(blobInfoSchema),
  }),
  z.strictObject({
    complete: z.literal(false),
    cursor: z.string().min(1),
    objects: z.array(blobInfoSchema),
  }),
]);

/** Metadata returned after a completed write, by head, and in list pages. */
export type BlobInfo = Readonly<z.infer<typeof blobInfoSchema>>;
/** Optional metadata for a portable write. */
export type BlobPutOptions = z.infer<typeof blobPutOptionsSchema>;
/** Portable prefix pagination options; no ordering or snapshot guarantee. */
export type BlobListOptions = z.infer<typeof blobListOptionsSchema>;
/** An explicitly complete page, or an incomplete page with a continuation. */
export type BlobListPage = z.infer<typeof blobListPageSchema>;
