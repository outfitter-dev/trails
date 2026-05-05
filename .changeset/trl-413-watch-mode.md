---
'@ontrails/cli': patch
'@ontrails/trails': patch
---

Add `--watch` for the `trails run` family. File-system events are cheap wake-ups; the rerun gate compares the resolved trail's surface-map entry hash so edits only rerun when the public contract for the watched trail changes. New `watchPreset()` exposes the boolean flag; `'watch'` is added to `META_FLAG_CANDIDATES` so the flag never routes into trail input. The watch loop in `apps/trails/src/run-watch.ts` runs once, then sets up a debounced (`100ms`) `node:fs.watch` filtered to `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` extensions in the trail's source directory. SIGINT closes the watcher cleanly. A short startup warmup window (`150ms`) suppresses the macOS FSEvents replay event that would otherwise produce a phantom rerun on first invocation.
