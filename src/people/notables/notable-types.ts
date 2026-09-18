import { createPublicError } from "../../core/contracts/public-error.js";
import { err, ok, type Result } from "../../core/contracts/result.js";
import { isOpaqueId } from "../../core/identity/ids.js";
import { isActorUuid } from "../../core/identity/refs.js";

export type NotableVisibility = "public" | "restricted" | "secret";
export const NOTABLE_VISIBILITIES: readonly NotableVisibility[] = Object.freeze([
  "public",
  "restricted",
  "secret"
]);

export function isNotableVisibility(value: unknown): value is NotableVisibility {
  return typeof value === "string" && NOTABLE_VISIBILITIES.includes(value as NotableVisibility);
}

export interface InlineNotable {
  readonly id: string;
  readonly type: "inline";
  readonly name: string;
  readonly portrait?: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly visibility: NotableVisibility;
}

export interface ActorNotable {
  readonly id: string;
  readonly type: "actor";
  readonly actorUuid: string;
  readonly name?: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly visibility: NotableVisibility;
}

export type Notable = InlineNotable | ActorNotable;

export interface NotableStatusReport {
  readonly notable: Notable;
  readonly isBrokenRef: boolean;
  readonly resolvedName: string;
  readonly resolvedImg?: string;
}

export function validateNotable(candidate: unknown): Result<Notable> {
  if (!candidate || typeof candidate !== "object") {
    return err(
      createPublicError({
        code: "DM_NOTABLE_INVALID",
        category: "validation",
        message: "Notable must be an object"
      })
    );
  }

  const raw = candidate as Record<string, unknown>;

  if (!isOpaqueId(raw.id, "not")) {
    return err(
      createPublicError({
        code: "DM_NOTABLE_INVALID_ID",
        category: "validation",
        message: `Notable id must be an opaque ID with prefix 'not_', received: '${String(raw.id)}'`
      })
    );
  }

  const visibility: NotableVisibility =
    raw.visibility === undefined ? "public" : (raw.visibility as NotableVisibility);

  if (!isNotableVisibility(visibility)) {
    return err(
      createPublicError({
        code: "DM_NOTABLE_INVALID_VISIBILITY",
        category: "validation",
        message: `Invalid notable visibility: '${String(raw.visibility)}'. Must be one of: ${NOTABLE_VISIBILITIES.join(", ")}`
      })
    );
  }

  if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== "string"))) {
    return err(
      createPublicError({
        code: "DM_NOTABLE_INVALID_TAGS",
        category: "validation",
        message: "Notable tags must be an array of strings"
      })
    );
  }
  const tags = Object.freeze(Array.isArray(raw.tags) ? [...raw.tags] : []);

  if (raw.description !== undefined && raw.description !== null) {
    if (typeof raw.description !== "string") {
      return err(
        createPublicError({
          code: "DM_NOTABLE_INVALID_DESCRIPTION",
          category: "validation",
          message: "Notable description must be a string"
        })
      );
    }
    if (raw.description.length > 2000) {
      return err(
        createPublicError({
          code: "DM_NOTABLE_DESCRIPTION_TOO_LONG",
          category: "validation",
          message: "Notable description must not exceed 2000 characters"
        })
      );
    }
  }
  const description = raw.description ? (raw.description as string).trim() : undefined;

  if (raw.type === "inline") {
    if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
      return err(
        createPublicError({
          code: "DM_NOTABLE_INVALID_NAME",
          category: "validation",
          message: "Inline Notable requires a non-empty name"
        })
      );
    }

    if (raw.portrait !== undefined && raw.portrait !== null && typeof raw.portrait !== "string") {
      return err(
        createPublicError({
          code: "DM_NOTABLE_INVALID_PORTRAIT",
          category: "validation",
          message: "Notable portrait must be a string URL"
        })
      );
    }
    const portrait = raw.portrait ? (raw.portrait as string).trim() : undefined;

    return ok({
      id: raw.id,
      type: "inline",
      name: raw.name.trim(),
      portrait,
      description,
      tags,
      visibility
    });
  }

  if (raw.type === "actor") {
    if (typeof raw.actorUuid !== "string" || !isActorUuid(raw.actorUuid)) {
      return err(
        createPublicError({
          code: "DM_NOTABLE_INVALID_ACTOR_REF",
          category: "validation",
          message: `Actor Notable requires a valid Actor UUID, received: '${String(raw.actorUuid)}'`
        })
      );
    }

    const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : undefined;

    return ok({
      id: raw.id,
      type: "actor",
      actorUuid: raw.actorUuid,
      name,
      description,
      tags,
      visibility
    });
  }

  return err(
    createPublicError({
      code: "DM_NOTABLE_INVALID_TYPE",
      category: "validation",
      message: `Invalid notable type: '${String(raw.type)}'. Must be 'inline' or 'actor'`
    })
  );
}

export function resolveNotableStatus(
  notable: Notable,
  actorResolver?: (uuid: string) => { name: string; img?: string } | null | undefined
): NotableStatusReport {
  if (notable.type === "inline") {
    return {
      notable,
      isBrokenRef: false,
      resolvedName: notable.name,
      resolvedImg: notable.portrait
    };
  }

  const resolved = actorResolver ? actorResolver(notable.actorUuid) : null;
  if (!resolved) {
    return {
      notable,
      isBrokenRef: true,
      resolvedName: notable.name ?? "Unknown Actor (Missing Reference)",
      resolvedImg: undefined
    };
  }

  return {
    notable,
    isBrokenRef: false,
    resolvedName: resolved.name,
    resolvedImg: resolved.img
  };
}

