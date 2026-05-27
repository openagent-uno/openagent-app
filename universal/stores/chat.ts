/**
 * Chat state: multiple sessions, messages, processing status.
 */

import { create } from 'zustand';
import {
  toolPhase,
  type Attachment,
  type ChatMessage,
  type ChatSession,
  type ServerMessage,
  type ToolInfo,
} from '../../common/types';
import type { SessionEntry, SessionRunMessage } from '../services/api';
import {
  deleteSession as deleteSessionApi,
  fetchSessionRuns,
  updateSessionMetadata,
} from '../services/api';

let nextMsgId = 1;
const genId = () => `msg-${nextMsgId++}-${Date.now()}`;

// Token-streaming throttle: coalesce all deltas that land within one
// animation frame into a single store mutation. Without this, a model
// streaming at 200 tok/s triggers ~200 set() calls per second — each
// schedules a re-render of every subscriber. With it we cap mutations
// at ~60/s which is plenty for visual feedback and stays well below
// MessageList memo's effective re-render budget.
const pendingDeltas = new Map<string, string>();
let flushScheduled = false;
function scheduleDeltaFlush(
  apply: (next: Map<string, string>) => void,
) {
  if (flushScheduled) return;
  flushScheduled = true;
  const runFlush = () => {
    flushScheduled = false;
    if (pendingDeltas.size === 0) return;
    const snapshot = new Map(pendingDeltas);
    pendingDeltas.clear();
    apply(snapshot);
  };
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(runFlush);
  } else {
    setTimeout(runFlush, 16);
  }
}

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  /** True after the first successful fetch from /api/sessions. */
  sessionsHydrated: boolean;

  createSession: () => string;
  setActiveSession: (id: string) => void;
  removeSession: (id: string) => void;
  /** Rename a session locally and on the server. */
  renameSession: (id: string, title: string) => void;
  /** Populate local sessions from the server's persisted list. */
  hydrateFromServer: (entries: SessionEntry[]) => void;
  /** Mark hydration as done even when the server returned no sessions. */
  markHydrated: () => void;
  addUserMessage: (sessionId: string, text: string, attachments?: Attachment[]) => void;
  /** Replace a previous user message in place (Edit & retry).
   *  Truncates everything after the edited message so the new turn
   *  starts from a clean tail. Returns true when the id was found. */
  editUserMessage: (sessionId: string, messageId: string, newText: string) => boolean;
  /** Persist composer text per-session so switching sessions doesn't
   *  lose work. */
  setDraftInput: (sessionId: string, text: string) => void;
  /** Toggle the sticky-pin flag (sidebar surfaces pinned sessions first). */
  togglePinned: (sessionId: string) => void;
  /** Per-session LLM override. Stored on the session row and applied
   *  on the next ``session_open`` — chat.tsx is responsible for
   *  forcing a reopen (close + clear opened-cache) when this changes. */
  setLlmPin: (sessionId: string, model: string | undefined) => void;
  /** Per-session system prompt. Same gating as setLlmPin — the next
   *  outgoing turn is rebased on the new prompt. */
  setSystemPrompt: (sessionId: string, prompt: string) => void;
  handleServerMessage: (msg: ServerMessage) => void;
  clearAll: () => void;
  loadSession: (id: string, title: string, history: { role: string; content: string; tool_result?: string; tool_error?: string; tool_name?: string; tool_args?: Record<string, any> }[]) => string;
}

function sessionId(): string {
  return `session-${Date.now()}`;
}

export const useChat = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  sessionsHydrated: false,

  createSession: () => {
    const id = sessionId();
    const session: ChatSession = {
      id,
      title: 'New Chat',
      messages: [],
      isProcessing: false,
    };
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: id,
    }));
    return id;
  },

  setActiveSession: (id) => {
    const state = get();
    set({
      activeSessionId: id,
      // Bringing a session to focus clears its unread indicator.
      sessions: state.sessions.map((se) =>
        se.id === id && se.hasUnread ? { ...se, hasUnread: false } : se,
      ),
    });
    // Fetch run history from the server when switching to a hydrated
    // session that hasn't loaded its messages yet (e.g. from a
    // previous run that survived in agno_sessions).
    if (state.sessionsHydrated) {
      const ses = state.sessions.find((s) => s.id === id);
      if (ses && ses.messages.length === 0) {
        fetchSessionRuns(id)
          .then((raw) => {
            if (raw && raw.length > 0) {
              const msgs: ChatMessage[] = raw.map((m: SessionRunMessage) => ({
                id: m.id,
                role: m.role,
                text: m.text,
                timestamp: m.timestamp,
                toolInfo: m.toolInfo as ToolInfo | undefined,
                attachments: m.attachments as Attachment[] | undefined,
                model: m.model,
              }));
              set((s) => ({
                sessions: s.sessions.map((se) =>
                  se.id !== id ? se : { ...se, messages: msgs },
                ),
              }));
            }
          })
          .catch(() => {});
      }
    }
  },

  removeSession: (id) => set((s) => {
    // Best-effort delete on the server (fire-and-forget).
    deleteSessionApi(id).catch(() => {});
    const sessions = s.sessions.filter((ses) => ses.id !== id);
    let activeSessionId = s.activeSessionId;
    if (s.activeSessionId === id) {
      activeSessionId = sessions[0]?.id ?? null;
    }
    return { sessions, activeSessionId };
  }),

  renameSession: (id, title) => {
    set((s) => ({
      sessions: s.sessions.map((se) =>
        se.id !== id ? se : { ...se, title },
      ),
    }));
    updateSessionMetadata(id, { title }).catch(() => {});
  },

  hydrateFromServer: (entries) => {
    if (!entries || entries.length === 0) return;
    const existing = get().sessions;
    const existingIds = new Set(existing.map((s) => s.id));
    const imported: ChatSession[] = [];
    for (const e of entries) {
      const sid = e.session_id;
      if (!sid || existingIds.has(sid)) continue;
      imported.push({
        id: sid,
        title: e.title || 'New Chat',
        messages: [],
        isProcessing: false,
      });
    }
    if (imported.length === 0) return;
    const autoSelectId = get().activeSessionId ?? imported[0]?.id ?? null;
    set((s) => ({
      sessions: [...s.sessions, ...imported],
      sessionsHydrated: true,
      activeSessionId: autoSelectId,
    }));
    // Fetch run history for the auto-selected session so the chat
    // screen shows prior messages immediately.
    if (autoSelectId) {
      fetchSessionRuns(autoSelectId)
        .then((raw) => {
          if (raw && raw.length > 0) {
            const msgs: ChatMessage[] = raw.map((m: SessionRunMessage) => ({
              id: m.id,
              role: m.role,
              text: m.text,
              timestamp: m.timestamp,
              toolInfo: m.toolInfo as ToolInfo | undefined,
              attachments: m.attachments as Attachment[] | undefined,
              model: m.model,
            }));
            set((s) => ({
              sessions: s.sessions.map((se) =>
                se.id !== autoSelectId ? se : { ...se, messages: msgs },
              ),
            }));
          }
        })
        .catch(() => {});
    }
  },

  markHydrated: () => set({ sessionsHydrated: true }),

  addUserMessage: (sessionId, text, attachments) => {
    const state = get();
    const ses = state.sessions.find((s) => s.id === sessionId);
    const isFirstMessage = ses ? ses.messages.length === 0 : true;
    const newTitle = isFirstMessage
      ? (text.slice(0, 40) || attachments?.[0]?.filename || 'New Chat')
      : undefined;

    set((s) => ({
      sessions: s.sessions.map((se) =>
        se.id !== sessionId ? se : {
          ...se,
          isProcessing: true,
          statusText: 'Thinking...',
          messages: [...se.messages, {
            id: genId(),
            role: 'user' as const,
            text,
            timestamp: Date.now(),
            attachments: attachments && attachments.length ? attachments : undefined,
          }],
          title: newTitle ?? se.title,
        },
      ),
    }));

    // Persist the title to the server so it shows up on reconnect.
    if (newTitle) {
      updateSessionMetadata(sessionId, { title: newTitle }).catch(() => {});
    }
  },

  editUserMessage: (sessionId, messageId, newText) => {
    let found = false;
    set((s) => ({
      sessions: s.sessions.map((se) => {
        if (se.id !== sessionId) return se;
        const idx = se.messages.findIndex((m) => m.id === messageId);
        if (idx < 0) return se;
        found = true;
        const edited: ChatMessage = { ...se.messages[idx], text: newText };
        return {
          ...se,
          // Truncate after the edited message — the next assistant turn
          // gets a clean slate. Matches ChatGPT's edit-and-resend flow.
          messages: [...se.messages.slice(0, idx), edited],
          isProcessing: true,
          statusText: 'Thinking...',
        };
      }),
    }));
    return found;
  },

  setDraftInput: (sessionId, text) => {
    set((s) => ({
      sessions: s.sessions.map((se) =>
        se.id === sessionId ? { ...se, draftInput: text } : se,
      ),
    }));
  },

  togglePinned: (sessionId) => {
    set((s) => ({
      sessions: s.sessions.map((se) =>
        se.id === sessionId ? { ...se, pinned: !se.pinned } : se,
      ),
    }));
  },

  setLlmPin: (sessionId, model) => {
    set((s) => ({
      sessions: s.sessions.map((se) =>
        se.id === sessionId ? { ...se, llmPin: model } : se,
      ),
    }));
  },

  setSystemPrompt: (sessionId, prompt) => {
    set((s) => ({
      sessions: s.sessions.map((se) =>
        se.id === sessionId ? { ...se, systemPrompt: prompt } : se,
      ),
    }));
  },

  handleServerMessage: (msg) => set((s) => {
    if (msg.type === 'status') {
      const text = msg.text || '';

      // Try to parse as structured tool event. The server emits
      // Agno's native ``ToolExecution.to_dict()`` shape — phase
      // (running / completed / error) is derived locally below.
      let toolInfo: ToolInfo | undefined;
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.tool_name) toolInfo = parsed as ToolInfo;
      } catch { /* plain text status */ }

      if (toolInfo) {
        const phase = toolPhase(toolInfo);
        return {
          sessions: s.sessions.map((ses) => {
            if (ses.id !== msg.session_id) return ses;
            if (phase === 'running') {
              return {
                ...ses,
                messages: [...ses.messages, {
                  id: genId(),
                  role: 'tool' as const,
                  text: `Using ${toolInfo!.tool_name}...`,
                  timestamp: Date.now(),
                  toolInfo,
                }],
              };
            }
            // ``completed`` or ``error``: locate the matching running
            // chip (by tool_name) and replace its toolInfo in place.
            const msgs = [...ses.messages];
            let found = false;
            for (let i = msgs.length - 1; i >= 0; i--) {
              const existing = msgs[i].toolInfo;
              if (
                existing
                && existing.tool_name === toolInfo!.tool_name
                && toolPhase(existing) === 'running'
              ) {
                msgs[i] = { ...msgs[i], toolInfo: toolInfo! };
                found = true;
                break;
              }
            }
            if (!found) {
              msgs.push({
                id: genId(),
                role: 'tool' as const,
                text: phase === 'error'
                  ? `✗ ${toolInfo!.tool_name} failed`
                  : `✓ ${toolInfo!.tool_name} done`,
                timestamp: Date.now(),
                toolInfo,
              });
            }
            return { ...ses, messages: msgs };
          }),
        };
      }

      // Legacy plain text tool status ("Using ...")
      const isTool = text.startsWith('Using ');
      return {
        sessions: s.sessions.map((ses) => {
          if (ses.id !== msg.session_id) return ses;
          if (isTool) {
            return {
              ...ses,
              statusText: text,
              messages: [...ses.messages, {
                id: genId(),
                role: 'tool' as const,
                text,
                timestamp: Date.now(),
              }],
            };
          }
          return { ...ses, statusText: text };
        }),
      };
    }

    if (msg.type === 'delta') {
      // Token-streaming chunk for the in-progress assistant bubble.
      // Coalesced via the module-level buffer above so we collapse a
      // burst of deltas into one set() per animation frame.
      const delta = msg.text || '';
      if (!delta) return {};
      const sid = msg.session_id;
      pendingDeltas.set(sid, (pendingDeltas.get(sid) ?? '') + delta);
      scheduleDeltaFlush((snapshot) => {
        set((cur) => ({
          sessions: cur.sessions.map((ses) => {
            const buffered = snapshot.get(ses.id);
            if (!buffered) return ses;
            const msgs = [...ses.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant' && last.streaming) {
              msgs[msgs.length - 1] = { ...last, text: last.text + buffered };
            } else {
              msgs.push({
                id: genId(),
                role: 'assistant' as const,
                text: buffered,
                timestamp: Date.now(),
                streaming: true,
              });
            }
            return {
              ...ses,
              messages: msgs,
              statusText: undefined,
              hasUnread: cur.activeSessionId === ses.id ? ses.hasUnread : true,
            };
          }),
        }));
      });
      return {};
    }

    if (msg.type === 'response') {
      // Drop any buffered deltas for this session — the response
      // frame is canonical, applying them on top would duplicate
      // content.
      pendingDeltas.delete(msg.session_id);
      return {
        sessions: s.sessions.map((ses) => {
          if (ses.id !== msg.session_id) return ses;
          const msgs = [...ses.messages];
          const last = msgs[msgs.length - 1];
          // If a streaming bubble is in-flight, replace its content
          // with the canonical RESPONSE text (which strips attachment
          // markers + carries model meta). Otherwise append a new
          // bubble — the legacy single-RESPONSE path used by older
          // gateways and clients that ignore ``delta``.
          if (last && last.role === 'assistant' && last.streaming) {
            msgs[msgs.length - 1] = {
              ...last,
              text: msg.text,
              attachments: msg.attachments ?? undefined,
              model: msg.model,
              streaming: false,
            };
          } else {
            msgs.push({
              id: genId(),
              role: 'assistant' as const,
              text: msg.text,
              timestamp: Date.now(),
              attachments: msg.attachments ?? undefined,
              model: msg.model,
            });
          }
          return {
            ...ses,
            isProcessing: false,
            statusText: undefined,
            messages: msgs,
          };
        }),
      };
    }

    if (msg.type === 'error') {
      // Route to the originating session (gateway sets session_id on
      // errors raised inside _process_message). Fall back to the chat
      // tab's active session for legacy/global errors with no id —
      // without this fallback an old gateway would silently swallow
      // every error frame.
      const targetId = msg.session_id ?? s.activeSessionId;
      return {
        sessions: s.sessions.map((ses) =>
          ses.id !== targetId ? ses : {
            ...ses,
            isProcessing: false,
            statusText: undefined,
            messages: [...ses.messages, {
              id: genId(),
              role: 'assistant' as const,
              text: `Error: ${msg.text}`,
              timestamp: Date.now(),
            }],
          },
        ),
      };
    }

    return {};
  }),

  clearAll: () => set({ sessions: [], activeSessionId: null, sessionsHydrated: false }),

  loadSession: (id, title, history) => {
    const buildToolInfo = (entry: typeof history[0]): ToolInfo | undefined => {
      const name = entry.tool_name;
      if (!name) return undefined;
      // Agno-native shape — phase is derived in the renderer from
      // ``tool_call_error`` + ``result`` presence. Errors carry the
      // message in ``result`` (same convention live wire frames use).
      const isError = !!entry.tool_error;
      return {
        tool_name: name,
        tool_args: entry.tool_args ?? {},
        tool_call_error: isError,
        result: isError
          ? (entry.tool_error ?? null)
          : (entry.tool_result ?? null),
      };
    };
    const messages: ChatMessage[] = history.map((entry, i) => {
      const toolInfo = buildToolInfo(entry);
      if (toolInfo) {
        return {
          id: `load-${id}-${i}-${Date.now()}`,
          role: 'tool' as const,
          text: JSON.stringify(toolInfo),
          timestamp: Date.now() - (history.length - i) * 1000,
          toolInfo,
        };
      }
      if (entry.role === 'user') {
        return {
          id: `load-${id}-${i}-${Date.now()}`,
          role: 'user' as const,
          text: entry.content,
          timestamp: Date.now() - (history.length - i) * 1000,
        };
      }
      return {
        id: `load-${id}-${i}-${Date.now()}`,
        role: 'assistant' as const,
        text: entry.content,
        timestamp: Date.now() - (history.length - i) * 1000,
      };
    });
    const session: ChatSession = { id, title, messages, isProcessing: false };
    set((s) => {
      const existing = s.sessions.some((ses) => ses.id === id);
      const sessions = existing
        ? s.sessions.map((ses) => (ses.id === id ? session : ses))
        : [...s.sessions, session];
      return { sessions, activeSessionId: id };
    });
    return id;
  },
}));
