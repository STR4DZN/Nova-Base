import {
  PrimaryAuthorityService,
  type PrimaryAuthorityEnvironment,
  type PrimaryAuthorityState
} from "./primary-authority-service.js";
import type { AuthorityElectionUser } from "./primary-authority-election.js";

export const PRIMARY_AUTHORITY_SETTING_NAMESPACE = "domain-manager";
export const PREFERRED_AUTHORITY_USER_SETTING = "preferredAuthorityUserId";
export const AUTHORITY_STATE_SETTING = "primaryAuthorityState";

const DEFAULT_PERSISTED_AUTHORITY_STATE = JSON.stringify({
  authorityUserId: null,
  authorityEpoch: 0,
  initialized: false
} satisfies PrimaryAuthorityState);

export interface FoundryAuthorityUserLike extends AuthorityElectionUser {}

export interface FoundryAuthorityUsersLike {
  readonly contents: readonly FoundryAuthorityUserLike[];
}

export interface FoundryAuthoritySettingsLike {
  register(namespace: string, key: string, data: {
    readonly name: string;
    readonly hint: string;
    readonly scope: "world";
    readonly config: boolean;
    readonly type: StringConstructor;
    readonly default: string;
    readonly onChange?: (value: unknown) => void;
  }): void;
  get(namespace: string, key: string): unknown;
  set(namespace: string, key: string, value: unknown): Promise<unknown>;
}

export interface FoundryAuthorityRuntimeLike {
  readonly users: FoundryAuthorityUsersLike;
  readonly user: FoundryAuthorityUserLike | null;
  readonly settings: FoundryAuthoritySettingsLike;
}

export interface FoundryPrimaryAuthoritySettingCallbacks {
  readonly onPreferredChanged?: () => void;
  readonly onAuthorityStateChanged?: (value: unknown) => void;
}

function settingsFromGlobals(): FoundryAuthoritySettingsLike {
  const globals = globalThis as unknown as {
    game?: { settings?: FoundryAuthoritySettingsLike };
  };

  const settings = globals.game?.settings;
  if (settings === undefined) {
    throw new Error("Foundry settings runtime is not available");
  }

  return settings;
}

function runtimeFromGlobals(): FoundryAuthorityRuntimeLike {
  const globals = globalThis as unknown as {
    game?: Partial<FoundryAuthorityRuntimeLike>;
  };

  const runtime = globals.game;
  if (
    runtime?.users === undefined ||
    runtime.settings === undefined ||
    !("user" in runtime)
  ) {
    throw new Error("Foundry authority runtime is not available");
  }

  return runtime as FoundryAuthorityRuntimeLike;
}

function normalizePreferredUserId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parsePersistedAuthorityState(value: unknown): PrimaryAuthorityState {
  if (typeof value !== "string") {
    throw new TypeError("Persisted Primary Authority state must be a JSON string");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Persisted Primary Authority state is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Persisted Primary Authority state must be an object");
  }

  const candidate = parsed as Record<string, unknown>;
  const authorityUserId = candidate.authorityUserId;
  const authorityEpoch = candidate.authorityEpoch;
  const initialized = candidate.initialized;

  if (authorityUserId !== null && (typeof authorityUserId !== "string" || authorityUserId.trim().length === 0)) {
    throw new TypeError("Persisted authorityUserId must be null or a non-blank string");
  }
  if (typeof authorityEpoch !== "number" || !Number.isSafeInteger(authorityEpoch) || authorityEpoch < 0) {
    throw new RangeError("Persisted authorityEpoch must be a non-negative safe integer");
  }
  if (typeof initialized !== "boolean") {
    throw new TypeError("Persisted authority initialized flag must be boolean");
  }
  if (!initialized && (authorityUserId !== null || authorityEpoch !== 0)) {
    throw new TypeError("Uninitialized persisted authority state must use null authority and epoch 0");
  }

  return Object.freeze({ authorityUserId, authorityEpoch, initialized }) as PrimaryAuthorityState;
}

function serializeAuthorityState(state: PrimaryAuthorityState): string {
  return JSON.stringify({
    authorityUserId: state.authorityUserId,
    authorityEpoch: state.authorityEpoch,
    initialized: state.initialized
  });
}

function statesEqual(left: PrimaryAuthorityState, right: PrimaryAuthorityState): boolean {
  return left.authorityUserId === right.authorityUserId &&
    left.authorityEpoch === right.authorityEpoch &&
    left.initialized === right.initialized;
}

export function registerFoundryPrimaryAuthoritySettings(
  callbacks: FoundryPrimaryAuthoritySettingCallbacks = {},
  settings: FoundryAuthoritySettingsLike = settingsFromGlobals()
): void {
  settings.register(PRIMARY_AUTHORITY_SETTING_NAMESPACE, PREFERRED_AUTHORITY_USER_SETTING, {
    name: "Domain Manager: Preferred Primary Authority",
    hint: "Optional preferred GM user id used by the technical authority election.",
    scope: "world",
    config: false,
    type: String,
    default: "",
    onChange: () => callbacks.onPreferredChanged?.()
  });

  settings.register(PRIMARY_AUTHORITY_SETTING_NAMESPACE, AUTHORITY_STATE_SETTING, {
    name: "Domain Manager: Primary Authority State",
    hint: "Internal persisted authority identity and monotonic epoch.",
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_PERSISTED_AUTHORITY_STATE,
    onChange: (value) => callbacks.onAuthorityStateChanged?.(value)
  });
}

class FoundryPrimaryAuthorityEnvironment implements PrimaryAuthorityEnvironment<FoundryAuthorityUserLike> {
  constructor(private readonly runtime: FoundryAuthorityRuntimeLike) {}

  getUsers(): readonly FoundryAuthorityUserLike[] {
    return this.runtime.users.contents;
  }

  getPreferredUserId(): string | null {
    return normalizePreferredUserId(
      this.runtime.settings.get(PRIMARY_AUTHORITY_SETTING_NAMESPACE, PREFERRED_AUTHORITY_USER_SETTING)
    );
  }

  getCurrentUserId(): string | null {
    return this.runtime.user?.id ?? null;
  }
}

export interface PrimaryAuthorityHost {
  readonly service: PrimaryAuthorityService<FoundryAuthorityUserLike>;
  reconcile(): Promise<FoundryAuthorityUserLike | null>;
  synchronizePersistedState(value: unknown): boolean;
}

/**
 * Foundry host boundary for PrimaryAuthorityService.
 *
 * Preferred GM and the authority state are world settings. Authority state is
 * persisted as one compact JSON value so identity and epoch cannot be observed
 * half-updated. Only the currently elected local authority writes changes.
 */
export class FoundryPrimaryAuthorityAdapter implements PrimaryAuthorityHost {
  readonly service: PrimaryAuthorityService<FoundryAuthorityUserLike>;

  constructor(private readonly runtime: FoundryAuthorityRuntimeLike = runtimeFromGlobals()) {
    const persistedState = parsePersistedAuthorityState(
      runtime.settings.get(PRIMARY_AUTHORITY_SETTING_NAMESPACE, AUTHORITY_STATE_SETTING)
    );

    this.service = new PrimaryAuthorityService(
      new FoundryPrimaryAuthorityEnvironment(runtime),
      persistedState
    );
  }

  async reconcile(): Promise<FoundryAuthorityUserLike | null> {
    const previousState = this.service.snapshotState();
    const authority = this.service.resolve();
    const nextState = this.service.snapshotState();

    if (!statesEqual(previousState, nextState) && this.service.isCurrentUser()) {
      await this.runtime.settings.set(
        PRIMARY_AUTHORITY_SETTING_NAMESPACE,
        AUTHORITY_STATE_SETTING,
        serializeAuthorityState(nextState)
      );
    }

    return authority;
  }

  synchronizePersistedState(value: unknown): boolean {
    return this.service.synchronizeState(parsePersistedAuthorityState(value));
  }
}
