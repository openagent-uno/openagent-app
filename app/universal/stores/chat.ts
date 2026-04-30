/**
 * Chat state: multiple sessions, messages, processing status.
 */

import { create } from 'zustand';
import type { Attachment, ChatMessage, ChatSession, ServerMessage, ToolInfo } from '../../common/types';

let nextMsgId = 1;
const genId = () => `msg-${nextMsgId++}-${Date.now()}`;

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  // Tracked separately from ``activeSessionId`` so the Voice screen
  // resumes its own session across tab switches without disturbing
  // the Chat tab's selection. Lives only in memory — a fresh app
  // launch always opens the Voice tab on a brand-new session.
  voiceSessionId: string | null;

  createSession: () => string;
  setActiveSession: (id: string) => void;
  removeSession: (id: string) => void;
  /** Returns the existing voice session id, or creates a new one. */
  getOrCreateVoiceSession: () => string;
  /** Clear the voice session pointer (next visit makes a fresh one).
   * Does NOT delete the session row from ``sessions[]`` so the Chat
   * tab's sidebar can still show the transcript. */
  clearVoiceSession: () => void;
  addUserMessage: (sessionId: string, text: string, attachments?: Attachment[]) => void;
  handleServerMessage: (msg: ServerMessage) => void;
  clearAll: () => void;
}

export const useChat = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  voiceSessionId: null,

  createSession: () => {
    const id = `session-${Date.now()}`;
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

  setActiveSession: (id) => set({ activeSessionId: id }),

  removeSession: (id) => set((s) => {
    const sessions = s.sessions.filter((ses) => ses.id !== id);
    const activeSessionId = s.activeSessionId === id
      ? (sessions[0]?.id ?? null)
      : s.activeSessionId;
    const voiceSessionId = s.voiceSessionId === id ? null : s.voiceSessionId;
    return { sessions, activeSessionId, voiceSessionId };
  }),

  getOrCreateVoiceSession: () => {
    const existing = get().voiceSessionId;
    if (existing && get().sessions.some((s) => s.id === existing)) return existing;
    const id = `session-${Date.now()}`;
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

  addUserMessage: (sessionId, text, attachments) => set((s) => ({
    sessions: s.sessions.map((ses) =>
      ses.id !== sessionId ? ses : {
        ...ses,
        isProcessing: true,
        statusText: 'Thinking...',
        messages: [...ses.messages, {
          id: genId(),
          role: 'user' as const,
          text,
          timestamp: Date.now(),
          attachments: attachments && attachments.length ? attachments : undefined,
        }],
        title: ses.messages.length === 0
          ? (text.slice(0, 40) || attachments?.[0]?.filename || 'New Chat')
          : ses.title,
      },
    ),
  })),

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

  clearAll: () => set({ sessions: [], activeSessionId: null, voiceSessionId: null }),
}));
