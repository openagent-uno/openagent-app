/**
 * Login screen — saved networks list + join/sign-in form.
 *
 * Two paths:
 *   1. "Sign in" — pick a saved account, enter the password, connect.
 *      Cert is refreshed under the hood; no other data needed.
 *   2. "Join with invite" — first-time on this device. Paste the
 *      ``oa1…`` ticket the network owner gave you, choose a handle,
 *      set a password. The ticket carries the network name, coordinator
 *      NodeId, invite code, and role — the renderer never sees those
 *      individually.
 */

import { colors, font, radius } from '../theme';
import Feather from '@expo/vector-icons/Feather';
import { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection, directedAccountId } from '../stores/connection';
import { useChat } from '../stores/chat';
import { useConfirm } from '../components/ConfirmDialog';
import Button from '../components/Button';
import Card from '../components/Card';
import Input from '../components/Input';
import WindowControls from '../components/WindowControls';
import DragRegion from '../components/DragRegion';
import { JarvisClock } from '../components/jarvis';
import BrandLogo from '../components/BrandLogo';

type Mode = 'signin' | 'join';

function extractAgentName(acc: { name: string; handle: string }): string {
  const parts = acc.name.split(' — ');
  if (parts.length > 1) return parts[parts.length - 1];
  if (acc.name === acc.handle) return acc.name;
  return acc.name;
}

export default function LoginScreen() {
  const router = useRouter();
  // Standalone agent window marker: this login screen belongs to a window
  // opened bound to a specific account (``?connect=<accountId>``, mirrored
  // to per-window sessionStorage). _layout's boot already kicks off a
  // passwordless connect to that account's running loopback.
  const connectId = directedAccountId();
  // The login screen has no sidebar, so on macOS it carries its own window
  // controls + drag strip (the sidebar hosts them everywhere else; Win/Linux
  // get them from the global chrome Header).
  const isMacDesktop = typeof window !== 'undefined'
    && (window as any).desktop?.isDesktop === true
    && (window as any).desktop?.platform === 'darwin';
  const {
    accounts, isConnected, isConnecting, error, agentName,
    joinNetwork, connectAccount, removeAccount,
  } = useConnection();
  const connectingAccount = connectId ? accounts.find((a) => a.id === connectId) : undefined;
  const createSession = useChat((s) => s.createSession);
  const sessions = useChat((s) => s.sessions);
  const sessionsHydrated = useChat((s) => s.sessionsHydrated);
  const confirm = useConfirm();

  // Default to the join form when no accounts exist; switch to sign-in
  // when the user has at least one network on this device.
  const [mode, setMode] = useState<Mode>(accounts.length > 0 ? 'signin' : 'join');

  // Sign-in form
  const [signinAccountId, setSigninAccountId] = useState<string | null>(null);
  const [signinPassword, setSigninPassword] = useState('');

  // Join form — one ticket string, optional handle (the user picks
  // theirs only for role=user tickets; role=device tickets carry the
  // bound handle and the loopback ignores ours), and a password.
  const [joinTicket, setJoinTicket] = useState('');
  const [joinHandle, setJoinHandle] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  // Decoded ticket info, populated when the user pastes a valid
  // ticket. ``role=device`` tickets carry the handle they bind to
  // and we auto-fill + lock the handle field; ``role=user`` tickets
  // let the user pick. ``null`` = no ticket yet OR ticket couldn't
  // be decoded (manual entry path, same as before).
  const [ticketIntent, setTicketIntent] = useState<{
    role: 'user' | 'device' | 'agent';
    bindTo: string;
    networkName: string;
  } | null>(null);

  // Only redirect when the user actually pressed "Sign in" / "Join" on
  // this screen and the connection then succeeded. The previous
  // "redirect whenever isConnected is true" logic bounced the user to
  // /(tabs)/chat the instant the screen mounted while a stale
  // ``isConnected: true`` was still latched (e.g. the header's + button
  // hadn't finished tearing down) — landing them on an empty chat.
  const attemptedRef = useRef(false);
  useEffect(() => {
    if (attemptedRef.current && isConnected && agentName && sessionsHydrated) {
      attemptedRef.current = false;
      // Only create a fresh session when the server returned no
      // persisted ones — otherwise the chat store is already
      // hydrated and the user can pick up where they left off.
      if (sessions.length === 0) {
        createSession();
      }
      router.replace('/(tabs)/chat');
    }
  }, [isConnected, agentName, sessions.length, sessionsHydrated]);

  // Auto-select the first account when sign-in mode opens with one in
  // the list — saves the user a click on the common case.
  useEffect(() => {
    if (mode === 'signin' && signinAccountId === null && accounts.length > 0) {
      setSigninAccountId(accounts[0].id);
    }
  }, [mode, accounts.length]);

  // Standalone agent window: preselect the bound account and mark the
  // attempt so the success effect above redirects to chat once the
  // passwordless connect (kicked off in _layout) lands. If that loopback
  // isn't up (rare), the user just types the password on the preselected
  // account and signs in normally.
  useEffect(() => {
    if (typeof connectId === 'string' && connectId) {
      attemptedRef.current = true;
      setMode('signin');
      setSigninAccountId(connectId);
    }
  }, [connectId]);

  // Decode the ticket whenever it changes so the form can auto-fill
  // the handle for ``role=device`` tickets (the user only has to type
  // their password) and clearly show what they're joining. On web,
  // ``window.desktop`` is undefined → no decode, falls back to the
  // manual-entry path (same as before).
  useEffect(() => {
    const ticket = joinTicket.trim();
    if (!ticket.startsWith('oa1')) {
      setTicketIntent(null);
      return;
    }
    // @ts-ignore — runtime-injected by Electron preload
    const d = (typeof window !== 'undefined') ? (window as any).desktop : null;
    if (!d || typeof d.decodeTicket !== 'function') {
      setTicketIntent(null);
      return;
    }
    let cancelled = false;
    void d.decodeTicket(ticket).then((info: any) => {
      if (cancelled) return;
      if (info && typeof info === 'object') {
        setTicketIntent({
          role: info.role,
          bindTo: info.bindTo ?? '',
          networkName: info.networkName ?? '',
        });
        // For device-bound tickets, auto-fill the handle. The user
        // can't pick a different one anyway — the coordinator
        // rejects the SRP login if the handle doesn't match
        // ``bind_to``.
        if (info.role === 'device' && info.bindTo) {
          setJoinHandle(info.bindTo);
        }
      } else {
        setTicketIntent(null);
      }
    });
    return () => { cancelled = true; };
  }, [joinTicket]);

  const hasSaved = accounts.length > 0;

  const handleSignIn = () => {
    if (!signinAccountId || !signinPassword) return;
    attemptedRef.current = true;
    void connectAccount(signinAccountId, signinPassword);
    setSigninPassword('');
  };

  const handleJoin = () => {
    const ticket = joinTicket.trim();
    const handle = joinHandle.trim().toLowerCase();
    if (!ticket || !handle || !joinPassword) return;
    if (!ticket.startsWith('oa1')) return;
    attemptedRef.current = true;
    void joinNetwork({
      ticket,
      handle,
      password: joinPassword,
      isLocal: false,
    });
    setJoinPassword('');
  };

  const ErrorBox = ({ message }: { message: string }) => (
    <View style={styles.errorBox}>
      <Feather
        name="alert-triangle"
        size={14}
        color={colors.error}
        style={styles.errorIcon}
      />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );

  const handleRemove = async (id: string, accName: string) => {
    const confirmed = await confirm({
      title: 'Remove network',
      message: `Forget "${accName}"? You'll need the invite + password again to rejoin.`,
      confirmLabel: 'Forget',
    });
    if (!confirmed) return;
    void removeAccount(id);
    if (signinAccountId === id) setSigninAccountId(null);
  };

  return (
    <View style={styles.screen}>
      {isMacDesktop && (
        <View style={styles.macStrip}>
          {/* Drag layer behind the controls (sibling, never their parent). */}
          <DragRegion />
          <WindowControls />
        </View>
      )}
      <ScrollView contentContainerStyle={styles.container}>
      <View
        style={styles.inner}
        // @ts-ignore
        {...(Platform.OS === 'web' ? { className: 'oa-slide-up' } : {})}
      >
        <View style={styles.wakeScene}>
          <BrandLogo size={108} />
          <View style={styles.clockWrap}>
            <JarvisClock size="md" />
          </View>
        </View>

        {/* Standalone agent window opening its own connection — show a
            "connecting" line instead of a bare login form while the
            passwordless connect lands. */}
        {connectId && isConnecting && (
          <Text style={[styles.subtitle, { textAlign: 'center' }]}>
            Connecting to {connectingAccount ? extractAgentName(connectingAccount) : 'agent'}…
          </Text>
        )}

        {hasSaved && (
          <>
            <Text style={styles.sectionKicker}>Your networks</Text>
            <Card padded={false}>
              {accounts.map((acc, i) => {
                const selected = mode === 'signin' && signinAccountId === acc.id;
                const agentNameDisplay = extractAgentName(acc);
                return (
                  <TouchableOpacity
                    key={acc.id}
                    onPress={() => {
                      setMode('signin');
                      setSigninAccountId(acc.id);
                    }}
                    style={[
                      styles.accountRow,
                      i > 0 && styles.accountRowBorder,
                      selected && styles.accountRowSelected,
                    ]}
                  >
                    <View style={styles.accountInfo}>
                      <Text style={styles.accountName}>{agentNameDisplay}</Text>
                      <Text style={styles.accountHost}>@{acc.handle}</Text>
                    </View>
                    {selected && (
                      <Feather name="check" size={14} color={colors.accent} style={{ marginRight: 8 }} />
                    )}
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => { void handleRemove(acc.id, acc.name); }}
                      hitSlop={8}
                    >
                      <Feather name="x" size={13} color={colors.textMuted} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </Card>
          </>
        )}

        {/* Mode toggle. Shown when there are saved accounts so the user
            can flip to "join" without losing their list. With no saved
            accounts we hide the toggle and show join only. */}
        {hasSaved && (
          <View style={styles.tabs}>
            <TouchableOpacity
              onPress={() => setMode('signin')}
              style={[styles.tab, mode === 'signin' && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, mode === 'signin' && styles.tabLabelActive]}>
                Sign in
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode('join')}
              style={[styles.tab, mode === 'join' && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, mode === 'join' && styles.tabLabelActive]}>
                Join with invite
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!hasSaved && (
          <Text style={[styles.sectionKicker, { marginTop: 12 }]}>Join a network</Text>
        )}
        {!hasSaved && (
          <Text style={styles.subtitle}>
            Connect to an OpenAgent network. Need an invite code from the network owner.
          </Text>
        )}

        {mode === 'signin' && hasSaved && (
          <Card>
            <Text style={styles.formHint}>
              Selected: <Text style={styles.formHintMono}>
                {(() => {
                  const a = accounts.find((a) => a.id === signinAccountId);
                  return a ? `@${a.handle}` : '—';
                })()}
              </Text>
            </Text>
            <Input
              label="Password"
              value={signinPassword}
              onChangeText={setSigninPassword}
              placeholder="••••••••"
              secureTextEntry
              containerStyle={{ marginTop: 12 }}
              onSubmitEditing={handleSignIn}
            />
            {error && <ErrorBox message={error} />}
            <Button
              variant="primary"
              size="md"
              fullWidth
              label={isConnecting ? 'Connecting…' : 'Sign in'}
              onPress={handleSignIn}
              disabled={isConnecting || !signinPassword || !signinAccountId}
              style={{ marginTop: 14 }}
            />
          </Card>
        )}

        {mode === 'join' && (
          <Card>
            <Input
              label="Invite ticket"
              value={joinTicket}
              onChangeText={setJoinTicket}
              placeholder="oa1abcdef… (paste from `openagent invite`)"
              autoCapitalize="none"
              autoCorrect={false}
              mono
              containerStyle={{ marginTop: 0 }}
            />
            {ticketIntent ? (
              <Text style={styles.fieldHint}>
                {ticketIntent.role === 'device' && ticketIntent.bindTo
                  ? `Joining ${ticketIntent.networkName || 'this network'} as ${ticketIntent.bindTo} — paired device for an existing account.`
                  : `Joining ${ticketIntent.networkName || 'this network'} — pick a handle below.`}
              </Text>
            ) : (
              <Text style={styles.fieldHint}>
                Paste the [oa1…] string from [openagent invite].
              </Text>
            )}

            <Input
              label="Handle"
              value={joinHandle}
              onChangeText={setJoinHandle}
              placeholder="alice"
              autoCapitalize="none"
              autoCorrect={false}
              mono
              containerStyle={{ marginTop: 12 }}
              editable={ticketIntent?.role !== 'device'}
            />
            {ticketIntent?.role !== 'device' && (
              <Text style={styles.fieldHint}>
                Choose the handle you want in this network.
              </Text>
            )}

            <Input
              label="Password"
              value={joinPassword}
              onChangeText={setJoinPassword}
              placeholder="••••••••"
              secureTextEntry
              containerStyle={{ marginTop: 12 }}
              onSubmitEditing={handleJoin}
            />

            {error && <ErrorBox message={error} />}

            <Button
              variant="primary"
              size="md"
              fullWidth
              label={isConnecting ? 'Joining…' : 'Join network'}
              onPress={handleJoin}
              disabled={
                isConnecting || !joinTicket.trim().startsWith('oa1') ||
                !joinHandle || !joinPassword
              }
              style={{ marginTop: 14 }}
            />
          </Card>
        )}
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // macOS: a transparent full-width drag strip at the very top, hosting the
  // custom window controls (top-left). Overlays the content, reserves no space.
  macStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 36,
    zIndex: 100,
  },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  inner: {
    width: 460,
    maxWidth: '100%',
  },
  wakeScene: {
    alignItems: 'center',
    marginBottom: 32,
    marginTop: 8,
  },
  clockWrap: {
    marginTop: 12,
  },
  sectionKicker: {
    fontSize: 10, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 14,
    marginTop: -4,
  },

  // Saved networks
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  accountRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  accountRowSelected: {
    backgroundColor: colors.surface,
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.2,
  },
  accountHost: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  deleteBtn: {
    padding: 8,
  },

  // Mode tabs
  tabs: {
    flexDirection: 'row',
    marginTop: 24,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
    marginBottom: -1,
  },
  tabLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: colors.text,
  },

  // Form
  fieldRow: { flexDirection: 'row' },
  fieldHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 6,
    lineHeight: 15,
  },
  formHint: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  formHintMono: {
    fontFamily: font.mono,
    color: colors.text,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.errorSoft,
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 12,
  },
  errorIcon: {
    marginTop: 1,
    marginRight: 8,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: 12.5,
    lineHeight: 17,
  },
});
