import { colors, font, radius } from '../../theme';
/**
 * MCPs screen — view default MCPs (read-only) and manage custom MCPs.
 */

import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import { setBaseUrl } from '../../services/api';
import { useConfirm } from '../../components/ConfirmDialog';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ThemedSwitch from '../../components/ThemedSwitch';

const DEFAULT_MCPS = [
  { name: 'vault', desc: 'Obsidian-compatible markdown notes (mcpvault)' },
  { name: 'filesystem', desc: 'Read, write, list, search files' },
  { name: 'editor', desc: 'Find-replace, grep, glob' },
  { name: 'web-search', desc: 'Web search + page fetch' },
  { name: 'shell', desc: 'Cross-platform shell execution' },
  { name: 'computer-control', desc: 'Screenshot, mouse, keyboard' },
  { name: 'chrome-devtools', desc: 'Browser automation, DOM inspection' },
  { name: 'messaging', desc: 'Send Telegram/Discord/WhatsApp messages' },
  { name: 'scheduler', desc: 'Manage cron tasks from conversations' },
];

export default function McpsScreen() {
  const config = useConnection((s) => s.config);
  const { config: agentConfig, loadConfig, updateSection } = useConfig();
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const confirm = useConfirm();

  useEffect(() => {
    if (config) {
      setBaseUrl(config.host, config.port);
      loadConfig();
    }
  }, [config]);

  const disabled = agentConfig?.mcp_disable || [];
  const customMcps = agentConfig?.mcp || [];

  const toggleDefault = async (name: string) => {
    const current = [...disabled];
    const idx = current.indexOf(name);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(name);
    await updateSection('mcp_disable', current);
  };

  const removeCustom = async (name: string) => {
    const confirmed = await confirm({
      title: 'Remove MCP',
      message: `Remove MCP "${name}"?`,
      confirmLabel: 'Remove',
    });
    if (!confirmed) return;
    const updated = customMcps.filter((m) => m.name !== name);
    await updateSection('mcp', updated);
  };

  const addCustom = async () => {
    if (!newName.trim()) return;
    const entry: any = { name: newName.trim() };
    if (newUrl.trim()) entry.url = newUrl.trim();
    else if (newCommand.trim()) entry.command = newCommand.trim().split(/\s+/);
    const updated = [...customMcps, entry];
    const ok = await updateSection('mcp', updated);
    if (ok) {
      setNewName('');
      setNewCommand('');
      setNewUrl('');
      setAddingNew(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Default MCPs */}
      <Text style={styles.sectionTitle}>Default MCPs</Text>
      <Text style={styles.sectionHint}>
        Bundled with OpenAgent. Toggle to enable/disable. Restart required.
      </Text>
      <Card padded={false}>
        {DEFAULT_MCPS.map((mcp, i) => (
          <View key={mcp.name} style={[styles.row, i > 0 && styles.rowBorder]}>
            <View style={styles.mcpInfo}>
              <Text style={styles.mcpName}>{mcp.name}</Text>
              <Text style={styles.mcpDesc}>{mcp.desc}</Text>
            </View>
            <ThemedSwitch
              value={!disabled.includes(mcp.name)}
              onValueChange={() => toggleDefault(mcp.name)}
            />
          </View>
        ))}
      </Card>

      {/* Custom MCPs */}
      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Custom MCPs</Text>
      <Text style={styles.sectionHint}>
        User-configured MCP servers from openagent.yaml
      </Text>
      <Card padded={false}>
        {customMcps.length === 0 && !addingNew && (
          <Text style={styles.emptyText}>No custom MCPs configured</Text>
        )}
        {customMcps.map((mcp, i) => (
          <View key={mcp.name} style={[styles.row, i > 0 && styles.rowBorder]}>
            <View style={styles.mcpInfo}>
              <Text style={styles.mcpName}>{mcp.name}</Text>
              <Text style={styles.mcpDesc}>
                {mcp.url || (mcp.command || []).join(' ')}
              </Text>
              {mcp.env && Object.keys(mcp.env).length > 0 && (
                <Text style={styles.mcpEnv}>
                  env: {Object.keys(mcp.env).join(', ')}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => removeCustom(mcp.name)} style={styles.removeBtn}>
              <Feather name="x" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ))}

        {/* Add new form */}
        {addingNew ? (
          <View style={styles.addForm}>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder="Name (e.g. github)"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={styles.input}
              value={newCommand}
              onChangeText={setNewCommand}
              placeholder="Command (e.g. github-mcp-server stdio)"
              placeholderTextColor={colors.textMuted}
            />
            <TextInput
              style={styles.input}
              value={newUrl}
              onChangeText={setNewUrl}
              placeholder="Or URL (e.g. http://localhost:8000/mcp)"
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.addFormActions}>
              <Button variant="ghost" size="sm" label="Cancel" onPress={() => setAddingNew(false)} />
              <Button variant="primary" size="sm" label="Add MCP" onPress={addCustom} />
            </View>
          </View>
        ) : (
          <View style={{ padding: 10, borderTopWidth: 1, borderTopColor: colors.borderLight }}>
            <Button
              variant="primary"
              label="Add MCP Server"
              icon="plus"
              fullWidth
              onPress={() => setAddingNew(true)}
            />
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, maxWidth: 640, width: "100%", alignSelf: "center" },
  sectionTitle: {
    fontSize: 18, fontWeight: '500', color: colors.text, marginBottom: 4,
    fontFamily: font.display, letterSpacing: -0.3,
  },
  sectionHint: { fontSize: 12, color: colors.textMuted, marginBottom: 12 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: 2,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  mcpInfo: { flex: 1 },
  mcpName: { fontSize: 13, fontWeight: '600', color: colors.text, fontFamily: font.mono },
  mcpDesc: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  mcpEnv: { fontSize: 10.5, color: colors.textMuted, marginTop: 2, fontFamily: font.mono },
  removeBtn: { padding: 6 },
  emptyText: { padding: 14, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  addBtn: { padding: 10, borderTopWidth: 1, borderTopColor: colors.borderLight },
  addBtnInner: { minHeight: 34, borderRadius: radius.sm },
  addBtnContent: { flexDirection: 'row', alignItems: 'center' },
  addBtnText: { fontSize: 12, color: colors.textInverse, fontWeight: '600', marginLeft: 6 },
  addForm: { padding: 12, borderTopWidth: 1, borderTopColor: colors.borderLight },
  input: {
    backgroundColor: colors.inputBg, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 11, paddingVertical: 9,
    color: colors.text, fontSize: 12, marginBottom: 6, fontFamily: font.mono,
  },
  addFormActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 4 },
  cancelBtn: { padding: 6 },
  cancelBtnText: { color: colors.textMuted, fontSize: 12 },
  saveBtn: {},
  saveBtnInner: { minHeight: 30, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm },
  saveBtnText: { color: colors.textInverse, fontSize: 12, fontWeight: '600' },
});
