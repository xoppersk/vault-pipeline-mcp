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
  MANAGE: `${N8N_BASE_URL}/webhook/mcp-pipeline-manage`,
};

const WORKFLOW_IDS: Record<string, string> = {
  W1: "SWIgVd1bFBrF5Fpf",
  W2: "Wmtg9lxyCWESypgi",
  W3: "93b0JpyOJHmV3T26",
  W4: "DzhKMzKIoYFUKWTl",
  W5: "WmG4h8GrOhlK7sqP",
  W6: "A0QB4WSYvuckSkSF",
  "V2-W1": "rXlIRlBd7pXBHfQE",
};

const WORKFLOW_NAMES: Record<string, string> = {
  W1: "Topic Research & Selection",
  W2: "Script Production",
  W3: "Voiceover Production",
  W4: "Video Assembly",
  W5: "YouTube Upload & Publishing",
  W6: "Performance Analytics",
  "V2-W1": "V2 Topic Research",
};

const PIPELINE_COLUMNS = [
  "title", "status", "created_at", "hook_angle", "content_pillar",
  "target_keyword", "script_url", "script_body", "hook_score",
  "voiceover_url", "avatar_hook_url", "avatar_cta_url", "video_url",
  "thumbnail_url", "thumbnail_status", "youtube_url", "publish_date",
  "video_id", "primary_keyword", "topic_summary", "total_score"
];

interface PipelineRow {
  title: string; status: string; created_at: string; hook_angle: string;
  content_pillar: string; target_keyword: string; script_url: string;
  script_body: string; hook_score: string; voiceover_url: string;
  avatar_hook_url: string; avatar_cta_url: string; video_url: string;
  thumbnail_url: string; thumbnail_status: string; youtube_url: string;
  publish_date: string; video_id: string; primary_keyword: string;
  topic_summary: string; total_score: string; row_number?: number;
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

const server = new McpServer({ name: "vault-pipeline-mcp", version: "1.1.0" });

// ── read_pipeline ──
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

// ── update_row (expanded to all columns) ──
server.registerTool("update_row", {
  title: "Update Pipeline Row",
  description: "Update fields on a Pipeline Sheet row matched by video_id. Supports: status, script_url, voiceover_url, video_url, thumbnail_url, youtube_url, publish_date, hook_angle, content_pillar, target_keyword, script_body, hook_score, avatar_hook_url, avatar_cta_url, thumbnail_status, primary_keyword, topic_summary, total_score, title, created_at.",
  inputSchema: {
    video_id: z.string().min(1).describe("The video_id to match"),
    status: z.string().optional().describe("New status value"),
    title: z.string().optional().describe("Video title"),
    created_at: z.string().optional().describe("Created timestamp"),
    hook_angle: z.string().optional().describe("Hook angle/reasoning"),
    content_pillar: z.string().optional().describe("Content pillar category"),
    target_keyword: z.string().optional().describe("Target keyword"),
    script_url: z.string().optional().describe("Script URL"),
    script_body: z.string().optional().describe("Script body text"),
    hook_score: z.string().optional().describe("Hook score"),
    voiceover_url: z.string().optional().describe("Voiceover URL"),
    avatar_hook_url: z.string().optional().describe("Avatar hook clip URL"),
    avatar_cta_url: z.string().optional().describe("Avatar CTA clip URL"),
    video_url: z.string().optional().describe("Video URL"),
    thumbnail_url: z.string().optional().describe("Thumbnail URL"),
    thumbnail_status: z.string().optional().describe("Thumbnail status"),
    youtube_url: z.string().optional().describe("YouTube URL"),
    publish_date: z.string().optional().describe("Publish date"),
    primary_keyword: z.string().optional().describe("Primary keyword"),
    topic_summary: z.string().optional().describe("Topic summary"),
    total_score: z.string().optional().describe("Total score"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (params) => {
  try {
    const updates: Record<string, string> = { video_id: params.video_id };
    const allFields = [
      "status", "title", "created_at", "hook_angle", "content_pillar",
      "target_keyword", "script_url", "script_body", "hook_score",
      "voiceover_url", "avatar_hook_url", "avatar_cta_url", "video_url",
      "thumbnail_url", "thumbnail_status", "youtube_url", "publish_date",
      "primary_keyword", "topic_summary", "total_score"
    ];
    for (const field of allFields) {
      if ((params as Record<string, unknown>)[field] !== undefined) {
        updates[field] = String((params as Record<string, unknown>)[field]);
      }
    }
    const fieldsUpdated = Object.keys(updates).filter((k) => k !== "video_id");
    if (fieldsUpdated.length === 0) return { content: [{ type: "text", text: "No fields to update." }], isError: true };
    const result = await callWebhook(WEBHOOK.UPDATE, updates);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, video_id: params.video_id, fields_updated: fieldsUpdated, result }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

// ── delete_rows ──
server.registerTool("delete_rows", {
  title: "Delete Pipeline Rows",
  description: "Delete rows from the Pipeline Sheet matching a column value. Deletes ONE matching row per call — call multiple times for bulk deletion. Use column='video_id' and value='V2-Jun3-1' to delete by video_id, or column='status' and value='Skipped' to delete by status.",
  inputSchema: {
    column: z.string().min(1).describe("Column name to match (e.g. video_id, status, title)"),
    value: z.string().min(1).describe("Value to match in the specified column"),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, async ({ column, value }) => {
  try {
    const result = await callWebhook(WEBHOOK.MANAGE, { action: "delete", column, value });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, action: "delete_rows", column, value, result }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

// ── clear_sheet ──
server.registerTool("clear_sheet", {
  title: "Clear Pipeline Sheet",
  description: "Wipe ALL data rows from the Pipeline Sheet. Headers are preserved. Use with caution — this deletes all pipeline data. Requires confirm=true.",
  inputSchema: {
    confirm: z.boolean().describe("Must be true to execute. Safety gate."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
}, async ({ confirm }) => {
  try {
    if (!confirm) return { content: [{ type: "text", text: "Clear aborted. Set confirm=true to execute." }] };
    const result = await callWebhook(WEBHOOK.MANAGE, { action: "clear" });
    return { content: [{ type: "text", text: JSON.stringify({ success: true, action: "clear_sheet", message: "All data rows cleared. Headers preserved.", result }, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

// ── trigger_workflow ──
server.registerTool("trigger_workflow", {
  title: "Trigger Pipeline Workflow",
  description: "Trigger a Vault pipeline workflow (W1-W6, V2-W1) by name or ID. Fire-and-forget.",
  inputSchema: { workflow: z.string().min(1).describe("Workflow name (W1-W6, V2-W1) or full workflow ID") },
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

// ── get_execution ──
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

// ── pipeline_health ──
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
  app.get("/health", (_req, res) => { res.json({ status: "ok", server: "vault-pipeline-mcp", version: "1.1.0" }); });
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.listen(PORT, () => {
    console.error(`Vault Pipeline MCP server v1.1.0 running on http://localhost:${PORT}/mcp`);
    console.error(`Health check: http://localhost:${PORT}/health`);
    console.error(`n8n base: ${N8N_BASE_URL}`);
  });
}

main().catch((error) => { console.error("Server error:", error); process.exit(1); });
