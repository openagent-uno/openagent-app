import type { ToolInfo } from './types.ts';
import type {
  SafeJsonValue,
  ToolInvocationDetail,
  ToolInvocationSummary,
} from './unified-history.ts';

const MAX_RESULT_PREVIEW_CHARS = 12_000;
const MAX_LEGACY_TOOL_JSON_CHARS = 64_000;
const MAX_FALLBACK_LABEL_CHARS = 120;

function safeJsonText(value: SafeJsonValue | undefined): string | undefined {
  if (value == null) return undefined;
  const text = typeof value === 'string'
    ? value
    : (() => {
        try { return JSON.stringify(value); } catch { return String(value); }
      })();
  if (text.length <= MAX_RESULT_PREVIEW_CHARS) return text;
  return `${text.slice(0, MAX_RESULT_PREVIEW_CHARS)}\n… [result truncated in chat; ${text.length.toLocaleString()} characters total]`;
}

function safeArgs(value: SafeJsonValue | undefined): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return value == null ? {} : { value };
}

type PresentationInput = {
  id?: string | null;
  tool_call_id?: string | null;
  tool_server?: string | null;
  tool_name: string;
  status: string;
  child_run_id?: string | null;
  child_session_id?: string | null;
  child_session_title?: string | null;
  child_model?: string | null;
  completeness?: string;
  args_safe?: SafeJsonValue;
  result_safe?: SafeJsonValue;
  error_safe?: string | null;
};

function toolInfoFromInput(input: PresentationInput, invocationId?: string): ToolInfo | undefined {
  const toolName = String(input.tool_name || '').trim();
  if (!toolName) return undefined;

  const status = String(input.status || '').toLowerCase();
  const failed = status === 'error'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'interrupted'
    || status === 'timed_out';
  const finished = failed
    || status === 'success'
    || status === 'complete'
    || status === 'completed';
  const resultPreview = safeJsonText(input.result_safe);
  const result = failed
    ? (input.error_safe?.trim() || resultPreview || (
        status === 'cancelled' ? 'Tool execution cancelled' : 'Tool execution failed'
      ))
    : finished
      // ToolInfo's established presentation contract uses a non-null result
      // as the completion marker. The compact summary deliberately carries no
      // result payload, so an empty marker means "done" without rendering it.
      ? (resultPreview ?? '')
      : undefined;

  return {
    tool_name: toolName,
    tool_call_id: input.tool_call_id || undefined,
    tool_invocation_id: input.id || invocationId || undefined,
    tool_server: input.tool_server || undefined,
    server: input.tool_server || undefined,
    tool_args: safeArgs(input.args_safe),
    tool_call_error: failed,
    result,
    status,
    child_run_id: input.child_run_id || undefined,
    child_session_id: input.child_session_id || undefined,
    child_session_title: input.child_session_title || undefined,
    child_model: input.child_model || undefined,
    completeness: input.completeness,
  };
}

/** Project the compact transcript envelope into the long-standing ToolInfo
 * model used by the stable compact ToolCard. */
export function toolInfoFromSummary(
  summary: ToolInvocationSummary | null | undefined,
  invocationId?: string,
): ToolInfo | undefined {
  if (!summary) return undefined;
  return toolInfoFromInput(summary, invocationId);
}

/** The search detail resolver carries authorized args/result previews. It
 * shares the exact same phase and card adapter as transcript summaries. */
export function toolInfoFromInvocationDetail(detail: ToolInvocationDetail): ToolInfo | undefined {
  return toolInfoFromInput(detail, detail.id);
}

/** Legacy history used to embed ToolExecution JSON directly in message text.
 * Keep that compatibility path bounded; normalized tool result blobs must
 * never be parsed just to decide how to paint one transcript row. */
export function legacyToolInfoFromText(text: string): ToolInfo | undefined {
  if (!text || text.length > MAX_LEGACY_TOOL_JSON_CHARS) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const row = value as Record<string, unknown>;
    if (typeof row.tool_name !== 'string' || !row.tool_name.trim()) return undefined;
    return row as unknown as ToolInfo;
  } catch {
    return undefined;
  }
}

/** Safe title for a tool row when talking to an older beta server that does
 * not expose tool_summary. JSON/results are replaced, never echoed. */
export function compactToolFallback(text: string): string {
  const normalized = String(text || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return 'Tool usage';
  if (/^(using|calling|running|executing)\b/i.test(normalized)) {
    return normalized.length <= MAX_FALLBACK_LABEL_CHARS
      ? normalized
      : `${normalized.slice(0, MAX_FALLBACK_LABEL_CHARS - 1)}…`;
  }
  return 'Tool result';
}
