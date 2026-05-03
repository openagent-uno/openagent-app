/**
 * Voice — always-listening conversational screen with streaming I/O.
 *
 * Streaming flow (Deepgram + StreamSession):
 *   focus → ws.sendSessionOpen({ language })
 *   VAD speech_start → MediaRecorder begins, chunks fire every ~250 ms
 *   each chunk → ws.sendAudioChunkIn(base64, { encoding: 'webm' })
 *   VAD speech_end → ws.sendAudioEndIn(sessionId)  (flushes the STT pump)
 *   server emits OutTextDelta (partial transcript), then TextFinal (committed
 *   user line, source='stt'), then DELTA + AUDIO_* + RESPONSE for the reply
 *   blur → ws.sendSessionClose(sessionId)
 *
 * Server-side (StreamSession) drives the STT transducer live, so the
 * Deepgram WS is fed audio as the user speaks — partials in ~150 ms,
 * final inside the user's last syllable. Replaces the legacy REST
 * upload + Whisper one-shot path which capped TTFA at ~3 s.
 *
 * Video (LLM path): two toggles next to the new-session button start
 * webcam / screen capture loops at 1 fps. Each frame ships via
 * ws.sendVideoFrame(stream, base64). Server-side, StreamSession keeps a
 * ring of 8 frames per stream and snapshots the latest as an image
 * attachment at turn-trigger time, so the model "sees" what was on
 * screen / camera the moment the user stopped speaking.
 *
 * Web/Electron only — native RN doesn't ship MediaRecorder /
 * getUserMedia. The screen falls back to typed-input on iOS/Android.
 *
 * Session: a fresh chat session is created on first visit per app launch
 * (``getOrCreateVoiceSession``); subsequent visits resume it. App reload
 * → fresh session (zustand store is in-memory only).
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform, Image,
} from 'react-native';

const logoIcon = require('../../assets/openagent-icon.png');
import { useConnection } from '../../stores/connection';
import { useChat } from '../../stores/chat';
import { useVoiceConfig } from '../../stores/voice';
import MessageComposer from '../../components/MessageComposer';
import MessageList from '../../components/MessageList';
import SoundWaves, { type SoundWavesState } from '../../components/SoundWaves';
import { listDbModels } from '../../services/api';
import {
  startWebcamCapture, startScreenCapture, useStreamingMic,
  type VideoStreamHandle,
} from '../../services/voice';
import { colors, font, radius } from '../../theme';

const log = (event: string, data?: Record<string, unknown>) => {
  console.log(`[voice] ${event}`, data ?? {});
};

const TRANSCRIPT_TAIL = 6;

export default function VoiceScreen() {
  const ws = useConnection((s) => s.ws);
  const {
    sessions, voiceSessionId, getOrCreateVoiceSession, clearVoiceSession,
    addUserMessage,
  } = useChat();

  const voiceSession = sessions.find((s) => s.id === voiceSessionId);
  const voiceConfig = useVoiceConfig((s) => s.config);

  const [input, setInput] = useState('');
  // ``null`` = unknown (still loading), ``true`` = configured, ``false`` =
  // missing → render the diagnostic banner. Re-checked on every focus so
  // adding a TTS row in another tab clears the banner immediately.
  const [hasTts, setHasTts] = useState<boolean | null>(null);
  const [webcamOn, setWebcamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const webcamHandleRef = useRef<VideoStreamHandle | null>(null);
  const screenHandleRef = useRef<VideoStreamHandle | null>(null);
  // The frame-grab loops capture this ref instead of ``voiceSessionId``
  // directly so a "New session" mid-share keeps streaming to the
  // currently active voice session — without it the closure pinned the
  // first sid forever and the agent's per-turn snapshot landed against
  // a session whose dispatch loop had already torn down.
  const voiceSessionIdRef = useRef<string | null>(voiceSessionId ?? null);
  voiceSessionIdRef.current = voiceSessionId ?? null;

  const browserAvailable =
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  useEffect(() => {
    if (!voiceSessionId) getOrCreateVoiceSession();
  }, [voiceSessionId, getOrCreateVoiceSession]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  }, [voiceSession?.messages.length, voiceSession?.statusText]);

  const langHint = voiceConfig.language && voiceConfig.language !== 'auto'
    ? voiceConfig.language : undefined;

  const handleVoiceTranscript = useCallback((text: string) => {
    if (voiceSessionId) {
      log('stt.committed', { chars: text.length });
      addUserMessage(voiceSessionId, text);
    }
  }, [voiceSessionId, addUserMessage]);

  const { vadState, audioState, energy, micError } = useStreamingMic({
    ws,
    sessionId: voiceSessionId ?? null,
    enabled: browserAvailable,
    voiceConfig,
    sessionOpen: { profile: 'realtime', clientKind: 'webapp', language: langHint },
    onTranscript: handleVoiceTranscript,
    onLog: log,
    onFirstPcmFrame: (info) => log('pcm.first_frame', info),
  });

  // Voice-tab-only focus lifecycle: TTS-availability probe + video
  // capture cleanup + explicit ``sendSessionClose`` on blur (the chat
  // tab keeps its session alive across tab switches; voice mode tears
  // down so a fresh ``sendSessionOpen`` re-pins the language on next
  // focus).
  useFocusEffect(
    useCallback(() => {
      if (!ws) return;
      const sid = voiceSessionId;
      if (!sid) return;

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
        ws.sendSessionClose(sid);
      };
    }, [ws, voiceSessionId]),
  );

  // Derived SoundWaves state. ``processing`` only when we have a session
  // and it's mid-turn — avoids a flicker on initial mount.
  const swState: SoundWavesState =
    audioState === 'playing' ? 'speaking'
    : voiceSession?.isProcessing ? 'processing'
    : vadState === 'listening' ? 'listening'
    : 'idle';

  const caption = micError ? `Mic ${micError}`
    : swState === 'speaking' ? 'Speaking…'
    : swState === 'processing' ? 'Thinking…'
    : swState === 'listening' ? 'Listening…'
    : 'Speak any time';

  const handleSend = useCallback(() => {
    if (!ws) return;
    const text = input.trim();
    if (!text) return;
    const sid = voiceSessionId ?? getOrCreateVoiceSession();
    addUserMessage(sid, text);
    ws.sendMessage(text, sid);
    setInput('');
  }, [ws, input, voiceSessionId, addUserMessage, getOrCreateVoiceSession]);

  const handleNewSession = useCallback(() => {
    clearVoiceSession();
    getOrCreateVoiceSession();
  }, [clearVoiceSession, getOrCreateVoiceSession]);

  const toggleWebcam = useCallback(async () => {
    if (!ws) return;
    if (webcamHandleRef.current) {
      webcamHandleRef.current.stop();
      webcamHandleRef.current = null;
      setWebcamOn(false);
      log('webcam.stop');
      return;
    }
    // Make sure a session exists before opening the camera. Seed the
    // ref synchronously so the first-second frame doesn't drop on the
    // floor while React waits to re-render. Subsequent frames keep
    // reading ``voiceSessionIdRef.current`` so a "New session" click
    // mid-share rebinds to whatever session is now live.
    if (!voiceSessionIdRef.current) {
      voiceSessionIdRef.current = getOrCreateVoiceSession();
    }
    try {
      const handle = await startWebcamCapture(
        (b64, w, h) => {
          const sid = voiceSessionIdRef.current;
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
  }, [ws, getOrCreateVoiceSession]);

  const toggleScreen = useCallback(async () => {
    if (!ws) return;
    if (screenHandleRef.current) {
      screenHandleRef.current.stop();
      screenHandleRef.current = null;
      setScreenOn(false);
      log('screen.stop');
      return;
    }
    if (!voiceSessionIdRef.current) {
      voiceSessionIdRef.current = getOrCreateVoiceSession();
    }
    try {
      const handle = await startScreenCapture(
        (b64, w, h) => {
          const sid = voiceSessionIdRef.current;
          if (!sid) return;
          ws.sendVideoFrame(sid, 'screen', b64, { width: w, height: h });
        },
        { fps: 1 },
      );
      screenHandleRef.current = handle;
      setScreenOn(true);
      log('screen.start');
    } catch (e) {
      // User cancelled the share-picker, or browser declined.
      log('screen.error', { error: String(e) });
    }
  }, [ws, getOrCreateVoiceSession]);

  const videoSupported = browserAvailable
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia;
  const screenSupported = videoSupported
    // ``getDisplayMedia`` lives on ``mediaDevices`` in modern browsers.
    && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={logoIcon} style={styles.headerLogo} resizeMode="contain" />
          <Text style={styles.headerTitle}>Voice Chat</Text>
        </View>
        <View style={styles.headerRight}>
          {videoSupported && (
            <TouchableOpacity
              style={[styles.iconBtn, webcamOn && styles.iconBtnActive]}
              onPress={toggleWebcam}
              accessibilityLabel={webcamOn ? 'Stop webcam' : 'Share webcam'}
            >
              <Feather
                name={webcamOn ? 'video' : 'video-off'}
                size={14}
                color={webcamOn ? colors.text : colors.textSecondary}
              />
            </TouchableOpacity>
          )}
          {screenSupported && (
            <TouchableOpacity
              style={[styles.iconBtn, screenOn && styles.iconBtnActive]}
              onPress={toggleScreen}
              accessibilityLabel={screenOn ? 'Stop screen share' : 'Share screen'}
            >
              <Feather
                name={screenOn ? 'monitor' : 'cast'}
                size={14}
                color={screenOn ? colors.text : colors.textSecondary}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.newBtn} onPress={handleNewSession}>
            <Feather name="plus" size={12} color={colors.textSecondary} />
            <Text style={styles.newBtnText}>New session</Text>
          </TouchableOpacity>
        </View>
      </View>

      {hasTts === false && (
        <View style={styles.banner} accessibilityRole="alert">
          <Feather name="volume-x" size={13} color={colors.error} />
          <Text style={styles.bannerText}>
            No TTS model configured — replies will be text-only. Add a{' '}
            <Text style={styles.bannerStrong}>kind=tts</Text> row in Models to hear spoken replies.
          </Text>
        </View>
      )}

      <View style={styles.stage}>
        {browserAvailable ? (
          <>
            <SoundWaves level={energy} state={swState} />
            <Text style={styles.caption}>{caption}</Text>
            {(webcamOn || screenOn) && (
              <Text style={styles.shareBadge}>
                Sharing: {[webcamOn && 'webcam', screenOn && 'screen'].filter(Boolean).join(' + ')}
              </Text>
            )}
          </>
        ) : (
          <View style={styles.fallback}>
            <Feather name="mic-off" size={28} color={colors.textMuted} />
            <Text style={styles.fallbackTitle}>Voice mode requires browser or desktop</Text>
            <Text style={styles.fallbackSub}>
              Open OpenAgent in a web browser or the desktop app to use the always-listening voice loop.
              You can still type messages below.
            </Text>
          </View>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.transcript}
        contentContainerStyle={styles.transcriptContent}
      >
        {(voiceSession?.messages.length ?? 0) === 0 ? (
          <Text style={styles.transcriptEmpty}>
            The transcript will appear here as you speak.
          </Text>
        ) : (
          <MessageList
            messages={voiceSession!.messages}
            isProcessing={voiceSession!.isProcessing}
            statusText={voiceSession!.statusText}
            maxItems={TRANSCRIPT_TAIL}
          />
        )}
      </ScrollView>

      <MessageComposer
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        disabled={!!voiceSession?.isProcessing}
        placeholder="Or type a message…"
        showHint={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.borderLight,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerLogo: { width: 22, height: 22 },
  headerTitle: {
    fontSize: 14, fontWeight: '500', color: colors.text,
    fontFamily: font.display, letterSpacing: -0.2,
  },
  iconBtn: {
    width: 28, height: 28, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  iconBtnActive: {
    borderColor: colors.text,
    backgroundColor: colors.borderLight,
  },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  newBtnText: {
    fontSize: 10, fontWeight: '600', color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },

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

  stage: {
    flex: 6, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20,
  },
  caption: {
    marginTop: 18, fontSize: 12, color: colors.textMuted,
    fontFamily: font.mono, letterSpacing: 0.6, textTransform: 'uppercase',
  },
  shareBadge: {
    marginTop: 6, fontSize: 10, color: colors.textSecondary,
    fontFamily: font.mono, letterSpacing: 0.4,
  },

  fallback: {
    alignItems: 'center', maxWidth: 360, paddingHorizontal: 16,
  },
  fallbackTitle: {
    fontSize: 14, fontWeight: '500', color: colors.text,
    marginTop: 12, marginBottom: 6, textAlign: 'center',
    fontFamily: font.display,
  },
  fallbackSub: {
    fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 18,
  },

  transcript: {
    flex: 3,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  transcriptContent: {
    paddingHorizontal: 20, paddingVertical: 12,
    maxWidth: 760, width: '100%', alignSelf: 'center',
  },
  transcriptEmpty: {
    fontSize: 12, color: colors.textMuted, textAlign: 'center',
    paddingVertical: 24, fontStyle: 'italic',
  },
});
