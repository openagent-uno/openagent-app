/**
 * Shared types for OpenAgent WebSocket protocol and REST API.
 * Used by both the universal app and the desktop Electron wrapper.
 */

// ── WebSocket Protocol ──

export type ClientMessage =
  // Legacy AUTH frame: ignored by the gateway (auth is enforced at the
  // Iroh transport layer via the device cert), but we keep sending one
  // for back-compat with code that waits for AUTH_OK as a "ready"
  // signal. ``token`` is no longer required.
  | { type: 'auth'; token?: string; client_id?: string }
  // ``input_was_voice``: true when the user just spoke (mic + ASR via
  // /api/upload). The gateway responds via the streaming TTS pipeline
  // when a TTS provider is configured, falling through to text-only
  // otherwise. Mirror-modality semantics — text-typed messages get
  // text-only replies regardless of voice mode.
  // ``voice_language``: ISO-639-1 hint matching what Whisper used for
  // transcription. The gateway forwards it to Piper so a transcribed
  // Italian message gets spoken with an Italian voice instead of the
  // default American one. Ignored unless ``input_was_voice`` is true.
  | {
      type: 'message';
      text: string;
      session_id: string;
      input_was_voice?: boolean;
      voice_language?: string;
    }
  // ``session_id`` MUST be passed for ``stop`` / ``new`` / ``clear`` / ``reset``
  // when the client hosts multiple independent conversations on one ws
  // (e.g. two chat tabs). The gateway scopes those commands to the tab's
  // session so one tab's /clear doesn't wipe the others.
  | {
      type: 'command';
      name: 'stop' | 'new' | 'clear' | 'reset' | 'status' | 'queue' | 'help' | 'usage' | 'update' | 'restart';
      session_id?: string;
    }
  | { type: 'ping' }
  // ── Stream protocol (additive) ──
  // Long-lived realtime sessions carry typed events on top of the same
  // WS. ``session_open`` begins; ``audio_chunk_in`` / ``video_frame`` /
  // ``text_delta`` / ``text_final`` / ``attachment`` push input;
  // ``interrupt`` triggers barge-in; ``session_close`` ends. The legacy
  // ``message`` frame still works for one-shot text turns; the new
  // surface is opt-in. Audio/video bytes are base64-encoded.
  | {
      type: 'session_open';
      session_id: string;
      profile?: 'realtime' | 'batched';
      llm_pin?: string;
      stt_pin?: string;
      tts_pin?: string;
      language?: string;
      client_kind?: string;
      // Debounce window for typed-text bursts. Server-side StreamSession
      // coalesces messages arriving during an in-flight turn into a
      // single merged turn. ``0`` = disabled (preempt-on-each-message).
      // Voice/STT messages always bypass the window.
      coalesce_window_ms?: number;
      // When false, the session never invokes its TTS sidecar even if
      // a provider is configured. Chat-tab sessions pass false so typed
      // replies stay silent; voice-mode sessions keep the default.
      speak?: boolean;
    }
  | { type: 'session_close'; session_id: string }
  | { type: 'text_delta'; session_id: string; text: string; final?: boolean }
  | {
      type: 'text_final';
      session_id: string;
      text: string;
      source?: 'user_typed' | 'stt' | 'system';
      attachments?: Attachment[];
    }
  | {
      type: 'audio_chunk_in';
      session_id: string;
      data: string;
      end_of_speech?: boolean;
      sample_rate?: number;
      encoding?: string;
    }
  | { type: 'audio_end_in'; session_id: string }
  | {
      type: 'video_frame';
      session_id: string;
      stream: string;
      data: string;
      width?: number;
      height?: number;
      keyframe?: boolean;
    }
  | {
      type: 'attachment';
      session_id: string;
      kind: 'image' | 'file' | 'voice' | 'video';
      path?: string;
      filename?: string;
      mime_type?: string;
    }
  | {
      type: 'interrupt';
      session_id: string;
      reason?: 'user_speech' | 'user_text' | 'manual';
    }
  // ── Interactive terminals (PTY on the gateway host) ──
  // The "SSH terminal" surface: a real pseudo-terminal on the machine
  // running the OpenAgent server, driven live from the System tab. Each
  // ``terminal_id`` is one shell. ``data`` is base64-encoded raw bytes
  // so colour/cursor control sequences survive the JSON transport.
  | {
      type: 'terminal_open';
      terminal_id: string;
      cols: number;
      rows: number;
      cwd?: string;
      shell?: string;
    }
  | { type: 'terminal_input'; terminal_id: string; data: string }
  | { type: 'terminal_resize'; terminal_id: string; cols: number; rows: number }
  | { type: 'terminal_signal'; terminal_id: string; signal: 'INT' | 'TERM' | 'HUP' | 'QUIT' | 'KILL' }
  | { type: 'terminal_close'; terminal_id: string };

export type ResourceKind = 'mcp' | 'scheduled_task' | 'workflow' | 'vault' | 'config' | 'session';
export type ResourceAction = 'created' | 'updated' | 'deleted' | 'changed';

export type ServerMessage =
  | { type: 'auth_ok'; agent_name: string; version: string }
  | { type: 'auth_error'; reason: string }
  | { type: 'status'; text: string; session_id: string }
  // ── Reasoning indicator (transient, session-scoped) ──
  // ``active=true`` while the agent is thinking with no visible output yet;
  // ``active=false`` once visible output starts OR the turn ends. The UI
  // swaps the static status row for an animated "Reasoning" shimmer while
  // active. Several may arrive per turn (true→false→true→false across
  // tool-call iterations). Transient — never persisted in the transcript.
  // ``seq``/``ts_ms`` ride along for ordering/debug; the UI only needs
  // ``active``. Clients also clear reasoning on the turn-final ``response``
  // frame as a safety net in case an explicit ``active=false`` is missed.
  | { type: 'reasoning'; session_id: string; active: boolean; seq?: number; ts_ms?: number }
  // Token-streaming frame for text-mode chat. Clients accumulate each
  // ``text`` chunk into the in-progress assistant bubble; the trailing
  // ``response`` is the canonical record (full text + attachments +
  // model meta) and replaces the streamed buffer. Older clients that
  // don't recognize ``delta`` ignore it and render the final
  // ``response`` like before — backward-compatible.
  | { type: 'delta'; text: string; session_id: string }
  | { type: 'response'; text: string; session_id: string; attachments?: Attachment[]; model?: string }
  // The agent-self seed that opens a spawned child session (a delegated
  // sub-agent, a scheduled firing, a workflow node) — the task/mission/role
  // prompt. Streamed FIRST so a run screen shows the Mission block at the top
  // while it runs, not only once the run completes. ``author.kind === 'agent'``
  // makes it render as a Mission/Role/Task block rather than a "You" bubble.
  | { type: 'seed'; text: string; session_id: string; author?: MessageAuthor }
  // ``session_id`` is set by the gateway when the error originated from
  // a specific session's processing (see _process_message). Older client
  // builds tolerated its absence — keep it optional for back-compat.
  | { type: 'error'; text: string; session_id?: string }
  | { type: 'queued'; position: number }
  | { type: 'command_result'; text: string }
  | { type: 'pong' }
  // Resource-change ping: a list the desktop app might be showing
  // moved on the server. Subscribed stores refetch on receipt.
  | { type: 'resource_event'; resource: ResourceKind; action: ResourceAction; id?: string }
  // Live host telemetry — emitted every ~2s by the gateway when at
  // least one client is connected. The System screen subscribes here
  // and re-renders without polling.
  | { type: 'system_snapshot'; snapshot: SystemSnapshot }
  // Streaming TTS frames for voice-mode replies. ``audio_start`` opens
  // the playback queue, ``audio_chunk`` carries one segment of audio
  // (base64 of MP3 frames by default — see ``mime``), ``audio_end``
  // closes it. The trailing ``response`` event still carries the full
  // text + attachments so non-audio-aware clients render unchanged.
  | { type: 'audio_start'; session_id: string; format: string; voice_id: string; mime: string }
  | { type: 'audio_chunk'; session_id: string; seq: number; data: string }
  | { type: 'audio_end'; session_id: string; total_chunks: number }
  // ── Stream protocol (additive) ──
  // ``turn_complete`` marks the end of one logical assistant turn for
  // batched-channel consumers; realtime clients can ignore it (the
  // ``response`` frame already drives "Thinking…" → "Done"). Backward
  // compat: clients that don't recognise these types ignore them.
  //
  // ``text_final`` echoes a recognised user utterance from streaming
  // STT — voice mode renders it as the user message in the transcript
  // without round-tripping through the legacy REST upload. ``source``
  // distinguishes user-typed (no UI update needed; chat already added
  // it) from STT (server-recognised — UI adds it now).
  | { type: 'turn_complete'; session_id: string }
  | {
      type: 'text_final';
      session_id: string;
      text: string;
      source?: 'user_typed' | 'stt' | 'system';
      attachments?: Attachment[];
    }
  | {
      type: 'video_frame_out';
      session_id: string;
      stream: string;
      data: string;
      width?: number;
      height?: number;
    }
  // ── Interactive terminals ──
  // ``terminal_ready`` confirms the PTY spawned (pid + resolved shell).
  // ``terminal_output`` carries base64 raw bytes for xterm to render.
  // ``terminal_exit`` fires when the shell ends (one of exit_code/signal
  // is set). ``terminal_error`` covers open failures (e.g. unsupported
  // host OS). All are scoped by ``terminal_id``.
  | { type: 'terminal_ready'; terminal_id: string; pid: number | null; shell: string; cols: number; rows: number; cwd?: string }
  | { type: 'terminal_output'; terminal_id: string; data: string }
  | { type: 'terminal_exit'; terminal_id: string; exit_code: number | null; signal: string | null }
  | { type: 'terminal_error'; terminal_id: string; error: string };

export interface Attachment {
  type: 'image' | 'file' | 'voice' | 'video';
  path: string;
  filename: string;
}

// ── Interactive terminal ──
// One live (or recently-closed) PTY shell on the gateway host. Returned
// by ``GET /api/terminals`` and tracked in the terminals store so the
// System tab can list sessions Termius-style.
export interface TerminalInfo {
  id: string;
  title: string;
  shell?: string;
  cwd?: string;
  pid?: number | null;
  /** ``pending`` = open frame sent, awaiting ready; ``running`` = live;
   *  ``exited`` = shell ended; ``error`` = failed to open. */
  status: 'pending' | 'running' | 'exited' | 'error';
  createdAt: number;
  /** Short epilogue once closed — e.g. "exited (code 0)" or the error. */
  detail?: string;
}

// ── Chat State ──

// Server-native ``ToolExecution.to_dict()`` shape — emitted verbatim
// on live STATUS frames and on the rehydration endpoint. Phase
// (running / completed / error) is derived locally in the UI from
// ``tool_call_error`` + presence of ``result``; the server does not
// synthesise a status enum on the wire.
//
// Additional fields (metrics, child_run_id, etc.) ride along through
// the index signature so future renderers can pick them up without
// another wire change.
export interface ToolInfo {
  tool_name: string;
  tool_call_id?: string;
  tool_args?: Record<string, any>;
  tool_call_error?: boolean | null;
  result?: string | null;
  /** When this tool call spawned a delegated sub-agent that runs as its own
   *  full session, the server stamps the child session id (+ optional title /
   *  model). MessageList renders such a tool call as a DelegationCard that
   *  deep-links into the child session instead of a generic tool chip. */
  child_session_id?: string;
  child_session_title?: string;
  child_model?: string;
  [key: string]: any;
}

// Derive the chip's visual phase from the wire tool-execution fields.
// Errors take precedence (the ``result`` slot carries the error text
// in error frames — that's how live ``ToolCallErrorEvent`` rides
// through), otherwise a populated ``result`` flips the chip to
// "completed".
export function toolPhase(t: ToolInfo): 'running' | 'completed' | 'error' {
  if (t.tool_call_error) return 'error';
  if (t.result !== undefined && t.result !== null) return 'completed';
  return 'running';
}

// A delegated sub-agent's session id always embeds a ``::sub::`` (MCP
// delegate_task) or ``::member::`` (team member) marker after its parent's id
// — e.g. ``agent:dev:abc::member::opus::1f2e``. These sessions are hidden from
// the sidebar / history list (navigable only from the parent's delegation
// card), so the id pattern lets the app recognise and hide a child even before
// its origin metadata loads (e.g. a lazy stub built from a live stream frame).
const SUB_AGENT_MARKER = /::(?:sub|member)::/;

export function isSubAgentSessionId(id: string): boolean {
  return SUB_AGENT_MARKER.test(id);
}

/** The parent chat session id a sub-agent session belongs to (the prefix
 *  before its ``::sub::`` / ``::member::`` marker), or undefined if ``id`` is
 *  not a sub-agent session. Drives the "← parent" breadcrumb for a child
 *  opened straight from a deep link before its metadata has loaded. */
export function subAgentParentId(id: string): string | undefined {
  // Greedy capture so the LAST marker delimits the IMMEDIATE parent: a
  // sub-agent that itself delegates yields ``A::member::x::yy::sub::z::ww``,
  // whose real parent is ``A::member::x::yy``, not the root ``A``. Model ids
  // embed only single colons, never ``::``, so every ``::sub::``/``::member::``
  // is a genuine lineage boundary.
  const m = id.match(/^(.*)::(?:sub|member)::/);
  return m ? m[1] : undefined;
}

// Child-session origins that never appear as standalone sidebar / history
// rows: a delegated sub-agent (reachable from its parent's transcript card),
// a scheduled firing or workflow node (reachable from its run's execution
// screen). Mirrors the server's ``HIDDEN_CHILD_ORIGINS`` so both ends hide the
// same set. ``chat`` is the only origin that lists normally.
const HIDDEN_CHILD_ORIGINS = new Set(['delegation', 'scheduler', 'workflow']);

/** Whether a session should be hidden from the flat sidebar / history list
 *  (a spawned child — by loaded origin metadata or sub-agent id shape). */
export function isHiddenChildSession(s: { id: string; origin?: string }): boolean {
  return (!!s.origin && HIDDEN_CHILD_ORIGINS.has(s.origin)) || isSubAgentSessionId(s.id);
}

// ── Run-launch tool cards ────────────────────────────────────────────
// When a chat turn runs a scheduled task or a workflow (the agent calls the
// scheduler / workflow-manager MCP's run-now tool), the resulting tool message
// renders as a navigable card into that run's execution screen — the run
// analogue of a DelegationCard. The MCP exposes these tools namespaced
// (``scheduler_run_scheduled_task_now`` / ``workflow_manager_run_workflow``),
// so we match by suffix to stay robust to the server-name prefix.
const RUN_LAUNCH_SUFFIXES: { suffix: string; kind: 'task' | 'workflow' }[] = [
  { suffix: 'run_scheduled_task_now', kind: 'task' },
  { suffix: 'run_workflow', kind: 'workflow' },
];

export interface RunLaunchTarget {
  kind: 'task' | 'workflow';
  /** The firing / workflow-run id to open (absent until the tool returns). */
  runId?: string;
  /** Owning task / workflow id, for the run screen's "open parent" link. */
  parentId?: string;
  /** Human label when the tool result carries one. */
  name?: string;
  /** ``running`` | ``success`` | ``failed`` | … from the tool result. */
  status?: string;
}

function parseToolResult(result: unknown): Record<string, any> | undefined {
  if (result == null) return undefined;
  if (typeof result === 'object') return result as Record<string, any>;
  if (typeof result === 'string') {
    try {
      const j = JSON.parse(result);
      return j && typeof j === 'object' ? (j as Record<string, any>) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// ── Effective-tool normalization (unwraps the deferred-tool dispatcher) ──
// In automations — and any run where the provider's upfront tool budget trims
// MCP tools — the agent reaches a tool indirectly through the tool-search
// dispatcher: ``tool_search_call_tool({server, tool, args})``. The persisted /
// streamed ToolExecution is then the GENERIC dispatcher, not the real tool, and
// the dispatcher's JSON coercion drops the inner result's structured
// ``child_session_id``. Card detection keys off the REAL tool, so we resolve it
// ONCE here and every detector (delegation, run-launch) shares the result — so
// the cards render identically on every screen (chat, scheduled run, workflow
// run) and at any delegation depth, no matter how the tool was invoked.
const TOOL_SEARCH_DISPATCHER = 'tool_search_call_tool';

export interface EffectiveTool {
  /** The real tool the agent invoked (unwrapped from the dispatcher). */
  tool_name: string;
  /** The real tool's arguments. */
  tool_args: Record<string, any>;
  /** The tool result verbatim — the dispatcher returns the inner result. */
  result?: string | null;
  tool_call_error?: boolean | null;
  /** Child session this call spawned — taken from the structured field, or
   *  (when the dispatcher dropped it) recovered from the inner result JSON,
   *  which the handler still echoes. */
  child_session_id?: string;
  child_session_title?: string;
  child_model?: string;
}

export function effectiveTool(t?: ToolInfo): EffectiveTool | undefined {
  if (!t) return undefined;
  const name = String(t.tool_name || '');
  if (name === TOOL_SEARCH_DISPATCHER) {
    const outer = t.tool_args || {};
    const innerName = String(outer.tool || '');
    const innerArgs =
      outer.args && typeof outer.args === 'object'
        ? (outer.args as Record<string, any>)
        : {};
    const res = parseToolResult(t.result);
    return {
      tool_name: innerName || name,
      tool_args: innerArgs,
      result: t.result,
      tool_call_error: t.tool_call_error,
      child_session_id:
        t.child_session_id || (res?.child_session_id as string) || undefined,
      child_session_title:
        t.child_session_title || (res?.child_session_title as string) || undefined,
      // Symmetric with the direct branch — the model surfaces as the card
      // TITLE via delegationTitle's args.model_id fallback, so no subtitle
      // fallback here (it would duplicate the title on the dispatched path).
      child_model: t.child_model,
    };
  }
  return {
    tool_name: name,
    tool_args: t.tool_args || {},
    result: t.result,
    tool_call_error: t.tool_call_error,
    child_session_id: t.child_session_id,
    child_session_title: t.child_session_title,
    child_model: t.child_model,
  };
}

// ── Delegation cards ─────────────────────────────────────────────────
// A delegation renders as a navigable DelegationCard (deep-links into the
// spawned sub-agent's child session) instead of a raw tool chip — even while
// still running. Detection lives here (shared) so every screen agrees.
const DELEGATION_TOOLS = new Set([
  'delegate_task_to_member', 'delegate_task', 'run_dream_mode',
]);

/** Whether a tool message should render as a DelegationCard. True when the call
 *  spawned a SUB-AGENT child session OR is a known delegation tool — unwrapping
 *  the dispatcher so a deferred-dispatched delegation is detected exactly like a
 *  direct one. A scheduler/workflow child session id is deliberately NOT a
 *  delegation (it renders as a RunLaunchCard via {@link runLaunchTarget}). */
export function isDelegationTool(t?: ToolInfo): boolean {
  const eff = effectiveTool(t);
  if (!eff) return false;
  return (
    (!!eff.child_session_id && isSubAgentSessionId(eff.child_session_id))
    || DELEGATION_TOOLS.has(eff.tool_name)
  );
}

/** The human title for a delegation card — child title, delegated member/model
 *  id, or a sensible default. */
export function delegationTitle(t?: ToolInfo): string {
  const eff = effectiveTool(t);
  if (!eff) return 'Sub-agent';
  const args = eff.tool_args;
  return (
    eff.child_session_title
    || String(args.member_id || args.model_id || '')
    || (eff.tool_name === 'run_dream_mode' ? 'Dream mode' : 'Sub-agent')
  );
}

/** The DelegationCard kind label ('dream mode' vs 'sub-agent'). */
export function delegationLabel(t?: ToolInfo): string {
  return effectiveTool(t)?.tool_name === 'run_dream_mode' ? 'dream mode' : 'sub-agent';
}

/** The run a scheduler / workflow CHILD SESSION id points at, parsed from its
 *  shape (``scheduler:{task}:{run}`` / ``workflow:{wf}:{run}:{node}``). The
 *  ``run`` segment equals the task_run / workflow_run id the run screen keys on,
 *  and ``{task}``/``{wf}`` is the parent. Lets a run-launch card deep-link WHILE
 *  the run is still in flight (before its blocking result returns) — either via
 *  the id the server re-streams onto the chip, or via the live child session the
 *  client already sees streaming. Returns undefined for any other id shape
 *  (e.g. a ``::sub::`` delegation, which is a DelegationCard, not a run). */
export function runTargetForChildSession(sid?: string): RunLaunchTarget | undefined {
  if (!sid) return undefined;
  const parts = sid.split(':');
  const kind: RunLaunchTarget['kind'] | undefined =
    parts[0] === 'scheduler' ? 'task' : parts[0] === 'workflow' ? 'workflow' : undefined;
  if (!kind || parts.length < 3 || !parts[1] || !parts[2]) return undefined;
  return { kind, parentId: parts[1], runId: parts[2], status: 'running' };
}

/** The ``/runs/{id}`` route (path + query) for a run-launch target, or
 *  undefined if it has no run id yet. One builder so every caller (chat's
 *  push, the run screen's detached open) routes identically. */
export function runRoutePath(target: RunLaunchTarget): string | undefined {
  if (!target.runId) return undefined;
  const params = new URLSearchParams({ kind: target.kind });
  if (target.parentId) params.set('parentId', target.parentId);
  if (target.name) params.set('name', target.name);
  return `runs/${encodeURIComponent(target.runId)}?${params.toString()}`;
}

/** If this tool call launched a scheduled task / workflow run, the target to
 *  deep-link into — else undefined. ``runId`` is absent while the tool is
 *  still running (it arrives in the result), so the card renders as a
 *  non-clickable "running" card until then, mirroring DelegationCard. */
export function runLaunchTarget(t?: ToolInfo): RunLaunchTarget | undefined {
  // Unwrap the deferred-tool dispatcher so a run-now invoked via
  // ``tool_search_call_tool`` is matched by its REAL tool name, exactly like a
  // direct call — the run card then appears on every screen regardless of how
  // the agent reached the tool.
  const eff = effectiveTool(t);
  const name = eff?.tool_name || '';
  if (!eff || !name) return undefined;
  // A tool-level failure (timeout / bad id) carries the error TEXT in
  // ``result`` (non-JSON), not a run row — let it fall through to the generic
  // ToolCard, which surfaces the error, instead of a stuck "running…" card.
  if (eff.tool_call_error) return undefined;
  const match = RUN_LAUNCH_SUFFIXES.find(
    (m) => name === m.suffix || name.endsWith('_' + m.suffix),
  );
  if (!match) return undefined;
  const res = parseToolResult(eff.result);
  const args = eff.tool_args;
  // The run id arrives in the result only when the (blocking) run-now tool
  // finishes. While it runs, recover it from the spawned child session id —
  // ``scheduler:{task}:{run}`` / ``workflow:{wf}:{run}:{node}`` — which the
  // server re-streams onto the in-flight chip, so the card is clickable
  // mid-run (matching the DelegationCard affordance).
  const fromSid = runTargetForChildSession(eff.child_session_id);
  const runId = res?.id || res?.run_id || fromSid?.runId || undefined;
  // Prefer a resolved parent ID (the tool result, or the linked child session
  // id) over the raw ``id_or_name`` argument: a workflow run-now is usually
  // invoked by NAME, but the run screen routes its parent by id — so falling
  // back to the name would point the parent-open link at a non-existent id.
  const parentId =
    (match.kind === 'task'
      ? res?.task_id || fromSid?.parentId || args.task_id
      : res?.workflow_id || fromSid?.parentId || args.id_or_name)
    || undefined;
  return {
    kind: match.kind,
    runId: runId ? String(runId) : undefined,
    parentId: parentId ? String(parentId) : undefined,
    name: res?.name ? String(res.name) : undefined,
    status: res?.status ? String(res.status) : 'running',
  };
}

/** Who authored a message. ``human`` carries a network handle/display so the
 *  app shows the real sender (and multi-human sessions attribute correctly);
 *  ``agent`` marks an agent-self seed — the delegated task / scheduled mission
 *  / workflow node prompt the agent gave itself — rendered as a Mission block
 *  rather than a "You" bubble. Absent on legacy messages → falls back to role. */
export interface MessageAuthor {
  kind: 'human' | 'agent';
  handle?: string;
  display?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  timestamp: number;
  attachments?: Attachment[];
  toolInfo?: ToolInfo;
  model?: string;
  /** Per-message authorship (see MessageAuthor). */
  author?: MessageAuthor;
  // True while the assistant bubble is being progressively populated
  // by ``delta`` frames. The trailing ``response`` clears the flag and
  // replaces ``text`` with the canonical clean version (strips the
  // attachment markers ``parse_response_markers`` extracted on the
  // server side). Used by MessageList to render a soft caret / cursor.
  streaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  isProcessing: boolean;
  statusText?: string;
  /** Driven by the transient ``reasoning`` wire frame: true while the agent
   *  is thinking with no visible output yet. Swaps the static status row for
   *  the animated <ReasoningIndicator/>. Cleared on the first streamed delta,
   *  the turn-final response, and on error (safety net). */
  isReasoning?: boolean;
  /** When this session was spawned by another (a delegated sub-agent, a
   *  scheduled-task firing, or a workflow AI node), the parent it belongs to —
   *  drives the "← parent" breadcrumb and lets the sidebar tag it. */
  parentSessionId?: string;
  /** What spawned this session: 'chat' (a normal conversation) | 'delegation'
   *  | 'scheduler' | 'workflow'. Renders as an origin chip in the sidebar. */
  origin?: 'chat' | 'delegation' | 'scheduler' | 'workflow';
  /** Fine-grained origin label (the delegated model id, the task id, etc.). */
  originLabel?: string;
  /** Server-reported last-activity epoch (seconds). Preserved through
   *  hydration so the sidebar can sort sessions by recency; falls back to
   *  the newest message timestamp when absent. */
  lastActiveAt?: number;
  /** Sticky session — sorted to the top of the sidebar regardless of recency. */
  pinned?: boolean;
  /** Per-session composer draft (text). Survives session switches but
   *  not full app restarts. */
  draftInput?: string;
  /** Set to true by the delta/response reducer when a non-active
   *  session receives a new assistant message. Cleared when the user
   *  brings that session to focus. Drives the sidebar dot indicator. */
  hasUnread?: boolean;
  /** Optional LLM pin (e.g. "claude-opus-4-7"). When set, gets sent
   *  with the next ``session_open`` — composer picker mutates this
   *  + closes any open WS session so the next message lands on the
   *  newly-pinned model. ``undefined`` = let the SmartRouter pick. */
  llmPin?: string;
  /** Optional system prompt for this session. Currently surfaced as
   *  the first user-tagged frame after session open, since the
   *  gateway has no first-class ``system_prompt`` field. */
  systemPrompt?: string;
}

// ── System telemetry ──

// Mirror of the dict produced by openagent/gateway/api/system.py.
// Cross-platform: same shape on Windows, macOS, Linux. Values from
// psutil are byte counts (memory, disk, network); the UI converts
// to human units. Fields that the host doesn't expose surface as
// 0 or null rather than being omitted, so consumers can render a
// stable layout.
export interface SystemSnapshot {
  timestamp: number;
  host: SystemHost;
  cpu: SystemCpu;
  memory: SystemMemory;
  swap: SystemSwap;
  disks: SystemDisk[];
  network: SystemNetwork;
  processes: SystemProcess[];
}

export interface ClaudeStatus {
  binary_ok: boolean;
  binary_path: string | null;
  auth_ok: boolean;
  auth_email: string | null;
  auth_type: string | null;
}

export interface ClaudeInstallResult {
  binary_ok: boolean;
  binary_path?: string;
  auth_ok: boolean;
  auth_email?: string;
  auth_type?: string;
  error?: string;
}

export interface ClaudeAuthLoginResult {
  ok: boolean;
  pid?: number;
  detail?: string;
  error?: string;
}

export interface SystemHost {
  hostname: string;
  platform: string;          // 'Darwin' | 'Linux' | 'Windows'
  os: string;                // human-readable, e.g. 'macOS 15.2', 'Windows 11'
  release: string;
  arch: string;              // 'arm64', 'x86_64', ...
  uptime_seconds: number;
  boot_time: number;         // epoch seconds
  loadavg: [number, number, number];
  users: number;
  python_version: string;
  openagent_version: string;
}

export interface SystemCpu {
  model: string;
  cores_physical: number;
  cores_logical: number;
  freq_mhz: number;
  freq_min_mhz: number;
  freq_max_mhz: number;
  usage_pct: number;
  per_core_pct: number[];
  temp_c: number | null;     // null when sensors unavailable (typical on Windows/macOS)
}

export interface SystemMemory {
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  free_bytes: number;
  cached_bytes: number | null;  // Linux-only
  percent: number;
}

export interface SystemSwap {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  percent: number;
}

export interface SystemDisk {
  mount: string;
  device: string;
  fs: string;
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  percent: number;
}

export interface SystemNetwork {
  primary_iface: string;
  ipv4: string;
  ipv6: string;
  rx_bytes_total: number;
  tx_bytes_total: number;
  rx_bps: number;            // bytes/sec, computed across snapshots
  tx_bps: number;
  connections: number;
}

export interface SystemProcess {
  pid: number;
  name: string;
  user: string;
  cpu_pct: number;
  rss_bytes: number;
  threads: number;
  status: string;
}

// ── Connection ──
//
// The legacy {host, port, token} shape is gone. Connections are now
// addressed by ``handle@network`` and authenticated via a device cert
// minted by the network's coordinator. The Electron main process runs
// a ``openagent network loopback`` child for each active account; that
// child binds a localhost port that proxies HTTP/WS traffic onto the
// Iroh transport. The renderer keeps using ``fetch`` / ``WebSocket``
// against ``localhost:<sidecarPort>``.
//
// First-time onboarding only needs: a ticket string + (for user-role
// tickets) a chosen handle + a password. Coordinator NodeId, network
// name, network ID, and invite code are all packed into the ticket.

export interface ConnectionConfig {
  name: string;                  // display label (e.g. "Personal")
  network: string;               // network short name (e.g. "homelab")
  handle: string;                // user handle within that network
  agentHandle?: string;          // active agent (default: first registered)
  // Set by the Electron main process after it spawns the loopback
  // sidecar — the renderer never picks this; it just hits the URL.
  sidecarPort?: number;
  isLocal: boolean;              // hint: same-machine vs. remote agent
}

export interface SavedAccount extends ConnectionConfig {
  id: string;          // unique identifier
  createdAt: number;   // epoch ms
  inviteCode?: string; // oa1… ticket used when joining (stored for reference)
}

// Inputs the onboarding screen collects to add a new account. The
// renderer doesn't see coordinator NodeIds or network IDs — those
// come from the ticket and are pinned by the loopback child.
export interface JoinNetworkInput {
  ticket: string;     // pasted oa1… string from `openagent network invite`
  handle: string;     // user-chosen for role=user; ignored for role=device
  password: string;   // PAKE secret, sent over IPC+stdin only
  displayName?: string; // optional friendly label saved on the account row
}

// ── Config ──

// OpenAgent v0.12 vocabulary:
//   - provider row = (name, framework) pair with a surrogate integer id
//
// The server collapsed the legacy ``'agno'`` and ``'litellm'`` values
// into ``'api-based'`` in v0.14. The desktop normalises any stray
// ``'agno'`` payload at the read boundary in services/api.ts so the
// rest of the app only sees the canonical names below.
export type ModelFramework = 'api-based' | 'litellm';
// ``llm`` covers the existing text-generation rows; ``tts`` covers
// audio synthesis providers (ElevenLabs in v1). The LLM dispatcher
// filters to ``kind='llm'`` so a TTS row never gets handed a turn.
export type ProviderKind = 'llm' | 'tts' | 'stt';

export interface ProviderConfig {
  id: number;
  name: string;
  framework: ModelFramework;
  kind: ProviderKind;
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
//   framework     = inherited from the provider row ("api-based").
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
  // Capability discriminator. ``llm`` rows go through the SmartRouter;
  // ``tts`` / ``stt`` rows are picked by the audio resolvers and
  // dispatched via LiteLLM.
  kind: ProviderKind;
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
  // Inferred by ``discovery.py`` from the model id (``tts-1`` → tts,
  // ``whisper-1`` → stt). The Add Model flow forwards this to
  // /api/models so the row lands with the correct ``kind``.
  kind?: ProviderKind;
}

// Source-of-truth yaml fields. Providers, models, MCPs, and scheduled
// tasks are DB-backed and live in SQLite — reach them via their
// dedicated REST endpoints (``/api/providers``, ``/api/models``,
// ``/api/mcps``, ``/api/scheduled-tasks``), not through this shape.
export interface AgentConfig {
  name?: string;
  system_prompt?: string;
  dream_mode?: { enabled: boolean; time: string };
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

// ── Vault write / move / history / gate ──

// One validation finding surfaced by the gateway when a note is written.
// ``fixable`` notes can be auto-corrected by ``runVaultDoctor(true)``.
export interface VaultWarning {
  rule: string;
  severity: string;
  message: string;
  fixable?: boolean;
}

// Response of ``PUT /api/vault/notes/{path}`` — the write is validated
// and git-committed server-side, so the body carries any warnings plus
// the commit hash (``null`` when nothing changed).
export interface VaultWriteResult {
  ok: boolean;
  path: string;
  warnings: VaultWarning[];
  commit: string | null;
  // Set when the quality gate REJECTED the write (nothing was saved). The
  // editor surfaces ``errors`` so the user can fix and re-save.
  blocked?: boolean;
  errors?: VaultWarning[];
  // What the gate auto-fixed on the way in (e.g. scaffolded frontmatter).
  applied?: string[];
}

// One entry from the vault git log. ``provenance`` is a free-form map
// whose keys include origin / session / workflow / task / tool.
export interface VaultCommit {
  hash: string;
  subject: string;
  date: string;
  author: string;
  provenance: Record<string, string>;
}

// ``GET /api/vault/history`` envelope. ``path`` scopes the log to one
// note/folder; ``null`` for the vault-wide log.
export interface VaultHistory {
  commits: VaultCommit[];
  path: string | null;
}

// A file touched by a commit: ``status`` is the git short status
// (A/M/D/R), ``path`` the vault-relative note path.
export interface VaultCommitFile {
  status: string;
  path: string;
}

// ``GET /api/vault/commit?hash=`` — the changes a single commit
// introduced: metadata + the files it touched + the unified diff
// (capped server-side; ``diff_truncated`` flags when it was cut).
export interface VaultCommitDetail extends VaultCommit {
  full_hash: string;
  files: VaultCommitFile[];
  diff: string;
  diff_truncated: boolean;
}

// ``POST /api/vault/restore`` — non-destructive roll-back to a state.
export interface VaultRestoreResult {
  ok: boolean;
  commit: string | null;
  restored_from: string;
  changed: boolean;
  error?: string;
}

// ``POST /api/vault/reset`` — destructive reset; ``deleted`` is how many
// later commits were removed.
export interface VaultResetResult {
  ok?: boolean;
  head?: string;
  deleted?: number;
  error?: string;
}

// ``GET /api/vault/gate`` report — quality-gate violations grouped by
// rule. Loosely typed (``by_rule`` / ``stats``) where the shape is
// open-ended.
export interface VaultGateViolation {
  rule: string;
  severity: string;
  path: string;
  message: string;
  suggestion?: string;
}

export interface VaultGateReport {
  ok: boolean;
  error_count: number;
  warn_count: number;
  info_count: number;
  note_count: number;
  violations: VaultGateViolation[];
  by_rule: Record<string, VaultGateViolation[]>;
  stats: Record<string, unknown>;
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
  /** True when a firing of this task is in flight right now (``running`` or
   *  mid-``cancelling``). Drives the tile's Run-now ↔ Stop control. Only set
   *  on list / get responses; create/update responses omit it (default false). */
  running?: boolean;
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

// One row in a scheduled task's execution history — the analogue of
// ``WorkflowRun`` for cron tasks. Persisted server-side in the
// ``task_runs`` table and served newest-first by
// ``GET /api/scheduled-tasks/{id}/runs``. A task firing has no block
// graph, so there is no trace: just the agent's output preview (or the
// error that aborted it). No 'cancelled' state — a task run either
// completes, fails, or is reaped to 'failed' on restart.
export type TaskRunStatus = 'running' | 'success' | 'failed';

export interface TaskRun {
  id: string;
  task_id: string;
  trigger: string; // 'schedule' for a cron fire, 'manual' for a hand-run, …
  status: TaskRunStatus;
  started_at: number;
  finished_at: number | null;
  output: string | null;
  error: string | null;
  started_at_iso?: string;
  finished_at_iso?: string | null;
  /** The durable child session this firing ran as — lets the run screen open
   *  it as a full chat session (transcript + composer) instead of a static
   *  output preview. */
  session_id?: string | null;
}

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
  // Optional cap on overlapping runs of this workflow. ``null`` means
  // unlimited (default) — concurrent runs all execute. ``1`` fully
  // serializes. ``N>1`` admits up to N simultaneous runs; the rest
  // queue on the executor's per-workflow semaphore.
  max_concurrent_runs?: number | null;
}

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  variables?: Record<string, unknown>;
  max_concurrent_runs?: number | null;
}

export type UpdateWorkflowInput = Partial<{
  name: string;
  description: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
  enabled: boolean;
  max_concurrent_runs: number | null;
}>;

// Per-block trace entry appended to workflow_runs.trace_json after
// each block finishes. Shared between the UI's RunHistoryContent and
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
  /** For an ai-prompt node, the durable child session it ran as — the run
   *  screen renders a DelegationCard that deep-links into the node's full
   *  conversation. */
  child_session_id?: string;
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

// Stats surface for the run-history view + list row sparklines.
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
