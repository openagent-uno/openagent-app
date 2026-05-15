/**
 * Vault state: notes list, graph data, selected note, editor content.
 */

import { create } from 'zustand';
import type { VaultNote, GraphData } from '../../common/types';
import * as api from '../services/api';

interface VaultState {
  notes: VaultNote[];
  graph: GraphData | null;
  selectedPath: string | null;
  editorContent: string;
  editorDirty: boolean;
  searchQuery: string;
  searchResults: VaultNote[];
  loading: boolean;
  error: string | null;

  loadNotes: () => Promise<void>;
  loadGraph: () => Promise<void>;
  selectNote: (path: string) => Promise<void>;
  updateEditor: (content: string) => void;
  saveNote: () => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
}

export const useVault = create<VaultState>((set, get) => ({
  notes: [],
  graph: null,
  selectedPath: null,
  editorContent: '',
  editorDirty: false,
  searchQuery: '',
  searchResults: [],
  loading: false,
  error: null,

  loadNotes: async () => {
    set({ loading: true, error: null });
    try {
      const notes = await api.listNotes();
      set({ notes, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  loadGraph: async () => {
    try {
      const graph = await api.getGraph();
      set({ graph });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  selectNote: async (path) => {
    set({ selectedPath: path, loading: true });
    try {
      const note = await api.readNote(path);
      set({ editorContent: note.content, editorDirty: false, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  updateEditor: (content) => set({ editorContent: content, editorDirty: true }),

  saveNote: async () => {
    const { selectedPath, editorContent } = get();
    if (!selectedPath) return;
    try {
      await api.writeNote(selectedPath, editorContent);
      set({ editorDirty: false });
      // Reload graph after save (links may have changed)
      get().loadGraph();
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  search: async (query) => {
    set({ searchQuery: query });
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    try {
      const results = await api.searchNotes(query);
      set({ searchResults: results });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [] }),
}));
