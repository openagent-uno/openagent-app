/**
 * MessageComposer — shared chat input bar.
 *
 * Same composer is used by the Chat tab (text + file attach + Telegram-
 * style mic record + send) and the Voice tab (text + send only — the
 * always-listening mic loop is the room's input model). Buttons appear
 * only when their handlers are passed, so the same component renders
 * the right surface in both screens without flag plumbing.
 *
 * Web uses a native ``<textarea>`` for autogrowing input + Enter-to-send;
 * native RN falls back to a ``<TextInput multiline>``.
 */

import { useCallback } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { colors, font, radius } from '../theme';

export interface PendingFile {
  filename: string;
  remotePath: string;
  kind: 'image' | 'file';
}

export interface MessageComposerProps {
  input: string;
  onInputChange: (v: string) => void;
  pendingFiles?: PendingFile[];
  onRemoveFile?: (idx: number) => void;
  onPickFile?: () => void;             // omit → no paperclip button
  onSend: () => void;
  disabled?: boolean;                  // disables send (e.g. session.isProcessing)
  recording?: boolean;                 // omit → no mic button
  onStartRecord?: () => void;
  onStopRecord?: () => void;
  placeholder?: string;
  showHint?: boolean;                  // default true (Enter / Shift+Enter)
}

export default function MessageComposer({
  input,
  onInputChange,
  pendingFiles,
  onRemoveFile,
  onPickFile,
  onSend,
  disabled,
  recording,
  onStartRecord,
  onStopRecord,
  placeholder = 'Message OpenAgent...',
  showHint = true,
}: MessageComposerProps) {
  const handleKeyDown = useCallback((e: any) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  const showMic = recording !== undefined && Platform.OS === 'web';
  const files = pendingFiles ?? [];
  const canSend = (input.trim().length > 0 || files.length > 0) && !disabled;

  return (
    <View style={styles.composerWrap}>
      <View style={styles.composer}>
        {files.length > 0 && (
          <View style={styles.pendingList}>
            {files.map((f, idx) => (
              <View key={`${f.remotePath}-${idx}`} style={styles.pendingChip}>
                <Feather name="paperclip" size={10} color={colors.textSecondary} />
                <Text style={styles.pendingText} numberOfLines={1}>{f.filename}</Text>
                {onRemoveFile && (
                  <TouchableOpacity onPress={() => onRemoveFile(idx)}>
                    <Feather name="x" size={11} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={styles.inputRow}>
          {Platform.OS === 'web' ? (
            <textarea
              value={input}
              onChange={(e: any) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={1}
              style={{
                flex: 1, background: 'transparent', border: 'none',
                paddingLeft: 0, paddingRight: 0, paddingTop: 6, paddingBottom: 6,
                color: colors.text, fontSize: 14, lineHeight: 1.5,
                fontFamily: font.sans,
                maxHeight: 140, resize: 'none', outline: 'none',
              } as any}
            />
          ) : (
            <TextInput
              style={styles.textInput}
              value={input} onChangeText={onInputChange}
              placeholder={placeholder} placeholderTextColor={colors.textMuted}
              onSubmitEditing={onSend} returnKeyType="send" multiline
            />
          )}
        </View>

        <View style={styles.composerActions}>
          <View style={styles.composerLeft}>
            {onPickFile && (
              <TouchableOpacity style={styles.iconBtn} onPress={onPickFile}>
                <Feather name="paperclip" size={13} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
            {showMic && (
              <TouchableOpacity
                style={[styles.iconBtn, recording && styles.iconBtnActive]}
                onPress={recording ? onStopRecord : onStartRecord}
              >
                <Feather
                  name={recording ? 'stop-circle' : 'mic'}
                  size={13}
                  color={recording ? colors.textInverse : colors.textSecondary}
                />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            onPress={onSend}
            disabled={!canSend}
          >
            <Feather name="arrow-up" size={13} color={colors.textInverse} />
          </TouchableOpacity>
        </View>
      </View>
      {showHint && (
        <Text style={styles.composerHint}>
          <Text style={styles.kbd}>Enter</Text> to send · <Text style={styles.kbd}>Shift+Enter</Text> for newline
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  composerWrap: {
    paddingHorizontal: 20, paddingBottom: 12, paddingTop: 4,
    backgroundColor: colors.bg,
  },
  composer: {
    maxWidth: 760, width: '100%', alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 2,
    elevation: 1,
  },
  pendingList: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 5,
    marginBottom: 8,
  },
  pendingChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.sidebar,
    borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: colors.borderLight,
    maxWidth: 220,
  },
  pendingText: {
    fontSize: 11, color: colors.textSecondary, fontWeight: '500',
    flexShrink: 1,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 4,
  },
  textInput: {
    flex: 1, color: colors.text, fontSize: 14,
    paddingVertical: 6, paddingHorizontal: 0,
    maxHeight: 140,
  },
  composerActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 4,
  },
  composerLeft: { flexDirection: 'row', gap: 2 },
  iconBtn: {
    width: 28, height: 28, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: colors.primary },
  sendBtn: {
    width: 28, height: 28, borderRadius: radius.sm,
    backgroundColor: colors.text,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.25 },
  composerHint: {
    fontSize: 10, color: colors.textMuted,
    textAlign: 'center', marginTop: 6,
    fontFamily: font.mono,
  },
  kbd: {
    fontSize: 10, color: colors.textSecondary,
    fontFamily: font.mono, fontWeight: '500',
  },
});
