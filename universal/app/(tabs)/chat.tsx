/**
 * Chat screen — editorial single-column flow, no left/right bubbles.
 * Inspired by Claude Code / Codex: messages read like a document, with
 * user prompts as left-rule quotes and assistant replies as full-width
 * prose. Tool invocations inline as compact rows.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import Feather from '@expo/vector-icons/Feather';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform, Image,
  Alert, TextInput,
} from 'react-native';

const logoIcon = require('../../assets/openagent-icon.png');
import type { Attachment } from '../../../common/types';
import { useConnection } from '../../stores/connection';
import { useChat } from '../../stores/chat';
import ResponsiveSidebar from '../../components/ResponsiveSidebar';
import MessageComposer, { type PendingFile, type SlashCommand } from '../../components/MessageComposer';
import MessageList from '../../components/MessageList';
import CommandPalette, { type PaletteEntry } from '../../components/CommandPalette';
import { JarvisOrb } from '../../components/jarvis';
import { uploadFile, guessMimeType, listDbModels } from '../../services/api';
import type { ModelEntry } from '../../../common/types';

const SUGGESTED_PROMPTS: { label: string; prompt: string; icon: string }[] = [
  { label: 'Explain a concept', prompt: 'Explain ', icon: 'book-open' },
  { label: 'Write code', prompt: 'Write a function that ', icon: 'code' },
  { label: 'Plan a task', prompt: 'Help me plan ', icon: 'list' },
  { label: 'Summarize', prompt: 'Summarize the key points of ', icon: 'align-left' },
];
import { useVoiceConfig } from '../../stores/voice';
import { useStreamingMic, useAudioPlayback } from '../../services/voice';
import { colors, font, radius } from '../../theme';

export default function ChatScreen() {
  const ws = useConnection((s) => s.ws);
  const isReconnecting = useConnection((s) => s.isReconnecting);
  const {
    sessions, activeSessionId, voiceSessionId,
    createSession, setActiveSession, removeSession, renameSession,
    addUserMessage, editUserMessage, setDraftInput, togglePinned,
    setLlmPin, setSystemPrompt,
  } = useChat();
  // The voice session lives in its own tab — it has no place in the
  // text-chat sidebar. Filtering here (rather than removing it from
  // ``sessions[]`` entirely) keeps the voice tab's transcript intact
  // and lets ``handleServerMessage`` route DELTA / RESPONSE frames to
  // either session by id without special-casing.
  // Sidebar: filter out the voice session, apply text search, sort
  // pinned-first then by recency (last message timestamp, falling back
  // to session id which is a Date.now() string).
  const [sessionSearch, setSessionSearch] = useState('');
  const chatSessions = (() => {
    const q = sessionSearch.trim().toLowerCase();
    const base = sessions.filter((s) => s.id !== voiceSessionId);
    const filtered = q
      ? base.filter((s) => {
          if (s.title.toLowerCase().includes(q)) return true;
          return s.messages.some((m) => m.text.toLowerCase().includes(q));
        })
      : base;
    return [...filtered].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const at = a.messages[a.messages.length - 1]?.timestamp ?? 0;
      const bt = b.messages[b.messages.length - 1]?.timestamp ?? 0;
      return bt - at;
    });
  })();

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
  const scrollRef = useRef<ScrollView>(null);
  // Monotonic per-mount counter for stable chip ids — collisions across
  // remounts don't matter (state resets), and we only need uniqueness
  // within one ``pendingFiles`` array.
  const nextPendingId = useRef(0);
  const newPendingId = () => `pf-${++nextPendingId.current}`;
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const toggleAlwaysListen = useCallback(() => {
    setVoiceConfig({ chatAlwaysListen: !voiceConfig.chatAlwaysListen });
  }, [setVoiceConfig, voiceConfig.chatAlwaysListen]);

  const handleStreamTranscript = useCallback((text: string) => {
    if (activeSessionId) addUserMessage(activeSessionId, text);
  }, [activeSessionId, addUserMessage]);

  // Continuous-mic mode for the chat tab. When the user toggles
  // ``chatAlwaysListen`` on, this hook mounts the same VoiceLoop +
  // AudioQueuePlayer pipeline the Voice tab uses and routes
  // recognised utterances into the active chat thread as
  // ``text_final(source='stt')`` — server-side mirror-modality re-
  // enables TTS replies even though chat-tab sessions opened with
  // ``speak: false``.
  useStreamingMic({
    ws,
    sessionId: activeSessionId ?? null,
    enabled: voiceConfig.chatAlwaysListen,
    voiceConfig,
    sessionOpen: { profile: 'batched', clientKind: 'webapp-chat', speak: false },
    onTranscript: handleStreamTranscript,
  });

  // Standalone audio playback for the OFF-mic case. When the user
  // records a voice note via the composer's mic button (or the server
  // mirror-modality rule otherwise speaks a reply), we still need a
  // client-side player even if continuous-listen is off — without
  // this hook the gateway streams audio_chunk frames into the void.
  // No-op once ``chatAlwaysListen`` is on because ``useStreamingMic``
  // already mounts its own player for that session.
  useAudioPlayback({
    ws,
    sessionId: activeSessionId ?? null,
    enabled: !voiceConfig.chatAlwaysListen,
  });

  // Hydrate composer from the active session's persisted draft. Runs
  // only on session-switch (id change) so we don't clobber whatever
  // the user is currently typing.
  const hydratedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) return;
    if (hydratedSessionRef.current === activeSessionId) return;
    hydratedSessionRef.current = activeSessionId;
    const draft = activeSession?.draftInput ?? '';
    setInput(draft);
  }, [activeSessionId, activeSession?.draftInput]);

  // Persist composer text back into the active session on every change.
  useEffect(() => {
    if (!activeSessionId) return;
    setDraftInput(activeSessionId, input);
  }, [input, activeSessionId, setDraftInput]);

  // Auto-scroll only when the user is already pinned to the bottom.
  // If they've scrolled up to read history, we don't yank them back —
  // instead the jump-to-bottom pill appears and lets them opt in.
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const scrollToBottom = useCallback((animated = true) => {
    scrollRef.current?.scrollToEnd({ animated });
    setPinnedToBottom(true);
  }, []);
  useEffect(() => {
    if (!pinnedToBottom) return;
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
    // ``activeSession?.messages`` reference also flips on every delta
    // when the last message's text grows — so we track length AND the
    // tail's text length, which is enough granularity for streaming
    // without re-scheduling on tool-card updates that don't grow text.
  }, [
    pinnedToBottom,
    activeSession?.messages.length,
    activeSession?.statusText,
    activeSession?.messages[activeSession.messages.length - 1]?.text.length,
  ]);
  const handleScroll = useCallback((e: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    setPinnedToBottom(distanceFromBottom < 60);
  }, []);

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
    if (!ws || !activeSessionId) return;
    const ok = editUserMessage(activeSessionId, messageId, newText);
    if (!ok) return;
    ws.sendMessage(newText, activeSessionId, {
      llmPin: activeSession?.llmPin,
      systemPrompt: activeSession?.systemPrompt,
    });
  }, [ws, activeSessionId, activeSession, editUserMessage]);

  // Cancel an in-flight assistant turn for the active session. Server
  // receives ``command:stop`` and halts streaming + tool execution.
  const handleStop = useCallback(() => {
    if (!ws || !activeSessionId) return;
    ws.sendCommand('stop', activeSessionId);
  }, [ws, activeSessionId]);

  // Resend the most recent user message verbatim (with its original
  // attachments). Used by the Regenerate button on the last assistant
  // bubble. Walks back from the tail to find the most recent
  // ``role: 'user'``; everything after it stays in the transcript so
  // the user can compare old vs new — ChatGPT-style.
  const handleRegenerate = useCallback(() => {
    if (!ws || !activeSessionId || !activeSession) return;
    const lastUser = [...activeSession.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const attachments = lastUser.attachments;
    let payload = lastUser.text;
    if (attachments && attachments.length) {
      const lines = attachments.map((a) => `- ${a.type}: ${a.filename} — server path: ${a.path}`);
      const noun = attachments.length === 1 ? 'a file' : `${attachments.length} files`;
      const header = `The user attached ${noun}:\n${lines.join('\n')}\nUse the Read tool to inspect ${attachments.length === 1 ? 'it' : 'them'}.`;
      payload = lastUser.text ? `${header}\n\nUser message: ${lastUser.text}` : header;
    }
    addUserMessage(activeSessionId, lastUser.text || '(regenerate)', attachments);
    ws.sendMessage(payload, activeSessionId, {
      llmPin: activeSession?.llmPin,
      systemPrompt: activeSession?.systemPrompt,
    });
  }, [ws, activeSessionId, activeSession, addUserMessage]);

  // Up/Down recall — walk the user-message history when composer is
  // empty (or caret at boundary). Index = position from the tail.
  const recallIdxRef = useRef<number | null>(null);
  const userMessages = activeSession
    ? activeSession.messages.filter((m) => m.role === 'user')
    : [];
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

  const handleSend = () => {
    recallIdxRef.current = null;
    if (!ws || !activeSessionId) return;
    const text = input.trim();
    // Failed uploads stay in pendingFiles as visible error chips so the
    // user knows the file didn't make it; they must dismiss explicitly.
    // Filter them out of the WS message + attachment list here.
    const sendableFiles = pendingFiles.filter((f) => !f.error && f.remotePath);
    if (!text && sendableFiles.length === 0) return;

    let msg = text;
    const displayMsg = text;

    const attachments: Attachment[] = sendableFiles.map((f) => ({
      type: f.kind,
      path: f.remotePath,
      filename: f.filename,
    }));

    if (sendableFiles.length > 0) {
      const lines = sendableFiles.map(
        (f) => `- ${f.kind}: ${f.filename} — server path: ${f.remotePath}`,
      );
      const noun = sendableFiles.length === 1 ? 'a file' : `${sendableFiles.length} files`;
      const fileHeader = `The user attached ${noun}:\n${lines.join('\n')}\nUse the Read tool to inspect ${sendableFiles.length === 1 ? 'it' : 'them'}.`;
      msg = text ? `${fileHeader}\n\nUser message: ${text}` : fileHeader;
    }

    addUserMessage(activeSessionId, displayMsg, attachments.length ? attachments : undefined);
    ws.sendMessage(msg, activeSessionId, {
      llmPin: activeSession?.llmPin,
      systemPrompt: activeSession?.systemPrompt,
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
          // Same language-hint resolution as the Voice tab: pass the
          // ISO-639-1 code unless the user explicitly picked
          // auto-detect ('auto' or empty).
          const langHint = voiceLanguage && voiceLanguage !== 'auto' ? voiceLanguage : undefined;
          const result = await uploadFile(file, undefined, { language: langHint });
          const transcription = (result as any).transcription;
          const msg = transcription
            ? transcription
            : `The user sent a voice message:\n- audio: ${result.filename} — local path: ${result.path}\nUse Read to inspect it.`;
          addUserMessage(activeSessionId, 'Voice message');
          // Tag as STT so the StreamSession (a) bypasses the typed
          // coalescence window for instant barge-in and (b) speaks the
          // reply back even though the chat-tab session was opened
          // with speak=false (mirror-modality rule).
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

  const sidebarContent = (
    <View style={styles.sidebarInner}>
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
        {chatSessions.map((ses) => {
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
                        { text: 'Delete', style: 'destructive', onPress: () => removeSession(ses.id) },
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
              <TouchableOpacity
                style={styles.sessionDeleteBtn}
                onPress={() => removeSession(ses.id)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Feather name="x" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          );
        })}
        {chatSessions.length === 0 && (
          <Text style={styles.sidebarEmpty}>No sessions yet</Text>
        )}
      </ScrollView>
    </View>
  );

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
      name: 'model',
      description: 'Switch model: /model <name>',
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

  const paletteEntries: PaletteEntry[] = chatSessions.map((s) => {
    const last = s.messages[s.messages.length - 1];
    return {
      id: s.id,
      title: s.title || 'Untitled chat',
      subtitle: last ? `${last.role}: ${last.text.slice(0, 80)}` : 'Empty chat',
      icon: 'message-circle',
      pinned: s.pinned,
      onSelect: () => setActiveSession(s.id),
    };
  });

  return (
    <ResponsiveSidebar sidebar={sidebarContent}>
      <View style={styles.chatArea}>
        {isReconnecting && (
          <View style={styles.reconnectBanner}>
            <View
              style={styles.reconnectDot}
              {...(Platform.OS === 'web' ? { className: 'oa-pulse' } : {})}
            />
            <Text style={styles.reconnectText}>Reconnecting to agent…</Text>
          </View>
        )}
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
        {activeSession ? (
          <>
            <ScrollView
              ref={scrollRef}
              style={styles.messages}
              contentContainerStyle={styles.messagesContent}
              onScroll={handleScroll}
              scrollEventThrottle={120}
            >
              <View style={styles.messagesInner}>
                {activeSession.messages.length === 0 && (
                  <View style={styles.heroEmpty}>
                    <JarvisOrb size={160} label="OPENAGENT" />
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
                  onRegenerate={handleRegenerate}
                  onEditUser={handleEditUser}
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
            {!pinnedToBottom && (
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
              modelOptions={llmModels.map((m) => ({
                id: m.runtime_id,
                label: m.display_name || m.model || m.runtime_id,
                provider: m.provider_name,
              }))}
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
              disabled={activeSession.isProcessing}
              recording={Platform.OS === 'web' ? recording : undefined}
              onStartRecord={startRecording}
              onStopRecord={stopRecording}
              alwaysListening={
                Platform.OS === 'web' ? voiceConfig.chatAlwaysListen : undefined
              }
              onToggleAlwaysListen={toggleAlwaysListen}
            />
          </>
        ) : (
          <View style={styles.emptyState}>
            <JarvisOrb size={180} label="OPENAGENT" />
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
  sessionRow: {
    flexDirection: 'row', alignItems: 'center',
  },
  sessionDeleteBtn: {
    padding: 6, marginLeft: 0,
    width: 24, height: 24,
    alignItems: 'center', justifyContent: 'center',
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

  // Chat area
  chatArea: { flex: 1, flexDirection: 'column' },
  messages: { flex: 1 },
  messagesContent: { paddingVertical: 12, paddingBottom: 12 },
  messagesInner: { maxWidth: 760, width: '100%', alignSelf: 'center', paddingHorizontal: 20 },

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

  // Post-auth WS drop banner — see [[isReconnecting]] in connection store.
  reconnectBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8,
    backgroundColor: colors.codeBg,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  reconnectDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning,
  },
  reconnectText: {
    fontSize: 11, color: colors.textSecondary, fontFamily: font.mono,
    letterSpacing: 0.3,
  },

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
