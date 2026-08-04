# Graph Report - iqms-mcp  (2026-05-23)

## Corpus Check
- 23 files · ~4,863 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 137 nodes · 206 edges · 12 communities (11 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3b3b0241`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]

## God Nodes (most connected - your core abstractions)
1. `getClient()` - 16 edges
2. `scripts` - 12 edges
3. `compilerOptions` - 11 edges
4. `getDomainHandler()` - 10 edges
5. `DomainHandler` - 9 edges
6. `CallToolResult` - 8 edges
7. `logger` - 7 edges
8. `getCredentials()` - 5 edges
9. ``iqms-mcp`` - 5 edges
10. `startHttpServer()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `handleCall()` --calls--> `getClient()`  [EXTRACTED]
  src/domains/inventory.ts → src/utils/client.ts
- `handleCall()` --calls--> `getClient()`  [EXTRACTED]
  src/domains/workorders.ts → src/utils/client.ts
- `handleCall()` --calls--> `getClient()`  [EXTRACTED]
  src/domains/quality.ts → src/utils/client.ts
- `handleCall()` --calls--> `getClient()`  [EXTRACTED]
  src/domains/schedule.ts → src/utils/client.ts
- `handleCall()` --calls--> `getClient()`  [EXTRACTED]
  src/domains/sales-orders.ts → src/utils/client.ts

## Communities (12 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.13
Nodes (16): bomsHandler, handleCall(), handleCall(), purchaseOrdersHandler, handleCall(), qualityHandler, handleCall(), salesOrdersHandler (+8 more)

### Community 1 - "Community 1"
Cohesion: 0.14
Nodes (17): handleCall(), inventoryHandler, HEADER_TO_ENV, startHttpServer(), server, transport, createServer(), Credentials (+9 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (18): author, bin, iqms-mcp, dependencies, @modelcontextprotocol/sdk, @wyre-technology/node-iqms, description, engines (+10 more)

### Community 3 - "Community 3"
Cohesion: 0.14
Nodes (13): compilerOptions, declaration, esModuleInterop, module, moduleResolution, outDir, rootDir, skipLibCheck (+5 more)

### Community 4 - "Community 4"
Cohesion: 0.17
Nodes (12): scripts, build, clean, dev, lint, prebuild, prepare, start (+4 more)

### Community 5 - "Community 5"
Cohesion: 0.35
Nodes (7): domainCache, getDomainHandler(), DOMAINS, getNavigationTools(), seen, tools, DomainName

### Community 6 - "Community 6"
Cohesion: 0.20
Nodes (10): devDependencies, semantic-release, @semantic-release/changelog, @semantic-release/git, @semantic-release/github, @semantic-release/npm, tsup, @types/node (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.20
Nodes (9): code:bash (IQMS_ORACLE_USER=eiq_ro \), code:bash (MCP_TRANSPORT=http \), Gateway (HTTP, stateless), `iqms-mcp`, License, Local (stdio), Run modes, Tools (+1 more)

### Community 8 - "Community 8"
Cohesion: 0.50
Nodes (3): Added, Changelog, [Unreleased]

## Knowledge Gaps
- **73 isolated node(s):** `branches`, `plugins`, `name`, `version`, `description` (+68 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `scripts` connect `Community 4` to `Community 2`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Community 6` to `Community 2`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `getClient()` connect `Community 0` to `Community 1`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **What connects `branches`, `plugins`, `name` to the rest of the system?**
  _73 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.12561576354679804 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.1383399209486166 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.10526315789473684 - nodes in this community are weakly interconnected._