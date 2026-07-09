/**
 * Chat screen — editorial single-column flow, no left/right bubbles.
 * Inspired by Claude Code / Codex: messages read like a document, with
 * user prompts as left-rule quotes and assistant replies as full-width
 * prose. Tool invocations inline as compact rows.
 *
 * Voice mode: when always-listening is toggled on, the screen shows a
 * compact voice bar (SoundWaves + caption + webcam/screen toggles) above
 * the transcript and streams the mic through the active chat session.
 */

import { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform, Image,
  Alert, TextInput,
} from 'react-native';

const logoIcon = require('../../assets/openagent-icon.png');
import type { Attachment } from '../../../common/types';
import { isHiddenChildSession, runRoutePath, type RunLaunchTarget, type MemoryTarget } from '../../../common/types';
import { useConnection } from '../../stores/connection';
import { useChat } from '../../stores/chat';
import { useUI } from '../../stores/ui';
import { useEvents } from '../../stores/events';
import { fetchSessions } from '../../services/api';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';
import MessageComposer, { type PendingFile, type SlashCommand } from '../../components/MessageComposer';
import MessageList from '../../components/MessageList';
import ContextPanel from '../../components/ContextPanel';
import CommandPalette, { type PaletteEntry } from '../../components/CommandPalette';
import BrandLogo from '../../components/BrandLogo';
import { useHeaderInset, HeaderBack, HeaderMenu, HeaderRight } from '../../components/screenHeader';
import PopupMenu from '../../components/PopupMenu';
import { NO_DRAG } from '../../components/DragRegion';
import { goBack } from '../../services/windows';
import { useNavHistory } from '../../stores/navHistory';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { Skeleton, SkeletonLines } from '../../components/Skeleton';
import { useConfirm } from '../../components/ConfirmDialog';
import { uploadFile, guessMimeType, listDbModels } from '../../services/api';
import type { ModelEntry } from '../../../common/types';

const SUGGESTED_PROMPTS: { label: string; prompt: string; icon: string }[] = [
  { label: 'Explain a concept', prompt: 'Explain ', icon: 'book-open' },
  { label: 'Write code', prompt: 'Write a function that ', icon: 'code' },
  { label: 'Plan a task', prompt: 'Help me plan ', icon: 'list' },
  { label: 'Summarize', prompt: 'Summarize the key points of ', icon: 'align-left' },
];
import { useVoiceConfig } from '../../stores/voice';
import {
  startWebcamCapture, startScreenCapture, useStreamingMic, useAudioPlayback,
  type VideoStreamHandle,
} from '../../services/voice';
import SoundWaves, { type SoundWavesState } from '../../components/SoundWaves';
import { colors, font, radius } from '../../theme';

const log = (event: string, data?: Record<string, unknown>) => {
  console.log(`[chat:voice] ${event}`, data ?? {});
};

export default function ChatScreen() {
  const headerInset = useHeaderInset();
  const ws = useConnection((s) => s.ws);
  const currentUserHandle = useConnection((s) => s.config?.handle);
  const router = useRouter();
  const navigation = useNavigation<any>();
  const routeParams = useLocalSearchParams<{ session?: string }>();
  // Fine-grained selectors instead of the whole-store `useChat()`. The
  // no-arg form returns a freshly-merged state object on EVERY mutation,
  // so this ~1600-line screen used to re-render on every store change —
  // including unrelated fields. State selectors below subscribe only to
  // the slices this screen reads; action selectors return stable refs and
  // never trigger a re-render on their own.
  const sessions = useChat((s) => s.sessions);
  const activeSessionId = useChat((s) => s.activeSessionId);
  const sessionsHydrated = useChat((s) => s.sessionsHydrated);
  const contextPanelVisible = useUI((s) => s.contextPanelVisible);
  const toggleContextPanel = useUI((s) => s.toggleContextPanel);
  const createSession = useChat((s) => s.createSession);
  const setActiveSession = useChat((s) => s.setActiveSession);
  const removeSession = useChat((s) => s.removeSession);
  const confirm = useConfirm();
  const renameSession = useChat((s) => s.renameSession);
  const addUserMessage = useChat((s) => s.addUserMessage);
  const editUserMessage = useChat((s) => s.editUserMessage);
  const setDraftInput = useChat((s) => s.setDraftInput);
  const togglePinned = useChat((s) => s.togglePinned);
  const setLlmPin = useChat((s) => s.setLlmPin);
  const setSystemPrompt = useChat((s) => s.setSystemPrompt);
  const hydrateFromServer = useChat((s) => s.hydrateFromServer);
  // Delete a chat session behind a confirmation dialog (vision §16: sessions
  // are durable — removal is an explicit, confirmed action). The server
  // cascades the delete to every sub-agent session this chat spawned, so the
  // copy warns about it up front. Only manual chats reach this path (the
  // affordances are gated to ``origin === 'chat'``).
  const confirmAndRemove = useCallback(
    async (ses: { id: string; title?: string }) => {
      const ok = await confirm({
        title: 'Delete chat',
        message:
          `Delete "${ses.title || 'this chat'}"? This permanently removes the ` +
          'conversation and any sub-agent sessions it spawned. This cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        confirmVariant: 'danger',
      });
      if (ok) removeSession(ses.id);
    },
    [confirm, removeSession],
  );
  // Sidebar: apply text search, sort pinned-first then by recency
  // (last message timestamp). Voice no longer has its own session id —
  // it's integrated into the chat tab now.
  const [sessionSearch, setSessionSearch] = useState('');
  // Cap the rendered session switcher; the full sorted list stays reachable
  // behind a "show all" toggle. Heavy users accumulate hundreds of sessions
  // (every delegation / cron / workflow run creates one durable session).
  const SESSION_SWITCHER_MAX = 60;
  const [showAllSessions, setShowAllSessions] = useState(false);
  // Memoized so the filter + sort (and, when searching, the full-text scan
  // over every message of every session) only runs when sessions or the
  // query actually change — not on every render of this screen.
  const chatSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    // Sub-agent (delegation) sessions are navigable only from their parent's
    // transcript card — never the sidebar/recent list. The active session view
    // reads from the full ``sessions`` list, so a child opened from a card
    // still renders even though it's filtered out here.
    const visible = sessions.filter((s) => !isHiddenChildSession(s));
    const filtered = q
      ? visible.filter((s) => {
          if (s.title.toLowerCase().includes(q)) return true;
          return s.messages.some((m) => m.text.toLowerCase().includes(q));
        })
      : visible;
    return [...filtered].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const at = a.messages[a.messages.length - 1]?.timestamp ?? 0;
      const bt = b.messages[b.messages.length - 1]?.timestamp ?? 0;
      return bt - at;
    });
  }, [sessions, sessionSearch]);

  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [llmModels, setLlmModels] = useState<ModelEntry[]>([]);
  // Lazy-load the LLM catalogue once the WS is up — the picker shows
  // models opted into ``enabled`` so disabled rows don't pollute it.
  useEffect(() => {
    if (!ws) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listDbModels({ enabledOnly: true, kind: 'llm' });
        if (!cancelled) setLlmModels(rows);
      } catch (e) {
        console.error('[chat] failed to load LLM catalogue:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [ws]);
  const isDesktop = typeof window !== 'undefined' && !!window.desktop?.isDesktop;
  const [recording, setRecording] = useState(false);
  const voiceLanguage = useVoiceConfig((s) => s.config.language);
  const voiceConfig = useVoiceConfig((s) => s.config);
  const setVoiceConfig = useVoiceConfig((s) => s.setConfig);
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  // The composer's underlying text field, so a stray printable keystroke
  // anywhere on the chat screen can be routed into it (type-to-focus).
  const composerInputRef = useRef<any>(null);
  // Monotonic per-mount counter for stable chip ids — collisions across
  // remounts don't matter (state resets), and we only need uniqueness
  // within one ``pendingFiles`` array.
  const nextPendingId = useRef(0);
  const newPendingId = () => `pf-${++nextPendingId.current}`;
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Voice mode state
  const [hasTts, setHasTts] = useState<boolean | null>(null);
  const [webcamOn, setWebcamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const webcamHandleRef = useRef<VideoStreamHandle | null>(null);
  const screenHandleRef = useRef<VideoStreamHandle | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId ?? null);
  activeSessionIdRef.current = activeSessionId ?? null;

  // Latest-value refs mirrored on every render. The callbacks handed to the
  // memoized <MessageList/> (onEditUser/onRegenerate/onOpenChild/…) MUST keep
  // a stable identity, otherwise MessageList's React.memo is defeated and the
  // whole transcript re-renders — markdown re-parse, syntax highlight, the
  // full 60-node window — on *every keystroke* in the composer. The natural
  // useCallback deps here are unstable: ``activeSession`` is a fresh
  // sessions.find() object each render, ``router`` is a new object each render
  // (useRouter), and ``ws`` flips on reconnect. Reading them through refs lets
  // those callbacks be created once with empty/stable deps.
  const activeSessionRef = useRef(activeSession);
  activeSessionRef.current = activeSession;
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const routerRef = useRef(router);
  routerRef.current = router;
  // Mirrors the live composer text so the session-switch handler can flush the
  // outgoing draft synchronously (the persist write itself is debounced).
  const inputValueRef = useRef('');
  inputValueRef.current = input;

  const browserAvailable =
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const voiceOn = voiceConfig.chatAlwaysListen && browserAvailable;
  const langHint = voiceConfig.language && voiceConfig.language !== 'auto'
    ? voiceConfig.language : undefined;

  const toggleAlwaysListen = useCallback(() => {
    setVoiceConfig({ chatAlwaysListen: !voiceConfig.chatAlwaysListen });
  }, [setVoiceConfig, voiceConfig.chatAlwaysListen]);

  const handleStreamTranscript = useCallback((text: string) => {
    if (activeSessionId) {
      log('stt.committed', { chars: text.length });
      addUserMessage(activeSessionId, text);
    }
  }, [activeSessionId, addUserMessage]);

  const { vadState, audioState, energy, micError } = useStreamingMic({
    ws,
    sessionId: activeSessionId ?? null,
    enabled: voiceConfig.chatAlwaysListen,
    voiceConfig,
    sessionOpen: { profile: 'realtime', clientKind: 'webapp', language: langHint },
    onTranscript: handleStreamTranscript,
    onLog: log,
  });

  useAudioPlayback({
    ws,
    sessionId: activeSessionId ?? null,
    enabled: !voiceConfig.chatAlwaysListen,
  });

  // TTS-availability check on focus
  useFocusEffect(
    useCallback(() => {
      if (!ws || !activeSessionId) return;
      void (async () => {
        try {
          const all = await listDbModels({ enabledOnly: true });
          setHasTts(all.some((m) => m.kind === 'tts'));
        } catch (e) {
          log('tts.check_error', { error: String(e) });
          setHasTts(true);
        }
      })();
      return () => {
        if (webcamHandleRef.current) {
          webcamHandleRef.current.stop();
          webcamHandleRef.current = null;
        }
        if (screenHandleRef.current) {
          screenHandleRef.current.stop();
          screenHandleRef.current = null;
        }
        setWebcamOn(false);
        setScreenOn(false);
      };
    }, [ws, activeSessionId]),
  );

  // Hydrate composer from the active session's persisted draft. Runs
  // only on session-switch (id change) so we don't clobber whatever
  // the user is currently typing.
  const hydratedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    if (hydratedSessionRef.current === activeSessionId) return;
    const prevId = hydratedSessionRef.current;
    // Flush the OUTGOING session's draft synchronously before swapping, so
    // switching sessions within the persist debounce window never drops the
    // text still sitting in the composer.
    if (prevId) setDraftInput(prevId, inputValueRef.current);
    hydratedSessionRef.current = activeSessionId;
    const draft = activeSession?.draftInput ?? '';
    setInput(draft);
  }, [activeSessionId, activeSession?.draftInput, setDraftInput]);

  // Persist composer text back into the active session, DEBOUNCED. Writing on
  // every keystroke rebuilt the whole ``sessions`` array in the store, which
  // re-ran the sidebar's filter+sort (and, while searching, a full-text scan
  // over every message of every session) and re-rendered this screen a second
  // time per character. The draft is an in-memory convenience — it survives a
  // session switch, not a reload — so collapsing writes to one ~400ms after
  // typing pauses is invisible to the user and keeps the keystroke path off
  // the store entirely. The trailing timer is cleared on switch/unmount.
  useEffect(() => {
    if (!activeSessionId) return;
    const sid = activeSessionId;
    const t = setTimeout(() => setDraftInput(sid, input), 400);
    return () => clearTimeout(t);
  }, [input, activeSessionId, setDraftInput]);

  // Deep-link: a ``?session=<id>`` param (set when a delegation card is
  // pressed, or by linking into a run's child session) drives the active
  // session. Guard with a ref so this one-way application never ping-pongs
  // with the store's own ``setActiveSession`` → URL update.
  const appliedParamRef = useRef<string | null>(null);
  useEffect(() => {
    const want = typeof routeParams.session === 'string' ? routeParams.session : undefined;
    if (!want || want === activeSessionId) return;
    if (appliedParamRef.current === want) return;
    appliedParamRef.current = want;
    setActiveSession(want);
  }, [routeParams.session, activeSessionId, setActiveSession]);

  // Navigate into a child session (delegation card / run node) by swapping
  // the active session and reflecting it in the URL so it's deep-linkable.
  // Record it as the applied param too: setActiveSession commits synchronously
  // (so the effect above never sees want≠active to record it itself), and
  // without this a later sidebar switch-away would re-apply the now-stale
  // ``?session=<child>`` and yank the user back into the child.
  const openChildSession = useCallback((childSessionId: string) => {
    appliedParamRef.current = childSessionId;
    setActiveSession(childSessionId);
    // Update the URL by EXPLICIT path, not router.setParams: setParams
    // regenerates the href from the focused navigation state, which — because
    // the chat screen mounts an inner ResponsiveSidebar (a
    // NavigationIndependentTree whose screen is named ``__main__``) — comes out
    // as ``/chat/__main__?session=…``, an unmatched route that 404s on reload /
    // deep-link. Replacing by the canonical ``/(tabs)/chat`` path keeps the URL
    // a clean, round-trippable ``/chat?session=…`` while staying on the same
    // screen (no push, no remount).
    routerRef.current.replace({ pathname: '/(tabs)/chat', params: { session: childSessionId } });
  }, [setActiveSession]);

  // A chat turn that ran a scheduled task / workflow shows a RunLaunchCard;
  // pressing it opens that firing's execution screen (``/runs/{id}``) — the
  // same single-run destination the sidebar's Recent feed uses.
  const openRun = useCallback((target: RunLaunchTarget) => {
    const path = runRoutePath(target);
    if (path) routerRef.current.push(`/${path}` as any);
  }, []);

  // A memory-vault tool chip deep-links into the Memory tab: a single-note op
  // opens that note's markdown screen (the same destination as clicking its
  // graph node — see (tabs)/memory/index.tsx ``openNote``); a search / list /
  // maintenance op opens the memory graph.
  const openMemory = useCallback((target: MemoryTarget) => {
    if (target.kind === 'note') {
      routerRef.current.push({
        pathname: '/(tabs)/memory/[...path]',
        params: { path: target.path.split('/') },
      });
    } else {
      routerRef.current.push('/(tabs)/memory');
    }
  }, []);

  // Drive the (drawer) header's left control. A child session — a delegation
  // sub-agent, a scheduled firing, or a workflow node — gets a real "back"
  // chevron instead of the drawer toggle: it swaps to the parent session in
  // place when that session is loaded (walking the lineage to any depth),
  // and otherwise steps back through navigation history to whatever screen
  // opened it (e.g. a run detail). A top-level chat session keeps the drawer
  // toggle. ``router``/``openChildSession`` are intentionally out of the deps
  // (``useRouter`` returns a fresh ref each render, which would re-run
  // setOptions every frame); the captured refs stay correct because the
  // effect re-runs whenever the session being viewed actually changes.
  const parentSession = activeSession?.parentSessionId
    ? sessions.find((s) => s.id === activeSession.parentSessionId)
    : undefined;
  const isChildSession = !!activeSession
    && (!!activeSession.parentSessionId
      || (!!activeSession.origin && activeSession.origin !== 'chat'));
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () =>
        isChildSession ? (
          <HeaderBack
            onPress={() => {
              // If this child was drilled into from a NON-chat screen (e.g. a
              // run detail's sub-agent card), return to that screen via the
              // route trail. Otherwise it's an in-chat delegation → swap to the
              // parent session in place (the session-lineage axis, any depth).
              const trail = useNavHistory.getState().trail;
              const prev = trail[trail.length - 2];
              if (prev && !prev.startsWith('/chat')) goBack(router);
              else if (parentSession) openChildSession(parentSession.id);
              else goBack(router);
            }}
          />
        ) : (
          <HeaderMenu />
        ),
      // Overflow menu for the open chat. Every session (incl. sub-agent / run
      // views) gets the context-panel toggle; only a top-level manual chat is
      // deletable, so the Delete row is appended just for those.
      headerRight: () =>
        activeSession ? (
          <HeaderRight>
            <PopupMenu
              triggerIcon="more-vertical"
              triggerSize={18}
              triggerColor={colors.textSecondary}
              triggerStyle={[styles.headerMenuBtn, NO_DRAG]}
              accessibilityLabel="Chat options"
              items={[
                {
                  label: contextPanelVisible ? 'Hide context panel' : 'Show context panel',
                  icon: 'pie-chart',
                  onPress: toggleContextPanel,
                },
                ...(!isChildSession ? [{
                  label: 'Delete chat',
                  icon: 'trash-2' as const,
                  destructive: true,
                  onPress: () => confirmAndRemove(activeSession),
                }] : []),
              ]}
            />
          </HeaderRight>
        ) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, isChildSession, parentSession?.id, activeSession?.id, activeSession?.title, contextPanelVisible, toggleContextPanel]);

  // A freshly-spawned child session (delegation / scheduled firing / workflow
  // node) fires a ``session`` resource_event — refetch so it appears in the
  // sidebar and its streaming stub gets real metadata. hydrateFromServer
  // merges metadata onto existing rows without clobbering live transcripts.
  useEffect(() => {
    const off = useEvents.getState().subscribe('session', () => {
      fetchSessions().then(hydrateFromServer).catch(() => {});
    });
    return off;
  }, [hydrateFromServer]);

  // Auto-scroll: stick to the bottom while the agent streams live updates.
  // When the user scrolls away from the bottom, auto-scroll pauses and a
  // jump-to-bottom pill appears. Scrolling back to the very bottom
  // re-engages auto-scroll — the same pattern as Claude Code, VS Code,
  // Slack, and every chat application.
  const {
    scrollRef,
    onScroll,
    onContentSizeChange,
    isPinned,
    scrollToBottom,
  } = useAutoScroll({
    trackDeps: [
      activeSession?.messages.length,
      activeSession?.statusText,
      activeSession?.messages[activeSession?.messages.length - 1]?.text.length,
    ],
  });

  // Shared upload pipeline used by every file-source surface (native
  // file dialog on desktop, hidden ``<input type=file>`` on plain web,
  // and the drop-zone overlay below). Centralising it keeps the
  // ``setPendingFiles`` accumulation logic + error handling in one
  // spot.
  // Run a single browser File through the upload pipeline + drive the
  // chip state. Reused by the initial upload AND by the retry handler.
  const runUpload = useCallback((
    file: File,
    id: string,
    kind: 'image' | 'file',
    previewUrl?: string,
  ) => {
    const controller = new AbortController();
    const retry = () => runUpload(file, id, kind, previewUrl);
    setPendingFiles((prev) => prev.map((p) => p.id === id
      ? { id, filename: file.name, remotePath: '', kind, uploading: true, previewUrl, abort: () => controller.abort(), retry }
      : p));
    (async () => {
      try {
        const result = await uploadFile(file, undefined, { signal: controller.signal });
        setPendingFiles((prev) => prev.map((p) => p.id === id
          ? { id, filename: result.filename, remotePath: result.path, kind, previewUrl, retry }
          : p));
      } catch (e: any) {
        if (e?.name === 'AbortError' || controller.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.error('Upload failed:', file.name, msg);
        setPendingFiles((prev) => prev.map((p) => p.id === id
          ? { id, filename: file.name, remotePath: '', kind, error: msg, previewUrl, retry }
          : p));
      }
    })();
  }, []);

  const uploadBrowserFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    // Spawn an in-flight placeholder chip per file *before* awaiting the
    // upload so the user gets immediate visual feedback.
    for (const file of files) {
      const id = newPendingId();
      const kind = file.type?.startsWith('image/') ? 'image' as const : 'file' as const;
      const previewUrl = kind === 'image' && typeof URL !== 'undefined'
        ? URL.createObjectURL(file) : undefined;
      // Push the placeholder first so the chip appears immediately;
      // runUpload then transitions it through uploading → ok/error.
      setPendingFiles((prev) => [
        ...prev,
        { id, filename: file.name, remotePath: '', kind, uploading: true, previewUrl },
      ]);
      runUpload(file, id, kind, previewUrl);
    }
  }, [runUpload]);

  // Drag-and-drop attachments. Web + Electron only — RN mobile has no
  // OS drag source. We listen on ``window`` (not the composer) so the
  // whole chat surface is a drop target: dropping anywhere lights up
  // the same overlay and routes to the upload pipeline. Browsers fire
  // ``dragenter``/``dragleave`` per child element, so we maintain a
  // counter to know when the cursor has actually left the window.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;

    let depth = 0;

    const hasFiles = (e: DragEvent): boolean => {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      for (let i = 0; i < types.length; i++) {
        if (types[i] === 'Files') return true;
      }
      return false;
    };

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth -= 1;
      if (depth <= 0) {
        depth = 0;
        setDragActive(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      // Fire-and-forget — uploads are async and we don't block here.
      uploadBrowserFiles(files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [uploadBrowserFiles]);

  // Browser notification when an assistant turn finishes while the
  // window is unfocused — modern desktop apps surface "your reply is
  // ready" without making the user babysit the tab. Requires the user
  // to have granted Notification permission at least once.
  const wasProcessingRef = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined' || typeof Notification === 'undefined') return;
    const isProcessing = !!activeSession?.isProcessing;
    const fellEdge = wasProcessingRef.current && !isProcessing;
    wasProcessingRef.current = isProcessing;
    if (!fellEdge) return;
    if (document.hasFocus()) return;
    const askPermission = async () => {
      try {
        if (Notification.permission === 'default') {
          await Notification.requestPermission();
        }
        if (Notification.permission !== 'granted') return;
        const title = activeSession?.title || 'OpenAgent';
        const last = activeSession?.messages[activeSession.messages.length - 1];
        const body = last?.role === 'assistant'
          ? (last.text || '').slice(0, 140)
          : 'Reply ready';
        const notif = new Notification(title, { body, silent: false });
        notif.onclick = () => { window.focus(); notif.close(); };
        setTimeout(() => notif.close(), 8000);
      } catch (e) { /* ignore */ }
    };
    askPermission();
  }, [activeSession?.isProcessing, activeSession?.title, activeSession?.messages]);

  // Cmd/Ctrl+V on the composer textarea → if the clipboard carries
  // image bytes (a screenshot, copied screenshot from a chat app),
  // attach it instead of pasting nothing. We listen on the document
  // ``paste`` event so the textarea's default text-paste keeps working
  // when the clipboard only carries text.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        if (it.kind !== 'file') continue;
        const f = it.getAsFile();
        if (f) files.push(f);
      }
      if (!files.length) return;
      e.preventDefault();
      uploadBrowserFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [uploadBrowserFiles]);

  // Global keyboard shortcuts (web + Electron). Kept narrow and
  // non-invasive — we only listen on ``window`` and bail out if the
  // event was already prevented by something else (a modal, IME, etc).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl+K — new chat session.
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        createSession();
        return;
      }

      // Cmd/Ctrl+P (or Cmd+Shift+O à la VS Code) — open quick switcher.
      if (mod && !e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      // Cmd/Ctrl+Backspace — clear composer text + abort any in-flight
      // upload chips. Only when the focus is on the composer textarea
      // so the user doesn't lose chat sidebar context unexpectedly.
      if (mod && e.key === 'Backspace') {
        const active = document.activeElement as HTMLElement | null;
        const isTextarea = active?.tagName === 'TEXTAREA';
        if (!isTextarea) return;
        e.preventDefault();
        setInput('');
        setPendingFiles((prev) => {
          prev.forEach((p) => p.abort?.());
          return [];
        });
        return;
      }

      // Esc — dismiss any failed upload chips (keep good + uploading).
      if (!mod && e.key === 'Escape') {
        setPendingFiles((prev) => prev.filter((p) => !p.error));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createSession]);

  // Switch the LLM pin for the active session. We must close the WS
  // session so the next sendMessage re-opens it with the new pin —
  // without this, the cached ``openedSessions`` entry on the WS keeps
  // the previous llmPin in force.
  const handleSelectModel = useCallback((modelId: string | undefined) => {
    if (!activeSessionId) return;
    setLlmPin(activeSessionId, modelId);
    if (ws) ws.sendSessionClose(activeSessionId);
  }, [ws, activeSessionId, setLlmPin]);

  // Serialize a session's transcript to a Markdown document and
  // trigger a browser download. Skips tool rows (they're noisy and
  // tend to be JSON dumps), keeps user + assistant turns + the model
  // attribution line.
  const exportSessionAsMarkdown = useCallback((sessionId: string) => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    const ses = sessions.find((s) => s.id === sessionId);
    if (!ses) return;
    const lines: string[] = [`# ${ses.title}`, ''];
    for (const m of ses.messages) {
      if (m.role === 'tool') continue;
      if (m.role === 'user') {
        lines.push('## You', '', m.text || '_(empty)_', '');
        if (m.attachments?.length) {
          for (const a of m.attachments) {
            lines.push(`- attached ${a.type}: \`${a.filename}\``);
          }
          lines.push('');
        }
      } else if (m.role === 'assistant') {
        const tag = m.model ? `## OpenAgent (${m.model})` : '## OpenAgent';
        lines.push(tag, '', m.text || '_(empty)_', '');
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${ses.title.replace(/[^a-z0-9-_\.\s]/gi, '_')}.md`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
  }, [sessions]);

  // Edit a previous user message and re-fire the turn from that
  // point. The store truncates everything after the edited message so
  // the new assistant reply lands on a clean tail (ChatGPT convention).
  const handleEditUser = useCallback((messageId: string, newText: string) => {
    const conn = wsRef.current;
    const sid = activeSessionIdRef.current;
    const ses = activeSessionRef.current;
    if (!conn || !sid) return;
    const ok = editUserMessage(sid, messageId, newText);
    if (!ok) return;
    conn.sendMessage(newText, sid, {
      llmPin: ses?.llmPin,
      systemPrompt: ses?.systemPrompt,
    });
  }, [editUserMessage]);

  // Cancel an in-flight assistant turn for the active session. Turns run
  // inside a server-side StreamSession whose cancel verb is the
  // ``interrupt`` frame (barge-in) — NOT the legacy ``command:stop``,
  // which targets a separate, unused queue and silently does nothing.
  // sendInterrupt routes to _cancel_active_turn so streaming + tool
  // execution actually halt and the server emits a terminal turn so the
  // composer un-sticks. ``reason: 'manual'`` = an explicit user stop.
  const handleStop = useCallback(() => {
    if (!ws || !activeSessionId) return;
    ws.sendInterrupt(activeSessionId, 'manual');
  }, [ws, activeSessionId]);

  // Resend the most recent user message verbatim (with its original
  // attachments). Used by the Regenerate button on the last assistant
  // bubble. Walks back from the tail to find the most recent
  // ``role: 'user'``; everything after it stays in the transcript so
  // the user can compare old vs new — ChatGPT-style.
  const handleRegenerate = useCallback(() => {
    const conn = wsRef.current;
    const sid = activeSessionIdRef.current;
    const ses = activeSessionRef.current;
    if (!conn || !sid || !ses) return;
    const lastUser = [...ses.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const attachments = lastUser.attachments;
    addUserMessage(sid, lastUser.text || '(regenerate)', attachments);
    conn.sendMessage(lastUser.text, sid, {
      llmPin: ses.llmPin,
      systemPrompt: ses.systemPrompt,
      attachments: attachments?.map((a) => ({
        type: a.type, path: a.path, filename: a.filename,
      })),
    });
  }, [addUserMessage]);

  // Up/Down recall — walk the user-message history when composer is
  // empty (or caret at boundary). Index = position from the tail.
  const recallIdxRef = useRef<number | null>(null);
  const userMessages = useMemo(
    () => (activeSession ? activeSession.messages.filter((m) => m.role === 'user') : []),
    [activeSession?.messages],
  );
  const recallPrev = useCallback(() => {
    if (!userMessages.length) return;
    const cur = recallIdxRef.current;
    const next = cur === null ? userMessages.length - 1 : Math.max(0, cur - 1);
    recallIdxRef.current = next;
    setInput(userMessages[next].text);
  }, [userMessages]);
  const recallNext = useCallback(() => {
    const cur = recallIdxRef.current;
    if (cur === null) return;
    const next = cur + 1;
    if (next >= userMessages.length) {
      recallIdxRef.current = null;
      setInput('');
      return;
    }
    recallIdxRef.current = next;
    setInput(userMessages[next].text);
  }, [userMessages]);

  // Type-to-focus: a printable keystroke anywhere on the focused chat
  // screen jumps into the composer and starts typing it — like Slack /
  // Discord / Telegram. Web/desktop only; native has no global key stream.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      const onKey = (e: KeyboardEvent) => {
        // Leave shortcuts, IME composition and non-printing keys alone.
        if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
        // Only single printable characters; keep Space free to scroll.
        if (e.key.length !== 1 || e.key === ' ') return;
        if (paletteOpen) return;
        // Don't hijack a keystroke already destined for a field.
        const el = document.activeElement as HTMLElement | null;
        const tag = el?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return;
        const ta = composerInputRef.current as HTMLTextAreaElement | null;
        // Bail when the composer isn't on screen (no session / hidden tab).
        if (!ta || ta.offsetParent === null) return;
        e.preventDefault();
        ta.focus();
        recallIdxRef.current = null;
        setInput((prev) => prev + e.key);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [paletteOpen]),
  );

  const swState: SoundWavesState =
    audioState === 'playing' ? 'speaking'
    : activeSession?.isProcessing ? 'processing'
    : vadState === 'listening' ? 'listening'
    : 'idle';

  const caption = micError ? `Mic ${micError}`
    : swState === 'speaking' ? 'Speaking…'
    : swState === 'processing' ? (activeSession?.isReasoning ? 'Reasoning…' : 'Thinking…')
    : swState === 'listening' ? 'Listening…'
    : 'Speak any time';

  const handleSend = () => {
    recallIdxRef.current = null;
    if (!ws || !activeSessionId) return;
    const text = input.trim();
    // Failed uploads stay in pendingFiles as visible error chips so the
    // user knows the file didn't make it; they must dismiss explicitly.
    // Filter them out of the WS message + attachment list here.
    const sendableFiles = pendingFiles.filter((f) => !f.error && f.remotePath);
    if (!text && sendableFiles.length === 0) return;

    // Intercept gateway slash-commands typed with an argument (e.g.
    // "/model claude-opus", "/compact"). Commands whose ``action`` is
    // defined in slashCommands fire immediately on autocomplete selection
    // and never reach here; commands without ``action`` (model, help) get
    // their "/name " template inserted and the user types the rest — that
    // fully-formed "/name arg" arrives here. Route as a COMMAND frame so
    // the server's _handle_command branch runs instead of the agent.
    if (text.startsWith('/') && sendableFiles.length === 0) {
      const spaceIdx = text.indexOf(' ');
      const cmdName = (spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx)).toLowerCase();
      const cmdArg = spaceIdx === -1 ? undefined : text.slice(spaceIdx + 1).trim() || undefined;
      // Only intercept known gateway commands — unknown "/foo" text still
      // goes to the agent as a normal message.
      const GATEWAY_COMMANDS = new Set([
        'compact', 'model', 'new', 'clear', 'reset', 'stop',
        'status', 'queue', 'usage', 'context', 'update', 'restart', 'help',
      ]);
      if (GATEWAY_COMMANDS.has(cmdName)) {
        ws.sendCommand(cmdName as any, activeSessionId, cmdArg);
        setInput('');
        return;
      }
    }

    const attachments: Attachment[] = sendableFiles.map((f) => ({
      type: f.kind,
      path: f.remotePath,
      filename: f.filename,
    }));

    addUserMessage(activeSessionId, text, attachments.length ? attachments : undefined);
    ws.sendMessage(text, activeSessionId, {
      llmPin: activeSession?.llmPin,
      systemPrompt: activeSession?.systemPrompt,
      attachments: attachments.length ? attachments : undefined,
    });
    setInput('');
    // Drop only the chips we actually sent; keep failed + still-uploading
    // entries visible so the user notices them (and the next Enter can
    // attach the late-arriving files into a follow-up message).
    setPendingFiles((prev) => prev.filter((f) => f.error || f.uploading));
  };

  const handleFilePick = async () => {
    if (isDesktop && window.desktop?.pickFiles && window.desktop?.readFile) {
      type Picked = Awaited<ReturnType<NonNullable<typeof window.desktop.pickFiles>>>[number];
      let picked: Picked[] = [];
      try {
        picked = await window.desktop.pickFiles();
      } catch (e: any) {
        console.error('Native picker failed:', e);
        return;
      }
      if (!picked.length) return;

      // Reject oversized files before we spawn an in-flight chip — the
      // ``dialog:readFile`` IPC would otherwise refuse them with a
      // generic "readFile: too big" string and surface as a useless
      // error chip. Doing it here puts the actual size + the limit in
      // front of the user.
      const oversized = picked.filter((p) => p.size > 0 && p.size > p.maxBytes);
      const okPicked = picked.filter((p) => !(p.size > 0 && p.size > p.maxBytes));
      if (oversized.length) {
        setPendingFiles((prev) => [
          ...prev,
          ...oversized.map((p) => ({
            id: newPendingId(),
            filename: p.filename,
            remotePath: '',
            kind: p.kind,
            error: `File too large (${(p.size / 1024 / 1024).toFixed(1)} MB; limit ${Math.round(p.maxBytes / 1024 / 1024)} MB)`,
          })),
        ]);
      }
      if (!okPicked.length) return;

      // Same placeholder-first flow as the web drop path.
      const items = okPicked.map((p) => ({
        meta: p,
        id: newPendingId(),
        controller: new AbortController(),
      }));
      setPendingFiles((prev) => [
        ...prev,
        ...items.map(({ id, meta, controller }) => ({
          id,
          filename: meta.filename,
          remotePath: '',
          kind: meta.kind,
          uploading: true,
          abort: () => controller.abort(),
        })),
      ]);
      await Promise.allSettled(items.map(async ({ meta, id, controller }) => {
        try {
          const bytes = await window.desktop!.readFile!(meta.path);
          if (controller.signal.aborted) return;
          const blob = new Blob([bytes as BlobPart], { type: guessMimeType(meta.filename, meta.kind) });
          const file = new File([blob], meta.filename, { type: blob.type });
          const result = await uploadFile(file, undefined, { signal: controller.signal });
          setPendingFiles((prev) => prev.map((p) => p.id === id
            ? { id, filename: result.filename, remotePath: result.path, kind: meta.kind }
            : p));
        } catch (e: any) {
          if (e?.name === 'AbortError' || controller.signal.aborted) return;
          const msg = e instanceof Error ? e.message : String(e);
          console.error('Desktop upload failed:', meta.filename, msg);
          setPendingFiles((prev) => prev.map((p) => p.id === id
            ? { id, filename: meta.filename, remotePath: '', kind: meta.kind, error: msg }
            : p));
        }
      }));
      return;
    }

    if (isDesktop && window.desktop?.pickFiles) {
      try {
        const picked = await window.desktop.pickFiles();
        if (picked.length) {
          setPendingFiles((prev) => [
            ...prev,
            ...picked.map((f) => ({
              id: newPendingId(),
              filename: f.filename,
              remotePath: f.path,
              kind: f.kind,
            })),
          ]);
        }
      } catch (e: any) {
        console.error('Native picker failed:', e);
      }
      return;
    }

    if (Platform.OS !== 'web') return;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*,.pdf,.txt,.md,.csv,.json,.py,.js,.ts,.yaml,.yml,.log';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    fileInput.onchange = async () => {
      const files = Array.from(fileInput.files || []);
      document.body.removeChild(fileInput);
      await uploadBrowserFiles(files);
    };
    fileInput.click();
  };

  const startRecording = async () => {
    if (Platform.OS !== 'web') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
        if (!activeSessionId || !ws) return;
        try {
          const langHint2 = voiceLanguage && voiceLanguage !== 'auto' ? voiceLanguage : undefined;
          const result = await uploadFile(file, undefined, { language: langHint2 });
          const transcription = (result as any).transcription;
          const msg = transcription
            ? transcription
            : `The user sent a voice message:\n- audio: ${result.filename} — local path: ${result.path}\nUse Read to inspect it.`;
          addUserMessage(activeSessionId, 'Voice message');
          ws.sendMessage(msg, activeSessionId, { source: 'stt' });
        } catch (e: any) {
          console.error('Voice upload failed:', e);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (e) {
      console.error('Mic access denied:', e);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setRecording(false);
    }
  };

  const toggleWebcam = useCallback(async () => {
    if (!ws) return;
    if (webcamHandleRef.current) {
      webcamHandleRef.current.stop();
      webcamHandleRef.current = null;
      setWebcamOn(false);
      log('webcam.stop');
      return;
    }
    if (!activeSessionIdRef.current) return;
    try {
      const handle = await startWebcamCapture(
        (b64, w, h) => {
          const sid = activeSessionIdRef.current;
          if (!sid) return;
          ws.sendVideoFrame(sid, 'webcam', b64, { width: w, height: h });
        },
        { fps: 1 },
      );
      webcamHandleRef.current = handle;
      setWebcamOn(true);
      log('webcam.start');
    } catch (e) {
      log('webcam.error', { error: String(e) });
    }
  }, [ws]);

  const toggleScreen = useCallback(async () => {
    if (!ws) return;
    if (screenHandleRef.current) {
      screenHandleRef.current.stop();
      screenHandleRef.current = null;
      setScreenOn(false);
      log('screen.stop');
      return;
    }
    if (!activeSessionIdRef.current) return;
    try {
      const handle = await startScreenCapture(
        (b64, w, h) => {
          const sid = activeSessionIdRef.current;
          if (!sid) return;
          ws.sendVideoFrame(sid, 'screen', b64, { width: w, height: h });
        },
        { fps: 1 },
      );
      screenHandleRef.current = handle;
      setScreenOn(true);
      log('screen.start');
    } catch (e) {
      log('screen.error', { error: String(e) });
    }
  }, [ws]);

  const videoSupported = browserAvailable
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;
  const screenSupported = videoSupported
    && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  // Memoized so the sidebar element keeps a STABLE reference across
  // keystroke-driven re-renders of this screen — React then bails out of
  // reconciling the whole session list (up to 60 rows) on every character
  // typed into the composer. Its inputs (sessions, search, edit state) don't
  // change while composing, so this recomputes only when the sidebar actually
  // needs to.
  const sidebarContent = useMemo(() => (
    <View style={[styles.sidebarInner, { paddingTop: headerInset + 10 }]}>
      <View style={styles.sidebarHead}>
        <Text style={styles.sidebarKicker}>Sessions</Text>
        <TouchableOpacity
          onPress={createSession}
          style={styles.newBtn}
          accessibilityLabel="New chat"
          // @ts-ignore
          {...(Platform.OS === 'web' ? { className: 'oa-hover-lift' } : {})}
        >
          <Feather name="plus" size={13} color={colors.text} />
          <Text style={styles.newBtnText}>New</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.sidebarSearchRow}>
        <Feather name="search" size={11} color={colors.textMuted} />
        <TextInput
          style={styles.sidebarSearchInput}
          value={sessionSearch}
          onChangeText={setSessionSearch}
          placeholder="Search sessions…"
          placeholderTextColor={colors.textMuted}
        />
        {sessionSearch.length > 0 && (
          <TouchableOpacity onPress={() => setSessionSearch('')}>
            <Feather name="x" size={11} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      <ScrollView style={styles.sessionList}>
        {(showAllSessions ? chatSessions : chatSessions.slice(0, SESSION_SWITCHER_MAX)).map((ses) => {
          const isEditing = editingSessionId === ses.id;
          return (
            <View key={ses.id} style={styles.sessionRow}>
              <TouchableOpacity
                style={[styles.sessionItem, ses.id === activeSessionId && styles.sessionActive]}
                onPress={() => { setEditingSessionId(null); setActiveSession(ses.id); }}
                onLongPress={() => {
                  if (Platform.OS === 'web') {
                    setEditingSessionId(ses.id);
                    setEditTitle(ses.title);
                  } else {
                    Alert.alert(
                      ses.title,
                      undefined,
                      [
                        { text: 'Rename', onPress: () => { setEditingSessionId(ses.id); setEditTitle(ses.title); } },
                        { text: ses.pinned ? 'Unpin' : 'Pin', onPress: () => togglePinned(ses.id) },
                        { text: 'Export as Markdown', onPress: () => exportSessionAsMarkdown(ses.id) },
                        { text: 'Delete', style: 'destructive', onPress: () => confirmAndRemove(ses) },
                        { text: 'Cancel', style: 'cancel' },
                      ],
                    );
                  }
                }}
                activeOpacity={0.7}
              >
                {ses.id === activeSessionId && <View style={styles.sessionActiveBar} />}
                {ses.pinned && (
                  <Feather
                    name="bookmark"
                    size={9}
                    color={colors.primary}
                    style={styles.sessionPinGlyph}
                  />
                )}
                {ses.origin && ses.origin !== 'chat' ? (
                  // Origin chip — distinguishes a delegation / scheduled / workflow
                  // child session from a normal chat in the flat list.
                  <Feather
                    name={ses.origin === 'scheduler' ? 'clock' : 'git-branch'}
                    size={9}
                    color={colors.textMuted}
                    style={{ marginRight: 5 }}
                    accessibilityLabel={`${ses.origin} session`}
                  />
                ) : null}
                {isEditing ? (
                  <TextInput
                    style={styles.sessionEditInput}
                    value={editTitle}
                    onChangeText={setEditTitle}
                    onSubmitEditing={() => {
                      const t = editTitle.trim();
                      if (t) renameSession(ses.id, t);
                      setEditingSessionId(null);
                    }}
                    onBlur={() => {
                      const t = editTitle.trim();
                      if (t) renameSession(ses.id, t);
                      setEditingSessionId(null);
                    }}
                    autoFocus
                    selectTextOnFocus
                  />
                ) : (
                  <Text style={[styles.sessionTitle, ses.id === activeSessionId && styles.sessionTitleActive]} numberOfLines={1}>
                    {ses.title}
                  </Text>
                )}
                {ses.isProcessing ? (
                  <View style={styles.processingDot} {...(Platform.OS === 'web' ? { className: 'oa-pulse' } : {})} />
                ) : ses.hasUnread ? (
                  <View style={styles.unreadDot} />
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.sessionPinBtn}
                onPress={() => togglePinned(ses.id)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                accessibilityLabel={ses.pinned ? 'Unpin session' : 'Pin session'}
              >
                <Feather
                  name="bookmark"
                  size={11}
                  color={ses.pinned ? colors.primary : colors.textMuted}
                />
              </TouchableOpacity>
              {(!ses.origin || ses.origin === 'chat') && (
                // Overflow menu — Delete lives behind a confirmation dialog.
                // Offered only on manual chats, never on a sub-agent /
                // scheduled-run / workflow row (the server rejects those).
                <PopupMenu
                  triggerIcon="more-horizontal"
                  triggerSize={15}
                  triggerColor={colors.textMuted}
                  triggerStyle={styles.sessionDeleteBtn}
                  accessibilityLabel={`Options for ${ses.title}`}
                  items={[
                    { label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => confirmAndRemove(ses) },
                  ]}
                />
              )}
            </View>
          );
        })}
        {!showAllSessions && chatSessions.length > SESSION_SWITCHER_MAX && (
          <TouchableOpacity
            style={styles.sessionShowAll}
            onPress={() => setShowAllSessions(true)}
            // @ts-ignore — web hover/press affordance
            {...(Platform.OS === 'web' ? { className: 'oa-side-row oa-press' } : {})}
          >
            <Text style={styles.sessionShowAllText}>Show all {chatSessions.length}</Text>
          </TouchableOpacity>
        )}
        {chatSessions.length === 0 && (
          <Text style={styles.sidebarEmpty}>No sessions yet</Text>
        )}
      </ScrollView>
    </View>
  ), [
    headerInset, createSession, sessionSearch, setSessionSearch, showAllSessions,
    setShowAllSessions, chatSessions, editingSessionId, setEditingSessionId,
    activeSessionId, setActiveSession, editTitle, setEditTitle, renameSession,
    togglePinned, exportSessionAsMarkdown, confirmAndRemove,
  ]);

  // Slash-command catalogue offered by the composer. ``action`` fires
  // a local handler; commands without ``action`` insert their template
  // into the input so the user can finish typing arguments.
  const slashCommands: SlashCommand[] = [
    {
      name: 'new',
      description: 'Start a new chat',
      action: () => createSession(),
    },
    {
      name: 'clear',
      description: 'Clear the active session transcript',
      action: () => {
        if (activeSessionId) ws?.sendCommand('clear', activeSessionId);
      },
    },
    {
      name: 'stop',
      description: 'Stop the current generation',
      action: handleStop,
    },
    {
      name: 'help',
      description: 'Ask the agent what it can do',
    },
    {
      name: 'compact',
      description: 'Compress conversation history to free up context',
      action: () => {
        if (activeSessionId) ws?.sendCommand('compact', activeSessionId);
      },
    },
    {
      name: 'context',
      description: 'Show this conversation’s context-window usage',
      // The panel is always visible; this forces an immediate refresh (the
      // command_result carries the fresh breakdown, applied in _layout.tsx).
      action: () => {
        if (activeSessionId) ws?.sendCommand('context', activeSessionId);
      },
    },
    {
      name: 'model',
      description: 'Switch the model for this conversation',
      // Opens the composer's model picker instead of inserting "/model "
      // for the user to type a runtime id by hand.
      argSource: 'models',
    },
    {
      name: 'export',
      description: 'Export this conversation as Markdown',
      action: () => { if (activeSessionId) exportSessionAsMarkdown(activeSessionId); },
    },
    {
      name: 'system',
      description: 'Set a system prompt for this session',
      action: () => {
        if (!activeSessionId) return;
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const current = activeSession?.systemPrompt ?? '';
        const next = window.prompt(
          'System prompt for this session (leave empty to clear):',
          current,
        );
        if (next === null) return;
        setSystemPrompt(activeSessionId, next.trim());
        if (ws) ws.sendSessionClose(activeSessionId);
      },
    },
  ];

  // Composer model-picker rows. Memoized on the raw catalogue so a keystroke
  // (which re-renders this screen) doesn't rebuild a fresh array each time and
  // hand the composer a new ``modelOptions`` reference.
  const modelOptions = useMemo(
    () => llmModels.map((m) => ({
      id: m.runtime_id,
      label: m.display_name || m.model || m.runtime_id,
      provider: m.provider_name,
    })),
    [llmModels],
  );

  const paletteEntries: PaletteEntry[] = useMemo(() => chatSessions.map((s) => {
    const last = s.messages[s.messages.length - 1];
    return {
      id: s.id,
      title: s.title || 'Untitled chat',
      subtitle: last ? `${last.role}: ${last.text.slice(0, 80)}` : 'Empty chat',
      icon: 'message-circle',
      pinned: s.pinned,
      onSelect: () => setActiveSession(s.id),
    };
  }), [chatSessions, setActiveSession]);

  return (
    <ResponsiveSidebar sidebar={sidebarContent}>
      <View style={[styles.chatArea, { paddingTop: headerInset }]}>
        {dragActive && (
          <View style={styles.dropOverlay} pointerEvents="none">
            <View style={styles.dropPanel}>
              <Feather name="upload-cloud" size={32} color={colors.primary} />
              <Text style={styles.dropTitle}>Drop to attach</Text>
              <Text style={styles.dropSub}>
                Files will be uploaded and added to the next message.
              </Text>
            </View>
          </View>
        )}
        {/* Always-visible context-window gauge, pinned top-right. Bound to
            the active session so it also serves sub-agent / scheduled-firing /
            workflow-AI-node sessions opened on this same screen. */}
        {activeSession ? (
          <ContextPanel context={activeSession.contextUsage} topInset={headerInset} />
        ) : null}
        {activeSession ? (
          <>
            {/* TTS banner */}
            {voiceOn && hasTts === false && (
              <View style={styles.banner} accessibilityRole="alert">
                <Feather name="volume-x" size={13} color={colors.error} />
                <Text style={styles.bannerText}>
                  No TTS model configured — replies will be text-only. Add a{' '}
                  <Text style={styles.bannerStrong}>kind=tts</Text> row in Models to hear spoken replies.
                </Text>
              </View>
            )}

            {/* Voice bar */}
            {voiceOn && (
              <View style={styles.voiceBar}>
                <View style={styles.voiceBarLeft}>
                  <SoundWaves level={energy} state={swState} bars={5} maxHeight={28} />
                  <Text style={styles.voiceCaption}>{caption}</Text>
                </View>
                <View style={styles.voiceBarRight}>
                  {videoSupported && (
                    <TouchableOpacity
                      style={[styles.voiceIconBtn, webcamOn && styles.voiceIconBtnActive]}
                      onPress={toggleWebcam}
                      accessibilityLabel={webcamOn ? 'Stop webcam' : 'Share webcam'}
                    >
                      <Feather
                        name={webcamOn ? 'video' : 'video-off'}
                        size={12}
                        color={webcamOn ? colors.text : colors.textSecondary}
                      />
                    </TouchableOpacity>
                  )}
                  {screenSupported && (
                    <TouchableOpacity
                      style={[styles.voiceIconBtn, screenOn && styles.voiceIconBtnActive]}
                      onPress={toggleScreen}
                      accessibilityLabel={screenOn ? 'Stop screen share' : 'Share screen'}
                    >
                      <Feather
                        name={screenOn ? 'monitor' : 'cast'}
                        size={12}
                        color={screenOn ? colors.text : colors.textSecondary}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {(webcamOn || screenOn) && voiceOn && (
              <Text style={styles.shareBadge}>
                Sharing: {[webcamOn && 'webcam', screenOn && 'screen'].filter(Boolean).join(' + ')}
              </Text>
            )}

            <ScrollView
              ref={scrollRef}
              // Pull up behind the transparent header (its empty top padding
              // is transparent, so any banners above still show through) and
              // pad the content so the first message clears the header.
              style={[styles.messages, { marginTop: -headerInset }]}
              contentContainerStyle={[styles.messagesContent, { paddingTop: headerInset + 12 }]}
              onScroll={onScroll}
              onContentSizeChange={onContentSizeChange}
              scrollEventThrottle={100}
              // Always show the scrollbar so the user sees there's
              // scrollable content even when the transcript is short.
              // @ts-ignore — RN Web prop, no-op on native
              persistentScrollbar
            >
              <View style={styles.messagesInner}>
                {(activeSession.parentSessionId || (activeSession.origin && activeSession.origin !== 'chat')) ? (
                  (() => {
                    const parent = sessions.find((s) => s.id === activeSession.parentSessionId);
                    const originName = activeSession.origin && activeSession.origin !== 'chat'
                      ? activeSession.origin : 'parent';
                    const label = parent
                      ? `${originName} · ${parent.title}`
                      : `${originName}${activeSession.originLabel ? ` · ${activeSession.originLabel}` : ''}`;
                    return (
                      <TouchableOpacity
                        disabled={!parent}
                        onPress={() => parent && openChildSession(parent.id)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 6,
                          paddingVertical: 6, paddingHorizontal: 8, marginBottom: 4,
                          alignSelf: 'flex-start', borderRadius: 6,
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Back to parent session"
                      >
                        <Feather name="corner-up-left" size={12} color={colors.textMuted} />
                        <Text style={{
                          color: colors.textMuted, fontSize: 11,
                          textTransform: 'uppercase', letterSpacing: 0.5,
                        }} numberOfLines={1}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })()
                ) : null}
                {activeSession.messages.length === 0 && (
                  <View style={styles.heroEmpty}>
                    <BrandLogo size={84} />
                    <Text style={styles.heroTitle}>At your service</Text>
                    <Text style={styles.heroSub}>
                      Ask a question, request a task, or attach a file.
                    </Text>
                    <View style={styles.suggestedRow}>
                      {SUGGESTED_PROMPTS.map((p) => (
                        <TouchableOpacity
                          key={p.label}
                          style={styles.suggestedChip}
                          onPress={() => setInput(p.prompt)}
                          // @ts-ignore
                          {...(Platform.OS === 'web' ? { className: 'oa-hover-lift' } : {})}
                        >
                          <Feather name={p.icon as any} size={11} color={colors.primary} />
                          <Text style={styles.suggestedLabel}>{p.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
                <MessageList
                  messages={activeSession.messages}
                  isProcessing={activeSession.isProcessing}
                  statusText={activeSession.statusText}
                  isReasoning={activeSession.isReasoning}
                  onRegenerate={handleRegenerate}
                  onEditUser={handleEditUser}
                  onOpenChild={openChildSession}
                  onOpenRun={openRun}
                  onOpenMemory={openMemory}
                  currentUserHandle={currentUserHandle}
                />
              </View>
            </ScrollView>

            {activeSession.systemPrompt ? (
              <View style={styles.systemHint}>
                <Feather name="settings" size={10} color={colors.textMuted} />
                <Text style={styles.systemHintText} numberOfLines={1}>
                  System: {activeSession.systemPrompt}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    if (!activeSessionId) return;
                    setSystemPrompt(activeSessionId, '');
                    if (ws) ws.sendSessionClose(activeSessionId);
                  }}
                  accessibilityLabel="Clear system prompt"
                >
                  <Feather name="x" size={10} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ) : null}
            {!isPinned && (
              <TouchableOpacity
                style={styles.jumpToBottom}
                onPress={() => scrollToBottom(true)}
                accessibilityLabel="Jump to bottom"
                // @ts-ignore
                {...(Platform.OS === 'web' ? { className: 'oa-hover-lift oa-fade-in' } : {})}
              >
                <Feather name="chevron-down" size={14} color={colors.text} />
              </TouchableOpacity>
            )}

            <MessageComposer
              inputRef={composerInputRef}
              input={input}
              onInputChange={(v) => {
                // Any manual edit invalidates the history-recall index.
                if (recallIdxRef.current !== null) recallIdxRef.current = null;
                setInput(v);
              }}
              processing={activeSession.isProcessing}
              onStop={handleStop}
              onRecallPrev={recallPrev}
              onRecallNext={recallNext}
              slashCommands={slashCommands}
              modelOptions={modelOptions}
              activeModelId={activeSession?.llmPin}
              onSelectModel={handleSelectModel}
              pendingFiles={pendingFiles}
              onRetryFile={(idx) => {
                const target = pendingFiles[idx];
                if (target?.retry) target.retry();
              }}
              onRemoveFile={(idx) => setPendingFiles((prev) => {
                const target = prev[idx];
                // Cancel the underlying fetch if the upload is still in
                // flight — otherwise the request orphan-completes and
                // the gateway accepts a file the user no longer wants.
                target?.abort?.();
                if (target?.previewUrl) {
                  try { URL.revokeObjectURL(target.previewUrl); } catch { /* ignore */ }
                }
                return prev.filter((_, i) => i !== idx);
              })}
              onPickFile={(Platform.OS === 'web' || isDesktop) ? handleFilePick : undefined}
              onSend={handleSend}
              // Composer stays interactive while the agent is processing so
              // the user can send a steer / send-while-busy message mid-turn
              // (vision §2 — "fast bursts coalesced into a single turn"); the
              // server coalesces it into the in-flight turn. Stopping is still
              // one tap away via the Stop button (rendered while processing)
              // and the command palette.
              recording={Platform.OS === 'web' ? recording : undefined}
              onStartRecord={startRecording}
              onStopRecord={stopRecording}
              alwaysListening={
                Platform.OS === 'web' ? voiceConfig.chatAlwaysListen : undefined
              }
              onToggleAlwaysListen={toggleAlwaysListen}
            />
          </>
        ) : !sessionsHydrated ? (
          // Sessions are still loading from the server — render the
          // transcript shell with shimmering placeholders so we land on
          // the page immediately instead of flashing "Standing by".
          <View style={styles.messages}>
            <View style={[styles.messagesInner, styles.skeletonInner]}>
              <View style={styles.skeletonTurn}>
                <Skeleton width={64} height={11} />
                <SkeletonLines lines={2} lastWidth="70%" />
              </View>
              <View style={styles.skeletonTurn}>
                <Skeleton width={88} height={11} />
                <SkeletonLines lines={3} lastWidth="45%" />
              </View>
              <View style={styles.skeletonTurn}>
                <Skeleton width={64} height={11} />
                <SkeletonLines lines={2} lastWidth="80%" />
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <BrandLogo size={96} />
            <Text style={styles.emptyTitle}>Standing by</Text>
            <Text style={styles.emptySub}>Select a session on the left, or open a new one.</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={createSession}>
              <Feather name="plus" size={13} color={colors.text} />
              <Text style={styles.emptyBtnText}>New chat</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      <CommandPalette
        visible={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        entries={paletteEntries}
      />
    </ResponsiveSidebar>
  );
}

const styles = StyleSheet.create({
  // Sidebar
  sidebarInner: { flex: 1, padding: 10, gap: 2 },
  sidebarHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 6, paddingTop: 4, paddingBottom: 6, marginBottom: 2,
  },
  sidebarKicker: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  newBtnText: {
    fontSize: 10, fontWeight: '600', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  sessionList: { flex: 1 },
  sessionRow: {
    flexDirection: 'row', alignItems: 'center',
    marginVertical: 1, marginHorizontal: 2,
  },
  sessionItem: {
    flex: 1,
    position: 'relative',
    paddingVertical: 7, paddingHorizontal: 10,
    borderRadius: radius.sm,
    flexDirection: 'row', alignItems: 'center',
    minWidth: 0,
  },
  sessionActive: { backgroundColor: colors.hover },
  sessionActiveBar: {
    position: 'absolute', left: 0, top: 8, bottom: 8, width: 2,
    backgroundColor: colors.primary, borderRadius: 1,
  },
  sessionTitle: { color: colors.textSecondary, flex: 1, fontSize: 12.5, fontWeight: '400' },
  sessionTitleActive: { color: colors.text, fontWeight: '500' },
  sessionDeleteBtn: {
    padding: 6, marginLeft: 0,
    width: 24, height: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  headerMenuBtn: {
    width: 34, height: 34,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md,
  },
  sessionPinBtn: {
    padding: 6, marginLeft: 4,
    width: 24, height: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  sessionPinGlyph: {
    position: 'absolute', left: 4, top: 9,
  },
  sidebarSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.borderLight,
    marginHorizontal: 2, marginBottom: 6,
  },
  sidebarSearchInput: {
    flex: 1, color: colors.text, fontSize: 11.5,
    paddingVertical: 0,
    // @ts-ignore — web outline cleanup
    ...(Platform.OS === 'web' ? { outline: 'none', border: 'none' } : {}),
  },
  sessionEditInput: {
    flex: 1, color: colors.text, fontSize: 12.5,
    borderBottomWidth: 1, borderBottomColor: colors.primary,
    paddingVertical: 2,
  },
  processingDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.primary, marginLeft: 6,
  },
  unreadDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: colors.primary, marginLeft: 6,
    opacity: 0.65,
  },
  sidebarEmpty: {
    fontSize: 11, color: colors.textMuted, textAlign: 'center',
    paddingVertical: 20,
  },
  sessionShowAll: {
    paddingVertical: 8, paddingHorizontal: 10, marginHorizontal: 4,
    alignItems: 'center', borderRadius: radius.sm,
  },
  sessionShowAllText: {
    fontSize: 11, color: colors.textMuted, fontFamily: font.mono,
  },

  // Chat area
  chatArea: { flex: 1, flexDirection: 'column' },

  // TTS banner
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 9,
    backgroundColor: colors.errorSoft,
    borderBottomWidth: 1, borderBottomColor: colors.errorBorder,
  },
  bannerText: {
    flex: 1, fontSize: 12, color: colors.error, lineHeight: 17,
  },
  bannerStrong: { fontFamily: font.mono, fontWeight: '600' },

  // Voice bar
  voiceBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
    minHeight: 44,
  },
  voiceBarLeft: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  voiceBarRight: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  voiceCaption: {
    fontSize: 11, color: colors.textMuted,
    fontFamily: font.mono, letterSpacing: 0.6, textTransform: 'uppercase',
  },
  voiceIconBtn: {
    width: 24, height: 24, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  voiceIconBtnActive: {
    borderColor: colors.text,
    backgroundColor: colors.borderLight,
  },
  shareBadge: {
    fontSize: 10, color: colors.textSecondary,
    fontFamily: font.mono, letterSpacing: 0.4,
    textAlign: 'center', paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },

  messages: { flex: 1 },
  messagesContent: { paddingVertical: 12, paddingBottom: 12 },
  messagesInner: { maxWidth: 760, width: '100%', alignSelf: 'center', paddingHorizontal: 20 },

  // Loading placeholder while sessions hydrate from the server.
  skeletonInner: { paddingTop: 28, gap: 28 },
  skeletonTurn: { gap: 10 },

  // Hero empty state
  heroEmpty: {
    alignItems: 'center', paddingVertical: 60, paddingHorizontal: 16,
  },
  heroGlyph: {
    fontSize: 26, color: colors.primary, marginBottom: 12,
    fontFamily: font.serif,
  },
  heroLogo: {
    width: 56, height: 56, marginBottom: 14,
  },
  heroTitle: {
    fontSize: 20, fontWeight: '500', color: colors.text,
    letterSpacing: -0.4, marginBottom: 4,
    fontFamily: font.display,
  },
  heroSub: {
    fontSize: 13, color: colors.textMuted, textAlign: 'center',
    marginBottom: 22,
  },
  suggestedRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    justifyContent: 'center', maxWidth: 520,
  },
  suggestedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  suggestedLabel: {
    fontSize: 12, fontWeight: '500', color: colors.text,
  },
  systemHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5,
    marginHorizontal: 20, marginBottom: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.codeBg,
    borderWidth: 1, borderColor: colors.borderLight,
    maxWidth: 760, alignSelf: 'center', width: '100%',
  },
  systemHintText: {
    flex: 1, fontSize: 11, color: colors.textSecondary,
    fontFamily: font.mono,
  },
  jumpToBottom: {
    position: 'absolute',
    bottom: 88,
    alignSelf: 'center',
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    zIndex: 5,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 3,
  },

  // Empty
  emptyState: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18, fontWeight: '500', color: colors.text,
    letterSpacing: -0.3, marginBottom: 4,
    fontFamily: font.display,
  },
  emptySub: {
    fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: 16,
  },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  emptyBtnText: { fontSize: 12, fontWeight: '500', color: colors.text },

  // Drag-and-drop overlay (web/desktop only — see useEffect above).
  dropOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 1000,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
    padding: 24,
  },
  dropPanel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2, borderColor: colors.primary,
    paddingHorizontal: 32, paddingVertical: 28,
    alignItems: 'center', gap: 10,
    maxWidth: 420,
    // @ts-ignore — web-only dashed border
    ...(Platform.OS === 'web' ? { borderStyle: 'dashed' as any } : {}),
  },
  dropTitle: {
    fontSize: 16, fontWeight: '600', color: colors.text,
    fontFamily: font.display, letterSpacing: -0.3,
  },
  dropSub: {
    fontSize: 12, color: colors.textMuted, textAlign: 'center',
  },
});
