/**
 * Login screen — connect to a local or remote OpenAgent instance.
 */

import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useConnection } from '../stores/connection';
import { useChat } from '../stores/chat';

export default function LoginScreen() {
  const router = useRouter();
  const { connect, isConnected, error, agentName } = useConnection();
  const createSession = useChat((s) => s.createSession);
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('8765');
  const [token, setToken] = useState('');

  const handleConnect = () => {
    connect({
      name: `${host}:${port}`,
      host,
      port: parseInt(port, 10),
      token,
      isLocal: host === 'localhost' || host === '127.0.0.1',
    });
  };

  if (isConnected && agentName) {
    createSession();
    router.replace('/(tabs)/chat');
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>OpenAgent</Text>
        <Text style={styles.subtitle}>Connect to an agent instance</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Host</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            placeholder="localhost"
            placeholderTextColor="#999"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Port</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            placeholder="8765"
            keyboardType="numeric"
            placeholderTextColor="#999"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="(optional)"
            secureTextEntry
            placeholderTextColor="#999"
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={styles.button} onPress={handleConnect}>
          <Text style={styles.buttonText}>Connect</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.localButton]}
          onPress={() => {
            setHost('localhost');
            setPort('8765');
            setToken('');
            setTimeout(handleConnect, 50);
          }}
        >
          <Text style={styles.buttonText}>Connect to Local</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 32,
    width: 380,
    maxWidth: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    // @ts-ignore
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 28,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    padding: 12,
    color: '#1a1a1a',
    fontSize: 14,
  },
  error: {
    color: '#D94F4F',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#D97757',
    borderRadius: 8,
    padding: 13,
    marginTop: 8,
    alignItems: 'center',
  },
  localButton: {
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
