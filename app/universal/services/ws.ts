/**
 * WebSocket client for OpenAgent.
 * Works on all platforms (React Native, Web, Electron).
 */

import type { ClientMessage, ServerMessage } from '../../common/types';

export type MessageHandler = (msg: ServerMessage) => void;

export class OpenAgentWS {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[WS] connected, sending auth...');
      this.send({ type: 'auth', token: this.token });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        this.handlers.forEach((h) => h(msg));
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = (event) => {
      console.log(`[WS] closed: code=${event.code} reason=${event.reason}`);
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = (event) => {
      console.error('[WS] error:', event);
      this.ws?.close();
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendMessage(
    text: string,
    sessionId: string,
    options?: { inputWasVoice?: boolean; voiceLanguage?: string },
  ): void {
    const payload: ClientMessage = { type: 'message', text, session_id: sessionId };
    if (options?.inputWasVoice) {
      (payload as { input_was_voice?: boolean }).input_was_voice = true;
    }
    // ``voiceLanguage`` is meaningful only for voice messages — gateway
    // ignores it on typed messages — but we pass it whenever the
    // caller has it so future text-mode features (e.g. agent locale
    // hints) can hook in without protocol churn.
    if (options?.voiceLanguage) {
      (payload as { voice_language?: string }).voice_language = options.voiceLanguage;
    }
    this.send(payload);
  }

  sendCommand(
    name: ClientMessage & { type: 'command' } extends { name: infer N } ? N : never,
    sessionId?: string,
  ): void {
    // Scope scope-sensitive commands (stop/new/clear/reset) to the
    // specific chat tab so other tabs stay intact. Pass `undefined` for
    // global admin commands (help/usage/update/restart).
    const payload: any = { type: 'command', name };
    if (sessionId !== undefined) payload.session_id = sessionId;
    this.send(payload);
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
