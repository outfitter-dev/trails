# Scaffold completion

A scaffold is a supported capability only when its command exists, its generated code and tests compile and run, and its documented integration passes Warden. Keep advertised add-family commands aligned with that bar; a template string alone is not a complete scaffold.

For resource scaffolds, prove config-driven creation, meaningful lifecycle cleanup, health reporting, and isolated mocks. The integration test must register the resource and execute a trail that declares and accesses it. `testAll(app)` must execute that consumer without resource configuration through the mock; an empty or unregistered resource graph is not evidence.

Scaffolds generate editable files without rewriting the user's topo. Teach the explicit import and declaration steps. Preserve authored output files, use the existing project-path safety helpers, preflight destination parents, and bound cleanup to files created by the invocation. Test the actual public surface rather than only invoking the implementation directly.

The resource and trail commands share a test filename for the same ID. If a planned file already exists, the command names the conflict and writes nothing. Choose distinct IDs when scaffolding both.

File-producing scaffold inputs may use a narrower ID subset than the corresponding Core definition. Document that as a scaffold naming constraint; do not silently tighten the Core or Warden grammar. Export names must remain valid for keyword-like IDs and IDs that match imports, and draft IDs must retain the reserved filename marker.

Public operator additions need an output schema, intentional CLI/MCP exposure, branch-local release intent, affected lock regeneration, and the distribution checks in `AGENTS.md`.

`trails add resource` and `trails add signal` are CLI-only and require a `project:write` permit. They share one private file-creation helper, not a template engine. For signal scaffolds, prove that a producer and consumer work together and keep Warden coaching for intentionally unwired declarations. These commands do not cover the whole add family.
