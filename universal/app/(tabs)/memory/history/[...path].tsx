/**
 * Memory — per-note git history. Pushed as ``history/[...path]`` onto
 * the Memory Stack. The path is a catch-all so folder segments
 * (``docs/ideas.md``) arrive intact.
 *
 * Reuses the shared ``HistoryList`` body from ``memory/history`` scoped
 * to a single note via ``getVaultHistory(path)``; the header back button
 * pops to the editor for that note.
 */

import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { HistoryList } from '../history';
import { colors, font } from '../../../../theme';

export default function NoteHistoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ path?: string | string[] }>();
  const notePath = Array.isArray(params.path)
    ? params.path.join('/')
    : typeof params.path === 'string'
      ? params.path
      : '';

  const titleFallback = notePath.split('/').pop()?.replace('.md', '') ?? '';

  // Back to the editor for this note. ``router.back()`` would pop this
  // pushed screen cleanly; use it since we arrived here from the editor.
  const back = () => router.back();

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={back} style={styles.backBtn}>
          <View style={styles.backBtnContent}>
            <Feather name="arrow-left" size={14} color={colors.primary} />
            <Text style={styles.backBtnText}>Note</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>History · {titleFallback}</Text>
      </View>
      <HistoryList path={notePath} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  backBtn: { paddingVertical: 4, paddingHorizontal: 6, marginRight: 10 },
  backBtnContent: { flexDirection: 'row', alignItems: 'center' },
  backBtnText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500', marginLeft: 5 },
  title: {
    fontSize: 14, fontWeight: '500', color: colors.text, flex: 1,
    fontFamily: font.display, letterSpacing: -0.2,
  },
});
