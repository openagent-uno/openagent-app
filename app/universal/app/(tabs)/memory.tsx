/**
 * Memory screen — file tree (left) + graph view (main).
 * Clicking a note navigates to the editor screen.
 */

import { useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../../stores/connection';
import { useVault } from '../../stores/vault';
import { setBaseUrl } from '../../services/api';
import GraphView from '../../components/GraphView';

export default function MemoryScreen() {
  const router = useRouter();
  const config = useConnection((s) => s.config);
  const {
    notes, graph, searchQuery, searchResults, loading,
    loadNotes, loadGraph, search, clearSearch,
  } = useVault();

  useEffect(() => {
    if (config) {
      setBaseUrl(config.host, config.port);
      loadNotes();
      loadGraph();
    }
  }, [config]);

  const openNote = (path: string) => {
    router.push({ pathname: '/editor', params: { path } });
  };

  const displayNotes = searchQuery.trim() ? searchResults : notes;

  // Group by folder
  const folders = new Map<string, typeof notes>();
  for (const n of displayNotes) {
    const parts = n.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder)!.push(n);
  }

  return (
    <View style={styles.container}>
      {/* Left panel: file tree */}
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
            <View key={folder || '__root'}>
              {folder !== '' && (
                <Text style={styles.folderName}>📁 {folder}</Text>
              )}
              {folderNotes.map((n) => (
                <TouchableOpacity
                  key={n.path}
                  style={styles.fileItem}
                  onPress={() => openNote(n.path)}
                >
                  <Text style={styles.fileName} numberOfLines={1}>
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

      {/* Main: graph view */}
      <View style={styles.mainArea}>
        {graph && graph.nodes.length > 0 ? (
          <GraphView data={graph} onSelectNode={openNote} />
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
  fileName: { fontSize: 13, color: '#333' },
  fileTags: { fontSize: 10, color: '#AAA', marginTop: 1 },
  noteCount: {
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#EBEBEB',
  },
  noteCountText: { fontSize: 11, color: '#999', textAlign: 'center' },
  mainArea: { flex: 1 },
  graphEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#999', fontSize: 13, padding: 16 },
});
