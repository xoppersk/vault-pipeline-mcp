import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

const N8N_BASE_URL = process.env.N8N_BASE_URL || "https://n8n.sevynlabs.io";
const N8N_API_KEY = process.env.N8N_API_KEY || "";
const PORT = parseInt(process.env.PORT || "3000");

const WEBHOOK = {
  READ: `${N8N_BASE_URL}/webhook/mcp-pipeline-read`,
  UPDATE: `${N8N_BASE_URL}/webhook/mcp-pipeline-update`,
  TRIGGER: `${N8N_BASE_URL}/webhook/mcp-trigger-workflow`,
};

const WORKFLOW_IDS: Record<string, string> = {
  W1: "SWIgVd1bFBrF5Fpf",
  W2: "Wmtg9lxyCWESypgi",
  W3: "93b0JpyOJHmV3T26",
  W4: "DzhKMzKIoYFUKWTl",
  W5: "WmG4h8GrOhlK7sqP",
  W6: "A0QB4WSYvuckSkSF",
};

const WORKFLOW_NAMES: Record<string, string> = {
  W1: "Topic Research & Selection",
  W2: "Script Production",
  W3: "Voiceover Production",
  W4: "Video Assembly",
  W5: "YouTube Upload & Publishing",
  W6: "Performance Analytics",
};

const PIPELINE_COLUMNS = [
  "video_id", "title", "status", "script_url", "voiceover_url",
  "video_url", "thumbnail_url", "youtube_url", "publish_date", "created_at"
];

interface PipelineRow {
  video_id: string; title: string; status: string; script_url: string;
  voiceover_url: string; video_url: string; thumbnail_url: string;
  youtube_url: string; publish_date: string; created_at: string;
  row_number?: number;
}

interface N8nExecution {
  id: string; finished: boolean; mode: string; status: string;
  startedAt: string; stoppedAt: string; workflowId: string;
  data?: { resultData?: { runData?: Record<string, Array<{
    startTime: number; executionTime: number;
    data?: Record<string, Array<Array<{ json: Record<string, unknown> }>>>;
    error?: { message: string; description?: string };
  }>>; }; };
}

async function callWebhook(url: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webhook call failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function n8nApiGet(path: string): Promise<unknown> {
  const response = await fetch(`${N8N_BASE_URL}/api/v1${path}`, {
    method: "GET",
    headers: { "X-N8N-API-KEY": N8N_API_KEY, "Accept": "application/json" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`n8n API call failed (${response.status}): ${text}`);
  }
  return response.json();
}

function formatPipelineTable(rows: PipelineRow[]): string {
  if (rows.length === 0) return "No rows found.";
  const header = "| # | video_id | title | status | voiceover | video | youtube |\n|---|----------|-------|--------|-----------|-------|---------|";
  const lines = rows.map((r, i) => {
    const vo = r.voiceover_url ? "Y" : "-";
    const vid = r.video_url ? "Y" : "-";
    const yt = r.youtube_url ? "Y" : "-";
    const title = (r.title || "").substring(0, 35);
    return `| ${i + 1} | ${r.video_id} | ${title} | ${r.status} | ${vo} | ${vid} | ${yt} |`;
  });
  return [header, ...lines].join("\n");
}

const server = new McpServer({ name: "vault-pipeline-mcp", version: "1.0.0" });

server.registerTool("read_pipeline", {
  title: "Read Pipeline Sheet",
  description: "Read all rows from the Vault Pipeline Sheet with optional status filter. Returns video_id, title, status, URLs, dates.",
  inputSchema: {
    status_filter: z.string().optional().describe("Filter by exact status value"),
    format: z.enum(["table", "json"]).default("json").describe("Output format"),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ status_filter, format }) => {
  try {
    const data = await callWebhook(WEBHOOK.READ) as PipelineRow[];
    let rows = Array.isArray(data) ? data : [];
    rows = rows.map((r, i) => ({ ...r, row_number: i + 2 }));
    if (status_filter) rows = rows.filter((r) => r.status === status_filter);
    const output = format === "table" ? formatPipelineTable(rows) : JSON.stringify({ total: rows.length, rows }, null, 2);
    return { content: [{ type: "text", text: output }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

server.registerTool("update_row", {
  title: "Update Pipeline Row",
  description: "Update fields on a Pipeline Sheet row matched by video_id. Supports: status, script_url, voiceover_url, video_url, thumbnail_url, youtube_url, publish_date.",
  inputSchema: {
    video_id: z.string().min(1).describe("The video_id to match"),
    status: z.string().optional().describe("New status value"),
    script_url: z.string().optional().describe("Script URL"),
    voiceover_url: z.string().optional().describe("Voiceover URL"),
    video_url: z.string().optional().describe("Video URL"),
    thumbnail_url: z.string().optional().describe("Thumbnail URL"),
    youtube_url: z.string().optional().describe("YouTube URL"),
    publish_date: z.string().optional().describe("Publish date"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ video_id, status, script_url, voiceover_url, video_url, thumbnail_url, youtube_url, publish_date }) => {
  try {
    const updates: Record<string, string> = { video_id };
    if (status !== undefined) updates.status = status;
    if (script_url !== undefined) updates.script_url = script_url;
    if (voiceover_url !== undefined) updates.voiceover_url = voiceover_url;
    if (video_url !== undefined) updates.video_url = video_url;
    if (thumbnail_url !== undefined) updates.thumbnail_url = thumbnail_url;
    if (youtube_url !== undefined) updates.youtube_url = youtube_url;
    if (publish_date !== undefined) updates.publish_date = publish_date;
    const fieldsUpdated = Object.keys(updates).filter((k) => k !== "video_id");
    if (fieldsUpdated.length === 0) return { content: [{ type: "text", text: "No fields to update." }], isError: true };
    const result = await callWebhook(WEBHOOK.UPDATE, updates);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, video_id, fields_updated: fieldsUpdated, result }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

server.registerTool("trigger_workflow", {
  title: "Trigger Pipeline Workflow",
  description: "Trigger a Vault pipeline workflow (W1-W6) by name or ID. Fire-and-forget.",
  inputSchema: { workflow: z.string().min(1).describe("Workflow name (W1-W6) or full workflow ID") },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ workflow: wf }) => {
  try {
    const upperWf = wf.toUpperCase();
    const workflowId = WORKFLOW_IDS[upperWf] || wf;
    const workflowName = WORKFLOW_NAMES[upperWf] || upperWf;
    const result = await callWebhook(WEBHOOK.TRIGGER, { workflowId });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, workflow: workflowName, workflow_id: workflowId, message: `Triggered ${workflowName}`, result }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

server.registerTool("get_execution", {
  title: "Get Execution Details",
  description: "Get execution data from n8n by execution ID with optional node-level detail.",
  inputSchema: {
    execution_id: z.string().min(1).describe("n8n execution ID"),
    workflow_id: z.string().min(1).describe("Workflow ID (W1-W6 or full ID)"),
    include_data: z.boolean().default(false).describe("Include node-level data"),
    node_names: z.array(z.string()).optional().describe("Filter to specific node names"),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ execution_id, workflow_id, include_data, node_names }) => {
  try {
    const resolvedWfId = WORKFLOW_IDS[workflow_id.toUpperCase()] || workflow_id;
    const qp = include_data ? "?includeData=true" : "";
    const data = await n8nApiGet(`/executions/${execution_id}${qp}`) as N8nExecution;
    const summary: Record<string, unknown> = {
      execution_id: data.id, workflow_id: data.workflowId, status: data.status,
      finished: data.finished, started_at: data.startedAt, stopped_at: data.stoppedAt,
    };
    if (include_data && data.data?.resultData?.runData) {
      const nodeResults: Record<string, unknown> = {};
      for (const [nodeName, executions] of Object.entries(data.data.resultData.runData)) {
        if (node_names && !node_names.includes(nodeName)) continue;
        const exec = executions[0]; if (!exec) continue;
        const nodeInfo: Record<string, unknown> = { execution_time_ms: exec.executionTime };
        if (exec.error) { nodeInfo.error = exec.error.message; if (exec.error.description) nodeInfo.error_detail = exec.error.description; }
        if (exec.data?.main) { const items = exec.data.main[0]; if (items) { nodeInfo.item_count = items.length; nodeInfo.preview = items.slice(0, 3).map((item) => item.json); } }
        nodeResults[nodeName] = nodeInfo;
      }
      summary.nodes = nodeResults;
    }
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

server.registerTool("pipeline_health", {
  title: "Pipeline Health Dashboard",
  description: "Summary of Vault Pipeline: status counts, actionable items (ready for W3/W4/W5), recent executions.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async () => {
  try {
    const data = await callWebhook(WEBHOOK.READ) as PipelineRow[];
    const rows = Array.isArray(data) ? data : [];
    const statusCounts: Record<string, number> = {};
    for (const row of rows) { const s = row.status || "(empty)"; statusCounts[s] = (statusCounts[s] || 0) + 1; }
    const readyForW3 = rows.filter((r) => r.status === "Script Complete");
    const readyForW4 = rows.filter((r) => r.status === "Voiceover Complete");
    const readyForW5 = rows.filter((r) => r.status === "Video Complete");
    const published = rows.filter((r) => r.status === "Published" || r.status === "Scheduled");
    let recentExecutions: Array<Record<string, unknown>> = [];
    try {
      const execData = await n8nApiGet("/executions?limit=10") as { data: Array<{ id: string; status: string; workflowId: string; startedAt: string; stoppedAt: string }> };
      const wfIds = new Set(Object.values(WORKFLOW_IDS));
      const wfIdToName: Record<string, string> = {};
      for (const [name, id] of Object.entries(WORKFLOW_IDS)) { wfIdToName[id] = name; }
      recentExecutions = (execData.data || []).filter((e) => wfIds.has(e.workflowId)).slice(0, 6).map((e) => ({ execution_id: e.id, workflow: wfIdToName[e.workflowId] || e.workflowId, status: e.status, started: e.startedAt, finished: e.stoppedAt }));
    } catch { /* non-critical */ }
    const health = { total_rows: rows.length, status_counts: statusCounts, actionable: { ready_for_W3_voiceover: readyForW3.map((r) => ({ video_id: r.video_id, title: r.title })), ready_for_W4_video: readyForW4.map((r) => ({ video_id: r.video_id, title: r.title })), ready_for_W5_upload: readyForW5.map((r) => ({ video_id: r.video_id, title: r.title })), published_or_scheduled: published.length }, recent_executions: recentExecutions };
    return { content: [{ type: "text", text: JSON.stringify(health, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

async function main(): Promise<void> {
  if (!N8N_API_KEY) console.error("WARNING: N8N_API_KEY not set");
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => { res.json({ status: "ok", server: "vault-pipeline-mcp", version: "1.0.0" }); });
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.listen(PORT, () => {
    console.error(`Vault Pipeline MCP server running on http://localhost:${PORT}/mcp`);
    console.error(`Health check: http://localhost:${PORT}/health`);
    console.error(`n8n base: ${N8N_BASE_URL}`);
  });
}

main().catch((error) => { console.error("Server error:", error); process.exit(1); });
