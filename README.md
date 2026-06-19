# Vault Pipeline Controller — MCP Server

Custom MCP server for Sevyn Studios Vault pipeline operations. Gives Claude direct access to the Pipeline Sheet and n8n workflow control — no more 5-step workaround dances.

## What It Does

| Tool | Description | Replaces |
|------|------------|----------|
| `read_pipeline` | Read all Pipeline Sheet rows with optional status filter | Composio workbench → temp workflow → cleanup |
| `update_row` | Update any row by video_id (status, URLs, dates) | Composio workbench → temp workflow → cleanup |
| `trigger_workflow` | Fire W1–W6 by name (fire-and-forget) | Manual trigger limitation workaround |
| `get_execution` | Get execution status with node-level data | Truncated MCP data parsing |
| `pipeline_health` | Full dashboard: status counts, actionable items, recent runs | Manual cross-referencing |

## Architecture

```
Claude ──MCP──► Vault Pipeline MCP Server (Render)
                    │
                    ├── POST /webhook/mcp-pipeline-read  ──► n8n ──► Google Sheets
                    ├── POST /webhook/mcp-pipeline-update ──► n8n ──► Google Sheets
                    ├── POST /webhook/mcp-trigger-workflow ──► n8n ──► Execute Workflow
                    └── GET  /api/v1/executions/{id}      ──► n8n REST API
```

Three permanent n8n utility workflows handle Sheet and workflow operations using existing Google Sheets OAuth. The MCP server is a thin TypeScript wrapper.

## Prerequisites

- n8n instance at n8n.sevynlabs.io (already running)
- Three MCP utility workflows deployed and active in n8n (already created):
  - `MCP — Pipeline Sheet Read` (Wd0jPaiMcMr7OxlS)
  - `MCP — Pipeline Sheet Update` (2SDCYSSBmWZ5TBGG)
  - `MCP — Trigger Workflow` (wLYf9LZ20WaAlVf1)
- n8n API key

## Deployment to Render

### Step 1: Push to GitHub

```bash
cd vault-pipeline-mcp
git init
git add .
git commit -m "Vault Pipeline Controller MCP server v1.0.0"
git remote add origin https://github.com/xoppersk/vault-pipeline-mcp.git
git push -u origin main
```

### Step 2: Create Render Web Service

1. Go to https://dashboard.render.com
2. New → Web Service → Connect your GitHub repo
3. Settings:
   - **Name**: vault-pipeline-mcp
   - **Environment**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (sufficient for MCP calls)

### Step 3: Set Environment Variables in Render

| Variable | Value |
|----------|-------|
| `N8N_BASE_URL` | `https://n8n.sevynlabs.io` |
| `N8N_API_KEY` | *(your n8n API key — find in Notion Studios Pipeline Credentials page)* |
| `PORT` | `3000` |

### Step 4: Connect to Claude

After deployment, add the MCP server URL to Claude:

1. Go to Claude.ai → Settings → MCP Servers (or wherever custom MCPs are configured)
2. Add: `https://vault-pipeline-mcp.onrender.com/mcp`

Or if using Claude Desktop / Claude Code, add to your MCP config:
```json
{
  "mcpServers": {
    "vault-pipeline": {
      "url": "https://vault-pipeline-mcp.onrender.com/mcp"
    }
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `N8N_BASE_URL` | No | `https://n8n.sevynlabs.io` | n8n instance URL |
| `N8N_API_KEY` | Yes | — | n8n API key for execution reads |
| `PORT` | No | `3000` | Server port |

## n8n Utility Workflows

These permanent workflows live in n8n and handle the actual data operations:

| Workflow | ID | Webhook Path | Purpose |
|----------|----|-------------|---------|
| MCP — Pipeline Sheet Read | Wd0jPaiMcMr7OxlS | `/webhook/mcp-pipeline-read` | Read all Pipeline Sheet rows |
| MCP — Pipeline Sheet Update | 2SDCYSSBmWZ5TBGG | `/webhook/mcp-pipeline-update` | Update row by video_id |
| MCP — Trigger Workflow | wLYf9LZ20WaAlVf1 | `/webhook/mcp-trigger-workflow` | Execute W1–W6 by ID |

**Important**: These workflows must remain active. If deactivated, the MCP server cannot operate.

## Pipeline Workflow Reference

| Name | ID | Description |
|------|----|-------------|
| W1 | SWIgVd1bFBrF5Fpf | Topic Research & Selection |
| W2 | Wmtg9lxyCWESypgi | Script Production |
| W3 | 93b0JpyOJHmV3T26 | Voiceover Production |
| W4 | DzhKMzKIoYFUKWTl | Video Assembly |
| W5 | WmG4h8GrOhlK7sqP | YouTube Upload & Publishing |
| W6 | A0QB4WSYvuckSkSF | Performance Analytics |

## Local Development

```bash
npm install
export N8N_API_KEY="your-key-here"
npm run dev
```

Test health check:
```bash
curl http://localhost:3000/health
```

## Security Notes

- The n8n API key is the only secret. Keep it in environment variables.
- Webhook paths are not secret — they only access Pipeline Sheet data.
- The MCP server itself has no authentication. Deploy behind a firewall or add auth if needed.
- Consider adding the `authentication: 'headerAuth'` option to the n8n webhook nodes for production hardening.
