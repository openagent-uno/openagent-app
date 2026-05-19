/**
 * Members screen — users + agents on this network, plus invite minting.
 *
 * Talks to the coordinator-only ``/api/network/*`` endpoints behind
 * the device-cert auth middleware. On a member-mode gateway the
 * endpoints 404 and we show a friendly "this isn't a coordinator"
 * notice instead.
 */

import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Platform,
} from 'react-native';
import { colors, font, radius } from '../../theme';

async function copyToClipboard(text: string): Promise<void> {
  // Desktop (Electron renderer) + web both expose ``navigator.clipboard``.
  // We don't ship the Members tab to native mobile yet, so this is
  // enough; if mobile lands later, swap in ``expo-clipboard``.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}
import { useConnection } from '../../stores/connection';
import { useConfirm } from '../../components/ConfirmDialog';
import Button from '../../components/Button';
import Card from '../../components/Card';
import {
  listNetworkUsers, listNetworkAgents, listNetworkInvitations,
  mintNetworkInvitation, revokeNetworkInvitation, setBaseUrl,
  type NetworkUser, type NetworkAgent, type NetworkInvitation,
  type MintInvitationResult,
} from '../../services/api';

function fmtAge(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '';
  const delta = Math.max(0, Date.now() / 1000 - unixSeconds);
  if (delta < 60) return `${Math.floor(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

function fmtUntil(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return '';
  const delta = unixSeconds - Date.now() / 1000;
  if (delta < 0) return 'expired';
  if (delta < 3600) return `in ${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `in ${Math.floor(delta / 3600)}h`;
  return `in ${Math.floor(delta / 86400)}d`;
}

function inviteAudience(inv: NetworkInvitation): string {
  if (inv.role === 'device' && inv.bind_to) return `new device for ${inv.bind_to}`;
  if (inv.role === 'user' && inv.bind_to) return `onboard ${inv.bind_to}`;
  if (inv.role === 'user') return 'any new user';
  if (inv.role === 'agent') return `agent (owner=${inv.bind_to || 'system'})`;
  return inv.role;
}

export default function MembersScreen() {
  const connConfig = useConnection((s) => s.config);
  const confirm = useConfirm();

  const [users, setUsers] = useState<NetworkUser[]>([]);
  const [agents, setAgents] = useState<NetworkAgent[]>([]);
  const [invitations, setInvitations] = useState<NetworkInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [memberMode, setMemberMode] = useState(false);
  const [loading, setLoading] = useState(false);

  const [handleInput, setHandleInput] = useState('');
  const [minting, setMinting] = useState(false);
  const [latestMint, setLatestMint] = useState<MintInvitationResult | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!connConfig?.sidecarPort) return;
    setLoading(true);
    setError(null);
    try {
      // Probe with /users first — its 404 signals member-mode, and
      // a single failure is cheaper than three parallel ones when
      // the agent isn't a coordinator. On success, fetch agents +
      // invitations in parallel.
      const u = await listNetworkUsers();
      const [a, inv] = await Promise.all([
        listNetworkAgents(),
        listNetworkInvitations(),
      ]);
      setUsers(u);
      setAgents(a);
      setInvitations(inv);
      setMemberMode(false);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes('404')) {
        setMemberMode(true);
        setUsers([]); setAgents([]); setInvitations([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [connConfig?.sidecarPort]);

  useEffect(() => {
    if (connConfig?.sidecarPort) {
      setBaseUrl('127.0.0.1', connConfig.sidecarPort);
      void refresh();
    }
  }, [connConfig?.sidecarPort, refresh]);

  const handleMint = async () => {
    setMinting(true);
    setLatestMint(null);
    setCopied(false);
    try {
      const result = await mintNetworkInvitation({
        handle: handleInput.trim() || undefined,
      });
      setLatestMint(result);
      setHandleInput('');
      void refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setMinting(false);
    }
  };

  const handleCopy = async () => {
    if (!latestMint) return;
    await copyToClipboard(latestMint.ticket);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRevoke = async (inv: NetworkInvitation) => {
    const confirmed = await confirm({
      title: 'Revoke invite',
      message: `Revoke the invite code "${inv.code}"? This can't be undone.`,
      confirmLabel: 'Revoke',
    });
    if (!confirmed) return;
    try {
      await revokeNetworkInvitation(inv.code);
      void refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  };

  if (memberMode) {
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Card>
            <Text style={styles.sectionTitle}>Members</Text>
            <Text style={styles.fieldHint}>
              This agent is a member, not a coordinator. User and invite
              management lives on the network's coordinator — open the
              Members tab there.
            </Text>
          </Card>
        </ScrollView>
      </View>
    );
  }

  // Predictive role + audience labels for the mint form, so the user
  // sees what kind of invite they're about to mint *before* hitting
  // submit. Pure UI — the server re-derives the same logic.
  const handleClean = handleInput.trim().toLowerCase();
  const exists = users.some((u) => u.handle === handleClean);
  const mintHint = !handleClean
    ? 'No handle → open invite, anyone can join.'
    : exists
      ? `${handleClean} exists → device-pairing invite (they need their existing password).`
      : `${handleClean} doesn't exist yet → onboarding invite (they pick a password).`;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>

        {error && (
          <View style={styles.errorBox}>
            <Feather name="alert-triangle" size={14} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* ── Invite minting ──────────────────────────────── */}
        <Card>
          <Text style={styles.sectionTitle}>Invite someone</Text>
          <Text style={styles.fieldHint}>
            One verb. Leave the handle empty for an open invite. Use an
            existing handle to pair a new device for that account.
          </Text>
          <View style={styles.row}>
            <TextInput
              value={handleInput}
              onChangeText={setHandleInput}
              placeholder="handle (optional)"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Button
              variant="primary"
              size="md"
              label={minting ? 'Minting…' : 'Mint invite'}
              onPress={handleMint}
              disabled={minting || !connConfig?.sidecarPort}
            />
          </View>
          <Text style={styles.hint}>{mintHint}</Text>

          {latestMint && (
            <View style={styles.ticketBox}>
              <Text style={styles.ticketIntent}>
                {latestMint.intent} · expires {fmtUntil(latestMint.expires_at)}
              </Text>
              <Text style={styles.ticketCode} selectable>
                {latestMint.ticket}
              </Text>
              <TouchableOpacity onPress={handleCopy} style={styles.copyBtn}>
                <Feather
                  name={copied ? 'check' : 'copy'}
                  size={14}
                  color={copied ? colors.success : colors.accent}
                />
                <Text style={[styles.copyLabel, copied && { color: colors.success }]}>
                  {copied ? 'Copied' : 'Copy ticket'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </Card>

        {/* ── Active invitations ────────────────────────────── */}
        <Card>
          <Text style={styles.sectionTitle}>
            Active invitations ({invitations.length})
          </Text>
          {invitations.length === 0 ? (
            <Text style={styles.fieldHint}>No active invitations.</Text>
          ) : (
            invitations.map((inv) => (
              <View key={inv.code} style={styles.invRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.invFor}>{inviteAudience(inv)}</Text>
                  <Text style={styles.invMeta}>
                    {inv.code} · expires {fmtUntil(inv.expires_at)} · by {inv.created_by}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handleRevoke(inv)}
                  style={styles.revokeBtn}
                >
                  <Feather name="x" size={14} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </Card>

        {/* ── Users ──────────────────────────────────────────── */}
        <Card>
          <Text style={styles.sectionTitle}>
            Users ({users.length})
          </Text>
          {users.length === 0 ? (
            <Text style={styles.fieldHint}>No users registered yet.</Text>
          ) : (
            users.map((u) => (
              <View key={u.handle} style={styles.listRow}>
                <Text style={styles.listHandle}>{u.handle}</Text>
                <Text style={styles.listMeta}>
                  {u.status} · joined {fmtAge(u.created_at)}
                </Text>
              </View>
            ))
          )}
        </Card>

        {/* ── Agents ─────────────────────────────────────────── */}
        <Card>
          <Text style={styles.sectionTitle}>
            Agents ({agents.length})
          </Text>
          {agents.length === 0 ? (
            <Text style={styles.fieldHint}>No agents registered.</Text>
          ) : (
            agents.map((a) => (
              <View key={a.handle + a.node_id} style={styles.listRow}>
                <Text style={styles.listHandle}>{a.handle}</Text>
                <Text style={styles.listMeta} numberOfLines={1}>
                  {a.label || a.owner_handle} · {a.node_id.slice(0, 16)}…
                  {a.last_seen ? ` · seen ${fmtAge(a.last_seen)}` : ''}
                </Text>
              </View>
            ))
          )}
        </Card>

        <View style={{ height: 80 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: font.sans,
    color: colors.text,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  fieldHint: {
    fontSize: 12,
    color: colors.textSecondary,
    fontFamily: font.sans,
    marginBottom: 8,
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 8 : 10,
    color: colors.text,
    fontFamily: font.mono,
    fontSize: 13,
  },
  hint: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 6,
    fontFamily: font.sans,
  },
  ticketBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ticketIntent: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: font.sans,
    marginBottom: 6,
  },
  ticketCode: {
    fontSize: 11,
    color: colors.text,
    fontFamily: font.mono,
    lineHeight: 16,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
  },
  copyLabel: {
    fontSize: 12,
    color: colors.accent,
    fontFamily: font.sans,
    fontWeight: '600',
  },
  listRow: {
    paddingVertical: 8,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  listHandle: {
    fontSize: 13,
    color: colors.text,
    fontFamily: font.mono,
    fontWeight: '600',
  },
  listMeta: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: font.sans,
    marginTop: 2,
  },
  invRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  invFor: {
    fontSize: 13,
    color: colors.text,
    fontFamily: font.sans,
    fontWeight: '600',
  },
  invMeta: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: font.mono,
    marginTop: 2,
  },
  revokeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radius.md,
    borderColor: colors.error,
    borderWidth: 1,
    backgroundColor: colors.errorSoft,
  },
  errorText: {
    color: colors.error,
    fontFamily: font.sans,
    fontSize: 12,
    flex: 1,
  },
});
