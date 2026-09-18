export interface ViewerIdentity {
  readonly userId: string;
  readonly isGm: boolean;
  readonly allowedRestrictedRefs?: readonly string[];
}

export type CurrentUserProvider = () => { id: string; isGM: boolean } | null | undefined;

let globalCurrentUserProvider: CurrentUserProvider | null = null;

export function setCurrentUserProvider(provider: CurrentUserProvider | null): void {
  globalCurrentUserProvider = provider;
}

export function resolveCurrentViewer(
  callerSuppliedViewer?: Partial<ViewerIdentity>,
  customProvider?: CurrentUserProvider
): ViewerIdentity {
  const provider = customProvider ?? globalCurrentUserProvider ?? (() => {
    const user = (globalThis as any).game?.user;
    if (user) {
      return { id: String(user.id ?? "anonymous"), isGM: Boolean(user.isGM) };
    }
    return null;
  });

  const current = provider();

  if (current) {
    const realIsGm = Boolean((current as any).isGM ?? (current as any).isGm);
    const realUserId = String((current as any).id ?? (current as any).userId ?? "anonymous");
    const trustedRestrictedRefs = (current as any).allowedRestrictedRefs as readonly string[] | undefined;

    if (!realIsGm) {
      // Security: Non-GM caller CANNOT escalate clearance, spoof another user, or supply arbitrary allowedRestrictedRefs
      return Object.freeze({
        userId: realUserId,
        isGm: false,
        allowedRestrictedRefs: trustedRestrictedRefs ? Object.freeze([...trustedRestrictedRefs]) : Object.freeze([])
      });
    }

    // GM caller: GM has full clearance, but can optionally narrow their own view for testing/simulation
    return Object.freeze({
      userId: callerSuppliedViewer?.userId ?? realUserId,
      isGm: callerSuppliedViewer?.isGm ?? true,
      allowedRestrictedRefs: callerSuppliedViewer?.allowedRestrictedRefs ?? trustedRestrictedRefs
    });
  }

  // Headless / fallback without configured provider: fail-closed by default
  return Object.freeze({
    userId: callerSuppliedViewer?.userId ?? "anonymous",
    isGm: callerSuppliedViewer?.isGm === true,
    allowedRestrictedRefs: callerSuppliedViewer?.allowedRestrictedRefs
      ? Object.freeze([...callerSuppliedViewer.allowedRestrictedRefs])
      : Object.freeze([])
  });
}
