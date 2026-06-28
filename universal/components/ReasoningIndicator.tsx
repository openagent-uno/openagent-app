/**
 * ReasoningIndicator — animated "the agent is thinking" cue.
 *
 * Replaces the static "Thinking…" status text with a premium, on-brand
 * signal (Claude-desktop-style) shown while a session's ``isReasoning``
 * flag is set — driven by the transient ``reasoning`` wire frame (see
 * [[common/types.ts]] ServerMessage + [[stores/chat.ts]]).
 *
 * Web rides CSS keyframes (see theme.ts ``.oa-reasoning``): a cyan
 * gradient shimmer sweeps across the "Reasoning" wordmark via
 * ``background-clip: text`` while three trailing dots pulse on a stagger.
 *
 * Native has no CSS animations, so it runs the equivalent with the RN
 * ``Animated`` API — a breathing opacity on the label plus three
 * sequentially-pulsing dots — matching the Skeleton.tsx / SoundWaves.tsx
 * convention (no reanimated worklets needed for a small inline cue).
 *
 * Kept small/inline so it slots straight into the MessageList status row.
 */

import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';

const isWeb = Platform.OS === 'web';
const DOTS = 3;

interface ReasoningIndicatorProps {
  /** Override the label text (defaults to "Reasoning"). */
  label?: string;
}

export default function ReasoningIndicator({ label = 'Reasoning' }: ReasoningIndicatorProps) {
  // Native breathing/pulse drivers. On web these stay idle — the CSS
  // shimmer/keyframes (theme.ts) drive the animation instead.
  const breath = useRef(new Animated.Value(0.55)).current;
  const dots = useRef(Array.from({ length: DOTS }, () => new Animated.Value(0.25))).current;

  useEffect(() => {
    if (isWeb) return;
    // Label: a slow breathing opacity so the word "feels alive" without a
    // hard blink.
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 1, duration: 720, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 0.55, duration: 720, useNativeDriver: true }),
      ]),
    );
    // Dots: each ramps up then down, offset by a fixed delay so they ripple
    // left→right instead of pulsing in lockstep. The trailing delay keeps the
    // total loop length identical across dots so the phase offset holds.
    const dotLoops = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 180),
          Animated.timing(v, { toValue: 1, duration: 420, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: 420, useNativeDriver: true }),
          Animated.delay((DOTS - 1 - i) * 180),
        ]),
      ),
    );
    breathLoop.start();
    dotLoops.forEach((l) => l.start());
    return () => {
      breathLoop.stop();
      dotLoops.forEach((l) => l.stop());
    };
  }, [breath, dots]);

  if (isWeb) {
    return (
      <View style={styles.row} accessibilityRole="text" accessibilityLabel="Reasoning">
        <Text
          style={styles.label}
          // @ts-ignore — web-only shimmer class (theme.ts)
          className="oa-reasoning"
        >
          {label}
        </Text>
        <View style={styles.dots}>
          {Array.from({ length: DOTS }).map((_, i) => (
            <View
              key={i}
              style={styles.dot}
              // @ts-ignore — web-only staggered pulse (theme.ts)
              className="oa-reasoning-dot"
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLabel="Reasoning">
      <Animated.Text style={[styles.label, styles.labelNative, { opacity: breath }]}>
        {label}
      </Animated.Text>
      <View style={styles.dots}>
        {dots.map((v, i) => (
          <Animated.View key={i} style={[styles.dot, { opacity: v }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  label: {
    fontSize: 13,
    fontFamily: font.mono,
    letterSpacing: 0.6,
    // On web the .oa-reasoning class overrides this with a clipped gradient;
    // it remains the fallback colour if the stylesheet hasn't injected yet.
    color: colors.primary,
  },
  // Native can't clip a gradient to text, so use the softer cyan accent and
  // let the breathing opacity carry the motion.
  labelNative: { color: colors.primaryMuted },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: colors.primary,
  },
});
