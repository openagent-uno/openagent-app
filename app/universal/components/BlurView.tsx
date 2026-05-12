import React from 'react';
import { View, Platform } from 'react-native';
import type { ViewProps } from 'react-native';

interface Props extends ViewProps {
  intensity?: number;
  children: React.ReactNode;
}

export default function BlurView({ intensity = 14, style, children, ...props }: Props) {
  if (Platform.OS === 'web') {
    return (
      <View
        style={[style, {
          backdropFilter: `blur(${intensity}px) saturate(140%)`,
          WebkitBackdropFilter: `blur(${intensity}px) saturate(140%)`,
        } as any]}
        {...props}
      >
        {children}
      </View>
    );
  }

  const { BlurView: ExpoBlurView } = require('expo-blur');
  const nativeIntensity = Math.min(100, Math.max(1, Math.round(intensity * 5)));
  return (
    <ExpoBlurView intensity={nativeIntensity} tint="dark" style={style as any} {...props}>
      {children}
    </ExpoBlurView>
  );
}
