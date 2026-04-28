/**
 * Shared types for OpenAgent WebSocket protocol and REST API.
 * Used by both the universal app and the desktop Electron wrapper.
 */

// ── WebSocket Protocol ──

export type ClientMessage =
  | { type: 'auth'; token: string; client_id?: string }
  | { type: 'message'; text: string; session_id: string }
  // ``session_id`` MUST be passed for ``stop`` / ``new`` / ``clear`` / ``reset``
  // when the client hosts multiple independent conversations on one ws
  // (e.g. two chat tabs). The gateway scopes those commands to the tab's
  // session so one tab's /clear doesn't wipe the others.
  | {
      type: 'command';
      name: 'stop' | 'new' | 'clear' | 'reset' | 'status' | 'queue' | 'help' | 'usage' | 'update' | 'restart';
      session_id?: string;
    }
  | { type: 'ping' };

export type ResourceKind = 'mcp' | 'scheduled_task' | 'workflow' | 'vault' | 'config';
export type ResourceAction = 'created' | 'updated' | 'deleted' | 'changed';

export type ServerMessage =
  | { type: 'auth_ok'; agent_name: string; version: string }
  | { type: 'auth_error'; reason: string }
  | { type: 'status'; text: string; session_id: string }
  | { type: 'response'; text: string; session_id: string; attachments?: Attachment[]; model?: string }
  | { type: 'error'; text: string }
  | { type: 'queued'; position: number }
  | { type: 'command_result'; text: string }
  | { type: 'pong' }
  // Resource-change ping: a list the desktop app might be showing
  // moved on the server. Subscribed stores refetch on receipt.
  | { type: 'resource_event'; resource: ResourceKind; action: ResourceAction; id?: string };

export interface Attachment {
  type: 'image' | 'file' | 'voice' | 'video';
  path: string;
  filename: string;
}

// ── Chat State ──

export interface ToolInfo {
  tool: string;
  params?: Record<string, any>;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  timestamp: number;
  attachments?: Attachment[];
  toolInfo?: ToolInfo;
  model?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  isProcessing: boolean;
  statusText?: string;
}

// ── Connection ──

export interface ConnectionConfig {
  name: string;
  host: string;
  port: number;
  token: string;
  isLocal: boolean;
}

export interface SavedAccount extends ConnectionConfig {
  id: string;          // unique identifier
  createdAt: number;   // epoch ms
}

// ── Config ──

// OpenAgent v0.12 vocabulary:
//   - provider row = (name, framework) pair with a surrogate integer id
//   - the same vendor can appear twice (e.g. anthropic+agno and anthropic+claude-cli)
//   - api_key is NULL for claude-cli rows (subscription auth, no API key)
export type ModelFramework = 'agno' | 'claude-cli';

export interface ProviderConfig {
  id: number;
  name: string;
  framework: ModelFramework;
  api_key_display: string;    // "****abcd" | "${VAR}" | "—"
  base_url: string | null;
  enabled: boolean;
  metadata?: Record<string, unknown>;
  created_at?: number;
  updated_at?: number;
}

export interface ModelCatalogEntry {
  model_id: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
}

export interface DailyUsageEntry {
  date: string;
  model: string;
  cost: number;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
}

export interface ModelsResponse {
  // v0.12: flat list — dict-by-name would collide when the same vendor
  // is registered under both frameworks.
  models: ProviderConfig[];
}

export interface UsageData {
  monthly_spend: number;
  monthly_budget: number;
  remaining: number | null;
  by_model: Record<string, number>;
}

export interface McpServerConfig {
  name: string;
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  oauth?: boolean;
  args?: string[];
}

// ── DB-backed registries (mcps + models tables) ──
// Managed via /api/mcps and /api/models/db — the ``mcps`` and ``models``
// SQLite tables are the source of truth. The ``mcps`` table is seeded
// from any legacy yaml ``mcp:`` entries once on first boot.

export interface MCPEntry {
  name: string;
  kind: 'builtin' | 'custom' | 'default';
  builtin_name?: string | null;
  command?: string[] | null;
  args: string[];
  url?: string | null;
  env: Record<string, string>;
  headers: Record<string, string>;
  oauth: boolean;
  enabled: boolean;
  source: string;
  created_at: number;
  updated_at: number;
}

// OpenAgent model-catalog vocabulary (v0.12+):
//   provider_id   = FK to providers.id — authoritative.
//   provider_name = the vendor (anthropic, openai, google, zai, …).
//                   Denormalised on the response for rendering.
//   framework     = inherited from the provider row ("agno" | "claude-cli").
//                   Same reason: denormalised for the UI.
//   model         = bare vendor id (gpt-4o-mini, claude-sonnet-4-6, …).
//   runtime_id    = derived string used in session pins and classifier
//                   output; computed server-side from
//                   (provider_name, model, framework).
export interface ModelEntry {
  id: number;
  provider_id: number;
  provider_name: string;
  framework: ModelFramework;
  runtime_id: string;
  model: string;
  display_name?: string | null;
  input_cost_per_million?: number | null;
  output_cost_per_million?: number | null;
  tier_hint?: string | null;
  enabled: boolean;
  // When true, this row is eligible to act as the SmartRouter's turn-1
  // classifier. Multiple rows may carry the flag — the router picks
  // the first flagged entry in catalog order each turn, so the flag
  // opts a model into the "classifier pool" rather than claiming
  // exclusive ownership.
  is_classifier?: boolean;
  provider_enabled?: boolean;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface AvailableModel {
  id: string;
  display_name: string;
  runtime_id?: string;
  added?: boolean;
}

// Source-of-truth yaml fields. Providers, models, MCPs, and scheduled
// tasks are DB-backed and live in SQLite — reach them via their
// dedicated REST endpoints (``/api/providers``, ``/api/models``,
// ``/api/mcps``, ``/api/scheduled-tasks``), not through this shape.
export interface AgentConfig {
  name?: string;
  system_prompt?: string;
  dream_mode?: { enabled: boolean; time: string };
  // Weekly self-review built-in. Cron defaults to "0 9 * * MON" — the
  // settings panel can override it; toggle ``enabled`` to suppress
  // the scheduled run without removing the row from the database.
  manager_review?: { enabled: boolean; cron: string };
  auto_update?: { enabled: boolean; mode: string; check_interval: string };
  channels?: Record<string, any>;
  services?: Record<string, any>;
  memory?: { db_path?: string; vault_path?: string };
}

// ── REST API — vault, config ──

export interface VaultNote {
  path: string;
  title: string;
  tags: string[];
  modified: string;
  content?: string;
}

export interface GraphData {
  nodes: { id: string; label: string; tags: string[] }[];
  edges: { source: string; target: string }[];
}

export interface HealthResponse {
  status: 'ok';
  agent: string;
  version: string;
  connected_clients: number;
}

// ── Scheduled Tasks ──

export interface ScheduledTask {
  id: string;
  name: string;
  cron_expression: string;
  prompt: string;
  enabled: boolean;
  last_run: number | null;
  next_run: number | null;
  created_at: number;
  updated_at: number;
  run_once: boolean;
  run_at?: number;
  run_at_iso?: string;
  last_run_iso?: string;
  next_run_iso?: string;
  created_at_iso?: string;
  updated_at_iso?: string;
}

export interface CreateScheduledTaskInput {
  name: string;
  cron_expression: string;
  prompt: string;
  enabled?: boolean;
}

export type UpdateScheduledTaskInput = Partial<
  Pick<ScheduledTask, 'name' | 'cron_expression' | 'prompt' | 'enabled'>
>;

// ── Workflows (n8n-style multi-block pipelines) ──

// A workflow is a DAG of blocks (nodes) connected by edges. The
// ``graph`` payload round-trips through the AI's workflow-manager
// MCP, the REST API, and the React-Flow / SVG editor unchanged.
//
// Triggering is declared *inside the graph* via trigger-* blocks
// (trigger-manual, trigger-schedule, trigger-ai). A workflow has no
// row-level trigger field — any workflow can be fired manually, by
// the AI, or on a schedule at any time, depending on what blocks it
// carries. Multiple trigger-schedule blocks fire independently.

export type WorkflowRunStatus = 'running' | 'success' | 'failed' | 'cancelled';

export type BlockCategory = 'triggers' | 'ai' | 'tools' | 'flow' | 'utility';

export type BlockType =
  | 'trigger-manual'
  | 'trigger-schedule'
  | 'trigger-ai'
  | 'mcp-tool'
  | 'ai-prompt'
  | 'if'
  | 'loop'
  | 'wait'
  | 'parallel'
  | 'merge'
  | 'set-variable'
  | 'http-request';

export interface WorkflowNode {
  id: string;
  type: BlockType;
  label?: string;
  position: { x: number; y: number };
  // Per-block config. Shape depends on ``type`` — see BlockTypeSpec.config_schema.
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;  // 'out' by default; 'true'|'false' for if, etc.
  targetHandle?: string;  // 'in' by default
  label?: string | null;
}

export interface WorkflowGraph {
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
}

// One schedule per ``trigger-schedule`` block, keyed by node_id. The
// scheduler loop polls this shape; the UI's list row + history drawer
// surface ``next_run_at_iso`` / ``last_run_at_iso``.
export interface WorkflowSchedule {
  id: string;
  workflow_id: string;
  node_id: string;
  cron_expression: string;
  next_run_at: number;
  last_run_at: number | null;
  enabled: boolean;
  created_at: number;
  updated_at: number;
  next_run_at_iso?: string | null;
  last_run_at_iso?: string | null;
  created_at_iso?: string;
  updated_at_iso?: string;
}

export interface WorkflowTask {
  id: string;
  name: string;
  description?: string | null;
  graph: WorkflowGraph;
  enabled: boolean;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
  last_run_at_iso?: string | null;
  created_at_iso?: string;
  updated_at_iso?: string;
  // Derived server-side from graph nodes — e.g. ``['trigger-manual',
  // 'trigger-schedule']`` when the workflow carries both kinds. Used
  // by the list badge + AI's ``has_trigger_type`` filter.
  trigger_types: string[];
  // Per-block schedule state (one row per ``trigger-schedule`` block).
  schedules: WorkflowSchedule[];
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  variables?: Record<string, unknown>;
}

export type UpdateWorkflowInput = Partial<{
  name: string;
  description: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
  enabled: boolean;
}>;

// Per-block trace entry appended to workflow_runs.trace_json after
// each block finishes. Shared between the UI's RunHistoryDrawer and
// the workflow-manager MCP's get_workflow_run tool.
export interface WorkflowTraceEntry {
  node_id: string;
  type: BlockType;
  started_at: number;
  finished_at: number | null;
  status: 'running' | 'success' | 'failed' | 'skipped';
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string | null;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  trigger: 'manual' | 'schedule' | 'ai' | 'api';
  status: WorkflowRunStatus;
  started_at: number;
  finished_at: number | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error: string | null;
  trace: WorkflowTraceEntry[];
  started_at_iso?: string;
  finished_at_iso?: string | null;
}

// Block type catalog — one entry per BlockType. Served by
// ``GET /api/workflow-block-types`` and consumed by the editor's
// palette + properties panel.
export interface BlockTypeFieldSpec {
  type: 'string' | 'integer' | 'number' | 'object' | 'array' | 'boolean';
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  description?: string;
  items?: BlockTypeFieldSpec;
}

export interface BlockTypeSpec {
  type: BlockType;
  category: BlockCategory;
  description: string;
  config_schema: Record<string, BlockTypeFieldSpec>;
  source_handles: string[];
  target_handles: string[];
  output_shape: string;
}

// One MCP + its tools as seen by the editor's tool picker. Served by
// ``GET /api/mcp-tools``.
export interface MCPToolParameter {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
}

export interface MCPToolDescriptor {
  name: string;
  description?: string;
  parameters_schema?: Record<string, unknown>;
}

export interface MCPToolkitDescriptor {
  mcp_name: string;
  tools: MCPToolDescriptor[];
}

// Stats surface for RunHistoryDrawer + list row sparklines.
export interface WorkflowRunSummary {
  id: string;
  status: WorkflowRunStatus;
  started_at: number;
  finished_at: number | null;
  duration_s: number | null;
  started_at_iso?: string | null;
  finished_at_iso?: string | null;
}

export interface WorkflowStats {
  total_runs: number;
  success_count: number;
  failed_count: number;
  cancelled_count: number;
  running_count: number;
  success_rate: number;
  avg_duration_s: number | null;
  last: WorkflowRunSummary[];
}
