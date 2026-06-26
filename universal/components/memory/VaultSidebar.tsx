/**
 * VaultSidebar — shared sidebar for the Memory tab.
 *
 * Used by both screens of the Memory stack:
 *   - ``memory/index`` — graph view
 *   - ``memory/[...path]`` — note editor
 *
 * Renders the search box, folder-grouped file list, and the note counter.
 * The parent decides what tapping a note does (push, replace, inline) by
 * passing ``onSelectNote`` — this component is navigation-agnostic.
 */

import Feather from '@expo/vector-icons/Feather';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useVault } from '../../stores/vault';
import { colors, font, radius } from '../../theme';

interface Props {
  selectedPath: string | null;
  onSelectNote: (path: string) => void;
}

export default function VaultSidebar({ selectedPath, onSelectNote }: Props) {
  const { notes, searchQuery, searchResults, loading, search, clearSearch, moveNote } = useVault();

  const displayNotes = searchQuery.trim() ? searchResults : notes;

  // Rename a note in place. A bare name preserves the folder; typing a
  // path moves it. ``moveNote`` reloads notes + rewrites inbound links.
  const renameNote = (path: string) => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const current = path.split('/').pop() ?? path;
    const input = window.prompt('Rename note (name or path):', current);
    if (input == null) return;
    const next = input.trim();
    if (!next || next === current) return;
    const withExt = next.endsWith('.md') ? next : `${next}.md`;
    const target = withExt.includes('/') ? withExt : `${dir}${withExt}`;
    if (target === path) return;
    void moveNote(path, target);
  };

  // Cap the rendered tree — agent vaults grow to hundreds of notes and the
  // whole list mounts (deeply-nested rows) whenever the Memory tab is open.
  // The search box above finds anything beyond the window.
  const VAULT_RENDER_CAP = 150;
  const cappedNotes = displayNotes.length > VAULT_RENDER_CAP
    ? displayNotes.slice(0, VAULT_RENDER_CAP)
    : displayNotes;
  const hiddenNotes = displayNotes.length - cappedNotes.length;

  // Group by top-level folder so the list reads as a tree.
  const folders = new Map<string, typeof notes>();
  for (const n of cappedNotes) {
    const parts = n.path.split('/');
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder)!.push(n);
  }

  return (
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
                onPress={() => onSelectNote(n.path)}
                onLongPress={() => renameNote(n.path)}
              >
                <View style={styles.fileRow}>
                  <View style={styles.fileMain}>
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
                  </View>
                  {/* Rename affordance — a quiet pencil shown on the
                      active row (web). Long-press renames on native. */}
                  {Platform.OS === 'web' && n.path === selectedPath && (
                    <TouchableOpacity
                      style={styles.renameBtn}
                      onPress={(e) => { e.stopPropagation?.(); renameNote(n.path); }}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Feather name="edit-2" size={11} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ))}
        {hiddenNotes > 0 && (
          <Text style={styles.emptyText}>+{hiddenNotes} more — search to narrow</Text>
        )}
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
  fileRow: { flexDirection: 'row', alignItems: 'center' },
  fileMain: { flex: 1, minWidth: 0 },
  renameBtn: { paddingHorizontal: 4, paddingVertical: 2, marginLeft: 4 },
  fileName: { fontSize: 12.5, color: colors.textSecondary, fontWeight: '400' },
  fileNameActive: { color: colors.text, fontWeight: '500' },
  fileTags: { fontSize: 10, color: colors.textMuted, marginTop: 1, fontFamily: font.mono },
  noteCount: { padding: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  noteCountText: { fontSize: 10, color: colors.textMuted, textAlign: 'center', fontFamily: font.mono },
  emptyText: { color: colors.textMuted, fontSize: 12, padding: 14 },
});
