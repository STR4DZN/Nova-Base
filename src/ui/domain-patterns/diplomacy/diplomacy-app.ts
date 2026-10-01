import { CLAIM_INHERITANCE_AXES, renderTerritoryClaims } from "./territory-claims-view.js";
import { OCCUPATION_ACTIONS, occupationFields, parseOccupationFields, parseOccupationEnd, renderTerritoryOccupations, renderOccupationFields, renderOccupationEnd, renderOccupationRequest } from "./territory-occupation-form.js";
import { INFLUENCE_ACTIONS, influenceFields, parseInfluenceFields, parseInfluenceOperation, editInfluenceRows, renderTerritoryInfluence, renderInfluenceRequest } from "./territory-influence-form.js";
import type { PublicDiplomacyApi, PublicDiplomacyOwnerApi } from "../../../diplomacy/public-diplomacy-api.js";
import { createDiplomacyDraft } from "../../../diplomacy/diplomacy-drafts.js";
import type { OwnerIntent } from "../../../diplomacy/owner-commands.js";
import type { RelationPartyRef } from "../../../relations/types/relation-types.js";
import { failure, isTimestamp, isText } from "../../../core/validation/value-validation.js";
import { ok, type Result } from "../../../core/contracts/result.js";
import { defaultReputationTrackFields, reputationTrackDefinitionFields, parseReputationTrackFields,
  renderReputationTrackFields } from "./reputation-track-form.js";
import type { ReputationTrackDefinition } from "../../../reputation/reputation-model.js";
import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
import { renderAgreementNegotiation } from "./agreement-negotiation-view.js";
import { renderAgreementObligations, renderAgreementAmendments, renderAgreementDuration } from "./agreement-inspector-view.js";
import { agreementTermFields, newAgreementTerm, parseAgreementTermEditor, reorderAgreementTermFields,
  renderAgreementTermEditorRow, AGREEMENT_TERM_TYPES, type AgreementTermEditorKind } from "./agreement-term-editor.js";
import type { AgreementTerm, AgreementDuration } from "../../../agreements/agreement-model.js";
import { compareAgreementSnapshots, type AgreementNegotiationDifference } from "../../../agreements/agreement-negotiation.js";
import { renderAgreementDifference } from "./agreement-negotiation-view.js";
import { isAgreementLifecycleFilter, type AgreementLifecycleFilter } from "../../../agreements/agreement-dashboard.js";
import { renderAgreementDashboard, renderAgreementListItem } from "./agreement-dashboard-view.js";
import type { ReputationHistoryFilter } from "../../../reputation/reputation-history.js";
import { parseReputationHistoryFields, reputationHistoryFields, renderReputationHistory } from "./reputation-history-view.js";
import { validateDiplomacyOverviewQuery, type DiplomacyOverviewFilter } from "../../../diplomacy/diplomacy-overview.js";
import { renderDiplomacyOverview } from "./diplomacy-overview-view.js";
import { parseRecognitionFields, recognitionFields, renderRecognitionFields, renderRecognitionRequest, renderTerritoryRecognitions } from "./territory-recognition-form.js";
import { linkFields, parseLinkFields, parseLinkStatus, renderLinkFields, renderLinkStatusFields, renderLinkRequest, renderTerritoryLinks, type LinkDestination } from "./territory-link-form.js";
export type DiplomacyTab = "overview" | "relations" | "reputation" | "agreements" | "territory" | "disputes" | "proposals";
const labels: Record<DiplomacyTab, string> = { overview: "Painel geral", relations: "Relações", reputation: "Reputação", agreements: "Acordos", territory: "Território", disputes: "Disputas", proposals: "Propostas" };
const kinds: Record<Exclude<DiplomacyTab, "proposals" | "overview">, OwnerIntent["kind"]> = { relations: "relation", reputation: "reputation", agreements: "agreement", territory: "territory", disputes: "dispute" };
const actions: Record<Exclude<DiplomacyTab, "proposals" | "overview">, readonly [string, string][]> = {
  relations: [["incident", "Registrar incidente / reversão"], ["modifier", "Adicionar modificador temporário"], ["end-modifier", "Encerrar modificador"], ["end", "Encerrar relação"], ["stance", "Definir / limpar postura manual"]],
  reputation: [["adjust", "Ajustar reputação"], ["decay", "Aplicar decadência configurada"]],
  agreements: [["propose", "Propor termos"], ["amend", "Propor emenda"], ["counter", "Contrapropor termos"], ["accept", "Aceitar proposta de termos"], ["reject", "Rejeitar termos"], ["activate", "Ativar termos aceitos"], ["suspend", "Suspender"], ["resume", "Retomar"], ["breach", "Registrar quebra"], ["expire", "Expirar acordo"], ["renew", "Renovar acordo"], ["expire-proposal", "Expirar proposta de termos"], ["terminate", "Encerrar"], ["obligation:evidence", "Adicionar evidência"], ["obligation:allege", "Alegar descumprimento"], ["obligation:contest", "Contestar alegação"], ["obligation:decide", "Decidir obrigação"]],
  territory: [["claim", "Adicionar reivindicação"], ["presence", "Registrar presença"], ["right", "Conceder direito"], ["reparent", "Alterar hierarquia"], ["transfer", "Transferir reivindicação de propriedade"], ["end-claim", "Encerrar reivindicação"], ["contest-claim", "Contestar reivindicação"], ["revoke-right", "Revogar direito"]],
  disputes: [["decide", "Registrar decisão de disputa"]]
};
const party = (raw: string): RelationPartyRef => raw.startsWith("JournalEntry.") ? { type: "domain", uuid: raw }
  : raw.startsWith("Actor.") ? { type: "actor", uuid: raw } : { type: "narrative", id: raw };
const refLabel = (x: any): string => typeof x === "string" ? x : x?.label ?? x?.title ?? x?.uuid ?? x?.id ?? "—";
function table(title: string, rows: readonly any[], columns: readonly [string, (row: any) => unknown][]): string {
  return `<section><h3>${escapeHtml(title)}</h3>${rows.length ? `<table><thead><tr>${columns.map(([name]) => `<th>${escapeHtml(name)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([, get]) => `<td>${escapeHtml(String(get(row) ?? "—"))}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "<p>Nenhum registro visível.</p>"}</section>`;
}
export class DiplomacyApplicationController {
  tab: DiplomacyTab = "relations"; offset = 0; search = ""; historyOffset = 0; selectedId: string | null = null;
  overviewFilter: DiplomacyOverviewFilter = "all"; expiryHorizonTicks = 10; recentHours = 24;
  list: any = null; detail: any = null; error = ""; creating = false; preview: any = null;
  reputationTrackCount = 1; reputationFormFields: Record<string, string> = {};
  reputationConfigurationFields: Record<string, string> = {};
  reputationHistoryFilter: ReputationHistoryFilter = {}; reputationHistoryFormFields: Record<string, string> = {};
  reputationSourceOffset = 0;
  territoryRecognitionFields: Record<string, string> = {}; recognitionReviewFields: Record<string, string> = {};
  recognitionReviewTarget: any = null; #recognitionDraftId: string | null = null;
  territoryLinkFields: Record<string, string> = {}; territoryLinkStatusFields: Record<string, string> = {}; linkReviewFields: Record<string, string> = {};
  linkReviewTarget: any = null; linkDestinations: LinkDestination[] = []; linkDestinationPage: any = null;
  linkDestinationSearch = ""; linkDestinationOffset = 0; linkDestinationError = ""; #linkDraftId: string | null = null;
  agreementFormFields: Record<string, string> = {};
  agreementLifecycle: AgreementLifecycleFilter | "" = "";
  agreementTermEditor: { kind: AgreementTermEditorKind; agreementId: string; revision: number; proposalId: string | null;
    proposalRevision: number | null; baseTerms: readonly AgreementTerm[]; duration: AgreementDuration; count: number;
    fields: Record<string, string> } | null = null;
  agreementTermPreview: AgreementNegotiationDifference | null = null;
  #agreementTermPreviewInput: string | null = null;
  #previewInput: string | null = null; #previewIntent: OwnerIntent | null = null;
  treeAxis: "locatedInUuid" | "administrativeParentUuid" | null = null; treeParent: string | null = null;
  claimInheritanceAxis: "locatedInUuid" | "administrativeParentUuid" = "locatedInUuid";
  applyClaimInheritanceAxis(axis: string): Result<void> {
    if (this.tab !== "territory" || !CLAIM_INHERITANCE_AXES.some(([key]) => key === axis)) return this.capture(failure("DM_DIPLOMACY_QUERY_INVALID", "Selecione uma hierarquia territorial válida."));
    this.claimInheritanceAxis = axis as typeof this.claimInheritanceAxis; this.detail = null; return this.capture(ok(undefined));
  }
  openClaimOrigin(id: string): Result<void> {
    if (this.tab !== "territory" || !this.detail?.effectiveClaims?.some((r: any) => r.sourceTerritoryUuid === id)) return this.capture(failure("DM_DIPLOMACY_NOT_FOUND", "Selecione uma origem visível.", "not-found"));
    this.select(id); this.detail = null; return this.capture(ok(undefined));
  }
  constructor(readonly api: PublicDiplomacyApi) {}
  selectTab(tab: DiplomacyTab): void { this.claimInheritanceAxis = "locatedInUuid"; this.resetOccupationContext(); this.resetInfluenceDrafts(); this.resetLinkContext(); this.resetRecognitionDraft(); this.recognitionReviewFields = {}; this.recognitionReviewTarget = null; this.tab = tab; this.list = null; this.overviewFilter = "all"; this.expiryHorizonTicks = 10; this.recentHours = 24; this.offset = 0; this.selectedId = null; this.detail = null; this.historyOffset = 0; this.creating = false; this.preview = null; this.reputationTrackCount = 1; this.reputationFormFields = {}; this.reputationConfigurationFields = {}; this.resetReputationHistory(); this.agreementLifecycle = ""; this.agreementFormFields = {}; this.cancelAgreementTermEditor(); }
  private resetReputationHistory(): void {
    this.reputationHistoryFilter = {}; this.reputationHistoryFormFields = {}; this.reputationSourceOffset = 0;
  }
  applyReputationHistory(fields: Record<string, string>): Result<unknown> {
    if (this.tab !== "reputation" || !this.detail || !this.list?.isGm)
      return this.capture(failure("DM_SECURITY_PERMISSION_DENIED", "O histórico detalhado de reputação é exclusivo do GM.", "permission"));
    this.reputationHistoryFormFields = { ...fields };
    const parsed = parseReputationHistoryFields(fields); if (!parsed.ok) return this.capture(parsed);
    if (parsed.value.trackId && !this.detail.tracks.some((t: any) => t.definitionId === parsed.value.trackId))
      return this.capture(failure("DM_REPUTATION_TRACK_UNAVAILABLE", "Selecione uma trilha deste registro."));
    this.reputationHistoryFilter = parsed.value; this.historyOffset = 0; this.reputationSourceOffset = 0;
    return this.capture(ok({}));
  }
  filterReputationSource(trackId: string, sourceType: string, sourceKind: string, sourceRef: string): Result<unknown> {
    if (!trackId || !sourceType || !sourceRef || !["id", "uuid"].includes(sourceKind))
      return this.capture(failure("DM_REPUTATION_HISTORY_FILTER_INVALID", "Selecione uma fonte registrada válida."));
    return this.applyReputationHistory({ ...reputationHistoryFields(this.reputationHistoryFilter), trackId, sourceType, sourceKind, sourceRef });
  }
  private resetAgreementSelection(): void {
    this.offset = 0; this.selectedId = null; this.detail = null; this.historyOffset = 0; this.list = null;
    this.creating = false; this.preview = null; this.agreementFormFields = {}; this.cancelAgreementTermEditor();
  }
  selectAgreementLifecycle(value: unknown): Result<unknown> {
    if (this.tab !== "agreements" || value !== "" && !isAgreementLifecycleFilter(value))
      return this.capture(failure("DM_DIPLOMACY_QUERY_INVALID", "Selecione um estado de acordo válido."));
    if (this.agreementLifecycle !== value) { this.agreementLifecycle = value; this.resetAgreementSelection(); }
    return this.capture(ok({}));
  }
  setSearch(value: string): void {
    this.search = value; this.offset = 0;
    if (this.tab === "agreements") this.resetAgreementSelection();
  }
  select(id: string): void { if (this.selectedId !== id) { this.resetOccupationContext(); this.resetInfluenceDrafts(); this.resetLinkContext(); this.resetRecognitionDraft(); this.recognitionReviewFields = {}; this.recognitionReviewTarget = null; this.reputationConfigurationFields = {}; this.resetReputationHistory(); this.agreementFormFields = {}; this.cancelAgreementTermEditor(); } this.selectedId = id; this.historyOffset = 0; this.creating = false; this.preview = null; }
  applyOverviewFilter(filter: unknown, expiryHorizonTicks = this.expiryHorizonTicks, recentHours = this.recentHours): Result<unknown> {
    if (this.tab !== "overview") return this.capture(failure("DM_DIPLOMACY_OVERVIEW_QUERY_INVALID", "Abra o painel geral."));
    const valid = validateDiplomacyOverviewQuery({ filter, expiryHorizonTicks, recentHours }); if (!valid.ok) return this.capture(valid);
    this.overviewFilter = valid.value.filter!; this.expiryHorizonTicks = expiryHorizonTicks; this.recentHours = recentHours;
    this.offset = 0; this.list = null; return this.capture(ok({}));
  }
  openOverviewItem(tab: unknown, id: unknown): Result<unknown> {
    if (this.tab !== "overview" || typeof tab !== "string" || tab === "overview" || !Object.hasOwn(labels, tab) || typeof id !== "string"
      || !this.list?.items?.some((r: any) => kinds[tab as keyof typeof kinds] === r.kind && r.id === id || tab === "proposals" && r.kind === "proposal" && r.id === id))
      return this.capture(failure("DM_DIPLOMACY_QUERY_INVALID", "Selecione um destaque visível."));
    this.selectTab(tab as DiplomacyTab); this.search = ""; this.treeAxis = null; this.treeParent = null; this.select(id); return this.capture(ok({}));
  }
  occupationDraft: Record<string, string> = {}; occupationEndDraft: Record<string, string> = {};
  occupationReviewFields: Record<string, string> = {}; occupationReviewTarget: any = null;
  #occupationDraftId: string | null = null;
  resetOccupationDrafts(): void { this.occupationDraft = {}; this.occupationEndDraft = {}; this.#occupationDraftId = null; }
  private resetOccupationContext(): void { this.resetOccupationDrafts(); this.occupationReviewFields = {}; this.occupationReviewTarget = null; }
  resetOccupationReviewReferences(f: Record<string, string>): void {
    this.occupationReviewFields = { ...f, occupationPresenceIds: "[]", occupationControlIds: "[]" };
    delete this.occupationReviewFields.occupationReferencesUnavailable;
  }
  async submitOccupation(f: Record<string, string>, end = false): Promise<Result<unknown>> {
    if (this.tab !== "territory" || !this.detail || this.selectedId !== this.detail.id)
      return this.capture(failure("DM_DIPLOMACY_INTENT_INVALID", "Selecione um território disponível."));
    return this.change({ ...f, kind: end ? "end-occupation" : "occupation" });
  }
  influenceDrafts: Record<string, Record<string, string>> = {};
  #influenceDraftIds: Record<string, string> = {};
  resetInfluenceDrafts(): void { this.influenceDrafts = {}; this.#influenceDraftIds = {}; }
  async submitInfluence(f: Record<string, string>, kind: string): Promise<Result<unknown>> {
    if (this.tab !== "territory" || !this.detail || this.selectedId !== this.detail.id || !INFLUENCE_ACTIONS.includes(kind as any))
      return this.capture(failure("DM_DIPLOMACY_INTENT_INVALID", "Selecione um território e operação disponíveis."));
    return this.change({ ...f, kind });
  }
  resetRecognitionDraft(): void { this.territoryRecognitionFields = {}; this.#recognitionDraftId = null; }
  async submitRecognition(fields: Record<string, string>): Promise<Result<unknown>> {
    if (this.tab !== "territory" || !this.detail || this.selectedId !== this.detail.id)
      return this.capture(failure("DM_DIPLOMACY_INTENT_INVALID", "Selecione um território disponível."));
    return this.change({ ...fields, kind: "recognition" });
  }
  resetLinkDrafts(): void { this.territoryLinkFields = {}; this.territoryLinkStatusFields = {}; this.#linkDraftId = null; }
  private resetLinkContext(): void { this.resetLinkDrafts(); this.linkReviewFields = {}; this.linkReviewTarget = null; this.linkDestinations = []; this.linkDestinationPage = null; this.linkDestinationSearch = ""; this.linkDestinationOffset = 0; this.linkDestinationError = ""; }
  async submitLink(fields: Record<string, string>, status = false): Promise<Result<unknown>> {
    if (this.tab !== "territory" || !this.detail || this.selectedId !== this.detail.id)
      return this.capture(failure("DM_DIPLOMACY_INTENT_INVALID", "Selecione um território disponível."));
    return this.change({ ...fields, kind: status ? "update-link" : "link" });
  }
  applyDestinationSearch(search: string): void { this.linkDestinationSearch = search.trim(); this.linkDestinationOffset = 0; }
  async loadLinkDestinations(sourceId: string): Promise<void> {
    this.linkDestinations = []; this.linkDestinationPage = null; this.linkDestinationError = "";
    const page = await this.api.territory.query({ offset: this.linkDestinationOffset, limit: 30, search: this.linkDestinationSearch });
    if (!page.ok) { this.linkDestinationError = "Destinos indisponíveis. Atualize a consulta antes de enviar."; return; }
    this.linkDestinationPage = page.value; this.linkDestinations = (page.value as any).items.filter((d: LinkDestination) => d.id !== sourceId);
    const target = this.tab === "proposals" ? this.linkReviewFields.linkTarget ?? this.detail?.original.action?.value?.targetTerritoryUuid : this.territoryLinkFields.linkTarget;
    if (target && target !== sourceId && !this.linkDestinations.some(d => d.id === target)) {
      const selected = await this.api.territory.query({ id: target, historyLimit: 0 });
      if (selected.ok) this.linkDestinations.push({ id: (selected.value as any).id, label: (selected.value as any).label });
      else this.linkDestinationError = "Destino anterior indisponível. Escolha outro destino visível.";
    }
  }
  async load(): Promise<Result<unknown>> {
    this.occupationReviewTarget = null; this.recognitionReviewTarget = null; this.linkReviewTarget = null; this.linkDestinations = []; this.linkDestinationPage = null;
    if (this.tab === "overview") {
      const result = await this.api.overview.query({ offset: this.offset, limit: 30, search: this.search, filter: this.overviewFilter,
        expiryHorizonTicks: this.expiryHorizonTicks, recentHours: this.recentHours });
      this.detail = null; this.list = result.ok ? result.value : null; return this.capture(result);
    }
    const queried = await this.api[this.tab].query({ offset: this.offset, limit: 30, search: this.search,
      ...(this.tab === "agreements" && this.agreementLifecycle ? { agreementLifecycle: this.agreementLifecycle } : {}),
      ...(this.tab === "territory" && this.treeAxis ? { treeAxis: this.treeAxis, parentUuid: this.treeParent } : {}) });
    if (!queried.ok) { this.error = queried.error.message; if (this.tab === "agreements" || this.tab === "reputation" || this.tab === "territory" || this.tab === "proposals") { this.list = null; this.detail = null; } return queried; } this.list = queried.value;
    if (this.selectedId) { const detail = await this.api[this.tab].query({ id: this.selectedId, historyOffset: this.historyOffset, historyLimit: 30,
      ...(this.tab === "territory" ? { claimInheritanceAxis: this.claimInheritanceAxis } : {}),
      ...(this.tab === "reputation" && this.list?.isGm ? { ...(Object.keys(this.reputationHistoryFilter).length ? { reputationHistory: this.reputationHistoryFilter } : {}),
        reputationSourceOffset: this.reputationSourceOffset, reputationSourceLimit: 30 } : {}) });
      if (!detail.ok) { this.error = detail.error.message; this.detail = null; return detail; } this.detail = detail.value;
      if (this.tab === "proposals" && this.list?.isGm && this.detail.lifecycle === "pending" && this.detail.original.kind === "territory"
        && this.detail.original.mode === "modify" && this.detail.original.action?.kind === "recognition") {
        const target = await this.api.territory.query({ id: this.detail.original.id, historyLimit: 0 });
        if (target.ok) this.recognitionReviewTarget = target.value;
        else this.error = "O território está indisponível para revisão. É possível rejeitar ou atualizar a consulta.";
      }
    }
    if (this.tab === "territory" && this.detail) await this.loadLinkDestinations(this.detail.id);
    if (this.tab === "proposals" && this.list?.isGm && this.detail?.lifecycle === "pending" && this.detail.original.kind === "territory"
      && this.detail.original.mode === "modify" && ["link", "update-link"].includes(this.detail.original.action?.kind)) {
      const target = await this.api.territory.query({ id: this.detail.original.id, historyLimit: 0 });
      if (target.ok) { this.linkReviewTarget = target.value; if (this.detail.original.action.kind === "link") await this.loadLinkDestinations(this.detail.original.id); }
      else this.error = "O território está indisponível para revisão. É possível rejeitar ou atualizar a consulta.";
    }
    if (this.tab === "proposals" && this.list?.isGm && this.detail?.lifecycle === "pending" && this.detail.original.kind === "territory"
      && this.detail.original.mode === "modify" && OCCUPATION_ACTIONS.includes(this.detail.original.action?.kind)) {
      const target = await this.api.territory.query({ id: this.detail.original.id, historyLimit: 0 });
      if (target.ok) this.occupationReviewTarget = target.value;
      else this.error = "O território está indisponível para revisão. É possível rejeitar ou atualizar a consulta.";
    }
    return ok(this.list);
  }
  async create(fields: Record<string, string>): Promise<Result<unknown>> {
    if (this.tab === "proposals" || this.tab === "overview") return failure("DM_DIPLOMACY_INTENT_INVALID", "Selecione o tipo de registro para criar uma proposta.");
    if (this.tab === "reputation") this.reputationFormFields = { ...fields };
    const parties = [fields.subject, fields.audience, ...fields.additionalParties?.split(",") ?? []].filter(Boolean).map(x => party(x.trim())), draft = createDiplomacyDraft(kinds[this.tab], fields.label, parties,
      fields.visibility as any, fields.territories?.split(",").map(x => x.trim()).filter(Boolean));
    if (this.tab === "relations" && fields.stancePolicy) {
      if (!["none", "manual", "derived"].includes(fields.stancePolicy))
        return this.capture(failure("DM_RELATION_STANCE_INVALID", "Selecione uma política de postura válida."));
      const data = draft.data as any;
      data.definition.stancePolicy = fields.stancePolicy;
      if (fields.stancePolicy !== "derived") delete data.definition.stanceRules;
      if (fields.stancePolicy === "manual" && fields.stance) data.state.relation.stance = fields.stance;
      if (fields.stancePolicy === "derived" && fields.stanceRules) {
        try { data.definition.stanceRules = JSON.parse(fields.stanceRules); }
        catch { return this.capture(failure("DM_RELATION_STANCE_POLICY_INVALID", "As regras de postura precisam ser um JSON válido.")); }
      }
    }
    if (this.tab === "reputation") {
      const data = draft.data as any, definitions: ReputationTrackDefinition[] = [], tracks = [], ids = new Set<string>();
      for (let i = 0; i < this.reputationTrackCount; i++) {
        const prefix = `rep_${i}_`, defaults = Object.fromEntries(Object.entries(defaultReputationTrackFields(i)).map(([k, v]) => [prefix + k, v]));
        const parsed = parseReputationTrackFields({ ...defaults, ...fields, [prefix + "decayEnabled"]: fields[prefix + "decayEnabled"] ?? "" }, prefix);
        if (!parsed.ok) return this.capture(parsed);
        const { definition, initialScore } = parsed.value;
        if (ids.has(definition.id)) return this.capture(failure("DM_REPUTATION_TRACK_ALREADY_EXISTS", "Cada trilha precisa de um identificador diferente."));
        ids.add(definition.id); definitions.push(definition);
        tracks.push({ definitionId: definition.id, definitionVersion: definition.version, initialScore, score: initialScore, lastDecayWorldTick: null });
      }
      data.definitions = definitions; data.record.tracks = tracks;
    }
    const intent: OwnerIntent = { kind: kinds[this.tab], mode: "create", id: draft.id, data: draft.data, reason: fields.reason };
    const result = this.list?.isGm ? await (this.api[this.tab] as PublicDiplomacyOwnerApi).create({ id: draft.id, data: draft.data, reason: fields.reason })
      : await this.api.proposals.submit({ id: crypto.randomUUID(), intent });
    this.capture(result); if (result.ok) { this.creating = false; if (this.list?.isGm) this.select(draft.id); } return result;
  }
  addReputationTrackForm(fields: Record<string, string>): void {
    this.reputationFormFields = { ...fields }; this.reputationTrackCount += 1;
  }
  removeReputationTrackForm(index: number, fields: Record<string, string>): void {
    if (this.reputationTrackCount <= 1 || index < 0 || index >= this.reputationTrackCount) return;
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      const match = /^rep_(\d+)_(.+)$/.exec(key);
      if (!match) next[key] = value;
      else if (Number(match[1]) !== index) next[`rep_${Number(match[1]) > index ? Number(match[1]) - 1 : match[1]}_${match[2]}`] = value;
    }
    this.reputationTrackCount -= 1; this.reputationFormFields = next;
  }
  async configureReputationTrack(fields: Record<string, string>, existing: boolean): Promise<Result<unknown>> {
    if (this.tab !== "reputation" || !this.detail || !this.list?.isGm)
      return this.capture(failure("DM_SECURITY_PERMISSION_DENIED", "A configuração de trilhas existentes é feita pelo GM.", "permission"));
    this.reputationConfigurationFields = { ...fields };
    const track = this.detail.tracks.find((t: any) => t.definitionId === fields.trackId);
    const definition = existing && track ? this.detail.definitions.find((d: any) => d.id === track.definitionId && d.version === track.definitionVersion) : undefined;
    if (existing && !definition) return this.capture(failure("DM_REPUTATION_TRACK_UNAVAILABLE", "Selecione uma trilha existente."));
    const parsed = parseReputationTrackFields(fields, "config_", definition ? { id: definition.id, version: definition.version, bandIds: definition.bands.map((b: any) => b.id) } : undefined);
    if (!parsed.ok) return this.capture(parsed);
    const { id: ignoredId, version: ignoredVersion, ...policy } = parsed.value.definition;
    const action = existing ? { kind: "configure-track", trackId: definition.id, policy }
      : { kind: "add-track", definition: parsed.value.definition, initialScore: parsed.value.initialScore };
    const result = await this.api.reputation.modify({ id: this.detail.id, expectedRevision: this.detail.revision, action, reason: fields.reason });
    this.capture(result); if (result.ok) this.reputationConfigurationFields = {}; return result;
  }
  reputationTrackForms(): string {
    return Array.from({ length: this.reputationTrackCount }, (_, i) => {
      const prefix = `rep_${i}_`, values = { ...defaultReputationTrackFields(i) };
      for (const key of Object.keys(values)) if (Object.hasOwn(this.reputationFormFields, prefix + key)) values[key] = this.reputationFormFields[prefix + key];
      return `<fieldset><legend>Trilha ${i + 1}</legend>${renderReputationTrackFields(prefix, values)}
        ${this.reputationTrackCount > 1 ? `<button type="button" data-dm-reputation-remove="${i}">Remover esta trilha</button>` : ""}</fieldset>`;
    }).join("") + '<button type="button" data-dm-reputation-add="true">Adicionar outra trilha</button>';
  }
  reputationConfigurationForms(): string {
    if (!this.list?.isGm || !this.detail?.definitions) return "";
    const render = (definition?: ReputationTrackDefinition) => {
      const editing = !!definition, saved = this.reputationConfigurationFields;
      const matches = editing ? saved.trackId === definition!.id : saved.trackId === "";
      const values = editing ? reputationTrackDefinitionFields(definition!) : defaultReputationTrackFields();
      if (matches) {
        for (const key of Object.keys(values)) if (Object.hasOwn(saved, "config_" + key)) values[key] = saved["config_" + key];
        values.decayEnabled = saved.config_decayEnabled ?? "";
      }
      const reason = matches ? saved.reason ?? "" : "";
      return `<details ${matches && this.error ? "open" : ""}><summary>${editing ? `Configurar ${escapeHtml(definition!.label)}` : "Adicionar trilha"}</summary>
        ${editing ? "<p>O intervalo preserva o histórico. Mudanças de política criam uma nova versão; alterações da decadência começam no tempo atual.</p>" : ""}
        <form data-dm-form="${editing ? "reputation-configure" : "reputation-add-track"}">
          <input type="hidden" name="trackId" value="${escapeAttribute(definition?.id ?? "")}">
          ${renderReputationTrackFields("config_", values, editing)}
          <label>Motivo auditável<input name="reason" required value="${escapeAttribute(reason)}"></label>
          <button>${editing ? "Salvar configuração" : "Adicionar trilha"}</button></form></details>`;
    };
    return '<section><h3>Configuração das trilhas</h3>' + render()
      + this.detail.tracks.map((t: any) => render(this.detail.definitions.find((d: any) => d.id === t.definitionId && d.version === t.definitionVersion))).join("") + "</section>";
  }
  buildAction(f: Record<string, string>): Result<unknown> {
    if (!this.detail || this.tab === "proposals" || this.tab === "overview") return failure("DM_DIPLOMACY_INTENT_INVALID", "Selecione um registro.");
    const n = Number(f.amount), kind = f.kind, d = this.detail;
    if (["incident", "modifier", "adjust", "presence"].includes(kind) && (!f.amount || !Number.isSafeInteger(n))) return failure("DM_DIPLOMACY_INTENT_INVALID", "Informe uma quantidade inteira.");
    if (this.tab === "relations") {
      if (kind === "stance") {
        if (d.stancePolicy !== "manual") return failure("DM_RELATION_STANCE_INVALID", "Esta relação não usa postura manual.");
        return ok({ kind, value: f.stance || null });
      }
      const selector = { axisId: f.axis, fromPartyId: f.from || null, toPartyId: f.to || null };
      return ok(kind === "incident" ? { kind, deltas: [{ ...selector, value: n }], ...(f.reversalOf ? { reversalOf: f.reversalOf } : {}) }
        : kind === "modifier" ? { kind, value: { ...selector, value: n, id: crypto.randomUUID(), source: { type: "manual", id: "gm-input" },
          visibility: f.visibility, lifecycle: "active", createdAt: 0, expiresAt: null, expiresAtWorldTick: f.expires ? Number(f.expires) : null,
          stackKey: "domain-manager:temporary", stacking: "add" } } : kind === "end-modifier" ? { kind, id: f.sourceId } : { kind });
    }
    if (this.tab === "reputation") return ok({ kind, trackId: f.axis, delta: n, ...(f.reversalOf ? { reversalOf: f.reversalOf } : {}) });
    if (this.tab === "agreements") {
      const p = f.sourceId ? d.proposals?.find((x: any) => x.id === f.sourceId)
        : d.proposals?.find((x: any) => ["open", "accepted"].includes(x.lifecycle)) ?? d.proposals?.at(-1);
      if (["counter", "accept", "reject", "activate", "expire-proposal"].includes(kind) && !p)
        return failure("DM_AGREEMENT_PROPOSAL_NOT_FOUND", "Selecione uma proposta de termos existente.", "not-found");
      const parseTick = (value: string | undefined): number | null => value?.trim() ? Number(value) : null;
      const expires = parseTick(f.expires), deadline = parseTick(f.proposalExpires), starts = parseTick(f.starts);
      if (["propose", "amend", "counter"].includes(kind) && [expires, deadline, starts].some(x => x !== null && (!Number.isSafeInteger(x) || x < 0)))
        return failure("DM_AGREEMENT_DURATION_INVALID", "Prazos e início precisam ser ticks inteiros não negativos.");
      if (kind === "renew") {
        const until = parseTick(f.renewExpires);
        if (until === null || !Number.isSafeInteger(until) || until <= (this.list?.worldTick ?? 0)
          || !["active", "breached"].includes(d.lifecycle) || d.duration?.expiresAtWorldTick == null || until <= d.duration.expiresAtWorldTick)
          return failure("DM_AGREEMENT_RENEWAL_INVALID", "Renovação manual precisa estender o prazo de um acordo ativo ou em quebra com duração finita.");
        return ok({ kind: "renew", expiresAtWorldTick: until, automatic: false });
      }
      if (kind === "expire-proposal") return ok({ kind, proposalId: p.id, expectedProposalRevision: p.revision });
      if (kind.startsWith("obligation:")) {
        const o = d.obligations?.find((x: any) => x.id === f.obligationId), nested = kind.slice(11);
        if (!o) return failure("DM_AGREEMENT_OBLIGATION_NOT_FOUND", "Selecione uma obrigação disponível.", "not-found");
        return ok({ kind: "obligation", obligationId: o?.id, expectedObligationRevision: o?.revision,
          action: nested === "evidence" ? { kind: nested, evidence: { id: crypto.randomUUID(), ref: { type: "evidence", id: f.outcome }, statement: f.text,
            position: f.position || "support", visibility: f.visibility, at: 0 } } : nested === "decide" ? { kind: nested, lifecycle: f.lifecycle } : { kind: nested },
          applyConsequences: f.applyConsequences === "on" });
      }
      if (["propose", "amend", "counter"].includes(kind)) {
        if (f.termEditor === "on") {
          const editor = this.agreementTermEditor;
          if (!editor || editor.agreementId !== d.id || kind !== editor.kind || (f.sourceId || null) !== editor.proposalId)
            return failure("DM_AGREEMENT_TERM_EDITOR_INVALID", "Abra uma edição para esta operação e este acordo.");
          if (d.revision !== editor.revision || (kind === "counter" && p.revision !== editor.proposalRevision))
            return failure("DM_AGREEMENT_TERM_EDITOR_STALE", "O acordo mudou. O rascunho foi preservado; confira os dados atuais e reabra a edição.", "conflict");
          if (kind === "counter" && (p.lifecycle !== "open" || (p.expiresAtWorldTick !== null && (d.worldTick ?? this.list?.worldTick ?? 0) >= p.expiresAtWorldTick)))
            return failure("DM_AGREEMENT_PROPOSAL_EXPIRED", "A proposta não está aberta para contrapropostas.", "conflict");
          const terms = parseAgreementTermEditor(f, editor.count, d.parties.map((x: any) => x.id), editor.baseTerms,
            d.definition?.allowedTermTypes ?? AGREEMENT_TERM_TYPES.map(x => x[0]));
          if (!terms.ok) return terms;
          if (starts !== null && expires !== null && expires <= starts)
            return failure("DM_AGREEMENT_DURATION_INVALID", "O fim dos termos precisa ser posterior ao início.");
          if (kind !== "counter" && deadline !== null && deadline <= (d.worldTick ?? this.list?.worldTick ?? 0))
            return failure("DM_AGREEMENT_PROPOSAL_EXPIRED", "O prazo de aceitação precisa estar no futuro.", "conflict");
          return ok({ kind, proposalId: kind === "counter" ? editor.proposalId : crypto.randomUUID(),
            ...(kind === "counter" ? { expectedProposalRevision: editor.proposalRevision } : { proposalExpiresAtWorldTick: deadline,
              ...(kind === "amend" ? { amendmentId: crypto.randomUUID() } : {}) }), partyId: f.partyId, terms: terms.value,
            baseTermIds: editor.baseTerms.map(t => t.id), duration: { startsAtWorldTick: starts, expiresAtWorldTick: expires } });
        }
        const type = f.termType || "narrative", grants = f.grants?.split(",").map(x => x.trim()).filter(Boolean) ?? [];
        const operation = { id: crypto.randomUUID(), ownerId: "domain-manager:economy", operation: "economy:adjust",
          targetRefs: [{ type: "domain", uuid: f.beneficiary }], payload: { domainUuid: f.beneficiary, resourceId: f.resource, deltaMinor: Number(f.amount), reason: f.reason } };
        const payload = type === "capability" ? { beneficiaryPartyId: f.beneficiaryPartyId, capabilityIds: grants,
          scopeRef: f.territories ? { type: "territory", uuid: f.territories } : null, conditionRefs: [] }
          : type === "right" ? { beneficiaryPartyId: f.beneficiaryPartyId, territoryUuid: f.territories, rightType: f.rightType || "domain-manager:entry", startsAtWorldTick: null,
            expiresAtWorldTick: f.expires ? Number(f.expires) : null, inherited: f.inherited === "on", revocable: true, conditionRefs: [], grants }
          : type === "obligation" ? { kind: "domain-manager:payment", obligatedPartyId: f.partyId, beneficiaryPartyId: f.beneficiaryPartyId || null,
            dueAtWorldTick: f.due ? Number(f.due) : null, graceTicks: Number(f.grace || "0"), overduePolicy: "report", requirementRef: { type: "resource", id: f.resource },
            consequences: f.consequence === "on" ? [operation] : [] }
          : type === "owner-operation" ? { operations: [operation] } : {};
        return ok({ kind, proposalId: kind === "counter" ? p?.id : crypto.randomUUID(), ...(kind === "counter" ? { expectedProposalRevision: p?.revision } : { proposalExpiresAtWorldTick: deadline, ...(kind === "amend" ? { amendmentId: crypto.randomUUID() } : {}) }), partyId: f.partyId,
          baseTermIds: [], terms: [{ id: crypto.randomUUID(), type: `domain-manager:${type}`, title: f.title, text: f.text || null, visibility: f.visibility,
            partyIds: d.parties.map((p: any) => p.id), payload }], duration: { startsAtWorldTick: starts, expiresAtWorldTick: expires } });
      }
      if (["accept", "reject", "activate"].includes(kind)) return ok({ kind, proposalId: p?.id, expectedProposalRevision: p?.revision, ...(kind !== "activate" ? { partyId: f.partyId } : { amendmentId: crypto.randomUUID() }) });
      return ok({ kind });
    }
    if (this.tab === "disputes") return ok({ kind, lifecycle: f.lifecycle, outcomeRef: f.outcome ? { type: "manual-outcome", id: f.outcome } : null });
    if (kind === "link" || kind === "update-link") {
      const revision = f.linkRevision === undefined ? d.revision : f.linkRevision.trim() ? Number(f.linkRevision) : NaN;
      if (!isTimestamp(revision) || revision !== d.revision) return failure("DM_REVISION_CONFLICT", "O território mudou. Preserve o rascunho ou limpe-o para usar a revisão atual.", "conflict");
      if (!isText(f.reason?.trim())) return failure("DM_TERRITORY_LINK_REASON_INVALID", "Informe um motivo auditável.");
      return kind === "update-link" ? parseLinkStatus(f, d.links ?? []) : parseLinkFields(f, d.id, this.linkDestinations, d.worldTick ?? this.list?.worldTick,
        this.#linkDraftId ??= crypto.randomUUID(), { type: "manual", id: "diplomacy-link-form" });
    }
    if (OCCUPATION_ACTIONS.includes(kind as any)) {
      const revision = f.occupationRevision === undefined ? d.revision : f.occupationRevision.trim() ? Number(f.occupationRevision) : NaN;
      if (!isTimestamp(revision) || revision !== d.revision) return failure("DM_REVISION_CONFLICT", "O território mudou. Revise ou limpe o rascunho antes de enviar.", "conflict");
      if (!isText(f.reason?.trim())) return failure("DM_TERRITORY_OCCUPATION_REASON_INVALID", "Informe um motivo auditável.");
      return kind === "end-occupation" ? parseOccupationEnd(f, d.occupations ?? []) : parseOccupationFields(f, d.presence ?? [], d.claims ?? [],
        d.worldTick ?? this.list?.worldTick, this.#occupationDraftId ??= crypto.randomUUID(), { type: "manual", id: "diplomacy-occupation-form" });
    }
    if (INFLUENCE_ACTIONS.includes(kind as any)) {
      const revision = f.influenceRevision === undefined ? d.revision : f.influenceRevision.trim() ? Number(f.influenceRevision) : NaN;
      if (!isTimestamp(revision) || revision !== d.revision) return failure("DM_REVISION_CONFLICT", "O território mudou. Revise o rascunho antes de enviar.", "conflict");
      if (!isText(f.reason?.trim())) return failure("DM_TERRITORY_INFLUENCE_REASON_INVALID", "Informe um motivo auditável.");
      const id = this.#influenceDraftIds[kind] ??= crypto.randomUUID(), tick = d.worldTick ?? this.list?.worldTick, source = { type: "manual", id: "diplomacy-influence-form" };
      return kind === "influence" ? parseInfluenceFields(f, tick, id, source) : parseInfluenceOperation(f, d.influence ?? [], tick, id, source);
    }
    if (kind === "recognition") {
      const revision = f.recognitionRevision === undefined ? d.revision : f.recognitionRevision.trim() ? Number(f.recognitionRevision) : NaN;
      if (!isTimestamp(revision) || revision !== d.revision)
        return failure("DM_REVISION_CONFLICT", "O território mudou. O rascunho foi preservado; use a revisão atual antes de enviar.", "conflict");
      if (!isText(f.reason?.trim())) return failure("DM_TERRITORY_RECOGNITION_REASON_INVALID", "Informe um motivo auditável.");
      return parseRecognitionFields(f, d.claims ?? [], d.worldTick ?? this.list?.worldTick, this.#recognitionDraftId ??= crypto.randomUUID(),
        { type: "manual", id: "diplomacy-recognition-form" });
    }
    const source = { id: crypto.randomUUID(), sourceRef: { type: "manual", id: "gm-review" }, visibility: f.visibility,
      startsAtWorldTick: f.starts ? Number(f.starts) : this.list?.worldTick ?? 0, expiresAtWorldTick: f.expires ? Number(f.expires) : null };
    if (kind === "claim") return ok({ kind, value: { ...source, claimantRef: party(f.beneficiary), claimType: f.claimType, lifecycle: "active", contested: false, strength: null, inherited: false } });
    if (kind === "presence") return ok({ kind, value: { ...source, partyRef: party(f.beneficiary), presenceType: "domain-manager:military", amount: n, active: true } });
    if (kind === "right") return ok({ kind, value: { ...source, beneficiaryRef: party(f.beneficiary), rightType: f.rightType, inherited: f.inherited === "on", revocable: true,
      active: true, conditionRefs: [], grants: f.grants ? f.grants.split(",").map(x => x.trim()).filter(Boolean) : [] } });
    if (kind === "reparent") return ok({ kind, parents: { locatedInUuid: f.physical || null, administrativeParentUuid: f.administrative || null } });
    if (kind === "transfer") return ok({ kind, targets: [{ territoryUuid: d.id, expectedRevision: d.revision, supersedeClaimIds: [f.sourceId],
      newClaim: { ...source, claimantRef: party(f.beneficiary), claimType: "domain-manager:ownership", lifecycle: "active", contested: false, strength: null, inherited: false } }] });
    return ok({ kind, id: f.sourceId });
  }
  selectAgreementObligation(id: string): Result<void> {
    if (this.tab !== "agreements" || !this.detail?.obligations?.some((o: any) => o.id === id))
      return this.capture(failure("DM_AGREEMENT_OBLIGATION_NOT_FOUND", "Selecione uma obrigação disponível.", "not-found"));
    this.agreementFormFields = { ...this.agreementFormFields, obligationId: id,
      kind: this.agreementFormFields.kind?.startsWith("obligation:") ? this.agreementFormFields.kind : "obligation:evidence" };
    return ok(undefined);
  }
  cancelAgreementTermEditor(): void {
    this.agreementTermEditor = null; this.agreementTermPreview = null; this.#agreementTermPreviewInput = null;
  }
  openAgreementTermEditor(kind: AgreementTermEditorKind, proposalId?: string): Result<void> {
    const d = this.detail;
    if (this.tab !== "agreements" || !d || !["propose", "amend", "counter"].includes(kind))
      return this.capture(failure("DM_AGREEMENT_TERM_EDITOR_INVALID", "Selecione um acordo e uma operação de termos."));
    const p = kind === "counter" ? d.proposals?.find((x: any) => x.id === proposalId && x.lifecycle === "open") : null;
    if (kind === "counter" && !p) return this.capture(failure("DM_AGREEMENT_PROPOSAL_NOT_FOUND", "Selecione uma proposta aberta.", "not-found"));
    if ((kind === "propose" && d.lifecycle !== "draft") || (kind === "amend" && !["active", "breached", "suspended"].includes(d.lifecycle)))
      return this.capture(failure("DM_AGREEMENT_TERM_EDITOR_INVALID", "Esta operação não está disponível no estado atual do acordo."));
    const baseTerms: AgreementTerm[] = structuredClone(p ? p.rounds.at(-1).terms : d.terms), duration = structuredClone(p ? p.rounds.at(-1).duration : d.duration);
    const initialType = d.definition?.allowedTermTypes?.includes("domain-manager:narrative") === false ? d.definition.allowedTermTypes[0] : "domain-manager:narrative";
    const terms = kind === "propose" && baseTerms.length === 0 ? [newAgreementTerm(initialType, d.parties.map((x: any) => x.id))] : baseTerms;
    const fields: Record<string, string> = { termEditor: "on", kind, sourceId: p?.id ?? "", partyId: d.parties[0].id,
      starts: duration.startsAtWorldTick === null ? "" : String(duration.startsAtWorldTick),
      expires: duration.expiresAtWorldTick === null ? "" : String(duration.expiresAtWorldTick), proposalExpires: "", reason: "" };
    for (const [i, t] of terms.entries()) for (const [key, value] of Object.entries(agreementTermFields(t, d.parties.map((x: any) => x.id)))) fields[`term_${i}_${key}`] = value;
    this.agreementTermEditor = { kind, agreementId: d.id, revision: d.revision, proposalId: p?.id ?? null,
      proposalRevision: p?.revision ?? null, baseTerms, duration, count: terms.length, fields };
    this.agreementTermPreview = null; this.#agreementTermPreviewInput = null; this.error = ""; return ok(undefined);
  }
  updateAgreementTermEditor(fields: Record<string, string>): void {
    if (!this.agreementTermEditor) return;
    this.agreementTermEditor.fields = { ...fields }; this.agreementTermPreview = null; this.#agreementTermPreviewInput = null;
  }
  addAgreementTerm(fields: Record<string, string>): void {
    const e = this.agreementTermEditor; if (!e) return; this.updateAgreementTermEditor(fields);
    const initialType = this.detail.definition?.allowedTermTypes?.includes("domain-manager:narrative") === false ? this.detail.definition.allowedTermTypes[0] : "domain-manager:narrative";
    const row = agreementTermFields(newAgreementTerm(initialType, this.detail.parties.map((p: any) => p.id)), this.detail.parties.map((p: any) => p.id));
    for (const [key, value] of Object.entries(row)) e.fields[`term_${e.count}_${key}`] = value; e.count++;
  }
  removeAgreementTerm(index: number, fields: Record<string, string>): void {
    const e = this.agreementTermEditor; if (!e || !Number.isInteger(index) || index < 0 || index >= e.count) return;
    this.updateAgreementTermEditor(reorderAgreementTermFields(fields, Array.from({ length: e.count }, (_, i) => i).filter(i => i !== index))); e.count--;
  }
  moveAgreementTerm(index: number, direction: number, fields: Record<string, string>): void {
    const e = this.agreementTermEditor; if (!e || !Number.isInteger(index) || ![-1, 1].includes(direction) || index < 0 || index >= e.count || index + direction < 0 || index + direction >= e.count) return;
    const order = Array.from({ length: e.count }, (_, i) => i); [order[index], order[index + direction]] = [order[index + direction], order[index]];
    this.updateAgreementTermEditor(reorderAgreementTermFields(fields, order));
  }
  changeAgreementTermType(index: number, fields: Record<string, string>): Result<void> {
    const e = this.agreementTermEditor, type = fields[`term_${index}_type`];
    if (!e || !Number.isInteger(index) || index < 0 || index >= e.count || !(this.detail.definition?.allowedTermTypes ?? AGREEMENT_TERM_TYPES.map(x => x[0])).includes(type))
      return this.capture(failure("DM_AGREEMENT_TERM_TYPE_INVALID", "Selecione um tipo de termo disponível."));
    this.updateAgreementTermEditor(fields);
    e.fields[`term_${index}_payload`] = JSON.stringify(newAgreementTerm(type, this.detail.parties.map((p: any) => p.id)).payload, null, 2);
    return ok(undefined);
  }
  previewAgreementTerms(fields: Record<string, string>): Result<void> {
    this.updateAgreementTermEditor(fields);
    const built = this.buildAction(fields); if (!built.ok) return this.capture(built);
    const e = this.agreementTermEditor!, action = built.value as { terms: readonly AgreementTerm[]; duration: AgreementDuration };
    this.agreementTermPreview = compareAgreementSnapshots(e.baseTerms, action.terms, e.duration, action.duration);
    this.#agreementTermPreviewInput = JSON.stringify(fields); return this.capture(ok(undefined));
  }
  async change(fields: Record<string, string>, previewOnly = false): Promise<Result<unknown>> {
    if (this.tab === "territory" && fields.kind === "occupation") this.occupationDraft = { ...fields };
    if (this.tab === "territory" && fields.kind === "end-occupation") this.occupationEndDraft = { ...fields };
    if (this.tab === "territory" && fields.kind === "link") this.territoryLinkFields = { ...fields };
    if (this.tab === "territory" && fields.kind === "update-link") this.territoryLinkStatusFields = { ...fields };
    if (this.tab === "territory" && fields.kind === "recognition") this.territoryRecognitionFields = { ...fields };
    if (this.tab === "agreements") {
      if (fields.termEditor === "on" && this.agreementTermEditor) this.agreementTermEditor.fields = { ...fields };
      else this.agreementFormFields = { ...fields };
    }
    if (this.tab === "territory" && INFLUENCE_ACTIONS.includes(fields.kind as any)) this.influenceDrafts[fields.kind.startsWith("end-influence") ? "end-influence" : fields.kind] = { ...fields };
    const built = this.buildAction(fields); if (!built.ok) { this.capture(built); return built; }
    if (this.tab === "agreements" && fields.termEditor === "on" && this.#agreementTermPreviewInput !== JSON.stringify(fields))
      return this.capture(failure("DM_AGREEMENT_TERM_PREVIEW_REQUIRED", "Confira as alterações dos termos antes de enviar."));
    let intent: OwnerIntent = { kind: kinds[this.tab as Exclude<DiplomacyTab, "proposals" | "overview">], mode: "modify", id: this.detail.id,
      expectedRevision: fields.termEditor === "on" ? this.agreementTermEditor!.revision : this.detail.revision, action: built.value, reason: ["recognition", "link", "update-link", ...OCCUPATION_ACTIONS].includes(fields.kind) ? fields.reason.trim() : fields.reason };
    if (previewOnly) { const result = await this.api.previewTerritory(intent as any); this.capture(result);
      if (result.ok) { this.preview = result.value; this.#previewInput = JSON.stringify(fields); this.#previewIntent = intent; } else this.preview = null; return result; }
    if (this.tab === "territory" && ["transfer", "reparent"].includes(fields.kind) && this.list?.isGm
      && (!this.preview || this.#previewInput !== JSON.stringify(fields) || this.#previewIntent?.expectedRevision !== this.detail.revision))
      return this.capture(failure("DM_DIPLOMACY_PREVIEW_REQUIRED", "Confira a prévia antes de confirmar a alteração territorial."));
    if (this.preview && this.#previewIntent && this.#previewInput === JSON.stringify(fields)) intent = this.#previewIntent;
    const result = this.list?.isGm ? await (this.api[this.tab] as PublicDiplomacyOwnerApi).modify(intent as any)
      : await this.api.proposals.submit({ id: crypto.randomUUID(), intent });
    this.capture(result); if (result.ok) { if (fields.kind === "occupation") { this.occupationDraft = {}; this.#occupationDraftId = null; } if (fields.kind === "end-occupation") this.occupationEndDraft = {}; if (INFLUENCE_ACTIONS.includes(fields.kind as any)) { delete this.influenceDrafts[fields.kind.startsWith("end-influence") ? "end-influence" : fields.kind]; delete this.#influenceDraftIds[fields.kind]; } this.preview = null; if (this.tab === "territory" && fields.kind === "link") { this.territoryLinkFields = {}; this.#linkDraftId = null; } if (this.tab === "territory" && fields.kind === "update-link") this.territoryLinkStatusFields = {}; if (this.tab === "territory" && fields.kind === "recognition") this.resetRecognitionDraft(); if (this.tab === "agreements") { this.agreementFormFields = {}; if (fields.termEditor === "on") this.cancelAgreementTermEditor(); } } return result;
  }
  async review(decision: "approve" | "reject", reason: string, fields: Record<string, string> = {}): Promise<Result<unknown>> {
    let editedIntent: OwnerIntent | undefined;
    if (fields.occupationReview === "on") {
      this.occupationReviewFields = { ...fields }; reason = reason.trim();
      if (!isText(reason)) return this.capture(failure("DM_TERRITORY_OCCUPATION_REASON_INVALID", "Informe o motivo da decisão."));
      if (decision === "approve") {
        const original = this.detail?.original;
        if (!this.list?.isGm || this.tab !== "proposals" || original?.kind !== "territory" || original.mode !== "modify"
          || !OCCUPATION_ACTIONS.includes(original.action?.kind) || !this.occupationReviewTarget)
          return this.capture(failure("DM_TERRITORY_OCCUPATION_UNAVAILABLE", "Atualize o território antes de aprovar.", "not-found"));
        const parsed = original.action.kind === "end-occupation" ? parseOccupationEnd({ occupationId: original.action.id }, this.occupationReviewTarget.occupations)
          : parseOccupationFields(fields, this.occupationReviewTarget.presence, this.occupationReviewTarget.claims, this.occupationReviewTarget.worldTick, original.action.value.id, original.action.value.sourceRef);
        if (!parsed.ok) return this.capture(parsed);
        editedIntent = { ...structuredClone(original), action: parsed.value };
      }
    }
    if (fields.linkReview === "on") {
      this.linkReviewFields = { ...fields }; reason = reason?.trim();
      if (!isText(reason)) return this.capture(failure("DM_TERRITORY_LINK_REASON_INVALID", "Informe o motivo da decisão."));
      if (decision === "approve") {
        const original = this.detail?.original;
        if (!this.list?.isGm || this.tab !== "proposals" || original?.kind !== "territory" || original.mode !== "modify"
          || !["link", "update-link"].includes(original.action?.kind) || !this.linkReviewTarget)
          return this.capture(failure("DM_TERRITORY_LINK_UNAVAILABLE", "Atualize o território antes de aprovar.", "not-found"));
        const parsed = original.action.kind === "update-link" ? parseLinkStatus({ ...fields, linkId: original.action.id }, this.linkReviewTarget.links)
          : parseLinkFields(fields, original.id, this.linkDestinations, this.linkReviewTarget.worldTick, original.action.value.id, original.action.value.sourceRef);
        if (!parsed.ok) return this.capture(parsed);
        editedIntent = { ...structuredClone(original), action: parsed.value };
      }
    }
    if (fields.recognitionReview === "on") {
      this.recognitionReviewFields = { ...fields };
      reason = reason.trim();
      if (!isText(reason)) return this.capture(failure("DM_TERRITORY_RECOGNITION_REASON_INVALID", "Informe o motivo da decisão."));
      if (decision === "approve") {
        if (!this.list?.isGm || this.tab !== "proposals" || this.detail?.original.kind !== "territory"
          || this.detail?.original.mode !== "modify" || this.detail?.original.action?.kind !== "recognition" || !this.recognitionReviewTarget)
          return this.capture(failure("DM_TERRITORY_RECOGNITION_UNAVAILABLE", "Atualize o território antes de aprovar.", "not-found"));
        const original = this.detail.original.action.value;
        const parsed = parseRecognitionFields(fields, this.recognitionReviewTarget.claims, this.recognitionReviewTarget.worldTick, original.id, original.sourceRef);
        if (!parsed.ok) return this.capture(parsed);
        editedIntent = { ...structuredClone(this.detail.original), action: parsed.value };
      }
    }
    if (decision === "approve" && (fields.amount || fields.targetRevision)) {
      editedIntent ??= structuredClone(this.detail.original);
      const action = editedIntent!.action as any;
      if (fields.amount) {
        const delta = Number(fields.amount); if (!Number.isSafeInteger(delta)) return this.capture(failure("DM_DIPLOMACY_INTENT_INVALID", "A alteração deve ser inteira."));
        if (action?.kind === "incident" && action.deltas?.length === 1) action.deltas[0].value = delta;
        else if (action?.kind === "adjust") action.delta = delta;
        else return this.capture(failure("DM_DIPLOMACY_INTENT_INVALID", "Este pedido exige revisão pela API semântica."));
      }
      if (fields.targetRevision) {
        const revision = Number(fields.targetRevision);
        if (!isTimestamp(revision)) return this.capture(failure("DM_REVISION_CONFLICT", "Informe uma revisão inteira não negativa.", "conflict"));
        editedIntent = { ...editedIntent!, expectedRevision: revision };
      }
    }
    const result = await this.api.proposals.decide({ id: this.detail.id, expectedRevision: this.detail.revision, decision, reason, ...(editedIntent ? { editedIntent } : {}) }); this.capture(result); if (result.ok) { this.occupationReviewFields = {}; this.recognitionReviewFields = {}; this.linkReviewFields = {}; } return result;
  }
  capture<T>(result: Result<T>): Result<T> { this.error = result.ok ? "" : result.error.message; return result; }
  render(): string {
    const tabs = Object.entries(labels).map(([key, name]) => `<button type="button" data-dm-tab="${key}" aria-pressed="${this.tab === key}">${name}</button>`).join("");
    if (this.tab === "overview") return `<div class="dm-diplomacy"><nav>${tabs}</nav>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}
      <form data-dm-form="search"><input name="search" aria-label="Pesquisar" value="${escapeAttribute(this.search)}"><button>Pesquisar</button></form>
      ${renderDiplomacyOverview(this.list, this.overviewFilter, this.expiryHorizonTicks, this.recentHours)}</div>`;
    const list = (this.list?.items ?? []).map((r: any) => this.tab === "agreements" ? renderAgreementListItem(r, this.selectedId)
      : `<button type="button" data-dm-id="${escapeAttribute(r.id)}">${escapeHtml(r.label)} <small>${escapeHtml(r.lifecycle)}</small></button>`).join("");
    return `<div class="dm-diplomacy"><nav>${tabs}</nav><p>Resumo → explicação → detalhes → ação. As alterações são confirmadas pela autoridade do mundo.</p>
      ${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<form data-dm-form="search"><input name="search" aria-label="Pesquisar" value="${escapeAttribute(this.search)}"><button>Pesquisar</button></form>
      ${this.tab === "territory" ? `<nav><button type="button" data-dm-tree="all">Lista</button><button type="button" data-dm-tree="locatedInUuid">Árvore física</button><button type="button" data-dm-tree="administrativeParentUuid">Árvore administrativa</button><button type="button" data-dm-root="true">Raízes</button></nav><p>Ramo atual: ${escapeHtml(this.treeParent ?? "raízes / lista")}</p>` : ""}
      <div class="dm-diplomacy-columns"><aside>${this.tab === "agreements" && !this.list ? "<p>Lista indisponível.</p>" : `<p>${this.list?.total ?? 0} ${this.tab === "agreements" ? "acordos neste filtro/pesquisa" : "registros visíveis"}</p>${list || (this.tab === "agreements" ? "<p>Nenhum acordo visível para este filtro/pesquisa.</p>" : "<p>Nenhum registro.</p>")}`}
      <button type="button" data-dm-page="-1" ${this.offset === 0 ? "disabled" : ""}>Anterior</button><button type="button" data-dm-page="1" ${this.offset + 30 >= (this.list?.total ?? 0) ? "disabled" : ""}>Próxima</button>
      ${this.tab !== "proposals" ? '<button type="button" data-dm-create="true">Novo registro</button>' : ""}</aside><main>${this.tab === "agreements" && !this.creating ? renderAgreementDashboard(this.list?.agreementSummary, this.agreementLifecycle, this.search) : ""}${this.creating ? this.createForm() : this.detail ? this.inspector() : "<p>Selecione um registro para ver a explicação e o histórico.</p>"}</main></div></div>`;
  }
  createForm(): string {
    const input = (name: string, label: string, required = true) => `<label>${label}<input name="${name}" value="${escapeAttribute(this.tab === "reputation" ? this.reputationFormFields[name] ?? "" : "")}" ${required ? "required" : ""}></label>`;
    return `<h2>Novo registro: ${labels[this.tab]}</h2><form data-dm-form="create">${input("label", "Nome")}${this.tab !== "territory" ? input("subject", "Parte / sujeito (UUID de Domínio ou Actor; nome para parte narrativa)") + input("audience", "Outra parte / audiência") : ""}
      ${this.tab !== "reputation" && this.tab !== "territory" ? input("additionalParties", "Outras partes, separadas por vírgula (opcional)", false) : ""}
      ${this.tab === "relations" ? '<label>Postura<select name="stancePolicy"><option value="derived">Derivada dos eixos</option><option value="manual">Manual</option><option value="none">Sem postura</option></select></label>' + input("stance", "Postura inicial (somente manual; opcional)", false)
        + '<details><summary>Regras avançadas da postura derivada</summary><p>Regras avaliadas na ordem declarada. Cada regra usa id, label, visibility e conditions com axisId, minimum e maximum. Em branco usa confiança, neutralidade e desconfiança pelo eixo de confiança.</p><label>Regras (JSON)<textarea name="stanceRules"></textarea></label></details>' : ""}\n      ${this.tab === "reputation" ? this.reputationTrackForms() : ""}\n      ${this.tab === "disputes" ? input("territories", "UUIDs dos territórios, separados por vírgula") : ""}${this.visibilityField()}${input("reason", "Motivo auditável")}
      <button>${this.list?.isGm ? "Criar registro" : "Enviar proposta ao GM"}</button></form>`;
  }
  visibilityField(): string {
    const selected = this.tab === "reputation" && this.creating ? this.reputationFormFields.visibility ?? "public" : "public";
    return `<label>Visibilidade<select name="visibility">${[["public", "Pública"], ["restricted", "Participantes"], ["secret", "GM"]].map(([value, label]) =>
      `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
  }
  inspector(): string {
    const d = this.detail; let blocks = `<h2>${escapeHtml(d.label ?? d.id)}</h2><p>Estado: ${escapeHtml(d.lifecycle ?? "active")} · revisão ${d.revision}</p>`;
    const columns: readonly [string, (x: any) => unknown][] = [["Parte", x => refLabel(x.ref ?? x.partyRef ?? x.claimantRef ?? x.beneficiaryRef ?? x)], ["Papel", x => x.role ?? x.claimType ?? x.rightType ?? "—"]];
    if (d.parties) blocks += table("Participantes", d.parties, columns);
    if (d.stances?.length) {
      blocks += table("Postura", d.stances, [["De", x => x.fromPartyId ?? "Compartilhada"], ["Para", x => x.toPartyId ?? "Todos"],
        ["Postura", x => x.value ?? (x.status === "unconfigured" ? "Política sem regras configuradas" : "Sem classificação")],
        ["Origem", x => x.status === "manual" ? "Manual" : "Derivada dos eixos"]]);
      blocks += table("Razões da postura", d.stances.flatMap((stance: any) => stance.reasons.map((reason: any) => ({ ...reason,
        fromPartyId: stance.fromPartyId, toPartyId: stance.toPartyId }))),
        [["De", x => x.fromPartyId ?? "Compartilhada"], ["Para", x => x.toPartyId ?? "Todos"],
          ["Eixo", x => x.axisId], ["Base", x => x.base], ["Efetivo", x => x.effective]]);
    }
    if (d.scores) blocks += table("Eixos", d.scores, [["Eixo", x => x.axisId], ["Base", x => x.base], ["Efetivo", x => x.effective]]);
    if (d.tracks) {
      blocks += table("Reputação", d.tracks, [["Trilha", x => x.label ?? x.definitionId], ["Faixa / valor", x => x.band?.label ?? x.band ?? x.bandLabel ?? x.score ?? x.value ?? x.presentation]]);
      if (this.list?.isGm) {
        blocks += table("Política e valores", d.tracks, [["Trilha", x => x.label], ["Valor", x => x.score], ["Inicial", x => x.initialScore],
          ["Referência", x => x.baseline], ["Versão", x => x.definitionVersion],
          ["Decadência", x => x.decay ? `${x.decay.amount} por ${x.decay.periodTicks} ticks; cursor ${x.lastDecayWorldTick}` : "Desativada"],
          ["Visibilidade", x => x.visibility], ["Apresentação", x => x.publicPresentation]]);
        blocks += table("Histórico de configuração", d.configurationHistory ?? [], [["Trilha", x => x.trackId], ["Mudança", x => x.kind],
          ["Antes", x => x.beforeVersion], ["Depois", x => x.afterVersion], ["Motivo", x => x.reason], ["Momento", x => x.at]]);
        blocks += this.reputationConfigurationForms();
      }
    }
    if (d.terms) blocks += table("Termos vigentes", d.terms, [["Termo", x => x.title], ["Descrição", x => x.text]]);
    if (this.tab === "agreements") {
      const worldTick = d.worldTick ?? this.list?.worldTick ?? 0;
      blocks += renderAgreementDuration(d.duration, worldTick);
      blocks += renderAgreementObligations(d.obligations ?? [], d.parties, worldTick, Boolean(this.list?.isGm));
      blocks += renderAgreementAmendments(d.amendments ?? [], Boolean(this.list?.isGm));
      blocks += renderAgreementNegotiation(d.proposals ?? [], d.parties, worldTick, Boolean(this.list?.isGm), this.agreementFormFields);
      blocks += this.agreementTermEditingForm();
    }
    if (d.obligations && this.tab !== "agreements") blocks += table("Obrigações", d.obligations, [["Obrigação", x => x.id], ["Estado", x => x.lifecycle], ["Contestada", x => x.contested ? "Sim" : "Não"]]);
    if (d.territory) { blocks += `<p>Propriedade, administração, controle e presença possuem registros independentes. Transferências preservam as reivindicações concorrentes.</p>
      <p>Localização: ${escapeHtml(d.territory.locatedInUuid ?? "raiz")} · hierarquia administrativa: ${escapeHtml(d.territory.administrativeParentUuid ?? "raiz")}</p>`;
      if (this.treeAxis) blocks += `<button type="button" data-dm-children="${escapeAttribute(d.id)}">Abrir filhos neste ramo</button>`;
      for (const [key, name] of [["claims", "Reivindicações locais (registros)"], ["presence", "Presença"], ["rights", "Direitos"]]) blocks += table(name, d[key] ?? [], [...columns, ["Estado", x => x.lifecycle ?? (x.active ? "active" : "inactive")]]);
      blocks += renderTerritoryClaims(d.effectiveClaims ?? [], d.claimInheritanceAxis ?? this.claimInheritanceAxis, d.worldTick ?? this.list?.worldTick);
      blocks += renderTerritoryOccupations(d, d.worldTick ?? this.list?.worldTick, Boolean(this.list?.isGm), this.occupationDraft, this.occupationEndDraft);
      blocks += renderTerritoryRecognitions(d, d.worldTick ?? this.list?.worldTick, Boolean(this.list?.isGm), this.territoryRecognitionFields);
      blocks += renderTerritoryInfluence(d, d.worldTick ?? this.list?.worldTick, Boolean(this.list?.isGm), this.influenceDrafts.influence ?? {}, this.influenceDrafts["add-influence-modifier"] ?? {}, this.influenceDrafts["end-influence"] ?? this.influenceDrafts["end-influence-modifier"] ?? {});
      blocks += renderTerritoryLinks(d, d.worldTick ?? this.list?.worldTick, Boolean(this.list?.isGm), this.linkDestinations, this.linkDestinationPage,
        this.linkDestinationSearch, this.territoryLinkFields, this.territoryLinkStatusFields, this.linkDestinationError);
    }
    if (this.tab === "proposals") {
      blocks += `<h3>Pedido original</h3><p>${escapeHtml(d.original.kind)} · ${escapeHtml(d.original.mode)} · ${escapeHtml(d.original.id)}</p><p>${escapeHtml(d.original.reason)}</p>
        <p>Solicitante: ${escapeHtml(d.requesterUserId)}</p>${d.decision ? `<h3>Decisão</h3><p>${escapeHtml(d.decision.reason)} · ${escapeHtml(d.decision.reviewerUserId)}</p>` : ""}`;
      const a = d.original.action;
      if (OCCUPATION_ACTIONS.includes(a?.kind)) blocks += renderOccupationRequest(a);
      const approvedOccupation = d.decision?.approvedIntent?.action;
      if (OCCUPATION_ACTIONS.includes(approvedOccupation?.kind)) blocks += renderOccupationRequest(approvedOccupation, "Ocupação aprovada");
      if (INFLUENCE_ACTIONS.includes(a?.kind)) blocks += renderInfluenceRequest(a);
      const approvedInfluence = d.decision?.approvedIntent?.action;
      if (INFLUENCE_ACTIONS.includes(approvedInfluence?.kind)) blocks += renderInfluenceRequest(approvedInfluence, "Influência aprovada");
      if (a) blocks += `<p>Ação solicitada: ${escapeHtml(a.kind)} · revisão esperada: ${d.original.expectedRevision}</p>`
        + table("Alteração solicitada", a.deltas ?? (a.delta !== undefined ? [{ axisId: a.trackId, value: a.delta }] : []), [["Eixo", x => x.axisId], ["Alteração", x => x.value]]);
      if (["link", "update-link"].includes(a?.kind)) {
        blocks += renderLinkRequest(a);
        const approved = d.decision?.approvedIntent?.action;
        if (["link", "update-link"].includes(approved?.kind)) blocks += renderLinkRequest(approved, "Ligação aprovada");
        else if (d.lifecycle === "approved" && !d.decision?.approvedIntent) blocks += "<p>O conteúdo revisado não está disponível nesta visão.</p>";
      }
      if (a?.kind === "recognition" && a.value) blocks += renderRecognitionRequest(a.value);
      if ((d.decision?.approvedIntent?.action as any)?.kind === "recognition" && (d.decision.approvedIntent.action as any).value)
        blocks += renderRecognitionRequest((d.decision.approvedIntent.action as any).value, "Reconhecimento aprovado");
      else if (a?.kind === "recognition" && d.lifecycle === "approved" && !d.decision?.approvedIntent)
        blocks += "<p>O conteúdo revisado não está disponível nesta visão.</p>";
      if (d.decision?.approvedIntent) blocks += `<p>Ação aprovada: ${escapeHtml((d.decision.approvedIntent.action as any)?.kind ?? "create")} · revisão esperada: ${d.decision.approvedIntent.expectedRevision ?? "nova"}</p>`;
      if (this.list?.isGm && d.lifecycle === "pending" && d.original.kind === "territory" && a?.kind === "recognition") {
        const f = { ...recognitionFields(a.value), ...this.recognitionReviewFields };
        blocks += `<h3>Revisar reconhecimento</h3><p>A revisão preserva o pedido original. Revisão solicitada: ${d.original.expectedRevision}; atual: ${this.recognitionReviewTarget?.revision ?? "indisponível"}.</p>
          <form data-dm-form="review"><input type="hidden" name="recognitionReview" value="on">
          ${this.recognitionReviewTarget ? renderRecognitionFields(this.recognitionReviewTarget.claims, f) : "<p>Território indisponível para aprovação. Atualize ou rejeite o pedido.</p>"}
          <label>Revisão atual do alvo (opcional; aceitar após conferir outra edição)<input name="targetRevision" type="number" min="0" step="1" value="${escapeAttribute(f.targetRevision ?? "")}"></label>
          <label>Motivo da decisão<input name="reason" required value="${escapeAttribute(f.reason ?? "")}"></label>
          <button name="decision" value="approve" ${this.recognitionReviewTarget ? "" : "disabled"}>Aprovar reconhecimento</button><button name="decision" value="reject" formnovalidate>Rejeitar</button></form>`;
      } else if (this.list?.isGm && d.lifecycle === "pending" && d.original.kind === "territory" && ["link", "update-link"].includes(a?.kind)) {
        const f: Record<string, string> = { ...(a.kind === "link" ? linkFields(a.value) : { linkId: a.id, linkStatus: a.status }), ...this.linkReviewFields };
        blocks += `<h3>Revisar ligação territorial</h3><p>Pedido original preservado. Revisão solicitada: ${d.original.expectedRevision}; atual: ${this.linkReviewTarget?.revision ?? "indisponível"}.</p>`;
        if (a.kind === "link" && this.linkReviewTarget) blocks += `<form data-dm-form="link-destinations"><label>Buscar destinos<input name="destinationSearch" value="${escapeAttribute(this.linkDestinationSearch)}"></label><button>Buscar</button></form><button type="button" data-dm-link-page="-1" ${this.linkDestinationOffset === 0 ? "disabled" : ""}>Destinos anteriores</button><button type="button" data-dm-link-page="1" ${!this.linkDestinationPage || this.linkDestinationOffset + 30 >= this.linkDestinationPage.total ? "disabled" : ""}>Próximos destinos</button><p>${escapeHtml(this.linkDestinationError)}</p>`;
        const available = this.linkReviewTarget && (a.kind === "update-link" || this.linkDestinationPage);
        blocks += `<form data-dm-form="review"><input type="hidden" name="linkReview" value="on">
          ${available ? a.kind === "link" ? renderLinkFields(this.linkDestinations, f) : renderLinkStatusFields(this.linkReviewTarget.links.filter((l: any) => l.id === a.id), f) : "<p>Território ou destinos indisponíveis para aprovação. Atualize ou rejeite o pedido.</p>"}
          <label>Revisão atual do alvo (opcional após conferir outra edição)<input name="targetRevision" type="number" min="0" step="1" value="${escapeAttribute(f.targetRevision ?? "")}"></label>
          <label>Motivo da decisão<input name="reason" required value="${escapeAttribute(f.reason ?? "")}"></label><button name="decision" value="approve" ${available ? "" : "disabled"}>Aprovar ligação</button><button name="decision" value="reject" formnovalidate>Rejeitar</button></form>`;
      } else if (this.list?.isGm && d.lifecycle === "pending" && d.original.kind === "territory" && OCCUPATION_ACTIONS.includes(a?.kind)) {
        const f: Record<string, string> = { ...(a.kind === "occupation" ? occupationFields(a.value) : { occupationId: a.id }), ...this.occupationReviewFields }, target = this.occupationReviewTarget;
        blocks += `<h3>Revisar ocupação territorial</h3><p>Pedido original preservado. Revisão solicitada: ${d.original.expectedRevision}; atual: ${target?.revision ?? "indisponível"}.</p>
          <form data-dm-form="review"><input type="hidden" name="occupationReview" value="on">
          ${target ? a.kind === "occupation" ? renderOccupationFields(target.presence, target.claims, f) : renderOccupationEnd(target.occupations, f, a.id) : "<p>Território indisponível para aprovação. Atualize ou rejeite o pedido.</p>"}
          ${a.kind === "occupation" ? '<button type="button" data-dm-occupation-review-reset="true">Limpar referências da revisão</button>' : ""}
          <label>Revisão atual do alvo (opcional após conferir outra edição)<input name="targetRevision" type="number" min="0" step="1" value="${escapeAttribute(f.targetRevision ?? "")}"></label>
          <label>Motivo da decisão<input name="reason" required value="${escapeAttribute(f.reason ?? "")}"></label><button name="decision" value="approve" ${target ? "" : "disabled"}>Aprovar ocupação</button><button name="decision" value="reject" formnovalidate>Rejeitar</button></form>`;
      } else if (this.list?.isGm && d.lifecycle === "pending") blocks += '<form data-dm-form="review"><label>Alteração revisada (incidente de um eixo ou ajuste de reputação; opcional)<input name="amount" type="number" step="1"></label><label>Revisão atual do alvo (se estiver aceitando uma mudança após outra edição; opcional)<input name="targetRevision" type="number" min="0" step="1"></label><label>Motivo<input name="reason" required></label><button name="decision" value="approve">Aprovar</button><button name="decision" value="reject">Rejeitar</button></form>';
      return blocks;
    }
    const history = d.history ?? d.entries ?? d.events ?? [];
    if (this.tab === "reputation") return blocks + (this.list?.isGm ? renderReputationHistory(d, this.reputationHistoryFormFields)
      : "<p>O histórico detalhado e as fontes são exclusivos do GM. Esta visão segue a apresentação configurada para cada trilha.</p>") + this.actionForm();
    blocks += table("Histórico visível", history, [["Evento", x => x.kind], ["Explicação", x => x.reason ?? x.summary], ["Momento", x => x.at]]);
    blocks += `<button type="button" data-dm-history="-1" ${this.historyOffset === 0 ? "disabled" : ""}>Histórico anterior</button><button type="button" data-dm-history="1" ${history.length < 30 ? "disabled" : ""}>Próximo histórico</button>`;
    return blocks + this.actionForm();
  }
  agreementTermEditingForm(): string {
    const d = this.detail, e = this.agreementTermEditor;
    const negotiating = d.proposals?.some((p: any) => ["open", "accepted"].includes(p.lifecycle));
    const controls = `${d.lifecycle === "draft" && !negotiating ? '<button type="button" data-dm-term-open="propose">Preparar proposta com vários termos</button>' : ""}
      ${["active", "breached", "suspended"].includes(d.lifecycle) && !negotiating ? '<button type="button" data-dm-term-open="amend">Preparar emenda dos termos vigentes</button>' : ""}
      ${(d.proposals ?? []).filter((p: any) => p.lifecycle === "open").map((p: any) => `<button type="button" data-dm-term-open="counter" data-dm-term-source="${escapeAttribute(p.id)}">Preparar contraproposta: ${escapeHtml(p.id)}</button>`).join("")}`;
    if (!e) return `<section><h3>Editar termos do acordo</h3>${controls || "<p>Aguarde a decisão da proposta em negociação para preparar outra emenda.</p>"}</section>`;
    const f = e.fields, input = (name: string, label: string) => `<label>${label}<input name="${name}" type="number" step="1" min="0" value="${escapeAttribute(f[name] ?? "")}"></label>`;
    return `<section><h3>${{ propose: "Nova proposta", amend: "Emenda dos termos vigentes", counter: "Contraproposta" }[e.kind]}</h3>
      <p>Os termos visíveis de origem foram copiados. Remover um termo exige usar o botão de remoção; termos fora da sua visibilidade são preservados. A edição está vinculada à revisão ${e.revision}.</p>
      ${e.revision !== d.revision ? '<p role="alert">O acordo mudou. Copie o rascunho que deseja guardar e reabra a edição com os dados atuais.</p>' : ""}
      <form data-dm-form="agreement-terms"><input type="hidden" name="termEditor" value="on"><input type="hidden" name="kind" value="${e.kind}"><input type="hidden" name="sourceId" value="${escapeAttribute(e.proposalId ?? "")}">
        <label>Parte que oferece<select name="partyId">${d.parties.map((p: any) => `<option value="${escapeAttribute(p.id)}" ${f.partyId === p.id ? "selected" : ""}>${escapeHtml(refLabel(p.ref))}</option>`).join("")}</select></label>
        ${input("starts", "Início em ticks (em branco: na ativação)")}${input("expires", "Fim em ticks (em branco: sem limite)")}
        ${e.kind !== "counter" ? input("proposalExpires", "Prazo de aceitação em ticks (opcional)") : ""}
        ${Array.from({ length: e.count }, (_, i) => renderAgreementTermEditorRow(i, e.count, f, d.parties, d.definition?.allowedTermTypes ?? AGREEMENT_TERM_TYPES.map(x => x[0]))).join("") || "<p>Nenhum termo selecionado; confira as remoções na prévia.</p>"}
        <button type="button" data-dm-term-add="true">Adicionar termo</button>
        <label>Motivo auditável<input name="reason" required value="${escapeAttribute(f.reason ?? "")}"></label>
        <button type="button" data-dm-term-preview="true">Conferir alterações</button><button>${this.list?.isGm ? "Enviar termos" : "Enviar proposta ao GM"}</button>
        <button type="button" data-dm-term-cancel="true">Cancelar edição</button></form>
      <div data-dm-term-preview-result>${this.agreementTermPreview ? renderAgreementDifference(this.agreementTermPreview, "Prévia das alterações visíveis") : "<p>Confira a prévia antes de enviar.</p>"}</div>
      <p>A prévia não aplica operações. Os termos só produzem efeitos pelo fluxo normal de aprovação e ativação do acordo.</p>
      ${controls ? `<details><summary>Reabrir edição com os dados atuais</summary><p>Reabrir substitui o rascunho desta edição.</p>${controls}</details>` : ""}</section>`;
  }
  actionForm(): string {
    const d = this.detail, input = (name: string, label: string) => `<label>${label}<input name="${name}" ${this.tab === "agreements" && ["starts", "expires", "proposalExpires", "renewExpires"].includes(name) ? 'type="number" step="1" min="0"' : ""}></label>`;
    const choices = actions[this.tab as Exclude<DiplomacyTab, "proposals" | "overview">].filter(([key]) => (key !== "stance" || d.stancePolicy === "manual")
      && (this.tab !== "agreements" || !["propose", "amend", "counter"].includes(key))).map(([key, label]) => `<option value="${key}">${label}</option>`).join("");
    let fields = "";
    if (this.tab === "relations" || this.tab === "reputation") {
      const axes = d.definition?.axes?.map((x: any) => ({ id: x.id, label: x.label })) ?? d.scores?.map((x: any) => ({ id: x.axisId, label: x.axisId })) ?? d.tracks?.map((x: any) => ({ id: x.definitionId ?? x.trackId, label: x.label ?? x.definitionId ?? x.trackId })) ?? [];
      fields = `<label>Eixo / trilha<select name="axis">${axes.map((x: any) => `<option value="${escapeAttribute(x.id)}">${escapeHtml(x.label)}</option>`).join("")}</select></label>${input("amount", "Alteração inteira")}${input("reversalOf", "ID do evento original a compensar (opcional)")}`;
      if (this.tab === "relations") {
        if (d.stancePolicy === "manual") fields += input("stance", "Nova postura manual (em branco: limpar)");
        if (d.scores.some((x: any) => x.fromPartyId !== null)) for (const [key, label] of [["from", "De"], ["to", "Para"]]) fields += `<label>${label}<select name="${key}">${d.parties.map((p: any) => `<option value="${escapeAttribute(p.id)}">${escapeHtml(refLabel(p.ref))}</option>`).join("")}</select></label>`;
        fields += `${this.visibilityField()}${input("expires", "Expiração do modificador no relógio do mundo")}${input("sourceId", "ID do modificador a encerrar")}`;
      }
    } else if (this.tab === "agreements") fields = `<label>Parte<select name="partyId">${d.parties.map((p: any) => `<option value="${escapeAttribute(p.id)}">${escapeHtml(refLabel(p.ref))}</option>`).join("")}</select></label>
      <label>Proposta de termos<select name="sourceId"><option value="">Proposta em negociação / mais recente</option>${(d.proposals ?? []).map((p: any) => `<option value="${escapeAttribute(p.id)}">${escapeHtml(p.id)} · ${escapeHtml(p.lifecycle)} · rev. ${p.revision}</option>`).join("")}</select></label>
      ${input("renewExpires", "Novo fim do acordo para renovação manual (ticks)")}${this.visibilityField()}
      <label>Texto da evidência<textarea name="text"></textarea></label>
      <label>Obrigação<select name="obligationId">${(d.obligations ?? []).map((o: any) => `<option value="${escapeAttribute(o.id)}">${escapeHtml(o.id)} · ${escapeHtml(o.lifecycle)}</option>`).join("")}</select></label>
      <label>Decisão de obrigação<select name="lifecycle">${["satisfied", "waived", "breached", "expired", "cancelled"].map(x => `<option>${x}</option>`).join("")}</select></label>${input("outcome", "Referência da evidência")}<label>Posição<select name="position"><option value="support">Apoia</option><option value="contest">Contesta</option></select></label><label><input type="checkbox" name="applyConsequences">Executar consequências declaradas ao confirmar quebra</label>`;
    else if (this.tab === "territory") fields = `${input("beneficiary", "Parte / beneficiário (UUID ou nome narrativo)")}${input("sourceId", "ID da reivindicação ou direito existente")}
      <label>Tipo de reivindicação<select name="claimType"><option value="domain-manager:ownership">Propriedade</option><option value="domain-manager:administration">Administração</option><option value="domain-manager:control">Controle</option></select></label>
      <label>Direito<select name="rightType">${["entry", "trade", "transit", "build", "extract"].map(x => `<option value="domain-manager:${x}">${x}</option>`).join("")}</select></label>${input("amount", "Quantidade de presença")}${input("grants", "Capacidades concedidas, separadas por vírgula")}
      <label><input type="checkbox" name="inherited">Herdar direito pela localização</label>${input("starts", "Início no relógio do mundo (para transferência: momento atual)")}${input("expires", "Expiração (opcional)")}${this.visibilityField()}
      ${input("physical", "UUID do novo pai físico (em branco: raiz)")}${input("administrative", "UUID do novo pai administrativo (em branco: raiz)")}`;
    else fields = `<label>Decisão<select name="lifecycle">${["latent", "active", "escalated", "frozen", "settled", "abandoned", "superseded"].map(x => `<option>${x}</option>`).join("")}</select></label>${input("outcome", "Referência do resultado explícito do GM")}`;
    const html = `<h3>${this.list?.isGm ? "Ação" : "Propor mudança ao GM"}</h3><form data-dm-form="change"><label>Operação<select name="kind">${choices}</select></label>${fields}<label>Motivo<input name="reason" required></label>
      ${this.tab === "territory" && this.list?.isGm ? '<button type="button" data-dm-preview="true">Conferir prévia</button>' : ""}<button>${this.list?.isGm ? "Confirmar ação" : "Enviar proposta"}</button></form>
      ${this.preview ? `<p role="status">Prévia validada: ${this.preview.changes.length} território(s). Nenhuma propriedade de instalação será alterada.</p>` : ""}`;
    return this.tab === "agreements" ? restoreAgreementFields(html, this.agreementFormFields) : html;
  }
}
function restoreAgreementFields(html: string, fields: Record<string, string>): string {
  return html.replace(/<input\b[^>]*>/g, tag => {
    const key = /name="([^"]+)"/.exec(tag)?.[1]; if (!key || fields[key] === undefined) return tag;
    if (tag.includes('type="checkbox"')) return fields[key] === "on" ? tag.replace(/>$/, " checked>") : tag;
    return tag.replace(/>$/, ` value="${escapeAttribute(fields[key])}">`);
  }).replace(/<textarea name="([^"]+)">[^<]*<\/textarea>/g, (tag, key) => fields[key] === undefined ? tag
    : `<textarea name="${key}">${escapeHtml(fields[key])}</textarea>`)
    .replace(/<select name="([^"]+)">([\s\S]*?)<\/select>/g, (tag, key, options) => fields[key] === undefined ? tag
      : `<select name="${key}">${options.replace(/<option([^>]*)>([^<]*)<\/option>/g, (option: string, attrs: string, text: string) => {
        const value = /value="([^"]*)"/.exec(attrs)?.[1] ?? text;
        return `<option${attrs}${value === escapeAttribute(fields[key]) ? " selected" : ""}>${text}</option>`;
      })}</select>`);
}
class HeadlessApplication {
  element: any = null;
  async render(): Promise<this> { const app = this as any; const c = await app._prepareContext(); this.element = { innerHTML: app._renderHTML(c) }; return this; }
  async close(): Promise<void> { this.element = null; }
}
const BaseApp = (globalThis as any).foundry?.applications?.api?.ApplicationV2 ?? HeadlessApplication;
export class DiplomacyApplication extends BaseApp {
  static DEFAULT_OPTIONS = { id: "domain-manager-diplomacy", classes: ["domain-manager", "dm-diplomacy-app"], tag: "div",
    window: { title: "Diplomacia e território", icon: "fas fa-handshake", resizable: true }, position: { width: 1050, height: 720 } };
  readonly controller: DiplomacyApplicationController; readonly #bound = new WeakSet<object>();
  constructor(options: { api: PublicDiplomacyApi }) { super(options); this.controller = new DiplomacyApplicationController(options.api); }
  async _prepareContext(): Promise<unknown> { await this.controller.load(); return {}; }
  _renderHTML(): string { return `<style>.dm-diplomacy-app .dm-diplomacy-columns{display:grid;grid-template-columns:240px 1fr;gap:16px}.dm-diplomacy-app aside button,.dm-diplomacy-app label{display:block;margin:6px 0}.dm-diplomacy-app table{width:100%;text-align:left;border-collapse:collapse}.dm-diplomacy-app td,.dm-diplomacy-app th{padding:6px;border-bottom:1px solid #7775}.dm-diplomacy-app input,.dm-diplomacy-app textarea{max-width:100%}.dm-diplomacy-app pre{white-space:pre-wrap;overflow-wrap:anywhere}.dm-diplomacy-app [role=alert]{color:#b3261e}.dm-diplomacy-app .dm-agreement-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}.dm-diplomacy-app .dm-agreement-summary strong{display:block;font-size:1.4em}.dm-diplomacy-app .dm-agreement-summary [aria-pressed=true]{outline:2px solid currentColor}.dm-diplomacy-app .dm-reputation-history-table{overflow-x:auto;max-width:100%}.dm-diplomacy-app .dm-reputation-history-table td{overflow-wrap:anywhere}.dm-diplomacy-app .dm-territory-claims-table{overflow-x:auto;max-width:100%}.dm-diplomacy-app .dm-territory-claims-table small{display:block;overflow-wrap:anywhere}.dm-diplomacy-app main{min-width:0}</style>${this.controller.render()}`; }
  _replaceHTML(html: string, content: HTMLElement): void { content.innerHTML = html; }
  _onRender(): void { const element = this.element; if (!element || this.#bound.has(element)) return; this.#bound.add(element);
    const fields = (form: HTMLFormElement): Record<string, string> => { const result: Record<string, string> = {}; new FormData(form).forEach((v, k) => { result[k] = form.dataset.dmForm === "agreement-terms" ? String(v) : String(v).trim(); }); if (form.dataset.dmForm?.startsWith("territory-influence")) form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => { if (!input.checked) result[input.name] = ""; });
      if (form.dataset.dmForm === "territory-occupation" || form.dataset.dmForm === "review" && result.occupationReview === "on") {
        for (const key of ["occupationPresenceIds", "occupationControlIds"]) result[key] = JSON.stringify(new FormData(form).getAll(key).map(String));
      }
      return result; };
    element.addEventListener("input", (e: Event) => {
      const form = (e.target as HTMLElement)?.closest?.('form') as HTMLFormElement | null;
      if (!form) return;
      if (form.dataset.dmForm === "territory-occupation") this.controller.occupationDraft = fields(form);
      else if (form.dataset.dmForm === "territory-occupation-end") this.controller.occupationEndDraft = fields(form);
      else if (form.dataset.dmForm === "review" && form.querySelector?.('[name="occupationReview"]')) this.controller.occupationReviewFields = fields(form);
      else if (form.dataset.dmForm?.startsWith("territory-influence")) {
        const f = fields(form), kind = form.dataset.dmForm === "territory-influence" ? "influence" : form.dataset.dmForm === "territory-influence-modifier" ? "add-influence-modifier" : f.endKind || "end-influence-modifier";
        this.controller.influenceDrafts[kind.startsWith("end-influence") ? "end-influence" : kind] = f;
      }
      else if (form.dataset.dmForm === "territory-link") this.controller.territoryLinkFields = fields(form);
      else if (form.dataset.dmForm === "territory-link-status") this.controller.territoryLinkStatusFields = fields(form);
      else if (form.dataset.dmForm === "review" && form.querySelector('[name="linkReview"]')) this.controller.linkReviewFields = fields(form);
      else if (form.dataset.dmForm === "agreement-terms") {
        this.controller.updateAgreementTermEditor(fields(form));
        const preview = element.querySelector?.("[data-dm-term-preview-result]");
        if (preview) preview.textContent = "Os campos mudaram. Confira novamente a prévia antes de enviar.";
      }
    });
    element.addEventListener("change", async (e: Event) => {
      const influenceSelect = e.target as HTMLSelectElement;
      if (influenceSelect.dataset.dmInfluenceTarget) { const form = influenceSelect.closest("form")!; const f = fields(form); const kind = form.dataset.dmForm === "territory-influence-modifier" ? "add-influence-modifier" : f.endKind || "end-influence-modifier"; this.controller.influenceDrafts[kind.startsWith("end-influence") ? "end-influence" : kind] = f; await this.render(true); return; }

      const select = e.target as HTMLSelectElement, form = select.closest?.('form[data-dm-form="agreement-terms"]') as HTMLFormElement | null;
      if (form && select.dataset.dmTermType !== undefined) {
        this.controller.changeAgreementTermType(Number(select.dataset.dmTermType), fields(form)); await this.render(true);
      }
    });
    element.addEventListener("click", async (e: Event) => { const button = (e.target as HTMLElement)?.closest?.("button"); if (!button) return;
      if (button.dataset.dmReputationAdd) this.controller.addReputationTrackForm(fields(button.closest("form")!));
      else if (button.dataset.dmReputationRemove !== undefined) this.controller.removeReputationTrackForm(Number(button.dataset.dmReputationRemove), fields(button.closest("form")!));
      else if (button.dataset.dmReputationHistoryClear) this.controller.applyReputationHistory(reputationHistoryFields());
      else if (button.dataset.dmReputationSourceTrack !== undefined) this.controller.filterReputationSource(button.dataset.dmReputationSourceTrack,
        button.dataset.dmReputationSourceType!, button.dataset.dmReputationSourceKind!, button.dataset.dmReputationSourceRef!);
      else if (button.dataset.dmReputationSourcePage) this.controller.reputationSourceOffset = Math.max(0, this.controller.reputationSourceOffset + Number(button.dataset.dmReputationSourcePage) * 30);
      else if (button.dataset.dmLinkReset) this.controller.resetLinkDrafts();
      else if (button.dataset.dmLinkPage) this.controller.linkDestinationOffset = Math.max(0, this.controller.linkDestinationOffset + Number(button.dataset.dmLinkPage) * 30);
      else if (button.dataset.dmRecognitionReset) this.controller.resetRecognitionDraft();
      else if (button.dataset.dmTermOpen) this.controller.openAgreementTermEditor(button.dataset.dmTermOpen as AgreementTermEditorKind, button.dataset.dmTermSource);
      else if (button.dataset.dmTermAdd) this.controller.addAgreementTerm(fields(button.closest("form")!));
      else if (button.dataset.dmTermRemove !== undefined) this.controller.removeAgreementTerm(Number(button.dataset.dmTermRemove), fields(button.closest("form")!));
      else if (button.dataset.dmTermMove !== undefined) this.controller.moveAgreementTerm(Number(button.dataset.dmTermMove), Number(button.dataset.dmTermDirection), fields(button.closest("form")!));
      else if (button.dataset.dmTermPreview) this.controller.previewAgreementTerms(fields(button.closest("form")!));
      else if (button.dataset.dmTermCancel) this.controller.cancelAgreementTermEditor();
      else if (button.dataset.dmObligation) this.controller.selectAgreementObligation(button.dataset.dmObligation);
      else if (button.dataset.dmOverviewFilter !== undefined) this.controller.applyOverviewFilter(button.dataset.dmOverviewFilter);
      else if (button.dataset.dmOverviewTab) this.controller.openOverviewItem(button.dataset.dmOverviewTab, button.dataset.dmOverviewId);
      else if (button.dataset.dmTab) this.controller.selectTab(button.dataset.dmTab as DiplomacyTab);
      else if (button.dataset.dmAgreementState !== undefined) this.controller.selectAgreementLifecycle(button.dataset.dmAgreementState);
      else if (button.dataset.dmId) this.controller.select(button.dataset.dmId);
      else if (button.dataset.dmPage) this.controller.offset = Math.max(0, this.controller.offset + Number(button.dataset.dmPage) * 30);
      else if (button.dataset.dmHistory) this.controller.historyOffset = Math.max(0, this.controller.historyOffset + Number(button.dataset.dmHistory) * 30);
      else if (button.dataset.dmClaimOrigin) this.controller.openClaimOrigin(button.dataset.dmClaimOrigin);
      else if (button.dataset.dmOccupationReviewReset) this.controller.resetOccupationReviewReferences(fields(button.closest("form")!));
      else if (button.dataset.dmOccupationReset) this.controller.resetOccupationDrafts();
      else if (button.dataset.dmInfluenceReset) this.controller.resetInfluenceDrafts();
      else if (button.dataset.dmInfluenceRows) {
        const f = fields(button.closest("form")!), result = editInfluenceRows(f, button.dataset.dmInfluenceRows as any, button.dataset.dmInfluenceOperation as any, Number(button.dataset.dmInfluenceIndex ?? -1));
        if (result.ok) this.controller.influenceDrafts.influence = result.value;
      }
      else if (button.dataset.dmCreate) this.controller.creating = true;
      else if (button.dataset.dmTree) { this.controller.treeAxis = button.dataset.dmTree === "all" ? null : button.dataset.dmTree as any; this.controller.treeParent = null; this.controller.offset = 0; }
      else if (button.dataset.dmRoot) { this.controller.treeParent = null; this.controller.offset = 0; }
      else if (button.dataset.dmChildren) { this.controller.treeParent = button.dataset.dmChildren; this.controller.offset = 0; }
      else if (button.dataset.dmPreview) await this.controller.change(fields(button.closest("form")!), true);
      else return;
      await this.render(true);
    });
    element.addEventListener("submit", async (e: SubmitEvent) => { const form = e.target as HTMLFormElement; if (!form.dataset.dmForm) return; e.preventDefault(); const data = fields(form);
      if (form.dataset.dmForm === "search") this.controller.setSearch(data.search);
      else if (form.dataset.dmForm === "overview-filter") this.controller.applyOverviewFilter(data.filter, data.expiryHorizonTicks?.trim() ? Number(data.expiryHorizonTicks) : NaN, data.recentHours?.trim() ? Number(data.recentHours) : NaN);
      else if (form.dataset.dmForm === "agreement-state") this.controller.selectAgreementLifecycle(data.agreementLifecycle);
      else if (form.dataset.dmForm === "create") await this.controller.create(data);
      else if (form.dataset.dmForm === "link-destinations") this.controller.applyDestinationSearch(data.destinationSearch);
      else if (form.dataset.dmForm === "territory-link") await this.controller.submitLink(data);
      else if (form.dataset.dmForm === "territory-link-status") await this.controller.submitLink(data, true);
      else if (form.dataset.dmForm === "claim-inheritance") this.controller.applyClaimInheritanceAxis(data.claimInheritanceAxis);
      else if (form.dataset.dmForm === "territory-occupation") await this.controller.submitOccupation(data);
      else if (form.dataset.dmForm === "territory-occupation-end") await this.controller.submitOccupation(data, true);
      else if (form.dataset.dmForm?.startsWith("territory-influence")) await this.controller.submitInfluence(data, form.dataset.dmForm === "territory-influence" ? "influence" : form.dataset.dmForm === "territory-influence-modifier" ? "add-influence-modifier" : data.endKind || "end-influence-modifier");
      else if (form.dataset.dmForm === "territory-recognition") await this.controller.submitRecognition(data);
      else if (form.dataset.dmForm === "reputation-add-track") await this.controller.configureReputationTrack(data, false);
      else if (form.dataset.dmForm === "reputation-configure") await this.controller.configureReputationTrack(data, true);
      else if (form.dataset.dmForm === "reputation-history") this.controller.applyReputationHistory(data);
      else if (form.dataset.dmForm === "change" || form.dataset.dmForm === "agreement-expire-proposal" || form.dataset.dmForm === "agreement-terms") await this.controller.change(data);
      else if (form.dataset.dmForm === "review") await this.controller.review((e.submitter as HTMLButtonElement).value as any, data.reason, data);
      await this.render(true);
    });
  }
}
