# Vault Pipeline Controller — MCP Server

Custom MCP server for Sevyn Studios Vault pipeline operations. Gives Claude direct access to the Pipeline Sheet and n8n workflow control.

## Tools

| Tool | Description |
|------|------------|
| `read_pipeline` | Read Pipeline Sheet rows with optional status filter |
| `update_row` | Update any row by video_id |
| `trigger_workflow` | Fire W1-W6 by name |
| `get_execution` | Get execution status with node-level data |
| `pipeline_health` | Full dashboard: status counts, actionable items, recent runs |

## Environment Variables

| Variable | Required | Default |
|----------|----------|---------|
| `N8N_BASE_URL` | No | `https://n8n.sevynlabs.io` |
| `N8N_API_KEY` | Yes | — |
| `PORT` | No | `3000` |

## Deploy

```bash
npm install && npm run build
npm start
```

MCP endpoint: `POST /mcp`
Health check: `GET /health`
