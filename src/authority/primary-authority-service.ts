import {
  resolvePrimaryAuthorityUserId,
  type AuthorityElectionUser
} from "./primary-authority-election.js";

export interface PrimaryAuthorityEnvironment<TUser extends AuthorityElectionUser> {
  getUsers(): readonly TUser[];
  getPreferredUserId(): string | null;
  getCurrentUserId(): string | null;
}

export interface PrimaryAuthorityState {
  readonly authorityUserId: string | null;
  readonly authorityEpoch: number;
  readonly initialized: boolean;
}

export interface PrimaryAuthorityStatus {
  readonly authorityUserId: string | null;
  readonly authorityEpoch: number;
  readonly available: boolean;
}

export type PrimaryAuthorityChangedCallback = () => void;

function assertValidEpoch(epoch: number): void {
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new RangeError("authorityEpoch must be a non-negative safe integer");
  }
}

function assertValidState(state: PrimaryAuthorityState): void {
  assertValidEpoch(state.authorityEpoch);

  if (
    state.authorityUserId !== null &&
    (typeof state.authorityUserId !== "string" || state.authorityUserId.trim().length === 0)
  ) {
    throw new TypeError("authorityUserId must be null or a non-blank string");
  }

  if (!state.initialized && (state.authorityUserId !== null || state.authorityEpoch !== 0)) {
    throw new TypeError("uninitialized authority state must use null authority and epoch 0");
  }
}

function nextEpoch(current: number): number {
  if (current >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("authorityEpoch cannot exceed Number.MAX_SAFE_INTEGER");
  }

  return current + 1;
}

/**
 * Stateful authority status service independent from Foundry APIs.
 *
 * `authorityUserId` intentionally remembers the last elected authority while
 * that user is temporarily offline. Availability is derived from the current
 * user snapshot. This lets a later failover compare against the last real
 * executor and advance the epoch exactly once, even across a no-GM gap.
 */
export class PrimaryAuthorityService<TUser extends AuthorityElectionUser> {
  readonly #environment: PrimaryAuthorityEnvironment<TUser>;
  readonly #callbacks = new Set<PrimaryAuthorityChangedCallback>();

  #authorityUserId: string | null;
  #authorityEpoch: number;
  #initialized: boolean;

  constructor(
    environment: PrimaryAuthorityEnvironment<TUser>,
    initialState: PrimaryAuthorityState = {
      authorityUserId: null,
      authorityEpoch: 0,
      initialized: false
    }
  ) {
    assertValidState(initialState);

    this.#environment = environment;
    this.#authorityUserId = initialState.authorityUserId;
    this.#authorityEpoch = initialState.authorityEpoch;
    this.#initialized = initialState.initialized;
  }

  getCurrent(): TUser | null {
    if (this.#authorityUserId === null) return null;

    for (const user of this.#environment.getUsers()) {
      if (
        user.id === this.#authorityUserId &&
        user.isGM &&
        user.active &&
        user.id.trim().length > 0
      ) {
        return user;
      }
    }

    return null;
  }

  getEpoch(): number {
    return this.#authorityEpoch;
  }

  getStatus(): PrimaryAuthorityStatus {
    return Object.freeze({
      authorityUserId: this.#authorityUserId,
      authorityEpoch: this.#authorityEpoch,
      available: this.getCurrent() !== null
    });
  }

  isCurrentUser(): boolean {
    const localUserId = this.#environment.getCurrentUserId();
    return localUserId !== null && localUserId === this.#authorityUserId && this.getCurrent() !== null;
  }

  resolve(): TUser | null {
    const users = this.#environment.getUsers();
    const nextAuthorityUserId = resolvePrimaryAuthorityUserId(
      users,
      this.#environment.getPreferredUserId()
    );

    if (!this.#initialized) {
      this.#authorityUserId = nextAuthorityUserId;
      this.#initialized = true;
      return this.getCurrent();
    }

    // A temporary no-GM gap makes authority unavailable, but does not invent a
    // new technical executor or advance the persisted authority epoch.
    if (nextAuthorityUserId === null) {
      return null;
    }

    if (nextAuthorityUserId === this.#authorityUserId) {
      return this.getCurrent();
    }

    // The first actual authority after a world that has never had one seeds the
    // identity at epoch 0. Every later executor change advances exactly once.
    if (this.#authorityUserId === null) {
      this.#authorityUserId = nextAuthorityUserId;
      for (const callback of [...this.#callbacks]) callback();
      return this.getCurrent();
    }

    const incrementedEpoch = nextEpoch(this.#authorityEpoch);
    this.#authorityUserId = nextAuthorityUserId;
    this.#authorityEpoch = incrementedEpoch;

    for (const callback of [...this.#callbacks]) callback();

    return this.getCurrent();
  }

  /**
   * Synchronize a persisted state received from the Foundry world setting.
   * Higher epochs win. At the same epoch, a previously unknown local identity
   * may adopt the persisted identity; conflicting known identities fail closed.
   */
  synchronizeState(state: PrimaryAuthorityState): boolean {
    assertValidState(state);
    if (!state.initialized) return false;

    if (state.authorityEpoch < this.#authorityEpoch) return false;

    if (state.authorityEpoch === this.#authorityEpoch) {
      if (state.authorityUserId === this.#authorityUserId) {
        if (state.initialized && !this.#initialized) {
          this.#initialized = true;
          return true;
        }
        return false;
      }

      if (this.#authorityUserId !== null) {
        throw new Error("Conflicting authority identities share the same authorityEpoch");
      }

      this.#authorityUserId = state.authorityUserId;
      this.#initialized = true;
      return true;
    }

    this.#authorityUserId = state.authorityUserId;
    this.#authorityEpoch = state.authorityEpoch;
    this.#initialized = true;
    return true;
  }

  onChanged(callback: PrimaryAuthorityChangedCallback): () => void {
    this.#callbacks.add(callback);
    let subscribed = true;

    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#callbacks.delete(callback);
    };
  }

  snapshotState(): PrimaryAuthorityState {
    return Object.freeze({
      authorityUserId: this.#authorityUserId,
      authorityEpoch: this.#authorityEpoch,
      initialized: this.#initialized
    });
  }
}
