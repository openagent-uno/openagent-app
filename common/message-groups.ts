import type { ChatMessage } from './types';

/**
 * A transcript group is a contiguous stretch owned by the same visible
 * speaker. Tool rows belong to the agent's stretch even though they do not
 * render an author header themselves; compaction is a system boundary. This
 * lets a response flow as assistant text -> tool card -> assistant text
 * without repeating the agent name, while still showing the name when a
 * response begins with a tool call.
 */
function groupKey(message: Pick<ChatMessage, 'role' | 'author'>): string {
  if (message.role === 'assistant' || message.role === 'tool') {
    return 'agent';
  }
  if (message.role === 'compaction') return 'system';
  if (message.author?.kind === 'agent') {
    // Agent-authored seed prompts are missions, not part of the reply group.
    return 'mission';
  }
  const human = message.author?.handle?.trim().toLowerCase()
    || message.author?.display?.trim().toLowerCase()
    || 'current-user';
  return `human:${human}`;
}

function rendersAuthorHeader(message: Pick<ChatMessage, 'role' | 'author'>): boolean {
  return message.role === 'assistant'
    || (message.role === 'user' && message.author?.kind !== 'agent');
}

/**
 * Return one flag per message. A flag is true only for the first header-bearing
 * message in a contiguous speaker group. The calculation intentionally runs
 * over the rendered window: if pagination starts halfway through a group, its
 * first visible message still identifies the speaker.
 */
export function messageHeaderVisibility(
  messages: readonly Pick<ChatMessage, 'role' | 'author'>[],
): boolean[] {
  let activeGroup: string | undefined;
  let headerShown = false;

  return messages.map((message) => {
    const nextGroup = groupKey(message);
    if (nextGroup !== activeGroup) {
      activeGroup = nextGroup;
      headerShown = false;
    }
    if (!rendersAuthorHeader(message) || headerShown) return false;
    headerShown = true;
    return true;
  });
}
