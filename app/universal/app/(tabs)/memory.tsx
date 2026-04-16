/**
 * Memory screen — master-detail with responsive sidebar.
 * Wide: fixed file tree + main area (graph or editor).
 * Narrow: drawer sidebar + main area.
 */

import { useState, useEffect, useCallback } from 'react';
import Feather from '@expo/vector-icons/Feather';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useVault } from '../../stores/vault';
import { setBaseUrl } from '../../services/api';
import GraphView from '../../components/GraphView';
import Markdown from '../../components/Markdown';
import Button from '../../components/Button';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';
import { colors, font, radius } from '../../theme';

export default function MemoryScreen() {
  const config = useConnection((s) => s.config);
  const {
    notes, graph, selectedPath, editorContent, editorDirty,
    searchQuery, searchResults, loading,
    loadNotes, loadGraph, selectNote, updateEditor, saveNote, search, clearSearch,
  } = useVault();

  const [rawMode, setRawMode] = useState(false);

  useEffect(() => {
    if (config) {
      setBaseUrl(config.host, config.port);
      loadNotes();
      loadGraph();
    }
  }, [config]);

  useEffect(() => { setRawMode(false); }, [selectedPath]);

  const handleSave = useCallback(() => {
    saveNote().then(() => loadNotes());
  }, [saveNote, loadNotes]);

  const handleClose = useCallback(() => {
    useVault.setState({ selectedPath: null, editorContent: '', editorDirty: false });
  }, []);

  const openNote = (path: string) => selectNote(path);

  useEffect(() => {
    if (Platform.OS !== 'web' || !selectedPath) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave, selectedPath]);

  const displayNotes = searchQuery.trim() ? searchResults : notes;
  const selectedNote = notes.find((n) => n.path === selectedPath);

  const folders = new Map<string, typeof notes>();
  for (const n of displayNotes) {
    const parts = n.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder)!.push(n);
  }

  const sidebarContent = (
    <View style={styles.sidebarInner}>
      <TextInput
        style={styles.searchInput}
        value={searchQuery}
        onChangeText={(q) => (q ? search(q) : clearSearch())}
        placeholder="Search notes..."
        placeholderTextColor={colors.textMuted}
      />
      <ScrollView style={styles.fileTree}>
        {Array.from(folders.entries()).map(([folder, folderNotes]) => (
          <View key={folder || '__root'}>
            {folder !== '' && (
              <View style={styles.folderRow}>
                <Feather name="folder" size={12} color={colors.textMuted} />
                <Text style={styles.folderName}>{folder}</Text>
              </View>
            )}
            {folderNotes.map((n) => (
              <TouchableOpacity
                key={n.path}
                style={[styles.fileItem, n.path === selectedPath && styles.fileItemActive]}
                onPress={() => openNote(n.path)}
              >
                <Text
                  style={[styles.fileName, n.path === selectedPath && styles.fileNameActive]}
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
  );

  return (
    <ResponsiveSidebar sidebar={sidebarContent}>
      <View style={styles.mainArea}>
        {selectedPath ? (
          <View style={styles.editorContainer}>
            <View style={styles.editorHeader}>
              <TouchableOpacity onPress={handleClose} style={styles.backBtn}>
                <View style={styles.backBtnContent}>
                  <Feather name="arrow-left" size={14} color={colors.primary} />
                  <Text style={styles.backBtnText}>Graph</Text>
                </View>
              </TouchableOpacity>
              <Text style={styles.editorTitle} numberOfLines={1}>
                {selectedNote?.title || selectedPath.split('/').pop()?.replace('.md', '')}
              </Text>
              <View style={styles.editorActions}>
                <TouchableOpacity style={styles.toggleBtn} onPress={() => setRawMode(!rawMode)}>
                  <Text style={styles.toggleBtnText}>{rawMode ? 'Preview' : 'Edit'}</Text>
                </TouchableOpacity>
                {rawMode && editorDirty && <Text style={styles.unsavedBadge}>unsaved</Text>}
                {rawMode && (
                  <Button
                    variant="primary"
                    size="sm"
                    label="Save"
                    onPress={handleSave}
                    disabled={!editorDirty}
                  />
                )}
              </View>
            </View>
            {rawMode ? (
              Platform.OS === 'web' ? (
                <textarea
                  value={editorContent}
                  onChange={(e: any) => updateEditor(e.target.value)}
                  style={{
                    flex: 1, width: '100%', height: '100%',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 13, lineHeight: '1.7', padding: 24,
                    border: 'none', outline: 'none', resize: 'none',
                    backgroundColor: colors.surface, color: colors.text,
                    boxSizing: 'border-box',
                  } as any}
                  spellCheck={false}
                />
              ) : (
                <ScrollView style={{ flex: 1, backgroundColor: colors.surface }}>
                  <TextInput
                    style={styles.editorInput}
                    value={editorContent} onChangeText={updateEditor}
                    multiline textAlignVertical="top"
                  />
                </ScrollView>
              )
            ) : (
              <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
                <Markdown text={editorContent} />
              </ScrollView>
            )}
          </View>
        ) : (
          graph && graph.nodes.length > 0 ? (
            <GraphView data={graph} onSelectNode={openNote} />
          ) : (
            <View style={styles.graphEmpty}>
              <Text style={styles.emptyText}>
                {loading ? 'Loading graph...' : 'No notes to visualize'}
              </Text>
            </View>
          )
        )}
      </View>
    </ResponsiveSidebar>
  );
}

const styles = StyleSheet.create({
  sidebarInner: { flex: 1 },
  searchInput: {
    margin: 10, padding: 8, paddingHorizontal: 11,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    fontSize: 12, color: colors.text, fontFamily: font.sans,
  },
  fileTree: { flex: 1, paddingHorizontal: 6 },
  folderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingTop: 10, paddingBottom: 4,
  },
  folderName: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginLeft: 6,
  },
  fileItem: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.sm, marginVertical: 0 },
  fileItemActive: { backgroundColor: colors.hover },
  fileName: { fontSize: 12.5, color: colors.textSecondary, fontWeight: '400' },
  fileNameActive: { color: colors.text, fontWeight: '500' },
  fileTags: { fontSize: 10, color: colors.textMuted, marginTop: 1, fontFamily: font.mono },
  noteCount: {
    padding: 10, borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  noteCountText: { fontSize: 10, color: colors.textMuted, textAlign: 'center', fontFamily: font.mono },

  mainArea: { flex: 1, backgroundColor: colors.bg },
  graphEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  editorContainer: { flex: 1, flexDirection: 'column', backgroundColor: colors.surface },
  editorHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
    backgroundColor: colors.bg,
  },
  backBtn: { paddingVertical: 4, paddingHorizontal: 6, marginRight: 10 },
  backBtnContent: { flexDirection: 'row', alignItems: 'center' },
  backBtnText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500', marginLeft: 5 },
  editorTitle: {
    fontSize: 14, fontWeight: '500', color: colors.text, flex: 1,
    fontFamily: font.display, letterSpacing: -0.2,
  },
  editorActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleBtn: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  toggleBtnText: { fontSize: 11, color: colors.textSecondary, fontWeight: '500' },
  unsavedBadge: {
    fontSize: 9, color: colors.primary, backgroundColor: colors.primaryLight,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.xs, overflow: 'hidden',
    fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5,
  },
  saveBtn: {},
  saveBtnInner: { minHeight: 30, paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.sm },
  saveBtnDisabled: { opacity: 0.3 },
  saveBtnText: { color: colors.textInverse, fontSize: 11, fontWeight: '600' },
  editorInput: { padding: 24, fontFamily: font.mono, fontSize: 13, color: colors.text, lineHeight: 22 },
  previewScroll: { flex: 1, backgroundColor: colors.surface },
  previewContent: { padding: 24, maxWidth: 720, width: '100%', alignSelf: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 12, padding: 14 },
});
