/**
 * MessageList — shared message-display layer.
 *
 * Renders a session's transcript with the same look on both Chat and
 * Voice tabs: user prompts as left-rule quotes, assistant replies as
 * full-width prose, tool calls as inline expandable cards. The status
 * row ("Thinking…") trails the last message while ``isProcessing``.
 *
 * Both screens share this so a stylistic change to message bubbles
 * lands uniformly. Pass ``maxItems`` to compact the view (Voice tab
 * tail-shows the last few turns); omit for the full transcript.
 */

import { memo, useState, useMemo } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Image } from 'react-native';
import type { Attachment, ChatMessage, ToolInfo } from '../../common/types';
import { downloadFile, fileUrl } from '../services/api';
import Markdown from './Markdown';
import { colors, font, radius } from '../theme';

export interface MessageListProps {
  messages: ChatMessage[];
  isProcessing?: boolean;
  statusText?: string;
  /** Slice the tail when set (Voice tab uses ~6). Omit for full history. */
  maxItems?: number;
  /** Fired by the per-bubble Regenerate button on the last (non-streaming)
   *  assistant message. Omit to hide the button entirely. */
  onRegenerate?: () => void;
  /** Fired by the per-bubble Edit button on a user message. Omit to hide. */
  onEditUser?: (msgId: string, newText: string) => void;
}

export default function MessageList({
  messages, isProcessing, statusText, maxItems, onRegenerate, onEditUser,
}: MessageListProps) {
  const visible = maxItems != null ? messages.slice(-maxItems) : messages;
  // Identify the last assistant message — Regenerate only attaches to
  // it, not to every assistant bubble in the transcript.
  const lastAssistantId = (() => {
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const m = visible[i];
      if (m.role === 'assistant' && !m.streaming) return m.id;
    }
    return null;
  })();
  return (
    <>
      {visible.map((msg) => (
        msg.role === 'tool' ? (
          <ToolCard key={msg.id} toolInfo={msg.toolInfo} fallbackText={msg.text} />
        ) : msg.role === 'user' ? (
          <UserMessage
            key={msg.id} id={msg.id} text={msg.text} attachments={msg.attachments}
            onEdit={onEditUser}
          />
        ) : (
          <AssistantMessage
            key={msg.id} text={msg.text} model={msg.model} attachments={msg.attachments}
            streaming={msg.streaming}
            onRegenerate={msg.id === lastAssistantId && !isProcessing ? onRegenerate : undefined}
          />
        )
      ))}
      {isProcessing && (
        <View style={styles.statusRow}>
          <View
            style={styles.statusDot}
            // @ts-ignore — web-only className for the pulse keyframe
            {...(Platform.OS === 'web' ? { className: 'oa-pulse' } : {})}
          />
          <Text style={styles.statusText}>{statusText || 'Thinking'}</Text>
        </View>
      )}
    </>
  );
}

// ── Atoms ────────────────────────────────────────────────────────────

const UserMessage = memo(function UserMessage({
  id, text, attachments, onEdit,
}: {
  id: string;
  text: string;
  attachments?: Attachment[];
  onEdit?: (id: string, newText: string) => void;
}) {
  const inlineImages = attachments?.filter((a) => a.type === 'image') ?? [];
  const otherAttach = attachments?.filter((a) => a.type !== 'image') ?? [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  return (
    <View
      style={styles.userBlock}
      // @ts-ignore
      {...(Platform.OS === 'web' ? { className: 'oa-fade-in oa-row-hover' } : {})}
    >
      <View style={styles.userRule} />
      <View style={styles.userBody}>
        <View style={styles.userHead}>
          <Text style={styles.userLabel}>You</Text>
          {!editing && (
            <View style={styles.msgActions}>
              <CopyButton text={text} />
              {onEdit && (
                <TouchableOpacity
                  style={styles.msgActionBtn}
                  onPress={() => { setDraft(text); setEditing(true); }}
                  accessibilityLabel="Edit message"
                >
                  <Feather name="edit-2" size={11} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        {editing ? (
          <>
            <View style={styles.editBox}>
              <Text
                // @ts-ignore — pass-through to underlying div as a textarea wrapper
                style={styles.editPlaceholder}
              >
                {Platform.OS === 'web' ? (
                  // @ts-ignore — RNW lets us drop in a real textarea inline
                  <textarea
                    value={draft}
                    onChange={(e: any) => setDraft(e.target.value)}
                    rows={Math.max(2, draft.split('\n').length)}
                    autoFocus
                    style={{
                      width: '100%', background: 'transparent', border: 'none',
                      color: colors.text, fontSize: 14, lineHeight: 1.5,
                      fontFamily: font.sans, padding: 0, resize: 'vertical',
                      outline: 'none', minHeight: 60,
                    } as any}
                  />
                ) : draft}
              </Text>
            </View>
            <View style={styles.editActionsRow}>
              <TouchableOpacity
                style={styles.editCancelBtn}
                onPress={() => { setEditing(false); setDraft(text); }}
              >
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editSendBtn}
                onPress={() => {
                  const trimmed = draft.trim();
                  if (!trimmed) return;
                  setEditing(false);
                  onEdit?.(id, trimmed);
                }}
              >
                <Text style={styles.editSendText}>Send</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          text ? <Text style={styles.userText} selectable>{text}</Text> : null
        )}
        {!editing && inlineImages.map((att, i) => (
          <InlineImage key={`img-${att.path}-${i}`} attachment={att} />
        ))}
        {!editing && otherAttach.length > 0 && (
          <View style={styles.attachmentsRow}>
            {otherAttach.map((att, i) => (
              <AttachmentView key={`${att.path}-${i}`} attachment={att} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
});

const AssistantMessage = memo(function AssistantMessage({
  text, model, attachments, streaming, onRegenerate,
}: {
  text: string;
  model?: string;
  attachments?: Attachment[];
  streaming?: boolean;
  onRegenerate?: () => void;
}) {
  const inlineImages = attachments?.filter((a) => a.type === 'image') ?? [];
  const otherAttach = attachments?.filter((a) => a.type !== 'image') ?? [];
  return (
    <View
      style={styles.assistantBlock}
      // @ts-ignore
      {...(Platform.OS === 'web' ? { className: 'oa-fade-in oa-row-hover' } : {})}
    >
      <View style={styles.assistantHead}>
        <View style={styles.assistantDot} />
        <Text style={styles.assistantLabel}>OpenAgent</Text>
        {model && <Text style={styles.modelText}>· {model}</Text>}
        {!streaming && (
          <View style={styles.msgActions}>
            <CopyButton text={text} />
            {onRegenerate && (
              <TouchableOpacity
                style={styles.msgActionBtn}
                onPress={onRegenerate}
                accessibilityLabel="Regenerate response"
              >
                <Feather name="refresh-cw" size={11} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
      <View style={styles.assistantBody}>
        <Markdown text={text} streaming={streaming} />
        {inlineImages.map((att, i) => (
          <InlineImage key={`img-${att.path}-${i}`} attachment={att} downloadable />
        ))}
        {otherAttach.length > 0 && (
          <View style={styles.attachmentsRow}>
            {otherAttach.map((att, i) => (
              <AttachmentView key={`${att.path}-${i}`} attachment={att} downloadable />
            ))}
          </View>
        )}
      </View>
    </View>
  );
});

// Generic copy-to-clipboard button used by both user + assistant headers.
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };
  return (
    <TouchableOpacity
      style={styles.msgActionBtn}
      onPress={doCopy}
      accessibilityLabel={copied ? 'Copied' : 'Copy message'}
    >
      <Feather
        name={copied ? 'check' : 'copy'}
        size={11}
        color={copied ? colors.success : colors.textMuted}
      />
    </TouchableOpacity>
  );
}

function InlineImage({
  attachment, downloadable = false,
}: { attachment: Attachment; downloadable?: boolean }) {
  const src = fileUrl(attachment.path);
  const image = (
    <Image
      source={{ uri: src }}
      style={styles.inlineImage}
      resizeMode="contain"
    />
  );
  if (!downloadable) return <View style={styles.imageContainer}>{image}</View>;
  return (
    <TouchableOpacity
      style={styles.imageContainer}
      onPress={async () => {
        try { await downloadFile(attachment.path, attachment.filename); } catch (e) { console.error('Download failed:', e); }
      }}
    >
      {image}
    </TouchableOpacity>
  );
}

function AttachmentView({
  attachment, downloadable = false,
}: { attachment: Attachment; downloadable?: boolean }) {
  const iconName = attachment.type === 'image'
    ? 'image'
    : attachment.type === 'voice'
      ? 'mic'
      : attachment.type === 'video'
        ? 'film'
        : 'file';
  const chipInner = (
    <>
      <Feather name={iconName as any} size={11} color={colors.textSecondary} />
      <Text style={styles.attachmentText} numberOfLines={1}>
        {attachment.filename}
      </Text>
      {downloadable ? <Feather name="download" size={10} color={colors.primary} /> : null}
    </>
  );
  if (!downloadable) {
    return <View style={styles.attachmentChip}>{chipInner}</View>;
  }
  return (
    <TouchableOpacity
      style={styles.attachmentChip}
      onPress={async () => {
        try {
          await downloadFile(attachment.path, attachment.filename);
        } catch (e) {
          console.error('Download failed:', e);
        }
      }}
    >
      {chipInner}
    </TouchableOpacity>
  );
}

const ToolCard = memo(function ToolCard({
  toolInfo, fallbackText,
}: { toolInfo?: ToolInfo; fallbackText: string }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = useMemo<ToolInfo | undefined>(() => {
    if (toolInfo) return toolInfo;
    try {
      const j = JSON.parse(fallbackText);
      if (j && j.tool) return j as ToolInfo;
    } catch { /* not JSON */ }
    return undefined;
  }, [toolInfo, fallbackText]);

  const info = parsed;

  if (!info) {
    return (
      <View style={styles.toolRow}>
        <View style={styles.toolIndicator} />
        <Feather name="tool" size={10} color={colors.textMuted} />
        <Text style={styles.toolRowText}>{fallbackText}</Text>
      </View>
    );
  }

  const isRunning = info.status === 'running';
  const isError = info.status === 'error';
  const statusColor = isError ? colors.error : isRunning ? colors.warning : colors.success;
  const statusLabel = isRunning ? 'running' : isError ? 'error' : 'done';

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => setExpanded(!expanded)}
      style={[styles.toolCard, isError && styles.toolCardError]}
      // @ts-ignore
      {...(Platform.OS === 'web' ? { className: 'oa-fade-in' } : {})}
    >
      <View style={styles.toolCardHeader}>
        <View style={[styles.toolStatusDot, { backgroundColor: statusColor }]} />
        <Feather name="tool" size={11} color={colors.textMuted} />
        <Text style={styles.toolCardName}>{info.tool}</Text>
        <Text style={[styles.toolStatusText, { color: statusColor }]}>{statusLabel}</Text>
        <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={colors.textMuted} />
      </View>

      {expanded && (
        <View style={styles.toolCardBody}>
          {info.params && Object.keys(info.params).length > 0 && (
            <>
              <Text style={styles.toolSectionTitle}>Parameters</Text>
              <View style={styles.toolCodeBlock}>
                {Object.entries(info.params).map(([k, v]) => (
                  <Text key={k} style={styles.toolCodeText}>
                    <Text style={{ color: colors.primary }}>{k}</Text>
                    <Text style={{ color: colors.textMuted }}>: </Text>
                    {typeof v === 'string' ? v : JSON.stringify(v)}
                  </Text>
                ))}
              </View>
            </>
          )}
          {info.result && (
            <>
              <Text style={styles.toolSectionTitle}>Result</Text>
              <View style={styles.toolCodeBlock}>
                <Text style={styles.toolCodeText} numberOfLines={10}>
                  {typeof info.result === 'string' ? info.result : JSON.stringify(info.result)}
                </Text>
              </View>
            </>
          )}
          {info.error && (
            <>
              <Text style={[styles.toolSectionTitle, { color: colors.error }]}>Error</Text>
              <View style={[styles.toolCodeBlock, { borderColor: colors.errorBorder }]}>
                <Text style={[styles.toolCodeText, { color: colors.error }]}>
                  {typeof info.error === 'string' ? info.error : JSON.stringify(info.error)}
                </Text>
              </View>
            </>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  // User
  userBlock: {
    flexDirection: 'row', alignItems: 'stretch',
    paddingVertical: 10, paddingLeft: 2,
  },
  userRule: {
    width: 2, backgroundColor: colors.primary,
    borderRadius: 1, marginRight: 12,
    opacity: 0.7,
  },
  userBody: { flex: 1, paddingVertical: 2 },
  userHead: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 4,
  },
  userLabel: {
    flex: 1,
    fontSize: 10, fontWeight: '600', color: colors.primary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  userText: {
    fontSize: 14, lineHeight: 22, color: colors.text,
    fontWeight: '400',
  },

  // Hover action buttons (Copy / Edit / Regenerate) — appear in the
  // message header. Web-only hover-reveal is layered on via the
  // ``.oa-row-hover`` global class (see theme.ts).
  msgActions: {
    flexDirection: 'row', gap: 2, marginLeft: 'auto',
    // @ts-ignore — web-only opacity for hover-reveal; native always-shown
    ...(Platform.OS === 'web' ? { opacity: 0, transition: 'opacity 0.16s' as any } : {}),
  },
  msgActionBtn: {
    width: 22, height: 22, borderRadius: radius.xs,
    alignItems: 'center', justifyContent: 'center',
  },

  // Inline-edit affordance on user messages.
  editBox: {
    borderWidth: 1, borderColor: colors.primary,
    backgroundColor: colors.surface,
    borderRadius: radius.sm, padding: 10,
    marginBottom: 8,
  },
  editPlaceholder: { color: colors.text, fontSize: 14 },
  editActionsRow: {
    flexDirection: 'row', gap: 8, justifyContent: 'flex-end',
    marginBottom: 6,
  },
  editCancelBtn: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: radius.sm,
  },
  editCancelText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  editSendBtn: {
    paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.text,
  },
  editSendText: { fontSize: 12, color: colors.textInverse, fontWeight: '600' },

  // Assistant
  assistantBlock: { paddingVertical: 10 },
  assistantHead: {
    flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6,
  },
  assistantDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.primary,
    marginRight: 8,
    // @ts-ignore web: gradient background
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(135deg, #d94841, #f3a33a)' } : {}),
  },
  assistantLabel: {
    fontSize: 10, fontWeight: '600', color: colors.text,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  modelText: {
    fontSize: 10, color: colors.textMuted, marginLeft: 4,
    fontFamily: font.mono,
  },
  assistantBody: {},

  // Status row ("Thinking…")
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10,
  },
  statusDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.primary,
  },
  statusText: {
    color: colors.textMuted, fontSize: 13, fontStyle: 'italic',
    fontFamily: font.mono,
  },

  // Tool rows + cards
  toolRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 6, paddingHorizontal: 10,
    marginVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderLight,
  },
  toolIndicator: {
    width: 3, height: 14, borderRadius: 1,
    backgroundColor: colors.primary, opacity: 0.5,
  },
  toolRowText: {
    fontSize: 12, color: colors.textSecondary, flex: 1,
    fontFamily: font.mono,
  },
  toolCard: {
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderLight,
    marginVertical: 4, overflow: 'hidden',
  },
  toolCardError: { borderColor: colors.errorBorder },
  toolCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  toolStatusDot: { width: 6, height: 6, borderRadius: 3 },
  toolCardName: {
    fontSize: 12, fontWeight: '500', color: colors.text, flex: 1,
    fontFamily: font.mono,
  },
  toolStatusText: {
    fontSize: 10, fontWeight: '500', letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  toolCardBody: {
    paddingHorizontal: 12, paddingBottom: 10, paddingTop: 2,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  toolSectionTitle: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    marginTop: 8, marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  toolCodeBlock: {
    backgroundColor: colors.codeBg, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.codeBorder,
    padding: 8,
  },
  toolCodeText: {
    fontSize: 11, color: colors.codeText,
    fontFamily: font.mono, lineHeight: 16,
  },

  // Attachments
  attachmentsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  attachmentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: colors.border,
    maxWidth: 220,
  },
  attachmentText: {
    color: colors.textSecondary, fontSize: 11, fontWeight: '500',
    flexShrink: 1,
  },

  // Inline images
  imageContainer: { marginTop: 8, marginBottom: 8 },
  inlineImage: {
    width: '100%',
    maxWidth: 480,
    height: 280,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.codeBg,
  },
});
