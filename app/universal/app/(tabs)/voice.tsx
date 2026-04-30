/**
 * Voice — always-listening conversational screen.
 *
 * Loop: VAD detects speech → records utterance → uploads to gateway →
 * gateway transcribes + replies + streams TTS chunks back over the WS →
 * AudioQueuePlayer plays them → mic auto-mutes during playback to
 * prevent echo → unmutes when playback ends, mic re-arms instantly.
 *
 * Web/Electron only — native RN doesn't ship MediaRecorder. The screen
 * still renders with a fallback message + a typed-input composer so the
 * tab is at least usable on iOS/Android (text only).
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
import type { ServerMessage } from '../../../common/types';
import { useConnection } from '../../stores/connection';
import { useChat } from '../../stores/chat';
import { useVoiceConfig } from '../../stores/voice';
import MessageComposer from '../../components/MessageComposer';
import MessageList from '../../components/MessageList';
import SoundWaves, { type SoundWavesState } from '../../components/SoundWaves';
import { uploadFile, listDbModels } from '../../services/api';
import { AudioQueuePlayer, VoiceLoop } from '../../services/voice';
import { colors, font, radius } from '../../theme';

const log = (event: string, data?: Record<string, unknown>) => {
  // Tagged client log so the events read as a single timeline in
  // browser devtools alongside server elog lines.
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
  const [energy, setEnergy] = useState(0);
  const [vadState, setVadState] = useState<'idle' | 'listening'>('idle');
  const [audioState, setAudioState] = useState<'idle' | 'playing'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  // ``null`` = unknown (still loading), ``true`` = configured, ``false`` =
  // missing → render the diagnostic banner. Re-checked on every focus so
  // adding a TTS row in another tab clears the banner immediately.
  const [hasTts, setHasTts] = useState<boolean | null>(null);

  const audioPlayerRef = useRef<AudioQueuePlayer | null>(null);
  const voiceLoopRef = useRef<VoiceLoop | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const browserAvailable =
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  // Ensure a voice session exists on mount.
  useEffect(() => {
    if (!voiceSessionId) getOrCreateVoiceSession();
  }, [voiceSessionId, getOrCreateVoiceSession]);

  // Scroll transcript to end on new messages.
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  }, [voiceSession?.messages.length, voiceSession?.statusText]);

  // Start the mic + AudioQueuePlayer only while the tab is focused.
  // ``useFocusEffect`` fires its setup on focus and runs the cleanup on
  // blur — Expo Router's ``<Tabs>`` keeps the screen mounted across tab
  // switches, so the older mount-only useEffect leaked the mic stream.
  useFocusEffect(
    useCallback(() => {
      if (!browserAvailable || !ws) {
        log('focus.skip', { browserAvailable, hasWs: !!ws });
        return;
      }
      log('focus.start', { sessionId: voiceSessionId ?? null });

      // Check whether any enabled kind='tts' model row exists. The
      // banner surfaces the no-audio root cause without the user
      // having to grep server logs for ``voice.tts_not_configured``.
      void (async () => {
        try {
          const all = await listDbModels({ enabledOnly: true });
          const tts = all.filter((m) => m.kind === 'tts');
          log('tts.check', { enabledTtsCount: tts.length });
          setHasTts(tts.length > 0);
        } catch (e) {
          // Don't block voice mode on a probe failure — assume present.
          log('tts.check_error', { error: String(e) });
          setHasTts(true);
        }
      })();

      let cancelled = false;
      const player = new AudioQueuePlayer({
        onStateChange: (state) => {
          log('audio.state', { state });
          setAudioState(state);
        },
        onPlayingChange: (playing) => voiceLoopRef.current?.setMuted(playing),
      });
      audioPlayerRef.current = player;

      const offWs = ws.onMessage((msg: ServerMessage) => {
        // Tap the global stream just for voice-tab diagnostics — the
        // store-side handler in app/_layout.tsx still owns response /
        // status / error routing into the chat session.
        if (msg.type === 'response' && (msg as { session_id?: string }).session_id === voiceSessionId) {
          log('ws.response', {
            sessionId: msg.session_id,
            chars: msg.text?.length ?? 0,
          });
        } else if (msg.type === 'error' && (msg as { session_id?: string }).session_id === voiceSessionId) {
          log('ws.error', {
            sessionId: (msg as { session_id?: string }).session_id,
            text: msg.text,
          });
        } else if (msg.type === 'audio_start') {
          log('audio.start', { mime: msg.mime, voice: msg.voice_id });
          player.start(msg.mime || 'audio/mpeg');
        } else if (msg.type === 'audio_chunk') {
          player.enqueue(msg.seq, msg.data);
        } else if (msg.type === 'audio_end') {
          log('audio.end', { totalChunks: msg.total_chunks });
          player.end(msg.total_chunks ?? 0);
        }
      });

      const loop = new VoiceLoop({
        speechThreshold: voiceConfig.speechThreshold,
        silenceThreshold: voiceConfig.silenceThreshold,
        speechFrames: voiceConfig.speechFrames,
        silenceFrames: voiceConfig.silenceFrames,
        maxUtteranceMs: voiceConfig.maxUtteranceMs,
        minUtteranceMs: voiceConfig.minUtteranceMs,
        onUtterance: async (blob) => {
          const sid = voiceSessionId ?? getOrCreateVoiceSession();
          if (!ws) return;
          // 'auto' and '' both mean "no language hint" — the picker
          // uses 'auto' as the explicit user choice, '' is the
          // never-picked sentinel. Either way the backend should
          // auto-detect, so don't send the query param.
          const langHint = voiceConfig.language && voiceConfig.language !== 'auto'
            ? voiceConfig.language
            : undefined;
          log('utterance.upload', {
            bytes: blob.size, sessionId: sid,
            language: langHint || 'auto',
          });
          try {
            const res = await uploadFile(blob, 'voice.webm', {
              language: langHint,
            });
            if (!res.transcription) {
              log('utterance.no_transcription', { filename: res.filename });
              return;
            }
            log('utterance.transcribed', {
              chars: res.transcription.length,
              preview: res.transcription.slice(0, 80),
            });
            addUserMessage(sid, res.transcription);
            log('ws.send', {
              sessionId: sid,
              chars: res.transcription.length,
              inputWasVoice: true,
              voiceLanguage: langHint || 'auto',
            });
            // Forward the same ISO-639-1 hint Whisper used so Piper
            // synthesises the reply with a matching voice — without it
            // an Italian transcription gets read in an American accent.
            ws.sendMessage(res.transcription, sid, {
              inputWasVoice: true,
              voiceLanguage: langHint,
            });
          } catch (e) {
            console.error('[voice] upload failed:', e);
            log('utterance.upload_error', { error: String(e) });
          }
        },
        onSpeechStart: () => {
          if (cancelled) return;
          log('vad.speech_start');
          setVadState('listening');
        },
        onSpeechEnd: () => {
          if (cancelled) return;
          log('vad.speech_end');
          setVadState('idle');
        },
        onEnergy: (level) => { if (!cancelled) setEnergy(level); },
        onMicError: (reason) => {
          console.warn('[voice] mic error:', reason);
          log('mic.error', { reason });
          if (!cancelled) {
            setVadState('idle');
            setEnergy(0);
            setMicError(reason);
          }
        },
      });
      voiceLoopRef.current = loop;
      void loop.start().then((ok) => log('mic.start', { ok }));

      return () => {
        log('focus.cleanup');
        cancelled = true;
        offWs();
        loop.stop();
        player.stop();
        if (voiceLoopRef.current === loop) voiceLoopRef.current = null;
        if (audioPlayerRef.current === player) audioPlayerRef.current = null;
        setVadState('idle');
        setEnergy(0);
        setAudioState('idle');
        setMicError(null);
      };
    }, [
      browserAvailable, ws, voiceSessionId, addUserMessage,
      getOrCreateVoiceSession, voiceConfig,
    ]),
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

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Image source={logoIcon} style={styles.headerLogo} resizeMode="contain" />
          <Text style={styles.headerTitle}>Voice Chat</Text>
        </View>
        <TouchableOpacity style={styles.newBtn} onPress={handleNewSession}>
          <Feather name="plus" size={12} color={colors.textSecondary} />
          <Text style={styles.newBtnText}>New session</Text>
        </TouchableOpacity>
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
  headerLogo: { width: 22, height: 22 },
  headerTitle: {
    fontSize: 14, fontWeight: '500', color: colors.text,
    fontFamily: font.display, letterSpacing: -0.2,
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
