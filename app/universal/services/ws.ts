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

    this.ws.onclose = () => {
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = () => {
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

  sendMessage(text: string, sessionId: string): void {
    this.send({ type: 'message', text, session_id: sessionId });
  }

  sendCommand(name: ClientMessage & { type: 'command' } extends { name: infer N } ? N : never): void {
    this.send({ type: 'command', name: name as any });
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
