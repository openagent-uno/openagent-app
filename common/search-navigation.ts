import type { EventCause, SearchTarget } from './unified-history';

/** Pure, serializable route intent. The universal service performs the push. */
export interface SearchNavigationIntent {
  pathname: string;
  params: Record<string, string>;
}

function addCause(params: Record<string, string>, causedBy?: EventCause | null): void {
  if (!causedBy) return;
  params.causedByEvent = causedBy.event_id;
  params.causedByDelivery = causedBy.delivery_id;
  params.causedByTitle = causedBy.title;
}

function unreachable(target: never): never {
  throw new Error(`Unsupported search target: ${JSON.stringify(target)}`);
}

/**
 * Exhaustive wire-target to existing Expo Router mapping.
 * SearchRoot is intentionally not accepted: it is display/grouping metadata,
 * not an authorized fallback navigation target.
 */
export function searchNavigationIntent(
  target: SearchTarget,
  causedBy?: EventCause | null,
): SearchNavigationIntent {
  switch (target.kind) {
    case 'chat':
      return { pathname: '/(tabs)/chat', params: { session: target.session_id } };
    case 'chat_message':
      return {
        pathname: '/(tabs)/chat',
        params: { session: target.session_id, message: target.message_id },
      };
    case 'chat_tool':
      return {
        pathname: '/(tabs)/chat',
        params: {
          session: target.session_id,
          message: target.message_id,
          toolInvocation: target.tool_invocation_id,
        },
      };
    case 'workflow_definition': {
      const params: Record<string, string> = { id: target.workflow_id };
      if (target.node_id) params.node = target.node_id;
      if (target.field) params.field = target.field;
      return { pathname: '/(tabs)/workflows/[id]', params };
    }
    case 'workflow_run': {
      const params: Record<string, string> = {
        id: target.run_id,
        kind: 'workflow',
        parentId: target.workflow_id,
      };
      if (target.trace_step_id) params.traceStep = target.trace_step_id;
      if (target.tool_invocation_id) params.toolInvocation = target.tool_invocation_id;
      addCause(params, causedBy);
      return { pathname: '/(tabs)/runs/[id]', params };
    }
    case 'scheduled_definition': {
      const params: Record<string, string> = { id: target.task_id };
      if (target.field) params.field = target.field;
      return { pathname: '/(tabs)/tasks/[id]', params };
    }
    case 'scheduled_run': {
      const params: Record<string, string> = {
        id: target.run_id,
        kind: 'task',
        parentId: target.task_id,
      };
      if (target.session_id) params.session = target.session_id;
      if (target.message_id) params.message = target.message_id;
      if (target.tool_invocation_id) params.toolInvocation = target.tool_invocation_id;
      addCause(params, causedBy);
      return { pathname: '/(tabs)/runs/[id]', params };
    }
    case 'event_definition': {
      const params: Record<string, string> = { id: target.event_id };
      if (target.field) params.field = target.field;
      return { pathname: '/(tabs)/events/[id]', params };
    }
    case 'event_delivery': {
      const params: Record<string, string> = {
        id: target.delivery_id,
        kind: 'event',
        parentId: target.event_id,
      };
      if (target.session_id) params.session = target.session_id;
      if (target.message_id) params.message = target.message_id;
      if (target.tool_invocation_id) params.toolInvocation = target.tool_invocation_id;
      addCause(params, causedBy);
      return { pathname: '/(tabs)/runs/[id]', params };
    }
    default:
      return unreachable(target);
  }
}
