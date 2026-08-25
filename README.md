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

```bash
MCP_TRANSPORT=http \
MCP_HTTP_PORT=8080 \
AUTH_MODE=gateway \
node dist/http.js
```

In gateway mode, credentials are injected per-request via headers:

| Header | Required | Notes |
|--------|----------|-------|
| `X-IQMS-Oracle-User` | yes | Oracle DB user |
| `X-IQMS-Oracle-Password` | yes | Oracle DB password |
| `X-IQMS-Oracle-Connect-String` | yes | Easy Connect or TNS |
| `X-IQMS-WebAPI-Base-URL` | no | Enables write tools when present |
| `X-IQMS-WebAPI-User` | no | |
| `X-IQMS-WebAPI-Password` | no | |

## License

Apache-2.0
