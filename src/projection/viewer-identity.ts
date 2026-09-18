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

    // Security: Caller CANNOT escalate isGm if real authenticated user is NOT a GM!
    const effectiveIsGm = realIsGm ? (callerSuppliedViewer?.isGm ?? true) : false;
    const effectiveUserId = callerSuppliedViewer?.userId ?? realUserId;
    const effectiveAllowedRestrictedRefs =
      callerSuppliedViewer?.allowedRestrictedRefs ?? (current as any).allowedRestrictedRefs;

    return Object.freeze({
      userId: effectiveUserId,
      isGm: effectiveIsGm,
      allowedRestrictedRefs: effectiveAllowedRestrictedRefs
    });
  }

  // Headless / Test environment without authenticated user context:
  // Default is FAIL-CLOSED: isGm is false unless explicitly specified
  return Object.freeze({
    userId: callerSuppliedViewer?.userId ?? "anonymous",
    isGm: callerSuppliedViewer?.isGm === true,
    allowedRestrictedRefs: callerSuppliedViewer?.allowedRestrictedRefs
  });
}
