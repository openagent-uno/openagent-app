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

  // Auto-navigate on successful connection
  if (isConnected && agentName) {
    createSession();
    router.replace('/chat');
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
            placeholderTextColor="#666"
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
            placeholderTextColor="#666"
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
            placeholderTextColor="#666"
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
            handleConnect();
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
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 32,
    width: 400,
    maxWidth: '90%',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#e0e0e0',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginBottom: 24,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    color: '#aaa',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    padding: 12,
    color: '#e0e0e0',
    fontSize: 15,
  },
  error: {
    color: '#e74c3c',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#533483',
    borderRadius: 8,
    padding: 14,
    marginTop: 8,
    alignItems: 'center',
  },
  localButton: {
    backgroundColor: '#0f3460',
  },
  buttonText: {
    color: '#e0e0e0',
    fontSize: 15,
    fontWeight: '600',
  },
});
