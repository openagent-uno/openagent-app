/**
 * Login screen — saved accounts list + add new connection form.
 */

import { colors, font, radius } from '../theme';
import Feather from '@expo/vector-icons/Feather';
import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';
import { useConfirm } from '../components/ConfirmDialog';
import Button from '../components/Button';
import Card from '../components/Card';
import Input from '../components/Input';
import { JarvisOrb, JarvisClock } from '../components/jarvis';

export default function LoginScreen() {
  const router = useRouter();
  const {
    accounts, isConnected, error, agentName,
    saveAccount, switchAccount, removeAccount,
  } = useConnection();
  const createSession = useChat((s) => s.createSession);
  const getOrCreateVoiceSession = useChat((s) => s.getOrCreateVoiceSession);
  const confirm = useConfirm();

  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('8765');
  const [token, setToken] = useState('');

  const handleSaveAndConnect = () => {
    saveAccount({
      name: `${host}:${port}`,
      host,
      port: parseInt(port, 10),
      token,
      isLocal: host === 'localhost' || host === '127.0.0.1',
    });
  };

  const handleQuickConnect = (accountId: string) => {
    switchAccount(accountId);
  };

  const handleRemove = async (id: string, accName: string) => {
    const confirmed = await confirm({
      title: 'Remove Agent',
      message: `Remove "${accName}"?`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    removeAccount(id);
  };

  useEffect(() => {
    if (isConnected && agentName) {
      createSession();
      // Mint the voice session at login too so the Voice tab is ready
      // the moment the user navigates there — no first-visit lag while
      // the page mounts and the session id is created lazily. Safe to
      // call regardless of which agent the user logged into; the store
      // is reset by ``switchAccount`` on agent switch.
      getOrCreateVoiceSession();
      router.replace('/(tabs)/chat');
    }
  }, [isConnected, agentName]);

  const hasSaved = accounts.length > 0;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View
        style={styles.inner}
        // @ts-ignore
        {...(Platform.OS === 'web' ? { className: 'oa-slide-up' } : {})}
      >
        {/* JARVIS wake-up scene — orb + clock above the connect form. */}
        <View style={styles.wakeScene}>
          <JarvisOrb size={180} label="OPENAGENT" />
          <View style={styles.clockWrap}>
            <JarvisClock size="md" />
          </View>
        </View>

        {hasSaved && (
          <>
            <Text style={styles.sectionKicker}>Your Agents</Text>
            <Card padded={false}>
              {accounts.map((acc, i) => (
                <View
                  key={acc.id}
                  style={[styles.accountRow, i > 0 && styles.accountRowBorder]}
                >
                  <TouchableOpacity
                    style={styles.accountInfo}
                    onPress={() => handleQuickConnect(acc.id)}
                  >
                    <Text style={styles.accountName}>{acc.name}</Text>
                    <Text style={styles.accountHost}>{acc.host}:{acc.port}</Text>
                  </TouchableOpacity>
                  <Button
                    variant="primary"
                    size="sm"
                    label="Connect"
                    onPress={() => handleQuickConnect(acc.id)}
                    style={{ marginRight: 4 }}
                  />
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => { void handleRemove(acc.id, acc.name); }}
                  >
                    <Feather name="x" size={13} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </Card>
          </>
        )}

        <Text style={[styles.sectionKicker, hasSaved && { marginTop: 24 }]}>
          {hasSaved ? 'New Agent' : 'Connect'}
        </Text>
        {!hasSaved && (
          <Text style={styles.subtitle}>Connect to an OpenAgent instance.</Text>
        )}

        <Card>
          <Input
            label="Host"
            value={host}
            onChangeText={setHost}
            placeholder="localhost"
            mono
            containerStyle={{ marginBottom: 12 }}
          />
          <View style={styles.fieldRow}>
            <Input
              label="Port"
              value={port}
              onChangeText={setPort}
              placeholder="8765"
              keyboardType="numeric"
              mono
              containerStyle={{ flex: 1, marginRight: 8 }}
            />
            <Input
              label="Token"
              value={token}
              onChangeText={setToken}
              placeholder="optional"
              secureTextEntry
              mono
              containerStyle={{ flex: 2 }}
            />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <Button
            variant="primary"
            size="md"
            fullWidth
            label={hasSaved ? 'Save & Connect' : 'Connect'}
            onPress={handleSaveAndConnect}
            style={{ marginTop: 14 }}
          />
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: colors.bg,
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

  // Saved accounts
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
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text,
    letterSpacing: -0.1,
  },
  accountHost: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    fontFamily: font.mono,
  },
  deleteBtn: {
    padding: 8,
  },
  fieldRow: { flexDirection: 'row' },
  error: {
    color: colors.error,
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
});
