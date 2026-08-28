export interface DiscoverableAgent {
  handle?: string;
  nodeId?: string;
}

/** Select the requested agent exactly. Falling back to the first registered
 * agent is valid only during onboarding, when no target was requested. */
export function selectAgentForConnection<T extends DiscoverableAgent>(
  agents: T[],
  requestedHandle?: string,
): T | undefined {
  if (!requestedHandle) return agents[0];
  const normalized = requestedHandle.trim().toLowerCase();
  return agents.find(
    (agent) => (agent.handle ?? '').trim().toLowerCase() === normalized,
  );
}
