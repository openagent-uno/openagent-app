/**
 * Connection state: which OpenAgent instance we're connected to.
 */

import { create } from 'zustand';
import type { ConnectionConfig } from '../../common/types';
import { OpenAgentWS } from '../services/ws';

interface ConnectionState {
  config: ConnectionConfig | null;
  ws: OpenAgentWS | null;
  isConnected: boolean;
  agentName: string | null;
  agentVersion: string | null;
  error: string | null;

  connect: (config: ConnectionConfig) => void;
  disconnect: () => void;
  setConnected: (name: string, version: string) => void;
  setError: (error: string) => void;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  config: null,
  ws: null,
  isConnected: false,
  agentName: null,
  agentVersion: null,
  error: null,

  connect: (config) => {
    const old = get().ws;
    old?.disconnect();

    const url = `ws://${config.host}:${config.port}/ws`;
    const ws = new OpenAgentWS(url, config.token);

    ws.onMessage((msg) => {
      if (msg.type === 'auth_ok') {
        set({ isConnected: true, agentName: msg.agent_name, agentVersion: msg.version, error: null });
      } else if (msg.type === 'auth_error') {
        set({ isConnected: false, error: msg.reason });
      }
    });

    ws.connect();
    set({ config, ws, isConnected: false, error: null });
  },

  disconnect: () => {
    get().ws?.disconnect();
    set({ ws: null, isConnected: false, config: null, agentName: null, agentVersion: null });
  },

  setConnected: (name, version) => set({ isConnected: true, agentName: name, agentVersion: version }),
  setError: (error) => set({ error, isConnected: false }),
}));
