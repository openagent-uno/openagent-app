/**
 * WorkflowEditor — native (iOS/Android) touch-first editor.
 *
 * Layout:
 *   - Top bar: Back · workflow name · Save · Run · History
 *   - NativeCanvas: SVG + gesture layer for nodes/edges
 *   - Floating "+" button bottom-right opens BlockPaletteNative
 *   - Selected node → PropertiesPanelNative modal
 *   - History button → RunHistoryDrawer (same component as web —
 *     it's RN-friendly enough to share)
 *
 * Same data flow as the web editor: unsaved edits stay local, Save
 * flushes the whole graph via ``updateWorkflow``, Run streams trace
 * entries back through the store's ``runWorkflow`` polling path.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors, font, radius } from '../../theme';
import { useWorkflows } from '../../stores/workflows';
import type {
  BlockType,
  WorkflowEdge,
  WorkflowNode,
  WorkflowTask,
  WorkflowTraceEntry,
} from '../../../common/types';
import BlockPaletteNative from './BlockPaletteNative';
import NativeCanvas from './NativeCanvas';
import PropertiesPanelNative from './PropertiesPanelNative';
import RunHistoryDrawer from './RunHistoryDrawer';
import { NODE_META } from './nodes-native/nodeMeta';

type NodeStatus = 'idle' | 'running' | 'success' | 'failed';

interface Props {
  workflow: WorkflowTask;
  onBack: () => void;
  onWorkflowUpdated?: (wf: WorkflowTask) => void;
}

export default function WorkflowEditorNative({
  workflow,
  onBack,
  onWorkflowUpdated,
}: Props) {
  const {
    blockTypes,
    runningId,
    loadBlockTypes,
    updateWorkflow,
    runWorkflow,
  } = useWorkflows();

  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [connectFrom, setConnectFrom] = useState<{
    nodeId: string;
    handle: string;
  } | null>(null);
  const [lastRunStatus, setLastRunStatus] = useState<string | null>(null);
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeStatus>>({});

  useEffect(() => {
    const g = workflow.graph || { nodes: [], edges: [], variables: {} };
    setNodes((g.nodes || []).map((n) => ({ ...n })));
    setEdges((g.edges || []).map((e) => ({ ...e })));
    setVariables(g.variables || {});
    setDirty(false);
    setSelectedId(null);
    setConnectFrom(null);
  }, [workflow.id]);

  useEffect(() => {
    if (blockTypes.length === 0) void loadBlockTypes();
  }, []);

  // ── Canvas → editor bridges ─────────────────────────────────────

  const onNodePositionChanged = useCallback(
    (id: string, position: { x: number; y: number }) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, position } : n)),
      );
      setDirty(true);
    },
    [],
  );

  const onHandleTap = useCallback(
    (nodeId: string, handle: string, kind: 'source' | 'target') => {
      // Two-tap connect: first tap source, second tap target.
      if (kind === 'source') {
        if (connectFrom && connectFrom.nodeId === nodeId && connectFrom.handle === handle) {
          // Second tap on the same source = cancel
          setConnectFrom(null);
        } else {
          setConnectFrom({ nodeId, handle });
        }
        return;
      }
      // Target tap
      if (!connectFrom) return; // nothing to connect
      if (connectFrom.nodeId === nodeId) {
        setConnectFrom(null); // can't connect to self
        return;
      }
      const newEdge: WorkflowEdge = {
        id: nextEdgeId(edges),
        source: connectFrom.nodeId,
        target: nodeId,
        sourceHandle: connectFrom.handle,
        targetHandle: handle,
      };
      setEdges((es) => [...es, newEdge]);
      setConnectFrom(null);
      setDirty(true);
    },
    [connectFrom, edges],
  );

  // ── Properties panel updates ────────────────────────────────────

  const patchNode = useCallback(
    (nodeId: string, patch: Partial<WorkflowNode>) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
      );
      setDirty(true);
    },
    [],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== nodeId));
      setEdges((es) =>
        es.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
      if (selectedId === nodeId) setSelectedId(null);
      setDirty(true);
    },
    [selectedId],
  );

  const insertBlockAtCenter = useCallback(
    (type: BlockType) => {
      const newId = nextNodeId(nodes);
      // Insert loosely in the middle of whatever the user is looking
      // at — pan/zoom tracking would let us hit the exact viewport
      // center, but this is fine as a starting point.
      const fallbackX = 60 + (nodes.length * 40) % 240;
      const fallbackY = 60 + (nodes.length * 40) % 240;
      const newNode: WorkflowNode = {
        id: newId,
        type,
        label: '',
        position: { x: fallbackX, y: fallbackY },
        config: defaultConfigFor(type),
      };
      setNodes((ns) => [...ns, newNode]);
      setSelectedId(newId);
      setDirty(true);
    },
    [nodes],
  );

  // ── Save / Run ──────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const ok = await updateWorkflow(workflow.id, {
        nodes,
        edges,
        variables,
      });
      if (ok) {
        setDirty(false);
        const updated = useWorkflows
          .getState()
          .workflows.find((w) => w.id === workflow.id);
        if (updated && onWorkflowUpdated) onWorkflowUpdated(updated);
      } else {
        setSaveError(
          useWorkflows.getState().error ||
            'Failed to save — server rejected the graph.',
        );
      }
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, variables, workflow.id, updateWorkflow, onWorkflowUpdated]);

  const handleRun = useCallback(async () => {
    setNodeStatuses({});
    setLastRunStatus('running');
    const run = await runWorkflow(workflow.id, {}, {
      onUpdate: (live) => {
        setLastRunStatus(live.status);
        const incremental: Record<string, NodeStatus> = {};
        for (const entry of (live.trace || []) as WorkflowTraceEntry[]) {
          const s = entry.status;
          if (s === 'success' || s === 'failed' || s === 'running') {
            incremental[entry.node_id] = s;
          }
        }
        setNodeStatuses(incremental);
      },
    });
    setLastRunStatus(run?.status || 'failed');
  }, [workflow.id, runWorkflow]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) || null,
    [nodes, selectedId],
  );
  const isRunning = runningId === workflow.id;

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.iconBtn}>
          <Feather name="arrow-left" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {workflow.name}
          </Text>
          {lastRunStatus ? (
            <Text
              style={[
                styles.statusBadge,
                lastRunStatus === 'success' && { color: colors.success },
                lastRunStatus === 'failed' && { color: colors.error },
                lastRunStatus === 'running' && { color: colors.warning },
              ]}
            >
              {lastRunStatus}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => setHistoryOpen(true)}
          style={styles.iconBtn}
        >
          <Feather name="clock" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSave}
          disabled={!dirty || saving}
          style={[
            styles.saveBtn,
            (!dirty || saving) && { opacity: 0.5 },
          ]}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <>
              <Feather name="save" size={12} color={colors.textInverse} />
              <Text style={styles.saveBtnText}>
                {dirty ? 'Save' : 'Saved'}
              </Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleRun}
          disabled={isRunning}
          style={[styles.runBtn, isRunning && { opacity: 0.5 }]}
        >
          {isRunning ? (
            <ActivityIndicator size="small" color={colors.textInverse} />
          ) : (
            <>
              <Feather name="play" size={12} color={colors.textInverse} />
              <Text style={styles.runBtnText}>Run</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {saveError ? <Text style={styles.errorBanner}>{saveError}</Text> : null}
      {connectFrom ? (
        <View style={styles.connectBanner}>
          <Feather name="link" size={12} color={colors.primary} />
          <Text style={styles.connectText}>
            Connecting from <Text style={styles.mono}>{connectFrom.nodeId}</Text>·
            <Text style={styles.mono}>{connectFrom.handle}</Text> — tap a target
            handle, or tap the same source to cancel.
          </Text>
        </View>
      ) : null}

      <View style={styles.canvasWrap}>
        <NativeCanvas
          nodes={nodes}
          edges={edges}
          nodeStatuses={nodeStatuses}
          selectedNodeId={selectedId}
          connectFrom={connectFrom}
          onSelectNode={setSelectedId}
          onNodePositionChanged={onNodePositionChanged}
          onHandleTap={onHandleTap}
        />
      </View>

      {/* Floating Add Block button */}
      <TouchableOpacity
        onPress={() => setPaletteOpen(true)}
        style={styles.addBtn}
        accessibilityLabel="Add block"
      >
        <Feather name="plus" size={20} color={colors.textInverse} />
      </TouchableOpacity>

      <BlockPaletteNative
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onPick={insertBlockAtCenter}
      />

      <PropertiesPanelNative
        node={selectedNode}
        blockTypes={blockTypes}
        onChange={patchNode}
        onDelete={deleteNode}
        onClose={() => setSelectedId(null)}
      />

      <RunHistoryDrawer
        workflowId={workflow.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      />
    </View>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function nextNodeId(existing: WorkflowNode[]): string {
  const used = new Set(existing.map((n) => n.id));
  let i = existing.length + 1;
  while (used.has(`n${i}`)) i++;
  return `n${i}`;
}

function nextEdgeId(existing: WorkflowEdge[]): string {
  const used = new Set(existing.map((e) => e.id));
  let i = existing.length + 1;
  while (used.has(`e${i}`)) i++;
  return `e${i}`;
}

function defaultConfigFor(type: BlockType): Record<string, unknown> {
  const meta = NODE_META[type];
  switch (type) {
    case 'trigger-schedule':
      return { cron_expression: '' };
    case 'trigger-ai':
      return { description: '' };
    case 'mcp-tool':
      return { mcp_name: '', tool_name: '', args: {} };
    case 'ai-prompt':
      return { prompt: '', session_policy: 'ephemeral' };
    case 'set-variable':
      return { key: '', value_expr: '' };
    case 'if':
      return { expression: '' };
    case 'loop':
      return { items_expr: '', max_iterations: 100, iteration_var: 'item' };
    case 'wait':
      return { mode: 'duration', seconds: 5 };
    case 'parallel':
      return { branches: 2 };
    case 'merge':
      return { strategy: 'all' };
    case 'http-request':
      return { method: 'GET', url: '' };
    default:
      return {};
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 6,
  },
  iconBtn: { padding: 6 },
  titleWrap: { flex: 1 },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    fontFamily: font.display,
    letterSpacing: -0.2,
  },
  statusBadge: {
    fontSize: 10,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 1,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    gap: 5,
  },
  saveBtnText: {
    fontSize: 11,
    color: colors.textInverse,
    fontWeight: '600',
  },
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.success,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    gap: 5,
  },
  runBtnText: {
    fontSize: 11,
    color: colors.textInverse,
    fontWeight: '600',
  },
  errorBanner: {
    padding: 8,
    backgroundColor: 'rgba(201, 74, 67, 0.08)',
    color: colors.error,
    fontSize: 11,
  },
  connectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    paddingHorizontal: 12,
    gap: 6,
    backgroundColor: colors.primarySoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  connectText: {
    flex: 1,
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 14,
  },
  mono: {
    fontFamily: font.mono,
    fontWeight: '600',
    color: colors.text,
  },
  canvasWrap: { flex: 1 },
  addBtn: {
    position: 'absolute',
    right: 18,
    bottom: 80,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: 'rgba(26, 25, 21, 0.15)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
});
