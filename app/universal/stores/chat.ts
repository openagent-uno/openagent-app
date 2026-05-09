/**
 * Chat state: multiple sessions, messages, processing status.
 */

import { create } from 'zustand';
import type { Attachment, ChatMessage, ChatSession, ServerMessage, ToolInfo } from '../../common/types';
import type { SessionEntry, SessionRunMessage } from '../services/api';
import {
  deleteSession as deleteSessionApi,
  fetchSessionRuns,
  updateSessionMetadata,
} from '../services/api';

let nextMsgId = 1;
const genId = () => `msg-${nextMsgId++}-${Date.now()}`;

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  voiceSessionId: string | null;
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
  /** Returns the existing voice session id, or creates a new one. */
  getOrCreateVoiceSession: () => string;
  /** Clear the voice session pointer (next visit makes a fresh one). */
  clearVoiceSession: () => void;
  addUserMessage: (sessionId: string, text: string, attachments?: Attachment[]) => void;
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
  voiceSessionId: null,
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
    set({ activeSessionId: id });
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
    const voiceSessionId = s.voiceSessionId === id ? null : s.voiceSessionId;
    let activeSessionId = s.activeSessionId;
    if (s.activeSessionId === id) {
      const nextChat = sessions.find((ses) => ses.id !== voiceSessionId);
      activeSessionId = nextChat?.id ?? null;
    }
    return { sessions, activeSessionId, voiceSessionId };
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

  getOrCreateVoiceSession: () => {
    const existing = get().voiceSessionId;
    if (existing && get().sessions.some((s) => s.id === existing)) return existing;
    const id = sessionId();
    const session: ChatSession = {
      id,
      title: 'Voice Chat',
      messages: [],
      isProcessing: false,
    };
    set((s) => ({
      sessions: [...s.sessions, session],
      voiceSessionId: id,
    }));
    return id;
  },

  clearVoiceSession: () => set({ voiceSessionId: null }),

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

  handleServerMessage: (msg) => set((s) => {
    if (msg.type === 'status') {
      const text = msg.text || '';

      // Try to parse as structured tool event
      let toolInfo: ToolInfo | undefined;
      try {
        const parsed = JSON.parse(text);
        if (parsed && parsed.tool) toolInfo = parsed as ToolInfo;
      } catch { /* plain text status */ }

      if (toolInfo) {
        return {
          sessions: s.sessions.map((ses) => {
            if (ses.id !== msg.session_id) return ses;
            if (toolInfo!.status === 'running') {
              // New tool → add message
              return {
                ...ses,
                statusText: `Using ${toolInfo!.tool}...`,
                messages: [...ses.messages, {
                  id: genId(),
                  role: 'tool' as const,
                  text: `Using ${toolInfo!.tool}...`,
                  timestamp: Date.now(),
                  toolInfo,
                }],
              };
            }
            // done/error → update the existing running tool message
            const msgs = [...ses.messages];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].toolInfo?.tool === toolInfo!.tool && msgs[i].toolInfo?.status === 'running') {
                msgs[i] = { ...msgs[i], toolInfo: toolInfo! };
                break;
              }
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
      // First delta of a turn creates the bubble (so it shows up
      // immediately in the transcript); subsequent deltas append to
      // the same bubble. The ``response`` frame replaces the bubble's
      // text with the canonical clean version + attaches metadata.
      const delta = msg.text || '';
      if (!delta) return {};
      return {
        sessions: s.sessions.map((ses) => {
          if (ses.id !== msg.session_id) return ses;
          const msgs = [...ses.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            msgs[msgs.length - 1] = { ...last, text: last.text + delta };
          } else {
            msgs.push({
              id: genId(),
              role: 'assistant' as const,
              text: delta,
              timestamp: Date.now(),
              streaming: true,
            });
          }
          return { ...ses, messages: msgs, statusText: undefined };
        }),
      };
    }

    if (msg.type === 'response') {
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

  clearAll: () => set({ sessions: [], activeSessionId: null, voiceSessionId: null, sessionsHydrated: false }),

  loadSession: (id, title, history) => {
    const buildToolInfo = (entry: typeof history[0]): ToolInfo | undefined => {
      const name = entry.tool_name;
      if (!name) return undefined;
      const isError = !!entry.tool_error;
      const isDone = !isError && entry.tool_result !== undefined;
      return {
        tool: name,
        params: entry.tool_args ?? {},
        status: isError ? 'error' : isDone ? 'done' : 'running',
        result: entry.tool_result,
        error: entry.tool_error,
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
