import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
import type { AgreementObligationInspector } from "../../../agreements/agreement-obligation-inspector.js";
import type { ObligationTermPayload } from "../../../agreements/agreement-obligations.js";
import type { AgreementAmendment, AgreementDuration } from "../../../agreements/agreement-model.js";
import type { AgreementNegotiationDifference } from "../../../agreements/agreement-negotiation.js";
import type { TypedRef } from "../../../core/identity/refs.js";
import { renderAgreementDifference, renderAgreementTerm } from "./agreement-negotiation-view.js";
const lifecycle: Record<string, string> = { pending: "Pendente", due: "Vencida", satisfied: "Cumprida", waived: "Dispensada", breached: "Descumprimento confirmado", expired: "Expirada", cancelled: "Cancelada" };
const ref = (r: TypedRef): string => `${r.type}: ${r.uuid ?? r.id}`;
const yes = (v: boolean): string => v ? "Sim" : "Não";
function table(headers: readonly string[], rows: readonly (readonly unknown[])[], empty: string): string {
  return rows.length ? `<table><thead><tr>${headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(row => `<tr>${row.map(x => `<td>${escapeHtml(String(x ?? "—"))}</td>`).join("")}</tr>`).join("")}</tbody></table>` : `<p>${escapeHtml(empty)}</p>`;
}
export function renderAgreementObligations(obligations: readonly AgreementObligationInspector[], parties: readonly { id: string; ref: TypedRef }[],
  worldTick: number, isGm: boolean): string {
  const party = (id: string | null): string => id === null ? "Não declarado" : (() => { const p = parties.find(x => x.id === id); return p?.ref?.uuid ?? p?.ref?.id ?? id; })();
  return `<section><h3>Obrigações e cumprimento</h3><p>Consulta no tick ${worldTick}. Vencimento e tolerância não confirmam descumprimento nem encerram o acordo.</p>
    ${obligations.length ? obligations.map(o => {
      const t = o.termSnapshot, p = t.payload as unknown as ObligationTermPayload, c = o.compliance, deadline = o.deadline;
      const terminal = ["satisfied", "waived", "expired", "cancelled"].includes(o.lifecycle);
      return `<details><summary>${escapeHtml(t.title)} · ${escapeHtml(lifecycle[c.lifecycle] ?? c.lifecycle)} · ${c.applicable ? "Vigente no acordo" : "Histórica"}</summary>
        <p>Estado registrado: ${escapeHtml(lifecycle[o.lifecycle] ?? o.lifecycle)}; estado consultado: ${escapeHtml(lifecycle[c.lifecycle] ?? c.lifecycle)}; revisão ${o.revision}.</p>
        <p>Responsável: ${escapeHtml(party(p.obligatedPartyId as string))}; beneficiário: ${escapeHtml(party(p.beneficiaryPartyId as string | null))}.</p>
        <p>Vencimento: ${deadline.dueAtWorldTick ?? "Sem prazo"}; tolerância: ${deadline.graceTicks} ticks; fim da tolerância (inclusive): ${deadline.graceEndsAtWorldTick ?? "Sem prazo"}.</p>
        <p>${!c.applicable ? "Prazo histórico; não é aplicado aos termos atuais." : terminal ? "Obrigação encerrada por decisão registrada." : c.pastGrace ? "Tolerância ultrapassada." : c.lifecycle === "due" ? "Prazo atingido; dentro da tolerância." : "Prazo ainda não atingido ou não definido."}</p>
        <p>Alegação: ${yes(c.allegedBreach)}; descumprimento confirmado: ${yes(c.confirmedBreach)}; contestação: ${yes(c.contested)}.</p>
        <p>Política após tolerância: ${p.overduePolicy === "allege-breach" ? "Sinalizar alegação" : "Somente informar"}; requisito declarado: ${escapeHtml(ref(p.requirementRef as TypedRef))}.</p>
        <p>Fonte: ${escapeHtml(o.termsSource.kind === "amendment" ? "Emenda" : "Proposta ativada")} ${escapeHtml(o.termsSource.id)}; termo ${escapeHtml(o.termId)}.</p>
        <details><summary>Termo de origem preservado</summary>${renderAgreementTerm(t)}</details>
        <h4>Evidências declaradas</h4>${table(["Referência", "Declaração", "Posição", "Visibilidade", "Momento"], o.evidence.map(e => [ref(e.ref), e.statement, e.position === "contest" ? "Contesta" : "Apoia", e.visibility, e.at]), "Nenhuma evidência visível.")}
        <details><summary>Consequências declaradas</summary>${table(["Operação", "Owner", "Alvos"], (p.consequences as readonly { operation: string; ownerId: string; targetRefs: readonly TypedRef[] }[]).map(x => [x.operation, x.ownerId, x.targetRefs.map(ref).join(", ")]), "Nenhuma consequência declarada.")}</details>
        ${isGm ? `<h4>Histórico da obrigação</h4>${table(["Evento", "Antes", "Depois", "Motivo", "Tick", "Fontes"], o.events.map(e => [e.kind, lifecycle[e.before] ?? e.before, lifecycle[e.after] ?? e.after, e.reason, e.worldTick, e.sourceRefs.map(ref).join(", ")]), "Nenhum evento nesta página.")}` : ""}
        <button type="button" data-dm-obligation="${escapeAttribute(o.id)}">${isGm ? "Selecionar obrigação para ação" : "Selecionar obrigação para proposta ao GM"}</button>
      </details>`;
    }).join("") : "<p>Nenhuma obrigação visível.</p>"}</section>`;
}
type Amendment = AgreementAmendment & { readonly comparison: AgreementNegotiationDifference };
export function renderAgreementAmendments(amendments: readonly Amendment[], isGm: boolean): string {
  if (!isGm) return "";
  return `<section><h3>Histórico de emendas</h3>${amendments.length ? amendments.map(m => `<details><summary>${escapeHtml(m.id)} · aplicado em ${m.appliedAt}</summary>
    <p>Origem: ${m.proposalId === null ? "Emenda direta do GM" : "Proposta " + escapeHtml(m.proposalId)}.</p>
    <details><summary>Todos os termos antes</summary>${m.beforeTerms.map(renderAgreementTerm).join("") || "<p>Nenhum termo.</p>"}</details>
    <details><summary>Todos os termos depois</summary>${m.afterTerms.map(renderAgreementTerm).join("") || "<p>Nenhum termo.</p>"}</details>
    ${renderAgreementDifference(m.comparison, "Alterações aplicadas pela emenda")}</details>`).join("") : "<p>Nenhuma emenda nesta página.</p>"}</section>`;
}
export function renderAgreementDuration(duration: AgreementDuration, worldTick: number): string {
  return `<p>Duração vigente: início ${duration.startsAtWorldTick ?? "na ativação"}; fim ${duration.expiresAtWorldTick ?? "sem limite"}. Relógio da consulta: ${worldTick}.</p>`;
}
