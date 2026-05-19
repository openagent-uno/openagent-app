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

import { useState, useRef, useEffect, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
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
import MessageComposer, { type PendingFile } from '../../components/MessageComposer';
import MessageList from '../../components/MessageList';
import { JarvisOrb } from '../../components/jarvis';
import { uploadFile, listDbModels } from '../../services/api';
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
  const ws = useConnection((s) => s.ws);
  const {
    sessions, activeSessionId,
    createSession, setActiveSession, removeSession, renameSession,
    addUserMessage,
  } = useChat();

  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const isDesktop = typeof window !== 'undefined' && !!window.desktop?.isDesktop;
  const [recording, setRecording] = useState(false);
  const voiceLanguage = useVoiceConfig((s) => s.config.language);
  const voiceConfig = useVoiceConfig((s) => s.config);
  const setVoiceConfig = useVoiceConfig((s) => s.setConfig);
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Voice mode state
  const [hasTts, setHasTts] = useState<boolean | null>(null);
  const [webcamOn, setWebcamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const webcamHandleRef = useRef<VideoStreamHandle | null>(null);
  const screenHandleRef = useRef<VideoStreamHandle | null>(null);
  const activeSessionIdRef = useRef<string | null>(activeSessionId ?? null);
  activeSessionIdRef.current = activeSessionId ?? null;

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

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [activeSession?.messages.length, activeSession?.statusText]);

  const swState: SoundWavesState =
    audioState === 'playing' ? 'speaking'
    : activeSession?.isProcessing ? 'processing'
    : vadState === 'listening' ? 'listening'
    : 'idle';

  const caption = micError ? `Mic ${micError}`
    : swState === 'speaking' ? 'Speaking…'
    : swState === 'processing' ? 'Thinking…'
    : swState === 'listening' ? 'Listening…'
    : 'Speak any time';

  const handleSend = () => {
    if (!ws || !activeSessionId) return;
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;

    let msg = text;
    let displayMsg = text;

    const attachments: Attachment[] = pendingFiles.map((f) => ({
      type: f.kind,
      path: f.remotePath,
      filename: f.filename,
    }));

    if (pendingFiles.length > 0) {
      const lines = pendingFiles.map(
        (f) => `- ${f.kind}: ${f.filename} — server path: ${f.remotePath}`,
      );
      const noun = pendingFiles.length === 1 ? 'a file' : `${pendingFiles.length} files`;
      const fileHeader = `The user attached ${noun}:\n${lines.join('\n')}\nUse the Read tool to inspect ${pendingFiles.length === 1 ? 'it' : 'them'}.`;
      msg = text ? `${fileHeader}\n\nUser message: ${text}` : fileHeader;
      displayMsg = text;
    }

    addUserMessage(activeSessionId, displayMsg, attachments.length ? attachments : undefined);
    ws.sendMessage(msg, activeSessionId);
    setInput('');
    setPendingFiles([]);
  };

  const guessMimeType = (filename: string, kind: 'image' | 'file'): string => {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const mimes: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
      webp: 'image/webp', bmp: 'image/bmp', heic: 'image/heic', tiff: 'image/tiff',
      pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
      csv: 'text/csv', json: 'application/json', yaml: 'application/x-yaml',
      yml: 'application/x-yaml', log: 'text/plain',
      py: 'text/x-python', js: 'application/javascript', ts: 'application/typescript',
      webm: 'audio/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg',
      wav: 'audio/wav', m4a: 'audio/mp4',
    };
    return mimes[ext] || (kind === 'image' ? 'application/octet-stream' : 'application/octet-stream');
  };

  const handleFilePick = async () => {
    if (isDesktop && window.desktop?.pickFiles && window.desktop?.readFile) {
      let picked: { path: string; filename: string; kind: 'image' | 'file' }[] = [];
      try {
        picked = await window.desktop.pickFiles();
      } catch (e: any) {
        console.error('Native picker failed:', e);
        return;
      }
      if (!picked.length) return;

      const uploads = await Promise.allSettled(
        picked.map(async (p) => {
          const bytes = await window.desktop!.readFile!(p.path);
          const blob = new Blob([bytes as BlobPart], { type: guessMimeType(p.filename, p.kind) });
          const file = new File([blob], p.filename, { type: blob.type });
          const result = await uploadFile(file);
          return { filename: result.filename, remotePath: result.path, kind: p.kind };
        }),
      );
      const next: PendingFile[] = [];
      uploads.forEach((u, i) => {
        if (u.status === 'fulfilled') {
          next.push(u.value);
        } else {
          console.error('Desktop upload failed:', picked[i].filename, u.reason);
        }
      });
      if (next.length) setPendingFiles((prev) => [...prev, ...next]);
      return;
    }

    if (isDesktop && window.desktop?.pickFiles) {
      try {
        const picked = await window.desktop.pickFiles();
        if (picked.length) {
          setPendingFiles((prev) => [
            ...prev,
            ...picked.map((f) => ({ filename: f.filename, remotePath: f.path, kind: f.kind })),
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
      if (files.length === 0) return;
      const uploads = await Promise.allSettled(files.map((f) => uploadFile(f)));
      const next: PendingFile[] = [];
      uploads.forEach((u, i) => {
        if (u.status === 'fulfilled') {
          const kind = files[i].type?.startsWith('image/') ? 'image' as const : 'file' as const;
          next.push({ filename: u.value.filename, remotePath: u.value.path, kind });
        } else {
          console.error('Upload failed:', files[i].name, u.reason);
        }
      });
      if (next.length) setPendingFiles((prev) => [...prev, ...next]);
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
      <ScrollView style={styles.sessionList}>
        {sessions.map((ses) => {
          const isEditing = editingSessionId === ses.id;
          return (
            <View key={ses.id} style={styles.sessionRow}>
              <TouchableOpacity
                style={[styles.sessionItem, ses.id === activeSessionId && styles.sessionActive]}
                onPress={() => { setEditingSessionId(null); setActiveSession(ses.id); }}
                onLongPress={() => {
                  if (Platform.OS === 'web') {
                    const name = window.prompt('Rename session:', ses.title);
                    if (name && name.trim()) renameSession(ses.id, name.trim());
                  } else {
                    Alert.alert(
                      ses.title,
                      undefined,
                      [
                        { text: 'Rename', onPress: () => { setEditingSessionId(ses.id); setEditTitle(ses.title); } },
                        { text: 'Delete', style: 'destructive', onPress: () => removeSession(ses.id) },
                        { text: 'Cancel', style: 'cancel' },
                      ],
                    );
                  }
                }}
                activeOpacity={0.7}
              >
                {ses.id === activeSessionId && <View style={styles.sessionActiveBar} />}
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
                {ses.isProcessing && (
                  <View style={styles.processingDot} {...(Platform.OS === 'web' ? { className: 'oa-pulse' } : {})} />
                )}
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
        {sessions.length === 0 && (
          <Text style={styles.sidebarEmpty}>No sessions yet</Text>
        )}
      </ScrollView>
    </View>
  );

  return (
    <ResponsiveSidebar sidebar={sidebarContent}>
      <View style={styles.chatArea}>
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

            <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent}>
              <View style={styles.messagesInner}>
                {activeSession.messages.length === 0 && (
                  <View style={styles.heroEmpty}>
                    <JarvisOrb size={160} label="OPENAGENT" />
                    <Text style={styles.heroTitle}>At your service</Text>
                    <Text style={styles.heroSub}>
                      Ask a question, request a task, or attach a file.
                    </Text>
                  </View>
                )}
                <MessageList
                  messages={activeSession.messages}
                  isProcessing={activeSession.isProcessing}
                  statusText={activeSession.statusText}
                />
              </View>
            </ScrollView>

            <MessageComposer
              input={input}
              onInputChange={setInput}
              pendingFiles={pendingFiles}
              onRemoveFile={(idx) => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
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
    padding: 6, marginLeft: 4,
    width: 24, height: 24,
    alignItems: 'center', justifyContent: 'center',
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
  sidebarEmpty: {
    fontSize: 11, color: colors.textMuted, textAlign: 'center',
    paddingVertical: 20,
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
});
