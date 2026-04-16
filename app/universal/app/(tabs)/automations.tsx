/**
 * Automations screen — placeholder with zoomable/draggable workflow diagram.
 */

import { useRef, useState, useCallback } from 'react';
import {
  View, Text, Image, StyleSheet, Dimensions, Platform,
  ScrollView,
} from 'react-native';
import { colors } from '../../theme';

const placeholderImg = require('../../assets/automation-placeholder.png');

const { width: SCREEN_W } = Dimensions.get('window');
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

export default function AutomationsScreen() {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleWheel = useCallback((e: any) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * delta)));
  }, []);

  const handleMouseDown = useCallback((e: any) => {
    setIsPanning(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: any) => {
    if (!isPanning) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setTranslate((t) => ({ x: t.x + dx, y: t.y + dy }));
  }, [isPanning]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Automations</Text>
        <Text style={styles.subtitle}>Visual workflow builder — coming soon</Text>
        <div
          style={{
            flex: 1, overflow: 'hidden',
            backgroundColor: colors.inputBg,
            borderTop: `1px solid ${colors.border}`,
            cursor: isPanning ? 'grabbing' : 'grab',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            userSelect: 'none',
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <Image
            source={placeholderImg}
            style={{
              width: SCREEN_W * 1.5,
              height: SCREEN_W * 0.9,
              transform: [
                { translateX: translate.x },
                { translateY: translate.y },
                { scale },
              ],
            } as any}
            resizeMode="contain"
          />
        </div>
        <Text style={styles.hint}>Scroll to zoom · Drag to pan</Text>
      </View>
    );
  }

  // Native fallback: simple scrollable image
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Automations</Text>
      <Text style={styles.subtitle}>Visual workflow builder — coming soon</Text>
      <ScrollView
        style={styles.canvas}
        contentContainerStyle={styles.nativeContent}
        maximumZoomScale={MAX_SCALE}
        minimumZoomScale={MIN_SCALE}
        bouncesZoom
      >
        <Image
          source={placeholderImg}
          style={{ width: SCREEN_W * 1.5, height: SCREEN_W * 0.9 }}
          resizeMode="contain"
        />
      </ScrollView>
      <Text style={styles.hint}>Pinch to zoom · Drag to pan</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: {
    fontSize: 20, fontWeight: '500', color: colors.text,
    textAlign: 'center', paddingTop: 18, paddingBottom: 2,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 12, color: colors.textMuted, textAlign: 'center',
    paddingBottom: 12, fontStyle: 'italic',
  },
  canvas: {
    flex: 1,
    backgroundColor: colors.sidebar,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
  },
  nativeContent: {
    alignItems: 'center', justifyContent: 'center',
    minHeight: '100%',
  },
  hint: {
    fontSize: 10, color: colors.textMuted, textAlign: 'center',
    paddingVertical: 8, backgroundColor: colors.surface,
    borderTopWidth: 1, borderTopColor: colors.borderLight,
    letterSpacing: 0.2,
  },
});
