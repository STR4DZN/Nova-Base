/**
 * Minimal user projection required to elect the world's technical authority.
 *
 * The election core deliberately knows nothing about Foundry collections,
 * settings, sockets, or commands. Adapters supply this projection later.
 */
export interface AuthorityElectionUser {
  readonly id: string;
  readonly isGM: boolean;
  readonly active: boolean;
}

function compareUserIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isEligible(user: AuthorityElectionUser): boolean {
  return user.isGM && user.active && user.id.trim().length > 0;
}

/**
 * Resolve exactly one authority user id from a client-visible user snapshot.
 *
 * Invariants from DEC-521–530:
 * - an online preferred GM wins;
 * - otherwise the fallback is the lexically-smallest active GM id;
 * - collection iteration order never affects the result;
 * - no eligible GM means no authority.
 *
 * Returning an id instead of the input object keeps the election result stable
 * even if callers provide duplicate projections for the same Foundry user.
 */
export function resolvePrimaryAuthorityUserId(
  users: readonly AuthorityElectionUser[],
  preferredUserId: string | null
): string | null {
  const eligibleIds = new Set<string>();

  for (const user of users) {
    if (isEligible(user)) eligibleIds.add(user.id);
  }

  if (preferredUserId !== null && eligibleIds.has(preferredUserId)) {
    return preferredUserId;
  }

  if (eligibleIds.size === 0) return null;

  return [...eligibleIds].sort(compareUserIds)[0] ?? null;
}
