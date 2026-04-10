/**
 * Memory screen — 3-panel layout:
 *   Left:   file tree + search
 *   Center: markdown editor (raw text for now, WYSIWYG later)
 *   Right:  force-directed graph view
 */

import { useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useVault } from '../../stores/vault';
import { setBaseUrl } from '../../services/api';
import GraphView from '../../components/GraphView';

export default function MemoryScreen() {
  const config = useConnection((s) => s.config);
  const {
    notes, graph, selectedPath, editorContent, editorDirty,
    searchQuery, searchResults, loading,
    loadNotes, loadGraph, selectNote, updateEditor, saveNote, search, clearSearch,
  } = useVault();

  // Set API base URL from connection config
  useEffect(() => {
    if (config) {
      setBaseUrl(config.host, config.port);
      loadNotes();
      loadGraph();
    }
  }, [config]);

  const handleSave = useCallback(() => {
    saveNote().then(() => loadNotes());
  }, [saveNote, loadNotes]);

  // Keyboard shortcut: Ctrl/Cmd+S to save
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  const displayNotes = searchQuery.trim() ? searchResults : notes;
  const selectedNote = notes.find((n) => n.path === selectedPath);

  // Group notes by folder
  const folders = new Map<string, typeof notes>();
  for (const n of displayNotes) {
    const parts = n.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder)!.push(n);
  }

  return (
    <View style={styles.container}>
      {/* ── Left panel: file tree ── */}
      <View style={styles.leftPanel}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={(q) => (q ? search(q) : clearSearch())}
          placeholder="Search notes..."
          placeholderTextColor="#999"
        />

        <ScrollView style={styles.fileTree}>
          {Array.from(folders.entries()).map(([folder, folderNotes]) => (
            <View key={folder}>
              {folder && (
                <Text style={styles.folderName}>📁 {folder}</Text>
              )}
              {folderNotes.map((n) => (
                <TouchableOpacity
                  key={n.path}
                  style={[
                    styles.fileItem,
                    n.path === selectedPath && styles.fileItemActive,
                  ]}
                  onPress={() => selectNote(n.path)}
                >
                  <Text
                    style={[
                      styles.fileName,
                      n.path === selectedPath && styles.fileNameActive,
                    ]}
                    numberOfLines={1}
                  >
                    {n.title || n.path.split('/').pop()?.replace('.md', '')}
                  </Text>
                  {n.tags && n.tags.length > 0 && (
                    <Text style={styles.fileTags} numberOfLines={1}>
                      {n.tags.slice(0, 3).join(', ')}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ))}

          {displayNotes.length === 0 && (
            <Text style={styles.emptyText}>
              {loading ? 'Loading...' : searchQuery ? 'No results' : 'No notes yet'}
            </Text>
          )}
        </ScrollView>

        <View style={styles.noteCount}>
          <Text style={styles.noteCountText}>{notes.length} notes</Text>
        </View>
      </View>

      {/* ── Center panel: editor ── */}
      <View style={styles.centerPanel}>
        {selectedPath ? (
          <>
            <View style={styles.editorHeader}>
              <Text style={styles.editorTitle} numberOfLines={1}>
                {selectedNote?.title || selectedPath}
              </Text>
              <View style={styles.editorActions}>
                {editorDirty && (
                  <Text style={styles.unsavedBadge}>unsaved</Text>
                )}
                <TouchableOpacity
                  style={[styles.saveBtn, !editorDirty && styles.saveBtnDisabled]}
                  onPress={handleSave}
                  disabled={!editorDirty}
                >
                  <Text style={styles.saveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
            {Platform.OS === 'web' ? (
              <textarea
                value={editorContent}
                onChange={(e: any) => updateEditor(e.target.value)}
                style={{
                  flex: 1,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 13,
                  lineHeight: '1.6',
                  padding: 20,
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  backgroundColor: '#FFFFFF',
                  color: '#1a1a1a',
                  width: '100%',
                  height: '100%',
                } as any}
                spellCheck={false}
              />
            ) : (
              <TextInput
                style={styles.editorInput}
                value={editorContent}
                onChangeText={updateEditor}
                multiline
                textAlignVertical="top"
              />
            )}
          </>
        ) : (
          <View style={styles.editorEmpty}>
            <Text style={styles.emptyText}>Select a note to edit</Text>
          </View>
        )}
      </View>

      {/* ── Right panel: graph view ── */}
      <View style={styles.rightPanel}>
        {graph && graph.nodes.length > 0 ? (
          <GraphView
            data={graph}
            onSelectNode={(id) => selectNote(id)}
          />
        ) : (
          <View style={styles.graphEmpty}>
            <Text style={styles.emptyText}>
              {loading ? 'Loading graph...' : 'No notes to visualize'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', backgroundColor: '#FAFAFA' },

  // Left panel (file tree)
  leftPanel: {
    width: 220,
    backgroundColor: '#F5F5F5',
    borderRightWidth: 1,
    borderRightColor: '#EBEBEB',
    flexDirection: 'column',
  },
  searchInput: {
    margin: 10,
    padding: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    fontSize: 12,
    color: '#1a1a1a',
  },
  fileTree: { flex: 1, paddingHorizontal: 6 },
  folderName: {
    fontSize: 11,
    fontWeight: '600',
    color: '#999',
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  fileItem: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginVertical: 1,
  },
  fileItemActive: {
    backgroundColor: '#EBEBEB',
  },
  fileName: {
    fontSize: 13,
    color: '#333',
  },
  fileNameActive: {
    color: '#D97757',
    fontWeight: '500',
  },
  fileTags: {
    fontSize: 10,
    color: '#AAA',
    marginTop: 1,
  },
  noteCount: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#EBEBEB',
  },
  noteCountText: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
  },

  // Center panel (editor)
  centerPanel: {
    flex: 1,
    flexDirection: 'column',
    borderRightWidth: 1,
    borderRightColor: '#EBEBEB',
  },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBEB',
    backgroundColor: '#FFFFFF',
  },
  editorTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  editorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unsavedBadge: {
    fontSize: 10,
    color: '#D97757',
    backgroundColor: '#FFF3EE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  saveBtn: {
    backgroundColor: '#D97757',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 6,
  },
  saveBtnDisabled: {
    opacity: 0.3,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  editorInput: {
    flex: 1,
    padding: 20,
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#1a1a1a',
    backgroundColor: '#FFFFFF',
  },
  editorEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Right panel (graph)
  rightPanel: {
    width: 350,
    backgroundColor: '#FAFAFA',
  },
  graphEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  emptyText: {
    color: '#999',
    fontSize: 13,
  },
});
