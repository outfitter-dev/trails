# Scaffold completion

A scaffold is a supported capability only when its command exists, its generated code and tests compile and run, and its documented integration passes Warden. Keep advertised add-family commands aligned with that bar; a template string alone is not a complete scaffold.

For resource scaffolds, prove config-driven creation, meaningful lifecycle cleanup, health reporting, and isolated mocks. The integration test must register the resource and execute a trail that declares and accesses it. `testAll(app)` must execute that consumer without resource configuration through the mock; an empty or unregistered resource graph is not evidence.

Scaffolds generate editable files without rewriting the user's topo. Teach the explicit import and declaration steps. Preserve authored output files, use the existing project-path safety helpers, preflight destination parents, and bound cleanup to files created by the invocation. Test the actual public surface rather than only invoking the implementation directly.

File-producing scaffold inputs may use a narrower ID subset than the corresponding Core definition. Document that as a scaffold naming constraint; do not silently tighten the Core or Warden grammar. Export names must remain valid for keyword-like IDs and IDs that match imports, and draft IDs must retain the reserved filename marker.

Public operator additions need an output schema, intentional CLI/MCP exposure, branch-local release intent, affected lock regeneration, and the distribution checks in `AGENTS.md`.

`add resource` and `add signal` cover resource and signal definitions. They share the operator's private safe file-creation owner; they do not form a new template engine. For signal scaffolds, prove a real producer and consumer integration, and retain coaching for an intentionally unwired declaration. These commands do not imply that every possible add-family capability is implemented.
