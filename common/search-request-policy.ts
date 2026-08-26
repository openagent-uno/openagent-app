import type { RunStatus, SearchGrouping, SearchScope, SearchSort } from './unified-history';

export type SearchScopeSelection = 'all' | SearchScope;
export type SearchPeriod = 'any' | '24h' | '7d' | '30d';

/** Only this view is guaranteed to be identical to the already-loaded
 * history page. Every scope or filter needs a server query so matches on a
 * later history page cannot be mistaken for an empty result set. */
export function canUseUnifiedHistoryCache(
  query: string,
  scope: SearchScopeSelection,
  statuses: RunStatus[],
  errorsOnly: boolean,
  period: SearchPeriod,
): boolean {
  return !query.trim()
    && scope === 'all'
    && statuses.length === 0
    && !errorsOnly
    && period === 'any';
}

/** Match grouping keeps every internal occurrence independently pageable.
 * Root grouping may return match_count > matches.length with no resolver for
 * the omitted occurrences in this beta client. */
export function searchPresentation(query: string): {
  sort: SearchSort;
  grouping: SearchGrouping;
} {
  return {
    sort: query.trim() ? 'relevance' : 'recent',
    grouping: 'match',
  };
}
