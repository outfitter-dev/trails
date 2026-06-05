# Surface Facet Field Notes

Surface facets should stay evidence-led. Use this file for lightweight notes from real MCP surface use before widening facet behavior to more surfaces or adding stronger governance.

## Evidence Window

TRL-890 originally called for two sprints between the ad-hoc Trails operator MCP surface and the reusable facet engine. Matt shortened that window during the Surface Facets & MCP Shaping sprint so the full stack could land together. Treat these notes as first-contact evidence plus a standing place for the next two sprints of follow-up, not as proof that every cross-surface question is settled.

## Trails Operator Surface

The first shaped surface was `apps/trails/src/mcp-options.ts`. It projected the Trails operator app into seven deferred MCP facet tools:

- `artifacts`
- `authoring`
- `execution`
- `governance`
- `inspect`
- `shell`
- `workspace`

Each facet uses an explicit trail list instead of a broad namespace glob. That made review easier: agent reviewers could verify coverage of public trails, confirm that internal trails stayed hidden, and reason about the grouping without expanding a hidden selector mentally.

TRL-908 revised the dogfood surface around permission boundaries. The Trails operator MCP server now keeps high-signal and permission-sensitive affordances as direct tools, removes shell completion trails from MCP, and uses one deferred `inspect` facet for saved read-only topo inspection. Selected Wayfinder graph-read trails are explicitly included as direct tools on the operator MCP topo, rather than hidden behind a generic Wayfinder bucket.

## What Survived Contact

- **Tool count:** a smaller tool surface still matters, but permission boundaries matter more than minimizing count.
- **Invocation shape:** `{ trail, input }` keeps the underlying trail visible and avoids a new action vocabulary inside the facet.
- **Output correlation:** `{ trail, output }` is necessary. Heterogeneous facet tools need the returned trail ID so an agent can connect a response to the selected contract without guessing from output fields.
- **Cold context:** the resolved MCP surface map belongs in MCP resources. Agents can inspect grouped tools, member trail IDs, examples, and deferred hints without paying that context cost in every tool schema.
- **Explicit selectors:** authored facet lists are boring, but boring helped. They made visibility and overlap review much more mechanical.
- **Direct sensitive tools:** Warden, run, compile, authoring, topo pinning, and developer-state mutation are clearer as direct MCP tools than as members of broad facets.

## What To Keep Watching

- **Schema size:** deferred loading is only a compatibility hint today. Clients that still load all schemas need to keep working, and large member schemas may still be expensive until richer MCP client support exists.
- **Description drift:** descriptions can become false as member lists evolve. `descriptionStableThrough` should be reserved for intentional stability, not used as a routine silencer.
- **Missing metadata:** the surface map should remain the place to look for member trail IDs, facet IDs, output schemas, examples, versions, and deferred hints. If agents still need to inspect source after reading it, the resource shape needs more work.
- **Selector overlap:** overlap should stay visible as a Warden finding unless future evidence shows a precise, governed exception is needed.

## Dropped Or Deferred

- A generic `facet()` primitive is not justified.
- `overlapsWith` is not justified; it would make drift too easy to silence.
- CLI and HTTP parity are deferred. CLI should be evaluated as command-group consolidation, and HTTP as route-group projection or a rejected non-fit.
- `mcp.search` and code-mode execution stay out of this slice.

## Follow-Up Notes Template

When adding future notes, include:

- app or topo under test;
- number of raw trails and projected facet tools;
- client used;
- whether agents found the right tool without source inspection;
- confusing invocation or output cases;
- schema/context cost observations;
- any description, selector, or visibility drift found.
