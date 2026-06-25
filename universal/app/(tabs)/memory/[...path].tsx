/**
 * Memory — note editor. Pushed as ``[...path]`` onto the Memory Stack.
 *
 * The path is a catch-all so folder segments (``docs/ideas.md``) come
 * through intact. The editor reads ``selectedPath`` from the vault
 * store — we call ``selectNote`` on mount (and whenever the route's
 * path changes) to pull the note.
 *
 * Chrome is the react-navigation header (back + note title) from
 * memory/_layout.tsx; the History / Rename / Edit-Preview / Save controls
 * live in ``headerRight``. The vault's last-save feedback (validation
 * errors / warnings / commit hash) shows in a slim status strip above the
 * body. No inner file-tree sidebar — note navigation is the graph screen.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import Markdown from '../../../components/Markdown';
import { HeaderRight, HeaderIconButton, HeaderAction, useHeaderInset } from '../../../components/screenHeader';
import { useConnection } from '../../../stores/connection';
import { useVault } from '../../../stores/vault';
import { setBaseUrl } from '../../../services/api';
import { colors, font, radius } from '../../../theme';

export default function MemoryNoteScreen() {
  const navigation = useNavigation();
  const headerInset = useHeaderInset();
  const router = useRouter();
  const params = useLocalSearchParams<{ path?: string | string[] }>();
  const notePath = Array.isArray(params.path)
    ? params.path.join('/')
    : typeof params.path === 'string'
      ? params.path
      : '';

  const config = useConnection((s) => s.config);
  const {
    notes, editorContent, editorDirty,
    lastWarnings, lastCommit, lastErrors,
    loadNotes, loadGraph, selectNote, updateEditor, saveNote, moveNote,
  } = useVault();

  const [rawMode, setRawMode] = useState(false);

  // Initial data — same set the graph screen loads, in case the user
  // deep-linked straight to a note.
  useEffect(() => {
    if (config) {
      if (config.sidecarPort) setBaseUrl('127.0.0.1', config.sidecarPort);
      loadNotes();
      loadGraph();
    }
  }, [config]);

  // Load the note into the vault store once per distinct route path —
  // ``selectNote`` also sets the store's ``selectedPath`` so ``saveNote``
  // writes to the right path. We gate on a ref keyed by ``notePath`` rather
  // than reading ``selectedPath`` from the store: ``selectNote`` mutates
  // ``selectedPath`` / ``loading`` / content, so depending on store values
  // here created a setState feedback loop ("Maximum update depth exceeded").
  const requestedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (notePath && requestedPathRef.current !== notePath) {
      requestedPathRef.current = notePath;
      selectNote(notePath);
    }
  }, [notePath, selectNote]);

  // Every new note starts in preview mode.
  useEffect(() => { setRawMode(false); }, [notePath]);

  const handleSave = useCallback(() => {
    saveNote().then(() => loadNotes());
  }, [saveNote, loadNotes]);

  // Ctrl/Cmd+S saves.
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

  // Push the per-note git history screen.
  const openHistory = useCallback(() => {
    router.push({
      pathname: '/(tabs)/memory/history/[...path]',
      params: { path: notePath.split('/') },
    });
  }, [router, notePath]);

  // Rename this note. A bare name keeps the current folder; typing a
  // path moves it. ``moveNote`` rewrites inbound wikilinks server-side;
  // we then ``router.replace`` to the new path so the editor follows.
  const handleRename = useCallback(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/') + 1) : '';
    const current = notePath.split('/').pop() ?? notePath;
    const input = window.prompt('Rename note (name or path):', current);
    if (input == null) return;
    const next = input.trim();
    if (!next || next === current) return;
    const withExt = next.endsWith('.md') ? next : `${next}.md`;
    const target = withExt.includes('/') ? withExt : `${dir}${withExt}`;
    if (target === notePath) return;
    moveNote(notePath, target).then(() => {
      router.replace({
        pathname: '/(tabs)/memory/[...path]',
        params: { path: target.split('/') },
      });
    });
  }, [notePath, moveNote, router]);

  const selectedNote = notes.find((n) => n.path === notePath);
  const titleFallback = notePath.split('/').pop()?.replace('.md', '') ?? '';

  // Note title in the nav header.
  useLayoutEffect(() => {
    navigation.setOptions({ title: selectedNote?.title || titleFallback || 'Note' });
  }, [navigation, selectedNote?.title, titleFallback]);

  // History / Rename / Edit-Preview / Save in the nav header's right slot.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderRight>
          <HeaderIconButton icon="clock" accessibilityLabel="History" onPress={openHistory} />
          {Platform.OS === 'web' && (
            <HeaderIconButton icon="type" accessibilityLabel="Rename" onPress={handleRename} />
          )}
          <HeaderIconButton
            icon={rawMode ? 'eye' : 'edit-3'}
            active={rawMode}
            accessibilityLabel={rawMode ? 'Preview' : 'Edit'}
            onPress={() => setRawMode((v) => !v)}
          />
          {rawMode && (
            <HeaderAction icon="check" label="Save" onPress={handleSave} disabled={!editorDirty} />
          )}
        </HeaderRight>
      ),
    });
    // Depend only on the primitives that change the header's appearance.
    // The handlers (openHistory / handleRename / handleSave) close over
    // ``notePath``; including the callbacks themselves would loop, because
    // ``useRouter()`` hands back a fresh reference each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, rawMode, editorDirty, notePath]);

  const showStatus = lastErrors.length > 0
    || (!editorDirty && (lastWarnings.length > 0 || !!lastCommit));

  return (
    <View style={[styles.editorContainer, { paddingTop: headerInset }]}>
      {showStatus && (
        <View style={styles.statusStrip}>
          {/* The quality gate rejected the last save — the note was NOT
              written. Show why so the user can fix and re-save. */}
          {lastErrors.length > 0 && (
            <View style={styles.errorPill}>
              <Text style={styles.errorPillText} numberOfLines={1}>
                ✕ blocked: {lastErrors.map((e) => e.message).join('; ')}
              </Text>
            </View>
          )}
          {!editorDirty && lastWarnings.length > 0 && (
            <View style={styles.warnPill}>
              <Text style={styles.warnPillText} numberOfLines={1}>
                ⚠ {lastWarnings.length}: {Array.from(new Set(lastWarnings.map((w) => w.rule))).join(', ')}
              </Text>
            </View>
          )}
          {!editorDirty && lastCommit && (
            <View style={styles.commitChip}>
              <Text style={styles.commitChipText}>committed {lastCommit.slice(0, 7)}</Text>
            </View>
          )}
        </View>
      )}

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
  );
}

const styles = StyleSheet.create({
  editorContainer: { flex: 1, flexDirection: 'column', backgroundColor: colors.surface },
  statusStrip: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 24, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  warnPill: {
    maxWidth: 320, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.xs, backgroundColor: colors.errorSoft,
  },
  warnPillText: { fontSize: 10, color: colors.warning, fontFamily: font.mono, fontWeight: '600' },
  errorPill: {
    maxWidth: 480, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.xs, backgroundColor: colors.errorSoft,
    borderWidth: 1, borderColor: colors.errorBorder,
  },
  errorPillText: { fontSize: 10, color: colors.error, fontFamily: font.mono, fontWeight: '700' },
  commitChip: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: radius.xs, backgroundColor: colors.mutedSoft,
  },
  commitChipText: { fontSize: 10, color: colors.textSecondary, fontFamily: font.mono },
  editorInput: { padding: 24, fontFamily: font.mono, fontSize: 13, color: colors.text, lineHeight: 22 },
  previewScroll: { flex: 1, backgroundColor: colors.surface },
  previewContent: { padding: 24, maxWidth: 720, width: '100%', alignSelf: 'center' },
});
