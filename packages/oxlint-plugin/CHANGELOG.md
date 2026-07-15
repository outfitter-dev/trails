# @ontrails/oxlint-plugin

## 1.0.0-beta.44

## 1.0.0-beta.43

### Patch Changes

- [`9f0842e`](https://github.com/outfitter-dev/trails/commit/9f0842ee9d7c7155d86a4fd023760ac0a5636f5d): Retire the temporary root vocabulary-cutover toolchain now that Regrade owns
  structured migration plans, safe rewrites, classification, census, CLI/MCP
  reports, and immutable history. Remove the obsolete source exemptions so
  Oxlint and Warden enforce the durable transition contract directly, and add a
  history-driven Regrade audit surface for current-tree regression checks.
- [`113aed6`](https://github.com/outfitter-dev/trails/commit/113aed62d20041e35b0cf9d6c1b1a18df4b88f57): Rename the dependency-light observability owner from `@ontrails/observe` to
  `@ontrails/observability` as a pre-v1 hard cut. Update dependent packages,
  documentation, package discovery, and the governed Regrade route; no
  compatibility package or old import route is retained.

## 1.0.0-beta.42

## 1.0.0-beta.41

## 1.0.0-beta.40

## 1.0.0-beta.39

## 1.0.0-beta.38

## 1.0.0-beta.37

## 1.0.0-beta.36

## 1.0.0-beta.35

## 1.0.0-beta.34

## 1.0.0-beta.33

## 1.0.0-beta.32

## 1.0.0-beta.31

## 1.0.0-beta.30

## 1.0.0-beta.29

## 1.0.0-beta.28

## 1.0.0-beta.27

## 1.0.0-beta.26

## 1.0.0-beta.25

## 1.0.0-beta.24

## 1.0.0-beta.23

## 1.0.0-beta.22

## 1.0.0-beta.21

## 1.0.0-beta.20

## 1.0.0-beta.19

## 1.0.0-beta.18

## 1.0.0-beta.17

## 1.0.0-beta.16

### Patch Changes

- 25f3c5c: Add the dedicated `@ontrails/commander` adapter package and move the Commander runtime out of the `@ontrails/cli/commander` subpath. Extend the repo-local package-source guardrails to cover adapter package source as the Commander runtime moves under `adapters/`.
