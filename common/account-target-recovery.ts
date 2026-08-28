export interface PublicAccountTarget {
  network: string;
  handle: string;
  agentHandle: string;
}

/** Apply non-secret metadata verified by Electron main after coordinator auth. */
export function withVerifiedAccountTarget<
  TAccount extends { network: string; handle: string; agentHandle?: string },
>(account: TAccount, target: PublicAccountTarget): TAccount {
  return {
    ...account,
    network: target.network,
    handle: target.handle,
    agentHandle: target.agentHandle,
  };
}

export function hasExplicitLoopbackTarget(
  account: { network: string; handle: string },
): boolean {
  return account.network.trim().length > 0 && account.handle.trim().length > 0;
}
