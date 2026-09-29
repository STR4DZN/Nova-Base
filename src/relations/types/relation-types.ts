import type { TypedRef } from "../../core/identity/refs.js";

/** G6.1: Master §18, DEC-098–104, DEC-3201–3350 §1.1–1.2. */
export const RELATION_SCHEMA_VERSION = 1 as const;
export type RelationSymmetry = "symmetric" | "asymmetric";
export type RelationLifecycle = "active" | "ended";
export type RelationVisibility = "public" | "restricted" | "secret";
export type RelationPartyType = "domain" | "populationGroup" | "operationalGroup" | "notable"
  | "actor" | "narrative" | `${string}:${string}`;

export interface RelationPartyRef extends TypedRef {
  readonly type: RelationPartyType;
  /** Required for embedded People entities; their IDs are local to a Domain. */
  readonly domainUuid?: string;
}

export interface RelationParty {
  readonly id: string;
  readonly role: string;
  readonly ref: RelationPartyRef;
}

export interface RelationAxisDefinition {
  readonly id: string;
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly defaultValue: number;
}

/** Versioned content, never a mutable instance or a diplomatic template. */
export interface RelationDefinition {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly symmetry: RelationSymmetry;
  readonly minParties: number;
  readonly maxParties: number | null;
  readonly allowedPartyTypes: readonly RelationPartyType[];
  readonly allowedPartyRoles: readonly string[];
  readonly allowMultiple: boolean;
  readonly axes: readonly RelationAxisDefinition[];
  readonly stancePolicy: "none" | "manual" | "derived";
}

/** Base truth only. Temporary modifiers and effective scores belong to G6.2. */
export interface RelationBaseAxis {
  readonly axisId: string;
  readonly value: number;
  /** Both null for a symmetric shared score; distinct party IDs for a direction. */
  readonly fromPartyId: string | null;
  readonly toPartyId: string | null;
}

/** A relation can exist independently of any owning Domain. */
export interface RelationInstance {
  readonly schemaVersion: typeof RELATION_SCHEMA_VERSION;
  readonly id: string;
  readonly definitionId: string;
  readonly definitionVersion: number;
  readonly revision: number;
  readonly label: string;
  readonly lifecycle: RelationLifecycle;
  readonly parties: readonly RelationParty[];
  readonly scope: TypedRef | null;
  readonly baseAxes: readonly RelationBaseAxis[];
  readonly visibility: RelationVisibility;
  readonly stance?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly endedAt: number | null;
}
