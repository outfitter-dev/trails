# Trails Plugin 0.4.0 Release Packet

This packet records the repository release that follows the agent-guidance ownership migration in [#1052](https://github.com/outfitter-dev/trails/pull/1052).

## Release Identity

| Fact | Value |
| --- | --- |
| Framework target | `@ontrails/core` 0.2.3 |
| Adopter plugin | `trails` 0.4.0 |
| Contributor plugin | `trails-dev` 0.1.0 |
| Skillset release | `012bd470f0ac` |
| Adopter bundle content | `sha256:2629a1a94b38a9727c9f738e897f04113b1779a14f9a77f5c56d258e82fc7eae` |
| Adopter bundle provenance | `sha256:b93e088beca7b9e915ebca7c9c7c996a535d31c9057f2e5558efea23760d544d` |
| Contributor bundle content | `sha256:bbca58eaec849e2033c21e01d9426a0e664390c7879a6879c9de818ae22c6d71` |
| Contributor bundle provenance | `sha256:f82b6fe85bfb06ee7534ee1e3409d3115c92ead406fcfd94e0d440d0737cb96e` |

The `trails` minor release removes contributor-only guidance from the adopter bundle and leaves the adopter skills focused on using Trails. The initial `trails-dev` release carries the contributor workflows moved out of that bundle. The framework package version does not change in this release.

The content hashes come from `bun scripts/hash-skillset-bundle.ts plugin plugin-dev`. The digest hashes every distributed file's sorted relative path and bytes, separated by null bytes. It excludes `skillset.lock` because the lock's independent `provenanceHash` records Skillset derivation.

## Marketplace State

The repository owns the `trails` Claude marketplace in `skillset.yaml`. The generated local catalog contains `trails` 0.4.0 and `trails-dev` 0.1.0. `skillset marketplace check trails --json` reports both entries as generated, verified, locked, and marketplace-ready.

This release updates repository artifacts only. It does not publish to an external marketplace or modify a user profile.

Before merge, the installed-skill check reports that the shared Agents and Codex symlinks still resolve to `main`, where the adopter skill is 0.3.4. The Claude home copy is absent. This is expected branch-to-main drift; rerun the read-only check after merge to confirm the symlinked installs resolve to 0.4.0.

## Verification

The release head must pass:

```bash
bun run plugin:metadata:check
bun run skillset:check
bunx skillset change status --json
bunx skillset release plan --json
bunx skillset release audit --json
bunx skillset marketplace check trails --json
bun scripts/hash-skillset-bundle.ts plugin plugin-dev
bun test scripts/__tests__/sync-plugin-metadata.test.ts
bun test scripts/__tests__/hash-skillset-bundle.test.ts
bun test scripts/__tests__/check-installed-trails-skill.test.ts
bun test scripts/__tests__/skillset-plugin-boundaries.test.ts
bun test scripts/__tests__/skillset-ownership-contract.test.ts
bun run format:check
git diff --check
```

The installed-skill check is evidence about the current machine rather than a release gate for repository artifacts. Record a stale global copy as intentionally decoupled until the operator authorizes an install refresh.

The runtime dogfood evidence comes from the v0.2.3 framework release and remains applicable because this release changes guidance packaging and generated plugin metadata without changing framework packages, trails, surfaces, or runtime behavior. The plugin-specific cold-bundle and boundary tests above cover the changed distribution surface.

## Classified Warnings

Skillset reports the two plugin config versions as compatibility baselines. This is intentional: release state owns the current versions, while the config fields preserve compatibility with older Skillset clients.

Skillset also reports that portable plugin agents are outside the `agent-plugins-1.0` support envelope. The adopter's `trail-engineer` agent remains Claude-only; the portable package intentionally contains the supported skill payload without claiming portable agent support.

After `marketplace update`, the generic build view reports `skillset.lock` as changed because the marketplace command adds Claude resolution provenance to that lock. The repository's `skillset:check` builds an isolated generic lock, removes only marketplace-added source ref, commit SHA, catalog-path entries, and the resulting root provenance hash, then requires the remaining structures to match exactly. It accepts that delta only while `marketplace check` proves both entries locked and ready. Drift in any other field or generated path remains an error.
