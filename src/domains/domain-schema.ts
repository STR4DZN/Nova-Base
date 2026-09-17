export type DomainLifecycle = "active" | "inactive" | "archived";

export const DOMAIN_SCHEMA_VERSION = 1 as const;

export interface DomainIdentity {
  readonly aliases: readonly string[];
  readonly summary: string;
  readonly description: string;
}

export interface DomainClassification {
  readonly kind: string;
  readonly scale: string;
  readonly tags: readonly string[];
}

export interface DomainHierarchy {
  readonly parentDomainUuid: string | null;
}

export interface DomainCapabilities {
  readonly enabled: readonly string[];
  readonly config: Readonly<Record<string, unknown>>;
}

export interface DomainRecord {
  readonly schemaVersion: number;
  readonly revision: number;
  readonly definition: {
    readonly identity: DomainIdentity;
    readonly classification: DomainClassification;
    readonly hierarchy: DomainHierarchy;
    readonly capabilities: DomainCapabilities;
  };
  readonly state: {
    readonly lifecycle: DomainLifecycle;
  };
  readonly metadata: {
    readonly createdByUserId: string | null;
    readonly archivedAt: number | null;
    readonly source: {
      readonly type: "manual" | "template" | "import" | "migration";
      readonly ref: string | null;
    };
  };
}
