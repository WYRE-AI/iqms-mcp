# `iqms-mcp`

MCP server for **IQMS / DELMIAworks** (EnterpriseIQ), the manufacturing ERP
from Dassault Systèmes.

> **Status:** Read tools issue queries through
> [`@wyre-technology/node-iqms`](https://github.com/wyre-technology/node-iqms)
> against the Direct Oracle path (always available). Write tools route through
> the licensed DELMIAworks WebAPI module — an optional add-on — and throw
> `DriverNotConfiguredError` until `X-IQMS-WebAPI-Base-URL` credentials are
> supplied.

## Why this exists

EnterpriseIQ doesn't have a public REST API. The realistic integration paths are:

1. **Direct Oracle** (universal at every install) — read-only queries
2. **WebAPI module** (paid licensed add-on) — transactional writes

This MCP server exposes both behind a single decision-tree-navigated tool surface.

## Tools

Initial discovery surface (always available):

- `iqms_navigate` — list tools in a domain
- `iqms_status` — credential / connection check

Domains: `workorders`, `inventory`, `boms`, `sales_orders`, `purchase_orders`,
`schedule`, `quality`.

Read tools (Oracle, available always):

| Tool | Purpose |
|------|---------|
| `iqms_workorders_list` | Open / in-progress work orders |
| `iqms_workorders_get` | Full work order detail incl. routings |
| `iqms_inventory_onhand` | On-hand by item / location / lot |
| `iqms_inventory_lot_trace` | Lot genealogy walk |
| `iqms_boms_explode` | BOM explosion |
| `iqms_boms_where_used` | Where-used reverse lookup |
| `iqms_sales_orders_list` | Open SOs / ship status |
| `iqms_purchase_orders_list` | Open POs / expected receipts |
| `iqms_schedule_capacity` | Machine schedule + capacity load |
| `iqms_quality_ncrs` | Non-conformances / CARs / CAPAs |

Write tools (WebAPI, gated):

| Tool | Purpose |
|------|---------|
| `iqms_workorders_create` | Create a new work order |
| `iqms_workorders_post_production` | Post qty made / scrapped |
| `iqms_inventory_adjust` | Inventory transaction |
| `iqms_quality_create_ncr` | Open a non-conformance record |

## Run modes

### Local (stdio)

```bash
IQMS_ORACLE_USER=eiq_ro \
IQMS_ORACLE_PASSWORD=… \
IQMS_ORACLE_CONNECT_STRING=eiq-db.example.com:1521/EIQ \
npx -y github:WYRE-AI/iqms-mcp
```

### Gateway (HTTP, stateless)

`CONDUIT_S2S_SECRET` is required. If it is empty or a known placeholder (`changeme`, `placeholder`, `your-s2s-secret`, and the other example values rejected at startup), the HTTP server logs an error and exits non-zero. It never prints the secret. Set `MCP_ALLOW_INSECURE_DEV=1` only for local development to start without the secret; the process logs a warning, does not check `X-Gateway-S2S`, and binds `127.0.0.1` only. A non-loopback `MCP_HTTP_HOST` (including `0.0.0.0`) is ignored in that mode and the override is logged. A placeholder secret still refuses to start.

`MCP_HTTP_HOST` is honored when `CONDUIT_S2S_SECRET` is set, and defaults to `0.0.0.0` when unset. With no secret, the listener is `127.0.0.1`. The container image sets `MCP_HTTP_HOST=0.0.0.0` and `AUTH_MODE=gateway`.

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
MCP_TRANSPORT=http \
MCP_HTTP_PORT=8080 \
AUTH_MODE=gateway \
node dist/http.js
```

Local HTTP without a secret is development-only and always binds `127.0.0.1`:

```bash
MCP_ALLOW_INSECURE_DEV=1 npm run start:http
```

#### `X-Gateway-S2S`

With `MCP_TRANSPORT=http` and a real `CONDUIT_S2S_SECRET`, every `/mcp` request must include `X-Gateway-S2S`:

```text
t=<unix seconds>,v1=<hex hmac-sha256>
```

The signature is HMAC-SHA256 of the literal message `t=<unix seconds>` (the same `t=` prefix that appears in the header), keyed with `CONDUIT_S2S_SECRET`, and hex-encoded. A missing or invalid header returns 401. `/health` stays unauthenticated and does not read vendor credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

In `AUTH_MODE=gateway`, `/mcp` also requires the Oracle headers below. Those headers are the only credential source for that request. A request missing any of them returns 401 and does not fall back to `IQMS_*` in the process environment.

| Header | Required | Notes |
|--------|----------|-------|
| `X-Gateway-S2S` | yes, when `CONDUIT_S2S_SECRET` is set | `t=<unix seconds>,v1=<hmac-sha256 hex of t=...>` |
| `X-IQMS-Oracle-User` | yes | Oracle DB user |
| `X-IQMS-Oracle-Password` | yes | Oracle DB password |
| `X-IQMS-Oracle-Connect-String` | yes | Easy Connect or TNS |
| `X-IQMS-WebAPI-Base-URL` | no | Enables write tools when all three WebAPI headers are present |
| `X-IQMS-WebAPI-User` | no | |
| `X-IQMS-WebAPI-Password` | no | |

#### Single-tenant HTTP (`AUTH_MODE=env`)

`/mcp` still requires a valid `X-Gateway-S2S` header. Vendor credentials come from `IQMS_ORACLE_USER`, `IQMS_ORACLE_PASSWORD`, and `IQMS_ORACLE_CONNECT_STRING`. Optional `IQMS_WEBAPI_*` variables enable write tools. This mode is separate from the gateway Compose service, which does not inject those variables.

### Docker

The image listens on `0.0.0.0` inside the container and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and pass the S2S secret. In gateway mode, IQMS credentials arrive on each request as headers; they are not read from the environment.

```bash
docker build -t iqms-mcp .
docker run \
  -e CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" \
  -p 127.0.0.1:8080:8080 \
  iqms-mcp
```

Compose refuses to start when `CONDUIT_S2S_SECRET` is unset, sets `AUTH_MODE=gateway`, publishes `127.0.0.1:8080:8080`, and does not inject static `IQMS_*` credentials:

```bash
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" docker compose up
```

## License

Apache-2.0
