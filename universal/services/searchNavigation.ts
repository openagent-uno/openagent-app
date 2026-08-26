import type { EventCause, SearchTarget } from '../../common/unified-history';
import { searchNavigationIntent } from '../../common/search-navigation';

interface RouterLike {
  // Expo Router's generated href type is intentionally stricter than the
  // serializable intent returned by common/. Keep this boundary structural:
  // this service only needs a push-capable router and owns the single cast.
  push: (...args: any[]) => void;
}

/** Navigation only. Destination screens own every detail/range fetch. */
export function openSearchTarget(
  router: RouterLike,
  target: SearchTarget,
  causedBy?: EventCause | null,
): void {
  router.push(searchNavigationIntent(target, causedBy));
}
