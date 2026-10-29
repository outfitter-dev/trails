# @ontrails/adapter-kit

Authoring utilities for Trails adapter metadata, scaffolding, and validation.

## Adapter owner dependencies

Extracted adapters declare their owner package as a peer dependency because the consuming application provides that package at runtime. An adapter may also list the same owner in `devDependencies` when its local build, typecheck, or tests need the owner package.

The adapter check rejects owner packages in runtime or optional dependencies, and it rejects a development-only owner declaration without the required peer dependency.
