# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial scaffold of `iqms-mcp` server.
- Decision-tree navigation tools (`iqms_navigate`, `iqms_status`).
- Read tools across seven domains: work orders, inventory, BOMs, sales orders,
  purchase orders, schedule, quality.
- Write tools (workorders create / post production, inventory adjust, NCR create)
  that route through the WebAPI driver and return clear errors when the WebAPI
  module is not licensed.
- Stdio transport (local plugin mode) and Streamable HTTP transport (gateway mode)
  with per-request server lifecycle.

### Fixed
- `/health` liveness endpoint now returns an unconditional `200` instead of `503`
  when no credentials are present. An Azure Container Apps liveness probe carries
  no credentials, so the previous credential-gated status code caused the
  container to crash-loop. Credential detail is retained in the response body
  (`status`, `credentials`) for diagnostics only.
- `getClient()`'s per-tenant Oracle pool cache now stores the in-flight
  `Promise<IqmsClient>` instead of the resolved client. Previously, two
  concurrent requests for the same brand-new tenant credentials (a cold
  start) could both miss the cache before the first `IqmsClient.create()`
  resolved, each opening its own Oracle connection pool; the second cache
  write silently overwrote the first, orphaning a pool that was never
  closed. Callers now single-flight onto the same in-flight creation, and a
  failed creation removes its cache entry so the next call retries instead
  of caching a permanent rejection. No change to steady-state pool reuse or
  cross-tenant isolation semantics.
