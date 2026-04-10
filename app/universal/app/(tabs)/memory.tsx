/**
 * Memory screen — placeholder for Obsidian-style vault editor.
 */

import { View, Text, StyleSheet } from 'react-native';

export default function MemoryScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>🧠</Text>
        <Text style={styles.title}>Memory Vault</Text>
        <Text style={styles.subtitle}>
          Graph view, markdown editor, and backlinks — coming soon.
        </Text>
        <Text style={styles.hint}>
          For now, use Obsidian desktop with Syncthing to browse the vault.
        </Text>
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
  content: {
    alignItems: 'center',
    maxWidth: 360,
    padding: 32,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  hint: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    lineHeight: 19,
  },
});
