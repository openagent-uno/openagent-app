/**
 * Note editor screen — opens when clicking a note from graph or file tree.
 * Uses Expo Router's stack navigation with a back button.
 */

import { useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useVault } from '../stores/vault';

export default function EditorScreen() {
  const router = useRouter();
  const { path } = useLocalSearchParams<{ path: string }>();
  const {
    selectedPath, editorContent, editorDirty,
    selectNote, updateEditor, saveNote, loadNotes,
  } = useVault();

  // Load note content on mount
  useEffect(() => {
    if (path && path !== selectedPath) {
      selectNote(path);
    }
  }, [path]);

  const handleSave = useCallback(() => {
    saveNote().then(() => loadNotes());
  }, [saveNote, loadNotes]);

  // Ctrl/Cmd+S
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

  const title = path?.split('/').pop()?.replace('.md', '') || 'Note';

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerStyle: { backgroundColor: '#FAFAFA' },
          headerTintColor: '#D97757',
          headerTitleStyle: { color: '#1a1a1a', fontSize: 14, fontWeight: '600' },
          headerRight: () => (
            <View style={styles.headerRight}>
              {editorDirty && <Text style={styles.unsavedBadge}>unsaved</Text>}
              <TouchableOpacity
                style={[styles.saveBtn, !editorDirty && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!editorDirty}
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          ),
        }}
      />
      <View style={styles.container}>
        {Platform.OS === 'web' ? (
          <textarea
            value={editorContent}
            onChange={(e: any) => updateEditor(e.target.value)}
            style={{
              flex: 1,
              width: '100%',
              height: '100%',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              lineHeight: '1.7',
              padding: 24,
              border: 'none',
              outline: 'none',
              resize: 'none',
              backgroundColor: '#FFFFFF',
              color: '#1a1a1a',
              boxSizing: 'border-box',
            } as any}
            spellCheck={false}
          />
        ) : (
          <ScrollView style={{ flex: 1 }}>
            <TextInput
              style={styles.editorInput}
              value={editorContent}
              onChangeText={updateEditor}
              multiline
              textAlignVertical="top"
            />
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 8 },
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
  saveBtnDisabled: { opacity: 0.3 },
  saveBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  editorInput: {
    padding: 24,
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#1a1a1a',
    lineHeight: 22,
  },
});
