/**
 * AgentSwitcher — the clickable agent identity beneath the sidebar logo,
 * and the full agent-management surface it opens.
 *
 * Tap the trigger and a JARVIS modal slides in: every saved agent
 * (`handle@network`) is listed; tap one to sign into it (a password row
 * unfolds inline), remove one with the trash control, or open "Add an
 * agent" to paste an invite ticket and join a new network. Switching is
 * the connection store's destructive switch (tear down + reconnect), so
 * it always re-prompts for the password — the modal just keeps that flow
 * in one place instead of bouncing the user back to the login route.
 *
 * Two trigger variants:
 *   - `wordmark` — the full sidebar: agent name + chevron + hairline rule.
 *   - `icon`     — the icon-density sidebar: a status-dotted avatar.
 *
 * Stays on the Ink-of-night JARVIS theme: glass sheet, cyan top rail,
 * tracked small-caps heading.
 */

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useConnection } from '../stores/connection';
import { useConfirm } from './ConfirmDialog';
import Button from './Button';
import Input from './Input';
import { colors, font, radius, spacing, tracking, glassSurface } from '../theme';

type Variant = 'wordmark' | 'icon' | 'compact';

/** The agent's friendly name is the trailing segment of the saved label
 *  (`handle@network — Agent`), falling back to the whole label. */
function extractAgentName(acc: { name: string; handle: string }): string {
  const parts = acc.name.split(' — ');
  if (parts.length > 1) return parts[parts.length - 1];
  return acc.name;
}

export default function AgentSwitcher({ variant }: { variant: Variant }) {
  const confirm = useConfirm();
  const {
    accounts,
    activeAccountId,
    isConnected,
    isConnecting,
    isReconnecting,
    agentName,
    error,
    connectAccount,
    joinNetwork,
    removeAccount,
    openAccountWindow,
  } = useConnection();

  const active = accounts.find((a) => a.id === activeAccountId);
  const activeName = active ? extractAgentName(active) : (agentName || 'Not connected');
  const initial = activeName.slice(0, 1).toUpperCase();

  // Desktop can host many windows, each on its own agent. There, signing
  // into an agent opens it in a NEW window (this one keeps its agent);
  // elsewhere (web / native, single window) it's the classic in-place
  // switch.
  const isElectron =
    typeof window !== 'undefined' && (window as any).desktop?.isDesktop === true;

  const [open, setOpen] = useState(false);
  // The account whose "open in a new window" is in flight (button label).
  const [busyId, setBusyId] = useState<string | null>(null);
  // Errors from the open-in-window flow are local to the sheet — the store's
  // global ``error`` belongs to this window's own connection, which the
  // multi-window flow never disturbs.
  const [localError, setLocalError] = useState<string | null>(null);
  // Which saved account has its sign-in password row unfolded.
  const [signInId, setSignInId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  // Add-agent (join) sub-view + its fields.
  const [adding, setAdding] = useState(false);
  const [ticket, setTicket] = useState('');
  const [handle, setHandle] = useState('');
  const [joinPw, setJoinPw] = useState('');
  // Decoded ticket preview (desktop only).
  const [intent, setIntent] = useState<{ role: string; bindTo: string; networkName: string } | null>(null);
  // True once the user actually pressed Switch / Join — drives auto-close
  // on the next successful connection.
  const [attempted, setAttempted] = useState(false);

  const close = () => {
    setOpen(false);
    setSignInId(null);
    setPassword('');
    setAdding(false);
    setTicket('');
    setHandle('');
    setJoinPw('');
    setIntent(null);
    setAttempted(false);
    setBusyId(null);
    setLocalError(null);
  };

  // Close the sheet once a switch / join lands.
  useEffect(() => {
    if (attempted && isConnected && !isConnecting) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempted, isConnected, isConnecting]);

  // Decode pasted tickets for a friendly "joining X as Y" preview and to
  // auto-fill device-bound handles. Web has no desktop bridge → skip.
  useEffect(() => {
    const t = ticket.trim();
    if (!t.startsWith('oa1')) { setIntent(null); return; }
    const d = (typeof window !== 'undefined') ? (window as any).desktop : null;
    if (!d || typeof d.decodeTicket !== 'function') { setIntent(null); return; }
    let cancelled = false;
    void d.decodeTicket(t).then((info: any) => {
      if (cancelled) return;
      if (info && typeof info === 'object') {
        setIntent({ role: info.role, bindTo: info.bindTo ?? '', networkName: info.networkName ?? '' });
        if (info.role === 'device' && info.bindTo) setHandle(info.bindTo);
      } else setIntent(null);
    });
    return () => { cancelled = true; };
  }, [ticket]);

  const beginSignIn = (id: string) => {
    if (id === activeAccountId && isConnected) return;
    setAdding(false);
    setSignInId(id);
    setPassword('');
  };

  // Desktop: open ``id`` in a NEW window, keeping this window on its own
  // agent. Tries the passwordless path first (loopback already up — the
  // active agent, or one already open in another window); when it needs
  // credentials we unfold that row's password field and retry on submit.
  const openInWindow = async (id: string, pw?: string) => {
    setBusyId(id);
    setLocalError(null);
    const res = await openAccountWindow(id, pw);
    setBusyId(null);
    if (res.ok) { close(); return; }
    if (!pw && res.error && /password/i.test(res.error)) {
      setAdding(false);
      setSignInId(id);
      setPassword('');
      return;
    }
    setLocalError(res.error || 'Could not open that agent.');
  };

  // Row tap: open a new window on desktop; classic in-place switch elsewhere.
  const onRowPress = (id: string) => {
    if (isElectron) void openInWindow(id);
    else beginSignIn(id);
  };

  // Submit of an unfolded password row.
  const doSubmit = () => {
    if (!signInId || !password) return;
    if (isElectron) {
      void openInWindow(signInId, password);
      return;
    }
    setAttempted(true);
    void connectAccount(signInId, password);
    setPassword('');
  };

  const doJoin = () => {
    const t = ticket.trim();
    const h = handle.trim().toLowerCase();
    if (!t.startsWith('oa1') || !h || !joinPw) return;
    setAttempted(true);
    void joinNetwork({ ticket: t, handle: h, password: joinPw, isLocal: false });
    setJoinPw('');
  };

  const onRemove = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Remove agent',
      message: `Forget "${name}"? You'll need the invite + password again to reconnect.`,
      confirmLabel: 'Remove',
    });
    if (ok) void removeAccount(id);
  };

  const statusColor = isConnected ? colors.success : isReconnecting ? colors.warning : colors.textMuted;

  return (
    <>
      {variant === 'wordmark' && (
        <Pressable
          onPress={() => setOpen(true)}
          // @ts-ignore web hover
          {...(Platform.OS === 'web' ? { className: 'oa-hover-lift' } : {})}
          style={styles.wordmarkTrigger}
          accessibilityRole="button"
          accessibilityLabel="Switch agent"
        >
          <View style={styles.wordmarkRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={styles.wordmark} numberOfLines={1}>{activeName}</Text>
            <Feather name="chevron-down" size={14} color={colors.textMuted} />
          </View>
          <View style={styles.wordmarkRule} />
        </Pressable>
      )}

      {variant === 'compact' && (
        <Pressable
          onPress={() => setOpen(true)}
          // @ts-ignore web hover
          {...(Platform.OS === 'web' ? { className: 'oa-side-row' } : {})}
          style={styles.compactTrigger}
          accessibilityRole="button"
          accessibilityLabel="Switch agent"
        >
          <View style={styles.compactAvatar}>
            <Text style={styles.compactAvatarText}>{initial}</Text>
            <View style={[styles.compactDot, { backgroundColor: statusColor }]} />
          </View>
          <Text style={styles.compactName} numberOfLines={1}>{activeName}</Text>
          <Feather name="chevron-up" size={13} color={colors.textMuted} />
        </Pressable>
      )}

      {variant === 'icon' && (
        <Pressable
          onPress={() => setOpen(true)}
          style={styles.iconTrigger}
          accessibilityRole="button"
          accessibilityLabel="Switch agent"
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={[styles.statusDot, styles.iconDot, { backgroundColor: statusColor }]} />
        </Pressable>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable
            style={styles.sheet}
            // Absorb presses so a tap inside the sheet doesn't bubble to
            // the backdrop (which would close the modal).
            onPress={(e: any) => e?.stopPropagation?.()}
            // @ts-ignore web entrance
            {...(Platform.OS === 'web' ? { className: 'oa-slide-up' } : {})}
          >
            <View style={styles.sheetRail} />
            <Text style={styles.sheetTitle}>{adding ? 'Add an agent' : 'Your agents'}</Text>
            {!adding && isElectron ? (
              <Text style={styles.sheetHint}>Each agent opens in its own window.</Text>
            ) : null}

            {adding ? (
              <View style={styles.joinForm}>
                <Input
                  label="Invite ticket"
                  value={ticket}
                  onChangeText={setTicket}
                  placeholder="oa1abcdef… (from `openagent invite`)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  mono
                  containerStyle={{ marginTop: 0 }}
                />
                {intent ? (
                  <Text style={styles.hint}>
                    {intent.role === 'device' && intent.bindTo
                      ? `Joining ${intent.networkName || 'this network'} as ${intent.bindTo}.`
                      : `Joining ${intent.networkName || 'this network'} — pick a handle.`}
                  </Text>
                ) : null}
                <Input
                  label="Handle"
                  value={handle}
                  onChangeText={setHandle}
                  placeholder="alice"
                  autoCapitalize="none"
                  autoCorrect={false}
                  mono
                  containerStyle={{ marginTop: spacing.md }}
                  editable={intent?.role !== 'device'}
                />
                <Input
                  label="Password"
                  value={joinPw}
                  onChangeText={setJoinPw}
                  placeholder="••••••••"
                  secureTextEntry
                  containerStyle={{ marginTop: spacing.md }}
                  onSubmitEditing={doJoin}
                />
                {error ? <Text style={styles.err}>{error}</Text> : null}
                <View style={styles.joinActions}>
                  <Button label="Back" variant="ghost" size="sm" icon="arrow-left" onPress={() => setAdding(false)} />
                  <Button
                    label={isConnecting ? 'Joining…' : 'Join network'}
                    variant="primary"
                    size="sm"
                    onPress={doJoin}
                    disabled={isConnecting || !ticket.trim().startsWith('oa1') || !handle || !joinPw}
                  />
                </View>
              </View>
            ) : (
              <>
                <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                  {accounts.length === 0 ? (
                    <Text style={styles.empty}>No agents yet — add one to begin.</Text>
                  ) : (
                    accounts.map((a, i) => {
                      const isActive = a.id === activeAccountId && isConnected;
                      const isSigning = signInId === a.id;
                      const label = extractAgentName(a);
                      return (
                        <View key={a.id} style={[styles.rowWrap, i > 0 && styles.rowBorder]}>
                          <View style={styles.row}>
                            <Pressable
                              style={styles.rowMain}
                              onPress={() => onRowPress(a.id)}
                              // On desktop even the active agent is tappable —
                              // it opens a second window on the same agent.
                              disabled={(isActive && !isElectron) || busyId === a.id}
                              accessibilityRole="button"
                              accessibilityState={{ selected: isActive }}
                              accessibilityHint={isElectron ? 'Opens this agent in a new window' : undefined}
                              // @ts-ignore web hover
                              {...(Platform.OS === 'web' ? { className: 'oa-hover-lift' } : {})}
                            >
                              <View style={styles.rowAvatar}>
                                <Text style={styles.rowAvatarText}>{label.slice(0, 1).toUpperCase()}</Text>
                              </View>
                              <View style={styles.rowText}>
                                <Text style={styles.rowName} numberOfLines={1}>{label}</Text>
                                <Text style={styles.rowSub} numberOfLines={1}>@{a.handle}</Text>
                              </View>
                              {isActive && (
                                <Feather name="check" size={16} color={colors.accent} style={isElectron ? styles.rowCheck : undefined} />
                              )}
                              {isElectron ? (
                                <Feather name="external-link" size={14} color={colors.textMuted} />
                              ) : !isActive ? (
                                <Feather name="chevron-right" size={15} color={colors.textMuted} />
                              ) : null}
                            </Pressable>
                            <Pressable
                              onPress={() => onRemove(a.id, a.name)}
                              hitSlop={8}
                              style={styles.iconBtn}
                              accessibilityLabel="Remove agent"
                            >
                              <Feather name="trash-2" size={14} color={colors.textMuted} />
                            </Pressable>
                          </View>
                          {isSigning && !isActive ? (
                            <View style={styles.signInRow}>
                              <Input
                                value={password}
                                onChangeText={setPassword}
                                placeholder="Password"
                                secureTextEntry
                                autoFocus
                                containerStyle={{ flex: 1, marginTop: 0 }}
                                onSubmitEditing={doSubmit}
                              />
                              <Button
                                label={
                                  isElectron
                                    ? (busyId === a.id ? 'Opening…' : 'Open')
                                    : (isConnecting ? '…' : 'Switch')
                                }
                                variant="primary"
                                size="sm"
                                onPress={doSubmit}
                                disabled={(isElectron ? busyId === a.id : isConnecting) || !password}
                              />
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  )}
                  {(localError || (!isElectron && error)) ? (
                    <Text style={styles.err}>{localError || error}</Text>
                  ) : null}
                </ScrollView>

                <View style={styles.addFoot}>
                  <Button
                    label="Add an agent"
                    variant="secondary"
                    icon="plus"
                    size="sm"
                    onPress={() => { setAdding(true); setSignInId(null); }}
                    fullWidth
                  />
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // ── Triggers ──
  wordmarkTrigger: { gap: spacing.sm, paddingHorizontal: spacing.xs },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  wordmark: {
    flex: 1,
    fontFamily: font.sans,
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: tracking.normal,
  },
  wordmarkRule: { height: 1, backgroundColor: colors.borderLight, width: '70%' },

  // compact — footer avatar item (avatar + name + chevron, fills its row)
  compactTrigger: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 6,
    borderRadius: radius.md,
  },
  compactAvatar: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactAvatarText: { fontFamily: font.display, fontSize: 12, color: colors.accent, fontWeight: '600' },
  compactDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.sidebar,
  },
  compactName: { flex: 1, minWidth: 0, fontFamily: font.sans, fontSize: 12.5, fontWeight: '600', color: colors.text },

  iconTrigger: { alignItems: 'center', paddingVertical: spacing.xs },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: font.display, fontSize: 14, color: colors.accent, fontWeight: '600' },
  statusDot: { width: 7, height: 7, borderRadius: radius.pill },
  iconDot: { marginTop: -7, alignSelf: 'flex-end', marginRight: 4 },

  // ── Modal ──
  backdrop: {
    flex: 1,
    // Dim the scene only — no full-screen blur. The frost is scoped to
    // the sheet so only the panel's own background is blurred.
    backgroundColor: 'rgba(2, 4, 10, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 440,
    // Shared frosted-glass recipe — matches the nav header exactly.
    backgroundColor: glassSurface.backgroundColor,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    maxHeight: '85%',
    overflow: 'hidden',
    // Frost the panel background only.
    ...(Platform.OS === 'web'
      ? ({ backdropFilter: glassSurface.webFilter, WebkitBackdropFilter: glassSurface.webFilter } as any)
      : {}),
    shadowColor: colors.shadowColorStrong,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 1,
    shadowRadius: 32,
  },
  sheetRail: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.panelRail,
    ...(Platform.OS === 'web' ? ({ boxShadow: `0 0 8px ${colors.accentGlow}` } as any) : {}),
  },
  sheetTitle: {
    fontFamily: font.display,
    fontSize: 12,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: tracking.wider,
    fontWeight: '600',
  },
  sheetHint: {
    fontFamily: font.sans,
    fontSize: 11,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    marginTop: -spacing.xs,
    paddingBottom: spacing.sm,
    lineHeight: 15,
  },
  list: { maxHeight: 380 },
  listContent: { paddingBottom: spacing.xs },
  empty: {
    fontFamily: font.sans,
    fontSize: 13,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },

  rowWrap: { paddingHorizontal: spacing.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    minWidth: 0,
  },
  rowAvatar: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarText: { fontFamily: font.display, fontSize: 12.5, color: colors.accent, fontWeight: '600' },
  rowCheck: { marginRight: 6 },
  rowText: { flex: 1, gap: 2, minWidth: 0 },
  rowName: { fontFamily: font.sans, fontSize: 13.5, color: colors.text, fontWeight: '600' },
  rowSub: { fontFamily: font.mono, fontSize: 11, color: colors.textMuted },
  iconBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  signInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },

  // ── Join sub-view ──
  joinForm: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  joinActions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.lg },
  hint: { fontFamily: font.sans, fontSize: 11, color: colors.textMuted, marginTop: 6, lineHeight: 15 },

  addFoot: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    marginTop: spacing.xs,
  },
  err: {
    fontFamily: font.sans,
    fontSize: 12,
    color: colors.error,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    lineHeight: 16,
  },
});
