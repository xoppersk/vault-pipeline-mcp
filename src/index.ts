import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";

// ─── Configuration ───────────────────────────────────────────────────────────

const N8N_BASE_URL = process.env.N8N_BASE_URL || "https://n8n.sevynlabs.io";
const N8N_API_KEY = process.env.N8N_API_KEY || "";
const PORT = parseInt(process.env.PORT || "3000");

// Permanent n8n utility workflow webhook paths
const WEBHOOK = {
  READ: `${N8N_BASE_URL}/webhook/mcp-pipeline-read`,
  UPDATE: `${N8N_BASE_URL}/webhook/mcp-pipeline-update`,
  TRIGGER: `${N8N_BASE_URL}/webhook/mcp-trigger-workflow`,
};

// Vault pipeline workflow IDs
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

// Pipeline Sheet column order for reference
const PIPELINE_COLUMNS = [
  "video_id", "title", "status", "script_url", "voiceover_url",
  "video_url", "thumbnail_url", "youtube_url", "publish_date", "created_at"
];

// ─── Type Definitions ────────────────────────────────────────────────────────

interface PipelineRow {
  video_id: string;
  title: string;
  status: string;
  script_url: string;
  voiceover_url: string;
  video_url: string;
  thumbnail_url: string;
  youtube_url: string;
  publish_date: string;
  created_at: string;
  row_number?: number;
}

interface N8nExecution {
  id: string;
  finished: boolean;
  mode: string;
  status: string;
  startedAt: string;
  stoppedAt: string;
  workflowId: string;
  data?: {
    resultData?: {
      runData?: Record<string, Array<{
        startTime: number;
        executionTime: number;
        data?: Record<string, Array<Array<{ json: Record<string, unknown> }>>>;
        error?: { message: string; description?: string };
      }>>;
    };
  };
}

// ─── Helper Functions ────────────────────────────────────────────────────────

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
    headers: {
      "X-N8N-API-KEY": N8N_API_KEY,
      "Accept": "application/json",
    },
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
    const vo = r.voiceover_url ? "✅" : "—";
    const vid = r.video_url ? "✅" : "—";
    const yt = r.youtube_url ? "✅" : "—";
    const title = (r.title || "").substring(0, 35);
    return `| ${i + 1} | ${r.video_id} | ${title} | ${r.status} | ${vo} | ${vid} | ${yt} |`;
  });

  return [header, ...lines].join("\n");
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "vault-pipeline-mcp",
  version: "1.0.0",
});

// ─── Tool 1: read_pipeline ───────────────────────────────────────────────────

server.registerTool(
  "read_pipeline",
  {
    title: "Read Pipeline Sheet",
    description: `Read all rows from the Vault Pipeline Sheet, with optional status filter.

Returns pipeline rows with: video_id, title, status, script_url, voiceover_url, video_url, thumbnail_url, youtube_url, publish_date, created_at.

Common status values: Topic Selected, Topic Approved, Script Complete, Voiceover Complete, Video Complete, Scheduled, Published.

Args:
  - status_filter (string, optional): Filter rows by exact status match
  - format ('table' | 'json'): Output format (default: 'json')

Returns: Array of pipeline row objects or formatted table.`,
    inputSchema: {
      status_filter: z.string().optional().describe("Filter by exact status value, e.g. 'Voiceover Complete'"),
      format: z.enum(["table", "json"]).default("json").describe("Output format"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ status_filter, format }) => {
    try {
      const data = await callWebhook(WEBHOOK.READ) as PipelineRow[];
      let rows = Array.isArray(data) ? data : [];

      // Add row numbers (Sheet row = array index + 2, accounting for header)
      rows = rows.map((r, i) => ({ ...r, row_number: i + 2 }));

      if (status_filter) {
        rows = rows.filter((r) => r.status === status_filter);
      }

      const output = format === "table"
        ? formatPipelineTable(rows)
        : JSON.stringify({ total: rows.length, rows }, null, 2);

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error reading pipeline: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool 2: update_row ──────────────────────────────────────────────────────

server.registerTool(
  "update_row",
  {
    title: "Update Pipeline Row",
    description: `Update fields on a specific Pipeline Sheet row, matched by video_id.

Supports updating any column: status, script_url, voiceover_url, video_url, thumbnail_url, youtube_url, publish_date.

Args:
  - video_id (string): The video_id of the row to update (required)
  - status (string, optional): New status value
  - script_url (string, optional): Script URL
  - voiceover_url (string, optional): Voiceover URL
  - video_url (string, optional): Video URL
  - thumbnail_url (string, optional): Thumbnail URL
  - youtube_url (string, optional): YouTube URL
  - publish_date (string, optional): Publish date

Returns: Confirmation of the update with affected fields.`,
    inputSchema: {
      video_id: z.string().min(1).describe("The video_id to match (required)"),
      status: z.string().optional().describe("New status value"),
      script_url: z.string().optional().describe("Script URL"),
      voiceover_url: z.string().optional().describe("Voiceover URL"),
      video_url: z.string().optional().describe("Video URL"),
      thumbnail_url: z.string().optional().describe("Thumbnail URL"),
      youtube_url: z.string().optional().describe("YouTube URL"),
      publish_date: z.string().optional().describe("Publish date"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ video_id, status, script_url, voiceover_url, video_url, thumbnail_url, youtube_url, publish_date }) => {
    try {
      // Build update payload — only include fields that were provided
      const updates: Record<string, string> = { video_id };
      if (status !== undefined) updates.status = status;
      if (script_url !== undefined) updates.script_url = script_url;
      if (voiceover_url !== undefined) updates.voiceover_url = voiceover_url;
      if (video_url !== undefined) updates.video_url = video_url;
      if (thumbnail_url !== undefined) updates.thumbnail_url = thumbnail_url;
      if (youtube_url !== undefined) updates.youtube_url = youtube_url;
      if (publish_date !== undefined) updates.publish_date = publish_date;

      const fieldsUpdated = Object.keys(updates).filter((k) => k !== "video_id");
      if (fieldsUpdated.length === 0) {
        return {
          content: [{ type: "text", text: "No fields provided to update. Include at least one field besides video_id." }],
          isError: true,
        };
      }

      const result = await callWebhook(WEBHOOK.UPDATE, updates);
      const output = {
        success: true,
        video_id,
        fields_updated: fieldsUpdated,
        result,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error updating row: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool 3: trigger_workflow ────────────────────────────────────────────────

server.registerTool(
  "trigger_workflow",
  {
    title: "Trigger Pipeline Workflow",
    description: `Trigger a Vault pipeline workflow (W1–W6) by name or ID. Fire-and-forget — returns immediately.

Workflow mapping:
  - W1: Topic Research & Selection (SWIgVd1bFBrF5Fpf)
  - W2: Script Production (Wmtg9lxyCWESypgi)
  - W3: Voiceover Production (93b0JpyOJHmV3T26)
  - W4: Video Assembly (DzhKMzKIoYFUKWTl)
  - W5: YouTube Upload & Publishing (WmG4h8GrOhlK7sqP)
  - W6: Performance Analytics (A0QB4WSYvuckSkSF)

Args:
  - workflow (string): Workflow name (W1-W6) or full n8n workflow ID

Returns: Confirmation that the workflow was triggered.`,
    inputSchema: {
      workflow: z.string().min(1).describe("Workflow name (W1-W6) or full workflow ID"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ workflow: wf }) => {
    try {
      // Resolve workflow name to ID
      const upperWf = wf.toUpperCase();
      const workflowId = WORKFLOW_IDS[upperWf] || wf;
      const workflowName = WORKFLOW_NAMES[upperWf] || upperWf;

      const result = await callWebhook(WEBHOOK.TRIGGER, { workflowId });
      const output = {
        success: true,
        workflow: workflowName,
        workflow_id: workflowId,
        message: `Workflow ${workflowName} triggered successfully (fire-and-forget)`,
        note: "Use get_execution to check the result after a minute or two.",
        result,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error triggering workflow: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool 4: get_execution ───────────────────────────────────────────────────

server.registerTool(
  "get_execution",
  {
    title: "Get Execution Details",
    description: `Get detailed execution data from n8n by execution ID.

Returns execution metadata (status, timing, workflow) and optionally node-level data.

Args:
  - execution_id (string): The n8n execution ID
  - workflow_id (string): The workflow ID the execution belongs to
  - include_data (boolean): Include node-level execution data (default: false)
  - node_names (string[], optional): Filter to specific nodes when include_data is true

Returns: Execution status, timing, and optional node data.`,
    inputSchema: {
      execution_id: z.string().min(1).describe("n8n execution ID"),
      workflow_id: z.string().min(1).describe("Workflow ID (use W1-W6 or full ID)"),
      include_data: z.boolean().default(false).describe("Include node-level data"),
      node_names: z.array(z.string()).optional().describe("Filter to specific node names"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ execution_id, workflow_id, include_data, node_names }) => {
    try {
      // Resolve W1-W6 to full IDs
      const resolvedWfId = WORKFLOW_IDS[workflow_id.toUpperCase()] || workflow_id;

      const queryParams = include_data ? "?includeData=true" : "";
      const data = await n8nApiGet(`/executions/${execution_id}${queryParams}`) as N8nExecution;

      // Build response
      const summary: Record<string, unknown> = {
        execution_id: data.id,
        workflow_id: data.workflowId,
        status: data.status,
        finished: data.finished,
        started_at: data.startedAt,
        stopped_at: data.stoppedAt,
      };

      // Add node data if requested
      if (include_data && data.data?.resultData?.runData) {
        const runData = data.data.resultData.runData;
        const nodeResults: Record<string, unknown> = {};

        for (const [nodeName, executions] of Object.entries(runData)) {
          if (node_names && !node_names.includes(nodeName)) continue;

          const exec = executions[0];
          if (!exec) continue;

          const nodeInfo: Record<string, unknown> = {
            execution_time_ms: exec.executionTime,
          };

          if (exec.error) {
            nodeInfo.error = exec.error.message;
            if (exec.error.description) nodeInfo.error_detail = exec.error.description;
          }

          if (exec.data?.main) {
            const items = exec.data.main[0];
            if (items) {
              nodeInfo.item_count = items.length;
              // Include first 3 items as preview
              nodeInfo.preview = items.slice(0, 3).map((item) => item.json);
            }
          }

          nodeResults[nodeName] = nodeInfo;
        }

        summary.nodes = nodeResults;
      }

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error fetching execution: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Tool 5: pipeline_health ─────────────────────────────────────────────────

server.registerTool(
  "pipeline_health",
  {
    title: "Pipeline Health Dashboard",
    description: `Get a summary of the Vault Pipeline health: row counts by status, rows ready for each workflow stage, and recent workflow execution status.

No arguments required.

Returns: Status counts, actionable items (rows ready for W3/W4/W5), and recent execution info.`,
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    try {
      // Get all pipeline rows
      const data = await callWebhook(WEBHOOK.READ) as PipelineRow[];
      const rows = Array.isArray(data) ? data : [];

      // Count by status
      const statusCounts: Record<string, number> = {};
      for (const row of rows) {
        const status = row.status || "(empty)";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }

      // Find actionable items
      const readyForW3 = rows.filter((r) => r.status === "Script Complete");
      const readyForW4 = rows.filter((r) => r.status === "Voiceover Complete");
      const readyForW5 = rows.filter((r) => r.status === "Video Complete");
      const published = rows.filter((r) => r.status === "Published" || r.status === "Scheduled");

      // Get recent executions for key workflows
      let recentExecutions: Array<Record<string, unknown>> = [];
      try {
        const execData = await n8nApiGet("/executions?limit=10") as { data: Array<{ id: string; status: string; workflowId: string; startedAt: string; stoppedAt: string }> };
        const wfIds = new Set(Object.values(WORKFLOW_IDS));
        const wfIdToName: Record<string, string> = {};
        for (const [name, id] of Object.entries(WORKFLOW_IDS)) {
          wfIdToName[id] = name;
        }

        recentExecutions = (execData.data || [])
          .filter((e) => wfIds.has(e.workflowId))
          .slice(0, 6)
          .map((e) => ({
            execution_id: e.id,
            workflow: wfIdToName[e.workflowId] || e.workflowId,
            status: e.status,
            started: e.startedAt,
            finished: e.stoppedAt,
          }));
      } catch {
        // Non-critical — continue without execution data
      }

      const health = {
        total_rows: rows.length,
        status_counts: statusCounts,
        actionable: {
          ready_for_W3_voiceover: readyForW3.map((r) => ({ video_id: r.video_id, title: r.title })),
          ready_for_W4_video: readyForW4.map((r) => ({ video_id: r.video_id, title: r.title })),
          ready_for_W5_upload: readyForW5.map((r) => ({ video_id: r.video_id, title: r.title })),
          published_or_scheduled: published.length,
        },
        recent_executions: recentExecutions,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(health, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error getting pipeline health: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ─── Server Startup ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!N8N_API_KEY) {
    console.error("WARNING: N8N_API_KEY not set — get_execution and pipeline_health execution data will fail");
  }

  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "vault-pipeline-mcp", version: "1.0.0" });
  });

  // MCP endpoint
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
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

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
