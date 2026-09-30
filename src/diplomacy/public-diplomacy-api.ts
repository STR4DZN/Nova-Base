import { createCommandId, type CommandId, type DomainCommand } from "../commands/command-envelope.js";
import type { TransportReceipt } from "../commands/command-transport.js";
import { failure, immutable, isJsonData, isRecord } from "../core/validation/value-validation.js";
import type { CommandBus } from "../commands/command-bus.js";
import { err, ok, type Result } from "../core/contracts/result.js";
import { createPublicError } from "../core/contracts/public-error.js";
import type { DiplomacyKind } from "./diplomacy-store.js";
import type { DiplomacyQuery } from "./diplomacy-query.js";
import { DIPLOMACY_NAMESPACES } from "./owner-commands.js";
import type { OwnerIntent } from "./owner-commands.js";
import { DiplomacyApplication } from "../ui/domain-patterns/diplomacy/diplomacy-app.js";
export interface PublicDiplomacyOwnerApi {
  query(query?: DiplomacyQuery): Promise<Result<any>>;
  create(input: { readonly id: string; readonly data: unknown; readonly reason: string }): Promise<Result<any>>;
  modify(input: { readonly id: string; readonly expectedRevision: number; readonly action: unknown; readonly reason: string }): Promise<Result<any>>;
}
export interface PublicDiplomacyApi {
  readonly commands: {
    prepare(type: string, payload: unknown): Result<DomainCommand<unknown>>;
    execute(ticket: DomainCommand<unknown>): Promise<Result<TransportReceipt>>;
    retry(ticket: DomainCommand<unknown>): Promise<Result<TransportReceipt>>;
    status(commandId: CommandId): Promise<Result<TransportReceipt>>;
  };
  open(): Promise<DiplomacyApplication>;
  readonly relations: PublicDiplomacyOwnerApi; readonly reputation: PublicDiplomacyOwnerApi;
  readonly agreements: PublicDiplomacyOwnerApi; readonly territory: PublicDiplomacyOwnerApi; readonly disputes: PublicDiplomacyOwnerApi;
  previewTerritory(input: { readonly id: string; readonly expectedRevision: number; readonly action: unknown; readonly reason: string }): Promise<Result<any>>;
  readonly proposals: {
    query(query?: DiplomacyQuery): Promise<Result<any>>;
    submit(input: { readonly id: string; readonly intent: OwnerIntent }): Promise<Result<any>>;
    decide(input: { readonly id: string; readonly expectedRevision: number; readonly decision: "approve" | "reject"; readonly reason: string; readonly editedIntent?: OwnerIntent }): Promise<Result<any>>;
  };
  capabilities(domainUuid: string, territoryUuid?: string): Promise<Result<any>>;
}
export function createPublicDiplomacyApi(bus: CommandBus): PublicDiplomacyApi {
  const allowedTypes = new Set([...Object.values(DIPLOMACY_NAMESPACES).flatMap(namespace => ["query", "create", "modify"].map(mode => `${namespace}:${mode}`)),
    "territory:preview", "diplomacy:submit-proposal", "diplomacy:decide-proposal", "diplomacy:query-proposals", "diplomacy:capabilities"]);
  const execute = async (ticket: DomainCommand<unknown>): Promise<Result<TransportReceipt>> =>
    isRecord(ticket) && allowedTypes.has(ticket.type as string) ? bus.execute(ticket)
      : failure("DM_DIPLOMACY_INTENT_INVALID", "Unsupported diplomacy command");
  const commands: PublicDiplomacyApi["commands"] = Object.freeze({
    prepare: (type: string, payload: unknown): Result<DomainCommand<unknown>> => allowedTypes.has(type) && isJsonData(payload)
      ? ok(immutable({ contractVersion: 1 as const, commandId: createCommandId(), type, payload: structuredClone(payload), issuedAtReal: Date.now() }))
      : failure("DM_DIPLOMACY_INTENT_INVALID", "Diplomacy ticket requires a supported type and JSON payload"),
    execute, retry: execute, status: (commandId: CommandId) => bus.queryCommandStatus(commandId)
  });
  const send = async (type: string, payload: unknown): Promise<Result<any>> => {
    const response = await bus.execute({ contractVersion: 1, commandId: createCommandId(), type, payload, issuedAtReal: Date.now() });
    if (!response.ok) return response;
    return response.value.error ? err(response.value.error) : response.value.status === "executed" ? ok(response.value.result)
      : err(createPublicError({ code: "DM_DIPLOMACY_COMMAND_INCOMPLETE", category: "busy", message: "Authority has not confirmed the command" }));
  };
  const owner = (kind: Exclude<DiplomacyKind, "proposal">): PublicDiplomacyOwnerApi => {
    const namespace = DIPLOMACY_NAMESPACES[kind];
    return Object.freeze({ query: (p: DiplomacyQuery = {}) => send(`${namespace}:query`, p),
      create: (p: Parameters<PublicDiplomacyOwnerApi["create"]>[0]) => send(`${namespace}:create`, p),
      modify: (p: Parameters<PublicDiplomacyOwnerApi["modify"]>[0]) => send(`${namespace}:modify`, p) });
  };
  const api: PublicDiplomacyApi = Object.freeze({ commands, open: () => new DiplomacyApplication({ api }).render(true),
    relations: owner("relation"), reputation: owner("reputation"), agreements: owner("agreement"), territory: owner("territory"), disputes: owner("dispute"),
    previewTerritory: (p: { id: string; expectedRevision: number; action: unknown; reason: string }) => send("territory:preview", p),
    proposals: Object.freeze({ query: (p: DiplomacyQuery = {}) => send("diplomacy:query-proposals", p),
      submit: (p: { id: string; intent: OwnerIntent }) => send("diplomacy:submit-proposal", p),
      decide: (p: { id: string; expectedRevision: number; decision: "approve" | "reject"; reason: string; editedIntent?: OwnerIntent }) => send("diplomacy:decide-proposal", p) }),
    capabilities: (domainUuid: string, territoryUuid?: string) => send("diplomacy:capabilities", { domainUuid, ...(territoryUuid ? { territoryUuid } : {}) }) });
  return api;
}
