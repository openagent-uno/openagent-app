/**
 * Members panel — Users / Agents / Invitations / Peers in four TabStrip tabs.
 *
 * Lives inside the Settings screen's "Members" category.
 * - Users / Agents / Invitations talk to coordinator-only ``/api/network/*``.
 * - Peers talks to ``/api/peers/*`` (works on any agent — federation).
 */

import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView,
} from 'react-native';
import { colors, font, radius } from '../theme';
import { useConnection } from '../stores/connection';
import { useConfirm } from './ConfirmDialog';
import Button from './Button';
import Card from './Card';
import TabStrip from './TabStrip';
import {
  listNetworkUsers, listNetworkAgents, listNetworkInvitations,
  mintNetworkInvitation, revokeNetworkInvitation,
  patchNetworkUser, deleteNetworkUser,
  patchNetworkAgent, deleteNetworkAgent,
  listPeerNetworks, joinPeerNetwork, removePeerNetwork,
  refreshPeerCert, listPeerAgents, chatWithPeer,
  type NetworkUser, type NetworkAgent, type NetworkInvitation,
  type MintInvitationResult, type PeerNetwork, type PeerChatResult,
} from '../services/api';

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

type SubTab = 'users' | 'agents' | 'invitations' | 'peers';

const SUB_TABS = [
  { id: 'users' as const, label: 'Users', icon: 'user' as const },
  { id: 'agents' as const, label: 'Agents', icon: 'cpu' as const },
  { id: 'invitations' as const, label: 'Invitations', icon: 'mail' as const },
  { id: 'peers' as const, label: 'Peers', icon: 'link' as const },
];

function fmtAge(s: number | null | undefined): string {
  if (!s) return '';
  const d = Math.max(0, Date.now() / 1000 - s);
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function fmtUntil(s: number | null | undefined): string {
  if (!s) return '';
  const d = s - Date.now() / 1000;
  if (d < 0) return 'expired';
  if (d < 3600) return `in ${Math.floor(d / 60)}m`;
  if (d < 86400) return `in ${Math.floor(d / 3600)}h`;
  return `in ${Math.floor(d / 86400)}d`;
}

function inviteAudience(inv: NetworkInvitation): string {
  if (inv.role === 'device' && inv.bind_to) return `new device for ${inv.bind_to}`;
  if (inv.role === 'user' && inv.bind_to) return `onboard ${inv.bind_to}`;
  if (inv.role === 'user') return 'any new user';
  if (inv.role === 'agent') return `agent (owner=${inv.bind_to || 'system'})`;
  return inv.role;
}


export default function MembersPanel() {
  const connConfig = useConnection((s) => s.config);
  const [tab, setTab] = useState<SubTab>('users');
  const [users, setUsers] = useState<NetworkUser[]>([]);
  const [agents, setAgents] = useState<NetworkAgent[]>([]);
  const [invitations, setInvitations] = useState<NetworkInvitation[]>([]);
  const [peers, setPeers] = useState<PeerNetwork[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [memberMode, setMemberMode] = useState(false);

  const refresh = useCallback(async () => {
    if (!connConfig?.sidecarPort) return;
    // Peers are available on all agents — always fetch.
    void listPeerNetworks().then(setPeers).catch(() => {});
    try {
      const u = await listNetworkUsers();
      const [a, inv] = await Promise.all([
        listNetworkAgents(),
        listNetworkInvitations(),
      ]);
      setUsers(u); setAgents(a); setInvitations(inv);
      setMemberMode(false); setError(null);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes('404')) {
        setMemberMode(true); setUsers([]); setAgents([]); setInvitations([]);
        setError(null);
      } else {
        console.warn('[Members] refresh failed:', e);
        setError(msg);
      }
    }
  }, [connConfig?.sidecarPort]);

  useEffect(() => {
    if (connConfig?.sidecarPort) {
      void refresh();
    }
  }, [connConfig?.sidecarPort, refresh]);

  return (
    <>
      <Text style={styles.sectionTitle}>Members</Text>

      {error && tab !== 'peers' && (
        <Card>
          <Text style={styles.fieldHint}>
            This agent is a member, not a coordinator. User and invite
            management lives on the network's coordinator. Switch to the{' '}
            <Text style={{ color: colors.accent }} onPress={() => setTab('peers')}>
              Peers
            </Text>{' '}
            tab to manage federated agents.
          </Text>
        </Card>
      )}

      <TabStrip
        tabs={SUB_TABS}
        active={tab}
        onChange={setTab}
        fullWidth
        style={{ marginBottom: 12 }}
      />

      {tab === 'users' && !memberMode && (
        <UsersPanel users={users} refresh={refresh} setError={setError} />
      )}
      {tab === 'agents' && !memberMode && (
        <AgentsPanel agents={agents} refresh={refresh} setError={setError} />
      )}
      {tab === 'invitations' && !memberMode && (
        <InvitationsPanel
          invitations={invitations} refresh={refresh} setError={setError}
        />
      )}
      {tab === 'peers' && (
        <PeersPanel peers={peers} refresh={refresh} setError={setError} />
      )}
    </>
  );
}


// ── Users ──────────────────────────────────────────────────────────────

function UsersPanel({
  users, refresh, setError,
}: {
  users: NetworkUser[];
  refresh: () => Promise<void>;
  setError: (m: string | null) => void;
}) {
  const confirm = useConfirm();
  const [handleInput, setHandleInput] = useState('');
  const [minting, setMinting] = useState(false);
  const [latestMint, setLatestMint] = useState<MintInvitationResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleClean = handleInput.trim().toLowerCase();
  const exists = users.some((u) => u.handle === handleClean);
  const mintHint = !handleClean
    ? 'No handle → open invite, anyone can join.'
    : exists
      ? `${handleClean} exists → device-pairing invite (they need their existing password).`
      : `${handleClean} doesn't exist yet → onboarding invite (they pick a password).`;

  const handleMint = async () => {
    setMinting(true);
    setLatestMint(null); setCopied(false); setError(null);
    try {
      const r = await mintNetworkInvitation({
        handle: handleInput.trim() || undefined,
      });
      setLatestMint(r); setHandleInput('');
      void refresh();
    } catch (e: any) {
      console.warn('[Members] mint failed:', e);
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

  const handleSuspend = async (u: NetworkUser) => {
    try {
      await patchNetworkUser(u.handle, {
        status: u.status === 'active' ? 'suspended' : 'active',
      });
      void refresh();
    } catch (e: any) {
      console.warn('[Members] suspend failed:', e);
      setError(String(e?.message || e));
    }
  };

  const handleDelete = async (u: NetworkUser) => {
    const ok = await confirm({
      title: 'Remove user',
      message: `Remove "${u.handle}"? Their account and paired devices will be deleted. This can't be undone.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await deleteNetworkUser(u.handle);
      void refresh();
    } catch (e: any) {
      console.warn('[Members] delete user failed:', e);
      setError(String(e?.message || e));
    }
  };

  return (
    <>
      <Card>
        <Text style={styles.cardTitle}>Invite a user</Text>
        <Text style={styles.fieldHint}>
          Leave the handle empty for an open invite. Use an existing handle to pair a new device for that account.
        </Text>
        <View style={styles.row}>
          <TextInput
            value={handleInput}
            onChangeText={setHandleInput}
            placeholder="handle (optional)"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <Button
            variant="primary" size="md"
            label={minting ? 'Minting…' : 'Mint invite'}
            onPress={handleMint}
            disabled={minting}
          />
        </View>
        <Text style={styles.hint}>{mintHint}</Text>
        {latestMint && <TicketBox mint={latestMint} copied={copied} onCopy={handleCopy} />}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Users ({users.length})</Text>
        {users.length === 0 ? (
          <Text style={styles.fieldHint}>No users registered yet.</Text>
        ) : (
          users.map((u) => (
            <View key={u.handle} style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listHandle}>{u.handle}</Text>
                <Text style={styles.listMeta}>{u.status} · joined {fmtAge(u.created_at)}</Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={() => handleSuspend(u)} style={styles.actionBtn}
                  accessibilityLabel={u.status === 'active' ? 'Suspend user' : 'Activate user'}
                >
                  <Feather
                    name={u.status === 'active' ? 'pause-circle' : 'play-circle'}
                    size={16}
                    color={u.status === 'active' ? colors.warning : colors.success}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(u)} style={styles.actionBtn}
                  accessibilityLabel="Remove user"
                >
                  <Feather name="trash-2" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </Card>
    </>
  );
}


// ── Agents ─────────────────────────────────────────────────────────────

function AgentsPanel({
  agents, refresh, setError,
}: {
  agents: NetworkAgent[];
  refresh: () => Promise<void>;
  setError: (m: string | null) => void;
}) {
  const confirm = useConfirm();
  const [minting, setMinting] = useState(false);
  const [latestMint, setLatestMint] = useState<MintInvitationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingHandle, setEditingHandle] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');

  const handleMintAgent = async () => {
    setMinting(true);
    setLatestMint(null); setCopied(false); setError(null);
    try {
      const r = await mintNetworkInvitation({ role: 'agent' });
      setLatestMint(r);
    } catch (e: any) {
      console.warn('[Members] mint agent failed:', e);
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

  const startEdit = (a: NetworkAgent) => {
    setEditingHandle(a.handle);
    setEditingLabel(a.label || '');
  };

  const cancelEdit = () => {
    setEditingHandle(null); setEditingLabel('');
  };

  const saveEdit = async (a: NetworkAgent) => {
    try {
      await patchNetworkAgent(a.handle, { label: editingLabel });
      setEditingHandle(null);
      void refresh();
    } catch (e: any) {
      console.warn('[Members] patch agent failed:', e);
      setError(String(e?.message || e));
    }
  };

  const handleDelete = async (a: NetworkAgent) => {
    const ok = await confirm({
      title: 'Remove agent',
      message: `Remove "${a.handle}" from the registry? This won't stop the agent process — it just unlists it.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await deleteNetworkAgent(a.handle);
      void refresh();
    } catch (e: any) {
      console.warn('[Members] delete agent failed:', e);
      setError(String(e?.message || e));
    }
  };

  return (
    <>
      <Card>
        <Text style={styles.cardTitle}>Invite an agent</Text>
        <Text style={styles.fieldHint}>
          Mints an agent-role invite so another agent process can self-register on this network. Most operators don't need this — it's the federation path.
        </Text>
        <Button
          variant="primary" size="md"
          label={minting ? 'Minting…' : 'Mint agent invite'}
          onPress={handleMintAgent}
          disabled={minting}
        />
        {latestMint && <TicketBox mint={latestMint} copied={copied} onCopy={handleCopy} />}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Federated agents ({agents.length})</Text>
        {agents.length === 0 ? (
          <Text style={styles.fieldHint}>
            No other agents on this network. The agent you're connected to
            is the only one — federate another agent here with the invite
            button above to make it appear in this list.
          </Text>
        ) : (
          agents.map((a) => (
            <View key={a.handle + a.node_id} style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.listHandle}>{a.handle}</Text>
                {editingHandle === a.handle ? (
                  <View style={styles.editRow}>
                    <TextInput
                      value={editingLabel}
                      onChangeText={setEditingLabel}
                      placeholder="label"
                      placeholderTextColor={colors.textMuted}
                      style={[styles.input, { flex: 1 }]}
                    />
                    <TouchableOpacity onPress={() => saveEdit(a)} style={styles.actionBtn}>
                      <Feather name="check" size={16} color={colors.success} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={cancelEdit} style={styles.actionBtn}>
                      <Feather name="x" size={16} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.listMeta} numberOfLines={1}>
                    {a.label || a.owner_handle} · {a.node_id.slice(0, 16)}…
                    {a.last_seen ? ` · seen ${fmtAge(a.last_seen)}` : ''}
                  </Text>
                )}
              </View>
              {editingHandle !== a.handle && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    onPress={() => startEdit(a)} style={styles.actionBtn}
                    accessibilityLabel="Edit agent label"
                  >
                    <Feather name="edit-2" size={16} color={colors.accent} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDelete(a)} style={styles.actionBtn}
                    accessibilityLabel="Remove agent"
                  >
                    <Feather name="trash-2" size={16} color={colors.error} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))
        )}
      </Card>
    </>
  );
}


// ── Invitations ────────────────────────────────────────────────────────

function InvitationsPanel({
  invitations, refresh, setError,
}: {
  invitations: NetworkInvitation[];
  refresh: () => Promise<void>;
  setError: (m: string | null) => void;
}) {
  const confirm = useConfirm();

  const handleRevoke = async (inv: NetworkInvitation) => {
    const ok = await confirm({
      title: 'Revoke invite',
      message: `Revoke the invite code "${inv.code}"? This can't be undone.`,
      confirmLabel: 'Revoke',
    });
    if (!ok) return;
    try {
      await revokeNetworkInvitation(inv.code);
      void refresh();
    } catch (e: any) {
      console.warn('[Members] revoke failed:', e);
      setError(String(e?.message || e));
    }
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>Active invitations ({invitations.length})</Text>
      <Text style={styles.fieldHint}>
        Codes that haven't been redeemed yet. Revoking an unspent code makes it unusable; redeemed codes are already burned and don't show up here.
      </Text>
      {invitations.length === 0 ? (
        <Text style={styles.fieldHint}>No active invitations.</Text>
      ) : (
        invitations.map((inv) => (
          <View key={inv.code} style={styles.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.invFor}>{inviteAudience(inv)}</Text>
              <Text style={styles.invMeta}>
                {inv.code} · expires {fmtUntil(inv.expires_at)} · by {inv.created_by}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => handleRevoke(inv)} style={styles.actionBtn}
              accessibilityLabel="Revoke invitation"
            >
              <Feather name="trash-2" size={16} color={colors.error} />
            </TouchableOpacity>
          </View>
        ))
      )}
    </Card>
  );
}


// ── Shared: ticket box ─────────────────────────────────────────────────

function TicketBox({
  mint, copied, onCopy,
}: {
  mint: MintInvitationResult;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <View style={styles.ticketBox}>
      <Text style={styles.ticketIntent}>
        {mint.intent} · expires {fmtUntil(mint.expires_at)}
      </Text>
      <Text style={styles.ticketCode} selectable>{mint.ticket}</Text>
      <TouchableOpacity onPress={onCopy} style={styles.copyBtn}>
        <Feather
          name={copied ? 'check' : 'copy'} size={14}
          color={copied ? colors.success : colors.accent}
        />
        <Text style={[styles.copyLabel, copied && { color: colors.success }]}>
          {copied ? 'Copied' : 'Copy ticket'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}


// ── PeersPanel ─────────────────────────────────────────────────────────────

function PeersPanel({
  peers, refresh, setError,
}: {
  peers: PeerNetwork[];
  refresh: () => void;
  setError: (e: string | null) => void;
}) {
  const confirm = useConfirm();
  const [ticketInput, setTicketInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [chatTarget, setChatTarget] = useState<PeerNetwork | null>(null);
  const [chatMsg, setChatMsg] = useState('');
  const [chatting, setChatting] = useState(false);
  const [chatResult, setChatResult] = useState<PeerChatResult | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  async function handleJoin() {
    const t = ticketInput.trim();
    if (!t) return;
    setJoining(true); setError(null);
    try {
      await joinPeerNetwork({ ticket: t });
      setTicketInput('');
      refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setJoining(false);
    }
  }

  async function handleRemove(peer: PeerNetwork) {
    const ok = await confirm(
      `Remove peer "${peer.name}"? This only removes the local membership — the remote agent still knows you.`,
      { confirmLabel: 'Remove', danger: true },
    );
    if (!ok) return;
    try {
      await removePeerNetwork(peer.network_id);
      refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function handleRefreshCert(peer: PeerNetwork) {
    try {
      await refreshPeerCert(peer.network_id);
      refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function handleChat() {
    if (!chatTarget || !chatMsg.trim()) return;
    setChatting(true); setChatError(null); setChatResult(null);
    try {
      const result = await chatWithPeer(chatTarget.network_id, {
        message: chatMsg.trim(),
        session_id: `app-peer-${chatTarget.network_id.slice(0, 8)}`,
      });
      setChatResult(result);
    } catch (e: any) {
      setChatError(String(e?.message || e));
    } finally {
      setChatting(false);
    }
  }

  return (
    <View>
      {/* Add Peer */}
      <Card>
        <Text style={styles.cardTitle}>Add Peer Agent</Text>
        <Text style={styles.fieldHint}>
          Paste an agent invite ticket (oa1…) received from another OpenAgent instance.
        </Text>
        <TextInput
          style={[styles.input, { marginTop: 8 }]}
          placeholder="oa1…"
          placeholderTextColor={colors.textMuted}
          value={ticketInput}
          onChangeText={setTicketInput}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <Button
          label={joining ? 'Joining…' : 'Join Peer'}
          onPress={handleJoin}
          disabled={joining || !ticketInput.trim()}
          style={{ marginTop: 8 }}
        />
      </Card>

      {/* Peer list */}
      <Card style={{ marginTop: 12 }}>
        <Text style={styles.cardTitle}>Peer Networks ({peers.length})</Text>
        {peers.length === 0 ? (
          <Text style={styles.fieldHint}>
            No peer networks joined yet. Paste an agent invite ticket above to get started.
          </Text>
        ) : (
          peers.map((p) => {
            const certOk = p.cert_expires_at && p.cert_expires_at > Date.now() / 1000;
            const isChatOpen = chatTarget?.network_id === p.network_id;
            return (
              <View key={p.network_id} style={styles.row}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowHandle}>{p.name}</Text>
                  <Text style={styles.rowMeta}>
                    {p.our_handle} · {p.join_type}
                    {certOk
                      ? ` · cert ${fmtUntil(p.cert_expires_at ?? undefined)}`
                      : ' · cert expired'}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setChatTarget(isChatOpen ? null : p);
                      setChatResult(null); setChatError(null); setChatMsg('');
                    }}
                    style={styles.iconBtn}
                  >
                    <Feather
                      name="message-circle"
                      size={16}
                      color={isChatOpen ? colors.accent : colors.textMuted}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleRefreshCert(p)}
                    style={styles.iconBtn}
                  >
                    <Feather name="refresh-cw" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleRemove(p)}
                    style={styles.iconBtn}
                  >
                    <Feather name="trash-2" size={16} color={colors.error} />
                  </TouchableOpacity>
                </View>

                {/* Inline chat panel */}
                {isChatOpen && (
                  <View style={styles.chatPane}>
                    {chatResult && (
                      <View style={styles.chatBubble}>
                        <Text style={styles.chatBubbleLabel}>
                          {chatResult.agent_handle ?? p.name}
                        </Text>
                        <Text style={styles.chatBubbleText}>{chatResult.response}</Text>
                        {chatResult.model ? (
                          <Text style={styles.chatBubbleMeta}>{chatResult.model}</Text>
                        ) : null}
                      </View>
                    )}
                    {chatError && (
                      <Text style={[styles.fieldHint, { color: colors.error, marginBottom: 6 }]}>
                        {chatError}
                      </Text>
                    )}
                    <TextInput
                      style={styles.input}
                      placeholder="Message…"
                      placeholderTextColor={colors.textMuted}
                      value={chatMsg}
                      onChangeText={setChatMsg}
                      multiline
                    />
                    <Button
                      label={chatting ? 'Sending…' : 'Send'}
                      onPress={handleChat}
                      disabled={chatting || !chatMsg.trim()}
                      style={{ marginTop: 6 }}
                    />
                  </View>
                )}
              </View>
            );
          })
        )}
      </Card>
    </View>
  );
}


const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 14, fontWeight: '700', fontFamily: font.sans,
    color: colors.text, letterSpacing: 0.5, marginBottom: 12,
  },
  cardTitle: {
    fontSize: 13, fontWeight: '700', fontFamily: font.sans,
    color: colors.text, marginBottom: 8,
  },
  fieldHint: {
    fontSize: 12, color: colors.textSecondary, fontFamily: font.sans,
    marginBottom: 8, lineHeight: 17,
  },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 8 : 10,
    color: colors.text, fontFamily: font.mono, fontSize: 13,
  },
  hint: {
    fontSize: 11, color: colors.textSecondary, marginTop: 6, fontFamily: font.sans,
  },
  ticketBox: {
    marginTop: 12, padding: 12, borderRadius: radius.md,
    backgroundColor: colors.surfaceElevated, borderColor: colors.border, borderWidth: 1,
  },
  ticketIntent: {
    fontSize: 11, color: colors.textSecondary, fontFamily: font.sans, marginBottom: 6,
  },
  ticketCode: {
    fontSize: 11, color: colors.text, fontFamily: font.mono, lineHeight: 16,
  },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
    alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.sm,
  },
  copyLabel: {
    fontSize: 12, color: colors.accent, fontFamily: font.sans, fontWeight: '600',
  },
  listRow: {
    paddingVertical: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  listHandle: {
    fontSize: 13, color: colors.text, fontFamily: font.mono, fontWeight: '600',
  },
  listMeta: {
    fontSize: 11, color: colors.textSecondary, fontFamily: font.sans, marginTop: 2,
  },
  actions: { flexDirection: 'row', gap: 4 },
  actionBtn: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: radius.sm },
  invFor: {
    fontSize: 13, color: colors.text, fontFamily: font.sans, fontWeight: '600',
  },
  invMeta: {
    fontSize: 11, color: colors.textSecondary, fontFamily: font.mono, marginTop: 2,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, marginBottom: 8,
    borderRadius: radius.md, borderColor: colors.error, borderWidth: 1,
    backgroundColor: colors.errorSoft,
  },
  errorText: {
    color: colors.error, fontFamily: font.sans, fontSize: 12, flex: 1,
  },
  // Peer-specific styles
  rowMain: { flex: 1 },
  rowHandle: { fontSize: 13, color: colors.text, fontFamily: font.mono, fontWeight: '600' },
  rowMeta: { fontSize: 11, color: colors.textSecondary, fontFamily: font.sans, marginTop: 2 },
  rowActions: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  iconBtn: { padding: 6, borderRadius: radius.sm },
  chatPane: {
    width: '100%', marginTop: 10, paddingTop: 10,
    borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth,
  },
  chatBubble: {
    backgroundColor: colors.surfaceElevated, borderRadius: radius.md,
    padding: 10, marginBottom: 8,
  },
  chatBubbleLabel: {
    fontSize: 11, color: colors.accent, fontFamily: font.sans,
    fontWeight: '600', marginBottom: 4,
  },
  chatBubbleText: {
    fontSize: 13, color: colors.text, fontFamily: font.sans, lineHeight: 19,
  },
  chatBubbleMeta: {
    fontSize: 10, color: colors.textMuted, fontFamily: font.mono, marginTop: 4,
  },
});
