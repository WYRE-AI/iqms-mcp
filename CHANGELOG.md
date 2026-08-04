# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The published container could not start at all**: `ERR_MODULE_NOT_FOUND` for
  `@wyre-technology/node-iqms/dist/index.js`, so `iqms-mcp` crash-looped on every
  deploy. The SDK was declared as a git dependency
  (`github:wyre-technology/node-iqms#main`), and the SDK builds its `dist/` in a
  `prepare` script — which `npm ci --ignore-scripts` (the Dockerfile's install
  step, correctly used to avoid a premature build) skips. The dependency now
  resolves from GitHub Packages (`^1.0.1`), where `dist/` ships prebuilt in the
  published tarball. Added the `.npmrc` that scope needs.

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
