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
import {
  toolPhase,
  runLaunchTarget,
  effectiveTool,
  isDelegationTool,
  delegationTitle,
  delegationLabel,
  toolDisplay,
  memoryTarget,
  type Attachment,
  type ChatMessage,
  type MessageAuthor,
  type MemoryTarget,
  type RunLaunchTarget,
  type ToolInfo,
} from '../../common/types';
import { downloadFile, fileUrl } from '../services/api';
import Markdown from './Markdown';
import DelegationCard from './DelegationCard';
import RunLaunchCard from './RunLaunchCard';
import ReasoningIndicator from './ReasoningIndicator';
import { colors, font, radius } from '../theme';

// How many trailing messages to render before "Load earlier". Caps the
// DOM + per-delta reconciliation on long transcripts to a fixed window.
const TRANSCRIPT_WINDOW = 60;

export interface MessageListProps {
  messages: ChatMessage[];
  isProcessing?: boolean;
  statusText?: string;
  /** When true, the status row shows the animated <ReasoningIndicator/>
   *  instead of the static status dot + text. Driven by the session's
   *  ``isReasoning`` flag (the transient ``reasoning`` wire frame). */
  isReasoning?: boolean;
  /** Slice the tail when set (Voice tab uses ~6). Omit for full history. */
  maxItems?: number;
  /** Fired by the per-bubble Regenerate button on the last (non-streaming)
   *  assistant message. Omit to hide the button entirely. */
  onRegenerate?: () => void;
  /** Fired by the per-bubble Edit button on a user message. Omit to hide. */
  onEditUser?: (msgId: string, newText: string) => void;
  /** Fired when a delegation card is pressed — navigates into the child
   *  session. Omit to render delegation cards as non-clickable. */
  onOpenChild?: (childSessionId: string, meta?: { title?: string; model?: string }) => void;
  /** Fired when a run-launch card (scheduled task / workflow run) is pressed —
   *  opens that run's execution screen. Omit to render such cards as
   *  non-clickable. */
  onOpenRun?: (target: RunLaunchTarget) => void;
  /** Fired when a memory-vault tool chip's "open" link is pressed — deep-links
   *  into the Memory tab (a single note's markdown screen, or the graph). Omit
   *  to render memory chips without the link affordance. */
  onOpenMemory?: (target: MemoryTarget) => void;
  /** The current user's handle/display, used as the fallback "You" label
   *  when a user message carries no explicit author. */
  currentUserHandle?: string;
}

function MessageListBase({
  messages, isProcessing, statusText, isReasoning, maxItems, onRegenerate, onEditUser,
  onOpenChild, onOpenRun, onOpenMemory, currentUserHandle,
}: MessageListProps) {
  // Windowing: render only the last `shown` messages. With bottom-pinned
  // scroll the tail is what the user sees; a long transcript otherwise
  // materializes thousands of deeply-nested DOM nodes and re-maps + diffs
  // ALL of them on every streaming delta. "Load earlier" widens the
  // window. The Voice tab passes maxItems and keeps its own tail-slice.
  const [shown, setShown] = useState(TRANSCRIPT_WINDOW);
  const capped = maxItems != null;
  const visible = useMemo(
    () => (capped
      ? messages.slice(-maxItems!)
      : (shown >= messages.length ? messages : messages.slice(-shown))),
    [messages, capped, maxItems, shown],
  );
  const hiddenCount = capped ? 0 : Math.max(0, messages.length - visible.length);
  // Identify the last assistant message — Regenerate only attaches to
  // it, not to every assistant bubble in the transcript.
  const lastAssistantId = useMemo(() => {
    for (let i = visible.length - 1; i >= 0; i -= 1) {
      const m = visible[i];
      if (m.role === 'assistant' && !m.streaming) return m.id;
    }
    return null;
  }, [visible]);
  const renderMessage = (msg: ChatMessage) => {
    if (msg.role === 'tool') {
      // A delegation renders as a card (deep-links into the sub-agent's
      // child session, OpenCode-style) instead of an inline tool chip —
      // even while it's still RUNNING (the card is non-clickable until the
      // child_session_id arrives at completion), so the parent never shows
      // the raw delegate-tool prompt or the sub-agent's own work inline.
      if (isDelegationTool(msg.toolInfo)) {
        const eff = effectiveTool(msg.toolInfo)!;
        return (
          <DelegationCard
            key={msg.id}
            childSessionId={eff.child_session_id}
            title={delegationTitle(msg.toolInfo)}
            model={eff.child_model}
            label={delegationLabel(msg.toolInfo)}
            phase={toolPhase(msg.toolInfo!)}
            onOpen={onOpenChild}
          />
        );
      }
      // A run-now of a scheduled task / workflow renders as a card that
      // deep-links into that run's execution screen (not an inline tool chip).
      const runTarget = runLaunchTarget(msg.toolInfo);
      if (runTarget) {
        return <RunLaunchCard key={msg.id} target={runTarget} onOpen={onOpenRun} />;
      }
      return (
        <ToolCard
          key={msg.id}
          toolInfo={msg.toolInfo}
          fallbackText={msg.text}
          onOpenMemory={onOpenMemory}
        />
      );
    }
    if (msg.role === 'user') {
      // An agent-self seed (a delegated task / scheduled mission / workflow
      // node prompt the agent gave itself) renders as a Mission block,
      // not a "You" bubble.
      if (msg.author?.kind === 'agent') {
        return <SelfPromptBlock key={msg.id} text={msg.text} label={msg.author.display} />;
      }
      return (
        <UserMessage
          key={msg.id} id={msg.id} text={msg.text} attachments={msg.attachments}
          author={msg.author} fallbackLabel={currentUserHandle}
          onEdit={onEditUser}
        />
      );
    }
    return (
      <AssistantMessage
        key={msg.id} text={msg.text} model={msg.model} attachments={msg.attachments}
        streaming={msg.streaming} author={msg.author}
        onRegenerate={msg.id === lastAssistantId && !isProcessing ? onRegenerate : undefined}
      />
    );
  };
  return (
    <>
      {hiddenCount > 0 && (
        <TouchableOpacity
          style={styles.loadEarlier}
          onPress={() => setShown((n) => n + TRANSCRIPT_WINDOW)}
          accessibilityLabel="Load earlier messages"
          // @ts-ignore — web hover/press affordance
          {...(Platform.OS === 'web' ? { className: 'oa-side-row oa-press' } : {})}
        >
          <Feather name="chevron-up" size={12} color={colors.textMuted} />
          <Text style={styles.loadEarlierText}>Load earlier ({hiddenCount})</Text>
        </TouchableOpacity>
      )}
      {visible.map(renderMessage)}
      {(isProcessing || isReasoning) && (() => {
        // The animated indicator is the DEFAULT "agent is working" state —
        // shown whenever we're processing without a specific tool line to
        // display (the generic "Thinking…" placeholder). It does NOT depend
        // on the server's ``reasoning`` frame (older/remote agents don't
        // send it); that frame just reinforces ``isReasoning``. Only a real
        // tool-status line (e.g. "Using bash…") falls through to the text row.
        const isGenericThinking = !statusText || /^thinking/i.test(statusText.trim());
        const showIndicator = isReasoning || isGenericThinking;
        return (
          <View style={styles.statusRow}>
            {showIndicator ? (
              <ReasoningIndicator />
            ) : (
              <>
                <View
                  style={styles.statusDot}
                  // @ts-ignore — web-only className for the pulse keyframe
                  {...(Platform.OS === 'web' ? { className: 'oa-pulse' } : {})}
                />
                <Text style={styles.statusText}>{statusText}</Text>
              </>
            )}
          </View>
        );
      })()}
    </>
  );
}

// Memoized so a parent re-render (e.g. chat.tsx re-rendering for an
// unrelated reason) doesn't re-map the transcript unless `messages` (or
// another prop) actually changed.
const MessageList = memo(MessageListBase);
export default MessageList;

// ── Atoms ────────────────────────────────────────────────────────────

const UserMessage = memo(function UserMessage({
  id, text, attachments, author, fallbackLabel, onEdit,
}: {
  id: string;
  text: string;
  attachments?: Attachment[];
  author?: MessageAuthor;
  fallbackLabel?: string;
  onEdit?: (id: string, newText: string) => void;
}) {
  const label = author?.display || author?.handle || fallbackLabel || 'You';
  const inlineImages = attachments?.filter((a) => a.type === 'image') ?? [];
  const otherAttach = attachments?.filter((a) => a.type !== 'image') ?? [];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  return (
    <View
      style={styles.userBlock}
      // @ts-ignore
      {...(Platform.OS === 'web' ? { className: 'oa-msg-in oa-row-hover' } : {})}
    >
      <View style={styles.userRule} />
      <View style={styles.userBody}>
        <View style={styles.userHead}>
          <Text style={styles.userLabel}>{label}</Text>
          {!editing && (
            <View style={styles.msgActions}>
              <CopyButton text={text} />
              {onEdit && (
                <TouchableOpacity
                  style={styles.msgActionBtn}
                  // @ts-ignore — web hover/press affordance
                  {...(Platform.OS === 'web' ? { className: 'oa-icon-btn' } : {})}
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
                // @ts-ignore — web press affordance
                {...(Platform.OS === 'web' ? { className: 'oa-press' } : {})}
                onPress={() => { setEditing(false); setDraft(text); }}
              >
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editSendBtn}
                // @ts-ignore — web press affordance
                {...(Platform.OS === 'web' ? { className: 'oa-press' } : {})}
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
  text, model, attachments, streaming, author, onRegenerate,
}: {
  text: string;
  model?: string;
  attachments?: Attachment[];
  streaming?: boolean;
  author?: MessageAuthor;
  onRegenerate?: () => void;
}) {
  const label = author?.display || 'OpenAgent';
  const inlineImages = attachments?.filter((a) => a.type === 'image') ?? [];
  const otherAttach = attachments?.filter((a) => a.type !== 'image') ?? [];
  return (
    <View
      style={styles.assistantBlock}
      // @ts-ignore
      {...(Platform.OS === 'web' ? { className: 'oa-msg-in oa-row-hover' } : {})}
    >
      <View style={styles.assistantHead}>
        <View style={styles.assistantDot} />
        <Text style={styles.assistantLabel}>{label}</Text>
        {model && <Text style={styles.modelText}>· {model}</Text>}
        {!streaming && (
          <View style={styles.msgActions}>
            <CopyButton text={text} />
            {onRegenerate && (
              <TouchableOpacity
                style={styles.msgActionBtn}
                // @ts-ignore — web hover/press affordance
                {...(Platform.OS === 'web' ? { className: 'oa-icon-btn' } : {})}
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
      // @ts-ignore — web hover/press affordance
      {...(Platform.OS === 'web' ? { className: 'oa-icon-btn' } : {})}
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

// The agent-authored seed of a child session — the task/mission/role prompt
// the agent gave itself. Rendered distinctly so it reads as "the agent set
// itself this task", not as a human "You" message.
const SelfPromptBlock = memo(function SelfPromptBlock({
  text, label,
}: { text: string; label?: string }) {
  return (
    <View
      style={styles.selfPromptBlock}
      // @ts-ignore
      {...(Platform.OS === 'web' ? { className: 'oa-msg-in' } : {})}
    >
      <View style={styles.selfPromptRule} />
      <View style={styles.userBody}>
        <View style={styles.userHead}>
          <Feather name="target" size={11} color={colors.accent} />
          <Text style={styles.selfPromptLabel}>{(label || 'Mission').toUpperCase()}</Text>
        </View>
        <Markdown text={text} />
      </View>
    </View>
  );
});

const ToolCard = memo(function ToolCard({
  toolInfo, fallbackText, onOpenMemory,
}: {
  toolInfo?: ToolInfo;
  fallbackText: string;
  onOpenMemory?: (target: MemoryTarget) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const parsed = useMemo<ToolInfo | undefined>(() => {
    if (toolInfo) return toolInfo;
    try {
      const j = JSON.parse(fallbackText);
      if (j && j.tool_name) return j as ToolInfo;
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

  // Phase derived locally from the wire tool-execution fields.
  // ``tool_call_error`` takes precedence; otherwise a populated
  // ``result`` flips us to "completed" and bare frames render as
  // "running".
  const phase = toolPhase(info);
  const isRunning = phase === 'running';
  const isError = phase === 'error';
  const statusColor = isError ? colors.error : isRunning ? colors.warning : colors.success;
  const statusLabel = isRunning ? 'running' : isError ? 'error' : 'done';
  // On error frames the message rides in ``result`` (the durable
  // carrier — stored ToolExecution rows don't keep the error text).
  const errorText = isError && typeof info.result === 'string'
    ? info.result
    : undefined;

  // Friendly, user-facing label/icon — the raw tool name + args remain in the
  // expanded body for debugging. Memory-vault ops additionally deep-link into
  // the Memory tab via the "open" affordance.
  const display = toolDisplay(info);
  const memTarget = display.isMemory ? memoryTarget(info) : undefined;
  const canOpenMemory = !!(memTarget && onOpenMemory);
  // The real tool the chip stands for (unwrapped from the dispatcher) — shown
  // in the debug body so the friendly title never hides what actually ran.
  const eff = effectiveTool(info);
  const rawName = eff?.tool_name || info.tool_name;
  const dispatched = info.tool_name === 'tool_search_call_tool';

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => setExpanded(!expanded)}
      style={[
        styles.toolCard,
        display.isMemory && styles.toolCardMemory,
        isError && styles.toolCardError,
      ]}
      // @ts-ignore
      {...(Platform.OS === 'web' ? { className: 'oa-msg-in oa-card-hover' } : {})}
    >
      <View style={styles.toolCardHeader}>
        <View style={[styles.toolStatusDot, { backgroundColor: statusColor }]} />
        <Feather
          name={display.icon as any}
          size={12}
          color={display.isMemory ? colors.accent : colors.textMuted}
        />
        <View style={styles.toolCardTitleWrap}>
          <Text style={styles.toolCardName} numberOfLines={1}>
            {display.title}
            {display.detail ? (
              <Text style={styles.toolCardDetail}>{`  ${display.detail}`}</Text>
            ) : null}
          </Text>
        </View>
        {canOpenMemory && (
          <TouchableOpacity
            // Separate touch target so opening the note doesn't also toggle the
            // debug body. Stop propagation on web; RN's onPress doesn't bubble.
            onPress={(e) => {
              // @ts-ignore — web SyntheticEvent
              e?.stopPropagation?.();
              onOpenMemory!(memTarget!);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.toolOpenLink}
            accessibilityRole="link"
            accessibilityLabel={
              memTarget!.kind === 'note'
                ? `Open ${memTarget!.title} in Memory`
                : 'Open Memory'
            }
            // @ts-ignore — web hover affordance
            {...(Platform.OS === 'web' ? { className: 'oa-press' } : {})}
          >
            <Feather name="external-link" size={11} color={colors.accent} />
            <Text style={styles.toolOpenLinkText}>Open</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.toolStatusText, { color: statusColor }]}>{statusLabel}</Text>
        <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={colors.textMuted} />
      </View>

      {expanded && (
        <View style={styles.toolCardBody}>
          <Text style={styles.toolSectionTitle}>Tool</Text>
          <View style={styles.toolCodeBlock}>
            <Text style={styles.toolCodeText}>
              <Text style={{ color: colors.primary }}>{rawName}</Text>
              {dispatched && (
                <Text style={{ color: colors.textMuted }}>
                  {`  (via tool_search_call_tool${eff?.server ? ` → ${eff.server}` : ''})`}
                </Text>
              )}
            </Text>
          </View>
          {info.tool_args && Object.keys(info.tool_args).length > 0 && (
            <>
              <Text style={styles.toolSectionTitle}>Parameters</Text>
              <View style={styles.toolCodeBlock}>
                {Object.entries(info.tool_args).map(([k, v]) => (
                  <Text key={k} style={styles.toolCodeText}>
                    <Text style={{ color: colors.primary }}>{k}</Text>
                    <Text style={{ color: colors.textMuted }}>: </Text>
                    {typeof v === 'string' ? v : JSON.stringify(v)}
                  </Text>
                ))}
              </View>
            </>
          )}
          {!isError && info.result != null && (
            <>
              <Text style={styles.toolSectionTitle}>Result</Text>
              <View style={styles.toolCodeBlock}>
                <Text style={styles.toolCodeText} numberOfLines={10}>
                  {typeof info.result === 'string' ? info.result : JSON.stringify(info.result)}
                </Text>
              </View>
            </>
          )}
          {errorText && (
            <>
              <Text style={[styles.toolSectionTitle, { color: colors.error }]}>Error</Text>
              <View style={[styles.toolCodeBlock, { borderColor: colors.errorBorder }]}>
                <Text style={[styles.toolCodeText, { color: colors.error }]}>
                  {errorText}
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
  // "Load earlier" — widens the rendered transcript window.
  loadEarlier: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 8, marginVertical: 4, alignSelf: 'center',
    paddingHorizontal: 12, borderRadius: radius.sm,
  },
  loadEarlierText: {
    fontSize: 11, color: colors.textMuted, fontFamily: font.mono,
  },
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

  // Agent-self seed prompt (Mission / Role / Task) — an accent-ruled quote.
  selfPromptBlock: {
    flexDirection: 'row', alignItems: 'stretch',
    paddingVertical: 10, paddingLeft: 2,
  },
  selfPromptRule: {
    width: 2, backgroundColor: colors.accent,
    borderRadius: 1, marginRight: 12, opacity: 0.85,
  },
  selfPromptLabel: {
    flex: 1,
    fontSize: 10, fontWeight: '600', color: colors.accent,
    textTransform: 'uppercase', letterSpacing: 0.8, marginLeft: 6,
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
  // Memory-vault chips get a faint accent left border so "the agent is using
  // its memory" reads at a glance, distinct from generic tool chips.
  toolCardMemory: {
    borderLeftWidth: 2, borderLeftColor: colors.accent,
  },
  toolCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 12,
  },
  toolStatusDot: { width: 6, height: 6, borderRadius: 3 },
  toolCardTitleWrap: { flex: 1, minWidth: 0 },
  toolCardName: {
    fontSize: 12, fontWeight: '600', color: colors.text,
  },
  toolCardDetail: {
    fontSize: 12, fontWeight: '400', color: colors.textMuted,
    fontFamily: font.mono,
  },
  // "Open in Memory" link — navigates to the note's markdown screen / graph.
  toolOpenLink: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 2, paddingHorizontal: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
  },
  toolOpenLinkText: {
    fontSize: 10, fontWeight: '600', color: colors.accent,
    letterSpacing: 0.3,
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
