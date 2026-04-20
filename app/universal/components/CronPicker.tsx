/**
 * CronPicker — reusable scheduling control.
 *
 * Shows four common presets (every 5 min, hourly, daily 9am, weekly
 * Monday 9am) plus a free-form custom input. On every change, calls
 * the gateway's ``/api/cron/describe`` to validate and preview the
 * next three fire times. Same widget intended for the workflow list
 * create form AND the trigger-schedule block's properties panel, so
 * the cron string ends up identical whether set at the row or graph
 * level — which the backend sync helper then reconciles.
 *
 * Works on both web (styled with RN's StyleSheet so it renders via
 * react-native-web) and native (same component; inputs use TextInput).
 */

import Feather from '@expo/vector-icons/Feather';
import { useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { describeCron, type CronDescribeResponse } from '../services/api';
import { colors, font, radius } from '../theme';

export interface CronPreset {
  label: string;
  expression: string;
}

const DEFAULT_PRESETS: CronPreset[] = [
  { label: 'Every 5 min', expression: '*/5 * * * *' },
  { label: 'Hourly', expression: '0 * * * *' },
  { label: 'Daily 9am', expression: '0 9 * * *' },
  { label: 'Weekly Mon 9am', expression: '0 9 * * 1' },
];

interface Props {
  value: string;
  onChange: (expression: string) => void;
  presets?: CronPreset[];
  label?: string;
  disabled?: boolean;
}

export default function CronPicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  label = 'Schedule',
  disabled = false,
}: Props) {
  const [preview, setPreview] = useState<CronDescribeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Debounce describe calls so typing feels instant instead of
  // flooding the gateway per keystroke.
  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await describeCron(value, 3);
        if (!cancelled) setPreview(res);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [value]);

  const isPreset = useMemo(
    () => presets.some((p) => p.expression === value),
    [presets, value],
  );

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <View style={styles.presetRow}>
        {presets.map((p) => (
          <TouchableOpacity
            key={p.expression}
            onPress={() => !disabled && onChange(p.expression)}
            disabled={disabled}
            style={[
              styles.presetChip,
              value === p.expression && styles.presetChipActive,
              disabled && styles.disabled,
            ]}
          >
            <Text
              style={[
                styles.presetText,
                value === p.expression && styles.presetTextActive,
              ]}
            >
              {p.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={[styles.input, disabled && styles.disabled]}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        placeholder="Custom cron (e.g. 0 9 * * *)"
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />

      {/* Preview area — valid + next 3, or error message. */}
      <View style={styles.previewBox}>
        {!value ? (
          <Text style={styles.previewMuted}>
            Pick a preset or enter a cron string.
          </Text>
        ) : loading ? (
          <Text style={styles.previewMuted}>Validating…</Text>
        ) : preview && preview.valid ? (
          <>
            <View style={styles.previewHeader}>
              <Feather name="check-circle" size={11} color={colors.success} />
              <Text style={styles.previewOk}>
                {preview.one_shot ? 'Fires once at:' : 'Next 3 runs:'}
              </Text>
            </View>
            {(preview.upcoming || []).map((u, i) => (
              <Text key={i} style={styles.previewLine}>
                {u.iso}
              </Text>
            ))}
            {isPreset || !value ? null : (
              <Text style={styles.previewHint}>
                Custom cron — 5 fields: minute hour day month weekday
              </Text>
            )}
          </>
        ) : (
          <View style={styles.previewHeader}>
            <Feather name="alert-circle" size={11} color={colors.error} />
            <Text style={styles.previewErr}>
              {preview?.error || 'Invalid cron expression'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 8,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetChipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  presetText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  presetTextActive: {
    color: colors.primary,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 12,
    fontFamily: font.mono,
  },
  previewBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    minHeight: 42,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 3,
  },
  previewOk: {
    fontSize: 10,
    color: colors.success,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  previewErr: {
    fontSize: 11,
    color: colors.error,
    flex: 1,
  },
  previewLine: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: font.mono,
    lineHeight: 16,
  },
  previewMuted: {
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  previewHint: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
    fontStyle: 'italic',
  },
  disabled: { opacity: 0.5 },
});
