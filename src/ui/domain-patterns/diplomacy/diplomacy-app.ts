import type { PublicDiplomacyApi, PublicDiplomacyOwnerApi } from "../../../diplomacy/public-diplomacy-api.js";
import { createDiplomacyDraft } from "../../../diplomacy/diplomacy-drafts.js";
import type { OwnerIntent } from "../../../diplomacy/owner-commands.js";
import type { RelationPartyRef } from "../../../relations/types/relation-types.js";
import { failure } from "../../../core/validation/value-validation.js";
import { ok, type Result } from "../../../core/contracts/result.js";
import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
export type DiplomacyTab = "relations" | "reputation" | "agreements" | "territory" | "disputes" | "proposals";
const labels: Record<DiplomacyTab, string> = { relations: "Relações", reputation: "Reputação", agreements: "Acordos", territory: "Território", disputes: "Disputas", proposals: "Propostas" };
const kinds: Record<Exclude<DiplomacyTab, "proposals">, OwnerIntent["kind"]> = { relations: "relation", reputation: "reputation", agreements: "agreement", territory: "territory", disputes: "dispute" };
const actions: Record<Exclude<DiplomacyTab, "proposals">, readonly [string, string][]> = {
  relations: [["incident", "Registrar incidente / reversão"], ["modifier", "Adicionar modificador temporário"], ["end-modifier", "Encerrar modificador"], ["end", "Encerrar relação"]],
  reputation: [["adjust", "Ajustar reputação"], ["decay", "Aplicar decadência configurada"]],
  agreements: [["propose", "Propor termos"], ["amend", "Propor emenda"], ["counter", "Contrapropor termos"], ["accept", "Aceitar proposta de termos"], ["reject", "Rejeitar termos"], ["activate", "Ativar termos aceitos"], ["suspend", "Suspender"], ["resume", "Retomar"], ["breach", "Registrar quebra"], ["expire", "Expirar"], ["terminate", "Encerrar"], ["obligation:evidence", "Adicionar evidência"], ["obligation:allege", "Alegar descumprimento"], ["obligation:contest", "Contestar alegação"], ["obligation:decide", "Decidir obrigação"]],
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
  list: any = null; detail: any = null; error = ""; creating = false; preview: any = null;
  #previewInput: string | null = null; #previewIntent: OwnerIntent | null = null;
  treeAxis: "locatedInUuid" | "administrativeParentUuid" | null = null; treeParent: string | null = null;
  constructor(readonly api: PublicDiplomacyApi) {}
  selectTab(tab: DiplomacyTab): void { this.tab = tab; this.offset = 0; this.selectedId = null; this.detail = null; this.historyOffset = 0; this.creating = false; this.preview = null; }
  select(id: string): void { this.selectedId = id; this.historyOffset = 0; this.creating = false; this.preview = null; }
  async load(): Promise<Result<unknown>> {
    const queried = await this.api[this.tab].query({ offset: this.offset, limit: 30, search: this.search,
      ...(this.tab === "territory" && this.treeAxis ? { treeAxis: this.treeAxis, parentUuid: this.treeParent } : {}) });
    if (!queried.ok) { this.error = queried.error.message; return queried; } this.list = queried.value;
    if (this.selectedId) { const detail = await this.api[this.tab].query({ id: this.selectedId, historyOffset: this.historyOffset, historyLimit: 30 });
      if (!detail.ok) { this.error = detail.error.message; this.detail = null; return detail; } this.detail = detail.value; }
    return ok(this.list);
  }
  async create(fields: Record<string, string>): Promise<Result<unknown>> {
    if (this.tab === "proposals") return failure("DM_DIPLOMACY_INTENT_INVALID", "Selecione o tipo de registro para criar uma proposta.");
    const parties = [fields.subject, fields.audience, ...fields.additionalParties?.split(",") ?? []].filter(Boolean).map(x => party(x.trim())), draft = createDiplomacyDraft(kinds[this.tab], fields.label, parties,
      fields.visibility as any, fields.territories?.split(",").map(x => x.trim()).filter(Boolean));
    const intent: OwnerIntent = { kind: kinds[this.tab], mode: "create", id: draft.id, data: draft.data, reason: fields.reason };
    const result = this.list?.isGm ? await (this.api[this.tab] as PublicDiplomacyOwnerApi).create({ id: draft.id, data: draft.data, reason: fields.reason })
      : await this.api.proposals.submit({ id: crypto.randomUUID(), intent });
    this.capture(result); if (result.ok) { this.creating = false; if (this.list?.isGm) this.select(draft.id); } return result;
  }
  buildAction(f: Record<string, string>): Result<unknown> {
    if (!this.detail || this.tab === "proposals") return failure("DM_DIPLOMACY_INTENT_INVALID", "Selecione um registro.");
    const n = Number(f.amount), kind = f.kind, d = this.detail;
    if (["incident", "modifier", "adjust", "presence"].includes(kind) && (!f.amount || !Number.isSafeInteger(n))) return failure("DM_DIPLOMACY_INTENT_INVALID", "Informe uma quantidade inteira.");
    if (this.tab === "relations") {
      const selector = { axisId: f.axis, fromPartyId: f.from || null, toPartyId: f.to || null };
      return ok(kind === "incident" ? { kind, deltas: [{ ...selector, value: n }], ...(f.reversalOf ? { reversalOf: f.reversalOf } : {}) }
        : kind === "modifier" ? { kind, value: { ...selector, value: n, id: crypto.randomUUID(), source: { type: "manual", id: "gm-input" },
          visibility: f.visibility, lifecycle: "active", createdAt: 0, expiresAt: null, expiresAtWorldTick: f.expires ? Number(f.expires) : null,
          stackKey: "domain-manager:temporary", stacking: "add" } } : kind === "end-modifier" ? { kind, id: f.sourceId } : { kind });
    }
    if (this.tab === "reputation") return ok({ kind, trackId: f.axis, delta: n, ...(f.reversalOf ? { reversalOf: f.reversalOf } : {}) });
    if (this.tab === "agreements") {
      const p = d.proposals?.find((x: any) => x.id === f.sourceId) ?? d.proposals?.at(-1);
      if (kind.startsWith("obligation:")) {
        const o = d.obligations?.find((x: any) => x.id === f.obligationId), nested = kind.slice(11);
        return ok({ kind: "obligation", obligationId: o?.id, expectedObligationRevision: o?.revision,
          action: nested === "evidence" ? { kind: nested, evidence: { id: crypto.randomUUID(), ref: { type: "evidence", id: f.outcome }, statement: f.text,
            position: f.position || "support", visibility: f.visibility, at: 0 } } : nested === "decide" ? { kind: nested, lifecycle: f.lifecycle } : { kind: nested },
          applyConsequences: f.applyConsequences === "on" });
      }
      if (["propose", "amend", "counter"].includes(kind)) {
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
        return ok({ kind, proposalId: kind === "counter" ? p?.id : crypto.randomUUID(), ...(kind === "counter" ? { expectedProposalRevision: p?.revision } : { proposalExpiresAtWorldTick: null }), partyId: f.partyId,
          terms: [{ id: crypto.randomUUID(), type: `domain-manager:${type}`, title: f.title, text: f.text || null, visibility: f.visibility,
            partyIds: d.parties.map((p: any) => p.id), payload }], duration: { startsAtWorldTick: null, expiresAtWorldTick: f.expires ? Number(f.expires) : null } });
      }
      if (["accept", "reject", "activate"].includes(kind)) return ok({ kind, proposalId: p?.id, expectedProposalRevision: p?.revision, ...(kind !== "activate" ? { partyId: f.partyId } : { amendmentId: crypto.randomUUID() }) });
      return ok({ kind });
    }
    if (this.tab === "disputes") return ok({ kind, lifecycle: f.lifecycle, outcomeRef: f.outcome ? { type: "manual-outcome", id: f.outcome } : null });
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
  async change(fields: Record<string, string>, previewOnly = false): Promise<Result<unknown>> {
    const built = this.buildAction(fields); if (!built.ok) { this.capture(built); return built; }
    let intent: OwnerIntent = { kind: kinds[this.tab as Exclude<DiplomacyTab, "proposals">], mode: "modify", id: this.detail.id,
      expectedRevision: this.detail.revision, action: built.value, reason: fields.reason };
    if (previewOnly) { const result = await this.api.previewTerritory(intent as any); this.capture(result);
      if (result.ok) { this.preview = result.value; this.#previewInput = JSON.stringify(fields); this.#previewIntent = intent; } else this.preview = null; return result; }
    if (this.tab === "territory" && ["transfer", "reparent"].includes(fields.kind) && this.list?.isGm
      && (!this.preview || this.#previewInput !== JSON.stringify(fields) || this.#previewIntent?.expectedRevision !== this.detail.revision))
      return this.capture(failure("DM_DIPLOMACY_PREVIEW_REQUIRED", "Confira a prévia antes de confirmar a alteração territorial."));
    if (this.preview && this.#previewIntent && this.#previewInput === JSON.stringify(fields)) intent = this.#previewIntent;
    const result = this.list?.isGm ? await (this.api[this.tab] as PublicDiplomacyOwnerApi).modify(intent as any)
      : await this.api.proposals.submit({ id: crypto.randomUUID(), intent });
    this.capture(result); if (result.ok) this.preview = null; return result;
  }
  async review(decision: "approve" | "reject", reason: string, fields: Record<string, string> = {}): Promise<Result<unknown>> {
    let editedIntent: OwnerIntent | undefined;
    if (decision === "approve" && (fields.amount || fields.targetRevision)) {
      editedIntent = structuredClone(this.detail.original);
      const action = editedIntent!.action as any;
      if (fields.amount) {
        const delta = Number(fields.amount); if (!Number.isSafeInteger(delta)) return this.capture(failure("DM_DIPLOMACY_INTENT_INVALID", "A alteração deve ser inteira."));
        if (action?.kind === "incident" && action.deltas?.length === 1) action.deltas[0].value = delta;
        else if (action?.kind === "adjust") action.delta = delta;
        else return this.capture(failure("DM_DIPLOMACY_INTENT_INVALID", "Este pedido exige revisão pela API semântica."));
      }
      if (fields.targetRevision) editedIntent = { ...editedIntent!, expectedRevision: Number(fields.targetRevision) };
    }
    const result = await this.api.proposals.decide({ id: this.detail.id, expectedRevision: this.detail.revision, decision, reason, ...(editedIntent ? { editedIntent } : {}) }); this.capture(result); return result;
  }
  capture<T>(result: Result<T>): Result<T> { this.error = result.ok ? "" : result.error.message; return result; }
  render(): string {
    const tabs = Object.entries(labels).map(([key, name]) => `<button type="button" data-dm-tab="${key}" aria-pressed="${this.tab === key}">${name}</button>`).join("");
    const list = (this.list?.items ?? []).map((r: any) => `<button type="button" data-dm-id="${escapeAttribute(r.id)}">${escapeHtml(r.label)} <small>${escapeHtml(r.lifecycle)}</small></button>`).join("");
    return `<div class="dm-diplomacy"><nav>${tabs}</nav><p>Resumo → explicação → detalhes → ação. As alterações são confirmadas pela autoridade do mundo.</p>
      ${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<form data-dm-form="search"><input name="search" aria-label="Pesquisar" value="${escapeAttribute(this.search)}"><button>Pesquisar</button></form>
      ${this.tab === "territory" ? `<nav><button type="button" data-dm-tree="all">Lista</button><button type="button" data-dm-tree="locatedInUuid">Árvore física</button><button type="button" data-dm-tree="administrativeParentUuid">Árvore administrativa</button><button type="button" data-dm-root="true">Raízes</button></nav><p>Ramo atual: ${escapeHtml(this.treeParent ?? "raízes / lista")}</p>` : ""}
      <div class="dm-diplomacy-columns"><aside><p>${this.list?.total ?? 0} registros visíveis</p>${list || "<p>Nenhum registro.</p>"}
      <button type="button" data-dm-page="-1" ${this.offset === 0 ? "disabled" : ""}>Anterior</button><button type="button" data-dm-page="1" ${this.offset + 30 >= (this.list?.total ?? 0) ? "disabled" : ""}>Próxima</button>
      ${this.tab !== "proposals" ? '<button type="button" data-dm-create="true">Novo registro</button>' : ""}</aside><main>${this.creating ? this.createForm() : this.detail ? this.inspector() : "<p>Selecione um registro para ver a explicação e o histórico.</p>"}</main></div></div>`;
  }
  createForm(): string {
    const input = (name: string, label: string, required = true) => `<label>${label}<input name="${name}" ${required ? "required" : ""}></label>`;
    return `<h2>Novo registro: ${labels[this.tab]}</h2><form data-dm-form="create">${input("label", "Nome")}${this.tab !== "territory" ? input("subject", "Parte / sujeito (UUID de Domínio ou Actor; nome para parte narrativa)") + input("audience", "Outra parte / audiência") : ""}
      ${this.tab !== "reputation" && this.tab !== "territory" ? input("additionalParties", "Outras partes, separadas por vírgula (opcional)", false) : ""}
      ${this.tab === "disputes" ? input("territories", "UUIDs dos territórios, separados por vírgula") : ""}${this.visibilityField()}${input("reason", "Motivo auditável")}
      <button>${this.list?.isGm ? "Criar registro" : "Enviar proposta ao GM"}</button></form>`;
  }
  visibilityField(): string { return '<label>Visibilidade<select name="visibility"><option value="public">Pública</option><option value="restricted">Participantes</option><option value="secret">GM</option></select></label>'; }
  inspector(): string {
    const d = this.detail; let blocks = `<h2>${escapeHtml(d.label ?? d.id)}</h2><p>Estado: ${escapeHtml(d.lifecycle ?? "active")} · revisão ${d.revision}</p>`;
    const columns: readonly [string, (x: any) => unknown][] = [["Parte", x => refLabel(x.ref ?? x.partyRef ?? x.claimantRef ?? x.beneficiaryRef ?? x)], ["Papel", x => x.role ?? x.claimType ?? x.rightType ?? "—"]];
    if (d.parties) blocks += table("Participantes", d.parties, columns);
    if (d.scores) blocks += table("Eixos", d.scores, [["Eixo", x => x.axisId], ["Base", x => x.base], ["Efetivo", x => x.effective]]);
    if (d.tracks) blocks += table("Reputação", d.tracks, [["Trilha", x => x.label ?? x.definitionId], ["Faixa / valor", x => x.band?.label ?? x.band ?? x.bandLabel ?? x.score ?? x.value ?? x.presentation]]);
    if (d.terms) blocks += table("Termos vigentes", d.terms, [["Termo", x => x.title], ["Descrição", x => x.text]]);
    if (d.proposals) blocks += table("Rodadas de termos", d.proposals, [["Proposta", x => x.id], ["Estado", x => x.lifecycle], ["Revisão", x => x.revision]]);
    if (d.obligations) blocks += table("Obrigações", d.obligations, [["Obrigação", x => x.id], ["Estado", x => x.lifecycle], ["Contestada", x => x.contested ? "Sim" : "Não"]]);
    if (d.territory) { blocks += `<p>Propriedade, administração, controle e presença possuem registros independentes. Transferências preservam as reivindicações concorrentes.</p>
      <p>Localização: ${escapeHtml(d.territory.locatedInUuid ?? "raiz")} · hierarquia administrativa: ${escapeHtml(d.territory.administrativeParentUuid ?? "raiz")}</p>`;
      if (this.treeAxis) blocks += `<button type="button" data-dm-children="${escapeAttribute(d.id)}">Abrir filhos neste ramo</button>`;
      for (const [key, name] of [["claims", "Reivindicações"], ["presence", "Presença"], ["rights", "Direitos"], ["occupations", "Ocupações"]]) blocks += table(name, d[key] ?? [], [...columns, ["Estado", x => x.lifecycle ?? (x.active ? "active" : "inactive")]]);
      blocks += table("Influência efetiva", d.effectiveInfluence ?? [], [["Parte", x => refLabel(x.partyRef)], ["Eixo", x => x.axisId], ["Valor", x => x.value]]);
      blocks += table("Ligações", d.links ?? [], [["Destino", x => x.targetTerritoryUuid], ["Direção", x => x.direction], ["Estado", x => x.status]]);
    }
    if (this.tab === "proposals") {
      blocks += `<h3>Pedido original</h3><p>${escapeHtml(d.original.kind)} · ${escapeHtml(d.original.mode)} · ${escapeHtml(d.original.id)}</p><p>${escapeHtml(d.original.reason)}</p>
        <p>Solicitante: ${escapeHtml(d.requesterUserId)}</p>${d.decision ? `<h3>Decisão</h3><p>${escapeHtml(d.decision.reason)} · ${escapeHtml(d.decision.reviewerUserId)}</p>` : ""}`;
      const a = d.original.action;
      if (a) blocks += `<p>Ação solicitada: ${escapeHtml(a.kind)} · revisão esperada: ${d.original.expectedRevision}</p>`
        + table("Alteração solicitada", a.deltas ?? (a.delta !== undefined ? [{ axisId: a.trackId, value: a.delta }] : []), [["Eixo", x => x.axisId], ["Alteração", x => x.value]]);
      if (d.decision?.approvedIntent) blocks += `<p>Ação aprovada: ${escapeHtml((d.decision.approvedIntent.action as any)?.kind ?? "create")} · revisão esperada: ${d.decision.approvedIntent.expectedRevision ?? "nova"}</p>`;
      if (this.list?.isGm && d.lifecycle === "pending") blocks += '<form data-dm-form="review"><label>Alteração revisada (incidente de um eixo ou ajuste de reputação; opcional)<input name="amount" type="number" step="1"></label><label>Revisão atual do alvo (se estiver aceitando uma mudança após outra edição; opcional)<input name="targetRevision" type="number" min="0" step="1"></label><label>Motivo<input name="reason" required></label><button name="decision" value="approve">Aprovar</button><button name="decision" value="reject">Rejeitar</button></form>';
      return blocks;
    }
    const history = d.history ?? d.entries ?? d.events ?? [];
    blocks += table("Histórico visível", history, [["Evento", x => x.kind], ["Explicação", x => x.reason ?? x.summary], ["Momento", x => x.at]]);
    blocks += `<button type="button" data-dm-history="-1" ${this.historyOffset === 0 ? "disabled" : ""}>Histórico anterior</button><button type="button" data-dm-history="1" ${history.length < 30 ? "disabled" : ""}>Próximo histórico</button>`;
    return blocks + this.actionForm();
  }
  actionForm(): string {
    const d = this.detail, input = (name: string, label: string) => `<label>${label}<input name="${name}"></label>`;
    const choices = actions[this.tab as Exclude<DiplomacyTab, "proposals">].map(([key, label]) => `<option value="${key}">${label}</option>`).join("");
    let fields = "";
    if (this.tab === "relations" || this.tab === "reputation") {
      const axes = d.definition?.axes?.map((x: any) => ({ id: x.id, label: x.label })) ?? d.scores?.map((x: any) => ({ id: x.axisId, label: x.axisId })) ?? d.tracks?.map((x: any) => ({ id: x.definitionId ?? x.trackId, label: x.label ?? x.definitionId ?? x.trackId })) ?? [];
      fields = `<label>Eixo / trilha<select name="axis">${axes.map((x: any) => `<option value="${escapeAttribute(x.id)}">${escapeHtml(x.label)}</option>`).join("")}</select></label>${input("amount", "Alteração inteira")}${input("reversalOf", "ID do evento original a compensar (opcional)")}`;
      if (this.tab === "relations") {
        if (d.scores.some((x: any) => x.fromPartyId !== null)) for (const [key, label] of [["from", "De"], ["to", "Para"]]) fields += `<label>${label}<select name="${key}">${d.parties.map((p: any) => `<option value="${escapeAttribute(p.id)}">${escapeHtml(refLabel(p.ref))}</option>`).join("")}</select></label>`;
        fields += `${this.visibilityField()}${input("expires", "Expiração do modificador no relógio do mundo")}${input("sourceId", "ID do modificador a encerrar")}`;
      }
    } else if (this.tab === "agreements") fields = `<label>Parte<select name="partyId">${d.parties.map((p: any) => `<option value="${escapeAttribute(p.id)}">${escapeHtml(refLabel(p.ref))}</option>`).join("")}</select></label>
      <label>Beneficiário<select name="beneficiaryPartyId">${d.parties.map((p: any) => `<option value="${escapeAttribute(p.id)}">${escapeHtml(refLabel(p.ref))}</option>`).join("")}</select></label>
      <label>Tipo de termo<select name="termType"><option value="narrative">Narrativo</option><option value="capability">Capacidade</option><option value="right">Direito territorial</option><option value="obligation">Obrigação</option><option value="owner-operation">Ajuste econômico na ativação</option></select></label>
      ${input("title", "Título do novo termo")}<label>Texto / evidência<textarea name="text"></textarea></label>${input("sourceId", "ID da proposta de termos (em branco usa a mais recente)")}${input("expires", "Expiração no relógio do mundo (opcional)")}${this.visibilityField()}
      ${input("grants", "Capacidades, separadas por vírgula")}${input("territories", "UUID do território do direito / escopo")}${input("rightType", "Tipo de direito (ex.: domain-manager:entry)")}<label><input type="checkbox" name="inherited">Direito herdável</label>
      ${input("beneficiary", "UUID do Domínio para ajuste econômico")}${input("resource", "Recurso econômico (ex.: domain-manager:treasury)")}${input("amount", "Ajuste econômico inteiro")}${input("due", "Vencimento da obrigação (relógio do mundo)")}${input("grace", "Tolerância em ticks")}<label><input type="checkbox" name="consequence">Declarar o ajuste como consequência da obrigação</label>
      <label>Obrigação<select name="obligationId">${(d.obligations ?? []).map((o: any) => `<option value="${escapeAttribute(o.id)}">${escapeHtml(o.id)} · ${escapeHtml(o.lifecycle)}</option>`).join("")}</select></label>
      <label>Decisão de obrigação<select name="lifecycle">${["satisfied", "waived", "breached", "expired", "cancelled"].map(x => `<option>${x}</option>`).join("")}</select></label>${input("outcome", "Referência da evidência")}<label>Posição<select name="position"><option value="support">Apoia</option><option value="contest">Contesta</option></select></label><label><input type="checkbox" name="applyConsequences">Executar consequências declaradas ao confirmar quebra</label>`;
    else if (this.tab === "territory") fields = `${input("beneficiary", "Parte / beneficiário (UUID ou nome narrativo)")}${input("sourceId", "ID da reivindicação ou direito existente")}
      <label>Tipo de reivindicação<select name="claimType"><option value="domain-manager:ownership">Propriedade</option><option value="domain-manager:administration">Administração</option><option value="domain-manager:control">Controle</option></select></label>
      <label>Direito<select name="rightType">${["entry", "trade", "transit", "build", "extract"].map(x => `<option value="domain-manager:${x}">${x}</option>`).join("")}</select></label>${input("amount", "Quantidade de presença")}${input("grants", "Capacidades concedidas, separadas por vírgula")}
      <label><input type="checkbox" name="inherited">Herdar direito pela localização</label>${input("starts", "Início no relógio do mundo (para transferência: momento atual)")}${input("expires", "Expiração (opcional)")}${this.visibilityField()}
      ${input("physical", "UUID do novo pai físico (em branco: raiz)")}${input("administrative", "UUID do novo pai administrativo (em branco: raiz)")}`;
    else fields = `<label>Decisão<select name="lifecycle">${["latent", "active", "escalated", "frozen", "settled", "abandoned", "superseded"].map(x => `<option>${x}</option>`).join("")}</select></label>${input("outcome", "Referência do resultado explícito do GM")}`;
    return `<h3>${this.list?.isGm ? "Ação" : "Propor mudança ao GM"}</h3><form data-dm-form="change"><label>Operação<select name="kind">${choices}</select></label>${fields}<label>Motivo<input name="reason" required></label>
      ${this.tab === "territory" && this.list?.isGm ? '<button type="button" data-dm-preview="true">Conferir prévia</button>' : ""}<button>${this.list?.isGm ? "Confirmar ação" : "Enviar proposta"}</button></form>
      ${this.preview ? `<p role="status">Prévia validada: ${this.preview.changes.length} território(s). Nenhuma propriedade de instalação será alterada.</p>` : ""}`;
  }
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
  _renderHTML(): string { return `<style>.dm-diplomacy-app .dm-diplomacy-columns{display:grid;grid-template-columns:240px 1fr;gap:16px}.dm-diplomacy-app aside button,.dm-diplomacy-app label{display:block;margin:6px 0}.dm-diplomacy-app table{width:100%;text-align:left;border-collapse:collapse}.dm-diplomacy-app td,.dm-diplomacy-app th{padding:6px;border-bottom:1px solid #7775}.dm-diplomacy-app input,.dm-diplomacy-app textarea{max-width:100%}.dm-diplomacy-app [role=alert]{color:#b3261e}</style>${this.controller.render()}`; }
  _replaceHTML(html: string, content: HTMLElement): void { content.innerHTML = html; }
  _onRender(): void { const element = this.element; if (!element || this.#bound.has(element)) return; this.#bound.add(element);
    const fields = (form: HTMLFormElement): Record<string, string> => { const result: Record<string, string> = {}; new FormData(form).forEach((v, k) => { result[k] = String(v).trim(); }); return result; };
    element.addEventListener("click", async (e: Event) => { const button = (e.target as HTMLElement)?.closest?.("button"); if (!button) return;
      if (button.dataset.dmTab) this.controller.selectTab(button.dataset.dmTab as DiplomacyTab);
      else if (button.dataset.dmId) this.controller.select(button.dataset.dmId);
      else if (button.dataset.dmPage) this.controller.offset = Math.max(0, this.controller.offset + Number(button.dataset.dmPage) * 30);
      else if (button.dataset.dmHistory) this.controller.historyOffset = Math.max(0, this.controller.historyOffset + Number(button.dataset.dmHistory) * 30);
      else if (button.dataset.dmCreate) this.controller.creating = true;
      else if (button.dataset.dmTree) { this.controller.treeAxis = button.dataset.dmTree === "all" ? null : button.dataset.dmTree as any; this.controller.treeParent = null; this.controller.offset = 0; }
      else if (button.dataset.dmRoot) { this.controller.treeParent = null; this.controller.offset = 0; }
      else if (button.dataset.dmChildren) { this.controller.treeParent = button.dataset.dmChildren; this.controller.offset = 0; }
      else if (button.dataset.dmPreview) await this.controller.change(fields(button.closest("form")!), true);
      else return;
      await this.render(true);
    });
    element.addEventListener("submit", async (e: SubmitEvent) => { const form = e.target as HTMLFormElement; if (!form.dataset.dmForm) return; e.preventDefault(); const data = fields(form);
      if (form.dataset.dmForm === "search") { this.controller.search = data.search; this.controller.offset = 0; }
      else if (form.dataset.dmForm === "create") await this.controller.create(data);
      else if (form.dataset.dmForm === "change") await this.controller.change(data);
      else if (form.dataset.dmForm === "review") await this.controller.review((e.submitter as HTMLButtonElement).value as any, data.reason, data);
      await this.render(true);
    });
  }
}
