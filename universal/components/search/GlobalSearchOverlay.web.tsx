import type { EventCause, SearchTarget } from '../../../common/unified-history';
import GlobalSearchOverlayShared from './GlobalSearchOverlay.shared';

export default function GlobalSearchOverlay({ onOpenTarget }: {
  onOpenTarget: (target: SearchTarget, causedBy?: EventCause | null) => void;
}) {
  return <GlobalSearchOverlayShared platform="web" onOpenTarget={onOpenTarget} />;
}
