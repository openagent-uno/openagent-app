import { Platform } from 'react-native';
import type { EventCause, SearchTarget } from '../../../common/unified-history';
import GlobalSearchOverlayShared from './GlobalSearchOverlay.shared';

/** TypeScript fallback; Metro selects the platform-specific sibling files. */
export default function GlobalSearchOverlay({ onOpenTarget }: {
  onOpenTarget: (target: SearchTarget, causedBy?: EventCause | null) => void;
}) {
  return (
    <GlobalSearchOverlayShared
      platform={Platform.OS === 'web' ? 'web' : 'native'}
      onOpenTarget={onOpenTarget}
    />
  );
}
