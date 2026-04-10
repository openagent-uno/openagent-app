/**
 * Settings screen — placeholder for config editor + MCP management.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../../stores/connection';

export default function SettingsScreen() {
  const router = useRouter();
  const { agentName, agentVersion, config, disconnect } = useConnection();

  const handleDisconnect = () => {
    disconnect();
    router.replace('/');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Agent</Text>
            <Text style={styles.value}>{agentName || '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Version</Text>
            <Text style={styles.value}>{agentVersion || '—'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Host</Text>
            <Text style={styles.value}>{config?.host || '—'}:{config?.port || '—'}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, { marginTop: 32 }]}>Configuration</Text>
        <View style={styles.card}>
          <Text style={styles.comingSoon}>
            YAML editor, MCP management, system prompt editor, scheduler — coming soon.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  content: {
    padding: 24,
    maxWidth: 600,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EBEBEB',
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  label: {
    fontSize: 14,
    color: '#666',
  },
  value: {
    fontSize: 14,
    color: '#1a1a1a',
    fontWeight: '500',
  },
  disconnectBtn: {
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D94F4F',
    padding: 12,
    alignItems: 'center',
  },
  disconnectText: {
    color: '#D94F4F',
    fontSize: 14,
    fontWeight: '500',
  },
  comingSoon: {
    fontSize: 14,
    color: '#999',
    lineHeight: 20,
  },
});
