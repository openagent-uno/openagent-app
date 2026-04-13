import { colors } from '../../theme';
/**
 * Model screen — view and edit the LLM provider configuration.
 */

import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useConnection } from '../../stores/connection';
import { useConfig } from '../../stores/config';
import { setBaseUrl, getUsage, getProviders, testProvider, updateConfigSection } from '../../services/api';
import PrimaryButton from '../../components/PrimaryButton';
import type { UsageData, ProviderConfig } from '../../../common/types';

const PROVIDERS = ['claude-cli', 'litellm', 'smart'];
const PERMISSION_MODES = ['bypass', 'auto', 'default'];

export default function ModelScreen() {
  const connConfig = useConnection((s) => s.config);
  const { config: agentConfig, loadConfig, updateSection } = useConfig();

  const [provider, setProvider] = useState('claude-cli');
  const [modelId, setModelId] = useState('claude-sonnet-4-6');
  const [permissionMode, setPermissionMode] = useState('bypass');
  const [apiKey, setApiKey] = useState('');
  const [monthlyBudget, setMonthlyBudget] = useState('20');
  const [routingSimple, setRoutingSimple] = useState('anthropic/claude-haiku-4-5');
  const [routingMedium, setRoutingMedium] = useState('anthropic/claude-sonnet-4-6');
  const [routingHard, setRoutingHard] = useState('anthropic/claude-opus-4-6');
  const [routingFallback, setRoutingFallback] = useState('google/gemini-2.5-flash');
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [saved, setSaved] = useState(false);

  // Provider management state
  const [llmProviders, setLlmProviders] = useState<Record<string, ProviderConfig>>({});
  const [addingProvider, setAddingProvider] = useState(false);
  const [newProvName, setNewProvName] = useState('');
  const [newProvKey, setNewProvKey] = useState('');
  const [newProvUrl, setNewProvUrl] = useState('');
  const [testingProv, setTestingProv] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; error?: string }>>({});

  const KNOWN_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter', 'ollama'];

  const loadProviders = async () => {
    try { setLlmProviders(await getProviders()); } catch {}
  };

  useEffect(() => {
    if (connConfig) {
      setBaseUrl(connConfig.host, connConfig.port);
      loadConfig();
      loadProviders();
      getUsage().then(setUsage).catch(() => {});
    }
  }, [connConfig]);

  // Populate fields from loaded config
  useEffect(() => {
    if (agentConfig?.model) {
      const m = agentConfig.model;
      setProvider(m.provider || 'claude-cli');
      setModelId(m.model_id || '');
      setPermissionMode(m.permission_mode || 'bypass');
      setApiKey(m.api_key || '');
      if (m.monthly_budget) setMonthlyBudget(String(m.monthly_budget));
      if (m.routing) {
        setRoutingSimple(m.routing.simple || '');
        setRoutingMedium(m.routing.medium || '');
        setRoutingHard(m.routing.hard || '');
        setRoutingFallback(m.routing.fallback || '');
      }
    }
  }, [agentConfig]);

  const handleSave = async () => {
    const model: any = { provider };

    if (provider === 'claude-cli') {
      model.model_id = modelId;
      model.permission_mode = permissionMode;
    } else if (provider === 'litellm') {
      model.model_id = modelId;
      if (apiKey.trim()) model.api_key = apiKey;
    } else if (provider === 'smart') {
      model.monthly_budget = parseFloat(monthlyBudget) || 20;
      model.routing = {
        simple: routingSimple,
        medium: routingMedium,
        hard: routingHard,
        fallback: routingFallback,
      };
      if (apiKey.trim()) model.api_key = apiKey;
    }

    const ok = await updateSection('model', model);
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  };

  const isLiteLLM = provider === 'litellm';
  const isSmart = provider === 'smart';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Model Configuration</Text>
      <Text style={styles.hint}>Changes require an agent restart to take effect.</Text>

      <View style={styles.card}>
        {/* Provider */}
        <Text style={styles.label}>Provider</Text>
        <View style={styles.segmented}>
          {PROVIDERS.map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.segment, provider === p && styles.segmentActive]}
              onPress={() => setProvider(p)}
            >
              <Text style={[styles.segmentText, provider === p && styles.segmentTextActive]}>
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Model ID (not for smart) */}
        {!isSmart && (
          <>
            <Text style={styles.label}>Model ID</Text>
            <TextInput
              style={styles.input}
              value={modelId}
              onChangeText={setModelId}
              placeholder={isLiteLLM ? 'anthropic/claude-sonnet-4-6' : 'claude-sonnet-4-6'}
              placeholderTextColor={colors.textMuted}
            />
          </>
        )}

        {/* Permission Mode (claude-cli only) */}
        {provider === 'claude-cli' && (
          <>
            <Text style={styles.label}>Permission Mode</Text>
            <View style={styles.segmented}>
              {PERMISSION_MODES.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.segment, permissionMode === m && styles.segmentActive]}
                  onPress={() => setPermissionMode(m)}
                >
                  <Text style={[styles.segmentText, permissionMode === m && styles.segmentTextActive]}>
                    {m}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* API Key override (litellm/smart — optional, keys come from Providers section below) */}
        {(isLiteLLM || isSmart) && (
          <>
            <Text style={styles.label}>API Key Override (optional)</Text>
            <TextInput
              style={styles.input}
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="Uses keys from Providers section below"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />
          </>
        )}

        {/* Smart Routing Config */}
        {isSmart && (
          <>
            <Text style={[styles.label, { marginTop: 20 }]}>Routing</Text>
            <Text style={styles.sublabel}>Simple tasks</Text>
            <TextInput style={styles.input} value={routingSimple} onChangeText={setRoutingSimple}
              placeholder="anthropic/claude-haiku-4-5" placeholderTextColor={colors.textMuted} />
            <Text style={styles.sublabel}>Medium tasks</Text>
            <TextInput style={styles.input} value={routingMedium} onChangeText={setRoutingMedium}
              placeholder="anthropic/claude-sonnet-4-6" placeholderTextColor={colors.textMuted} />
            <Text style={styles.sublabel}>Hard tasks</Text>
            <TextInput style={styles.input} value={routingHard} onChangeText={setRoutingHard}
              placeholder="anthropic/claude-opus-4-6" placeholderTextColor={colors.textMuted} />
            <Text style={styles.sublabel}>Fallback</Text>
            <TextInput style={styles.input} value={routingFallback} onChangeText={setRoutingFallback}
              placeholder="google/gemini-2.5-flash" placeholderTextColor={colors.textMuted} />

            <Text style={[styles.label, { marginTop: 20 }]}>Monthly Budget ($)</Text>
            <TextInput style={styles.input} value={monthlyBudget} onChangeText={setMonthlyBudget}
              placeholder="20.00" placeholderTextColor={colors.textMuted} keyboardType="numeric" />

            {/* Usage Display */}
            {usage && usage.monthly_budget > 0 && (
              <View style={styles.usageBox}>
                <Text style={styles.usageTitle}>Current Spend</Text>
                <View style={styles.usageBar}>
                  <View style={[styles.usageFill, {
                    width: `${Math.min(100, (usage.monthly_spend / usage.monthly_budget) * 100)}%`,
                    backgroundColor: usage.monthly_spend / usage.monthly_budget > 0.8 ? '#e74c3c' : colors.primary,
                  }]} />
                </View>
                <Text style={styles.usageText}>
                  ${usage.monthly_spend.toFixed(2)} / ${usage.monthly_budget.toFixed(2)}
                  {usage.remaining != null && ` (${usage.remaining.toFixed(2)} remaining)`}
                </Text>
              </View>
            )}
          </>
        )}

        {/* Save */}
        <PrimaryButton style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveBtnText}>
            {saved ? 'Saved (restart required)' : 'Save'}
          </Text>
        </PrimaryButton>
      </View>

      {/* ── LLM Providers (API Keys) ── */}
      {(isLiteLLM || isSmart) && (
        <>
          <Text style={[styles.title, { marginTop: 24 }]}>API Keys</Text>
          <Text style={styles.hint}>Manage API keys used by litellm and smart routing.</Text>

          {Object.entries(llmProviders).map(([name, cfg]) => (
            <View key={name} style={styles.providerCard}>
              <View style={styles.providerHeader}>
                <Text style={styles.providerName}>{name}</Text>
                <View style={styles.providerActions}>
                  <TouchableOpacity onPress={async () => {
                    setTestingProv(name);
                    try {
                      const r = await testProvider(name);
                      setTestResults((prev) => ({ ...prev, [name]: r }));
                    } catch (e: any) {
                      setTestResults((prev) => ({ ...prev, [name]: { ok: false, error: e.message } }));
                    }
                    setTestingProv(null);
                  }} disabled={testingProv === name}>
                    {testingProv === name
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <Text style={styles.actionLink}>Test</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={async () => {
                    const cp = { ...(agentConfig?.providers || {}) };
                    delete cp[name];
                    await updateConfigSection('providers', cp);
                    await loadProviders();
                    await loadConfig();
                  }}>
                    <Text style={[styles.actionLink, { color: '#e74c3c' }]}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.providerDetail}>
                Key: {cfg.api_key_display || '—'}
              </Text>
              {cfg.base_url && <Text style={styles.providerDetail}>URL: {cfg.base_url}</Text>}
              {testResults[name] && (
                <Text style={testResults[name].ok ? styles.testOk : styles.testFail}>
                  {testResults[name].ok ? 'Connection OK' : `Failed: ${testResults[name].error}`}
                </Text>
              )}
            </View>
          ))}

          {addingProvider ? (
            <View style={styles.providerCard}>
              <Text style={styles.label}>Provider</Text>
              <View style={[styles.segmented, { flexWrap: 'wrap', gap: 4, borderWidth: 0 }]}>
                {KNOWN_PROVIDERS.map((p) => (
                  <TouchableOpacity key={p}
                    style={[styles.chip, newProvName === p && styles.chipActive]}
                    onPress={() => setNewProvName(p)}>
                    <Text style={[styles.chipText, newProvName === p && styles.chipTextActive]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>API Key</Text>
              <TextInput style={styles.input} value={newProvKey} onChangeText={setNewProvKey}
                placeholder="sk-..." placeholderTextColor={colors.textMuted} secureTextEntry />
              {(newProvName === 'ollama' || newProvName === 'custom') && (
                <>
                  <Text style={styles.label}>Base URL</Text>
                  <TextInput style={styles.input} value={newProvUrl} onChangeText={setNewProvUrl}
                    placeholder="http://localhost:11434/v1" placeholderTextColor={colors.textMuted} />
                </>
              )}
              <View style={styles.providerFormActions}>
                <TouchableOpacity onPress={() => { setAddingProvider(false); setNewProvName(''); setNewProvKey(''); setNewProvUrl(''); }}>
                  <Text style={{ color: colors.textMuted }}>Cancel</Text>
                </TouchableOpacity>
                <PrimaryButton onPress={async () => {
                  if (!newProvName) return;
                  const entry: any = {};
                  if (newProvKey.trim()) entry.api_key = newProvKey;
                  if (newProvUrl.trim()) entry.base_url = newProvUrl;
                  const merged = { ...(agentConfig?.providers || {}), [newProvName]: entry };
                  await updateConfigSection('providers', merged);
                  setAddingProvider(false); setNewProvName(''); setNewProvKey(''); setNewProvUrl('');
                  await loadProviders();
                  await loadConfig();
                }}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </PrimaryButton>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.addProviderBtn} onPress={() => setAddingProvider(true)}>
              <Text style={styles.addProviderText}>+ Add API Key</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, maxWidth: 500, width: "100%", alignSelf: "center" },
  title: { fontSize: 17, fontWeight: '600', color: colors.text, marginBottom: 4 },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 16 },
  card: {
    backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, padding: 16,
  },
  label: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 16, marginBottom: 6 },
  input: {
    backgroundColor: colors.inputBg, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    padding: 10, color: colors.text, fontSize: 14,
  },
  segmented: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  segment: { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: colors.inputBg },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  segmentTextActive: { color: colors.textInverse },
  sublabel: { fontSize: 11, color: colors.textMuted, marginTop: 8, marginBottom: 4 },
  usageBox: { marginTop: 16, padding: 12, backgroundColor: colors.inputBg, borderRadius: 8 },
  usageTitle: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
  usageBar: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' },
  usageFill: { height: '100%', borderRadius: 3 },
  usageText: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  saveBtn: { marginTop: 20 },
  saveBtnText: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  // Provider management styles
  providerCard: {
    backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 10,
  },
  providerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  providerActions: { flexDirection: 'row', gap: 12 },
  providerName: { fontSize: 15, fontWeight: '600', color: colors.text },
  providerDetail: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  actionLink: { fontSize: 13, color: colors.primary, fontWeight: '500' },
  testOk: { fontSize: 12, color: '#2ecc71', marginTop: 6 },
  testFail: { fontSize: 12, color: '#e74c3c', marginTop: 6 },
  chip: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6,
    backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textSecondary },
  chipTextActive: { color: colors.textInverse },
  providerFormActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  addProviderBtn: {
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed',
    borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 8,
  },
  addProviderText: { fontSize: 14, color: colors.primary, fontWeight: '500' },
});
