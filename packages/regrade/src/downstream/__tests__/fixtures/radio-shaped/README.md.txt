# Radio-shaped downstream fixture

Synthetic source tree shaped like the Radio app for regrade regression tests.
This is a committed, stable fixture — it does NOT depend on the live Radio
checkout. Fixture source files carry a trailing `.txt` guard so they are
invisible to this package's typecheck, lint, test discovery, and Warden scan;
the test (`radio-fixture.test.ts`) materializes them into a temp directory with
their real `.ts` / `.tsx` extensions before running the regrade engine.

This `README.md.txt` materializes to `README.md` and exercises the
`unsupported-extension` skip path.
