import { ok, type Result } from "../../../core/contracts/result.js";
import { failure } from "../../../core/validation/value-validation.js";
import { REPUTATION_ENTRY_KINDS, reputationEntryLabels, reputationSourceKind, reputationSourceValue,
  validateReputationHistoryFilter, type ReputationHistoryFilter, type ReputationHistoryView } from "../../../reputation/reputation-history.js";
import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
export function reputationHistoryFields(filter: ReputationHistoryFilter = {}): Record<string, string> {
  return { trackId: filter.trackId ?? "", kind: filter.kind ?? "", sourceType: filter.sourceType ?? filter.source?.type ?? "",
    sourceKind: filter.source ? reputationSourceKind(filter.source) : "id", sourceRef: filter.source ? reputationSourceValue(filter.source) : "",
    from: filter.fromWorldTick?.toString() ?? "", to: filter.toWorldTick?.toString() ?? "" };
}
export function parseReputationHistoryFields(fields: Record<string, string>): Result<ReputationHistoryFilter> {
  const filter: { -readonly [K in keyof ReputationHistoryFilter]: ReputationHistoryFilter[K] } = {};
  if (fields.trackId) filter.trackId = fields.trackId;
  if (fields.kind) filter.kind = fields.kind as ReputationHistoryFilter["kind"];
  if (fields.sourceType) filter.sourceType = fields.sourceType;
  if (fields.sourceRef) {
    if (!["id", "uuid"].includes(fields.sourceKind)) return failure("DM_REPUTATION_HISTORY_FILTER_INVALID", "Selecione ID ou UUID para a referência da fonte.");
    filter.source = { type: fields.sourceType ?? "", [fields.sourceKind]: fields.sourceRef };
  }
  for (const [field, key] of [["from", "fromWorldTick"], ["to", "toWorldTick"]] as const) {
    if (fields[field]) { if (!/^\d+$/.test(fields[field])) return failure("DM_REPUTATION_HISTORY_FILTER_INVALID", "Ticks devem ser inteiros não negativos."); filter[key] = Number(fields[field]); }
  }
  return validateReputationHistoryFilter(filter);
}
const timestamp = (at: number) => new Date(at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const signed = (value: number | string) => BigInt(value) > 0n ? `+${value}` : String(value);
export function renderReputationHistory(detail: { entries: ReputationHistoryView["entries"]; reputationHistory?: ReputationHistoryView["reputationHistory"];
  tracks: readonly { definitionId: string; label: string }[] }, savedFields: Record<string, string>): string {
  const summary = detail.reputationHistory;
  if (!summary) return '<section><h3>Histórico de reputação</h3><p>Resumo do histórico indisponível. Atualize a consulta.</p></section>';
  const values = { ...reputationHistoryFields(summary.filters), ...savedFields };
  const trackName = (id: string) => `${detail.tracks.find(t => t.definitionId === id)?.label ?? id} (${id})`;
  const option = (value: string, text: string, selected: string) => `<option value="${escapeAttribute(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(text)}</option>`;
  const input = (name: string, label: string, numeric = false) => `<label>${label}<input name="${name}" ${numeric ? 'type="number" min="0" step="1"' : ""} value="${escapeAttribute(values[name])}"></label>`;
  const applied = summary.filters, scope = [applied.trackId ? `Trilha: ${trackName(applied.trackId)}` : "Todas as trilhas",
    applied.kind ? reputationEntryLabels[applied.kind] : "Todos os lançamentos", applied.sourceType ?? applied.source?.type ? `Tipo de fonte: ${applied.sourceType ?? applied.source!.type}` : "Todos os tipos de fonte",
    applied.source ? `${reputationSourceKind(applied.source).toUpperCase()}: ${reputationSourceValue(applied.source)}` : "Todas as referências",
    applied.fromWorldTick !== undefined || applied.toWorldTick !== undefined ? `Ticks: ${applied.fromWorldTick ?? "início"} até ${applied.toWorldTick ?? "sem limite"}` : "Todos os ticks / sem tick"];
  const sourceRows = summary.sources.items.map(s => `<tr><td>${escapeHtml(trackName(s.trackId))}</td><td>${escapeHtml(s.source.type)}</td><td>${escapeHtml(reputationSourceKind(s.source).toUpperCase())}: ${escapeHtml(reputationSourceValue(s.source))}</td>
    <td>${s.entries}</td><td>${escapeHtml(signed(s.gains))}</td><td>${escapeHtml(signed(s.losses))}</td><td>${escapeHtml(signed(s.net))}</td>
    <td>${s.byKind.adjustment} / ${s.byKind.reversal} / ${s.byKind.decay}</td><td>${escapeHtml(timestamp(s.firstAt))} → ${escapeHtml(timestamp(s.lastAt))}</td>
    <td><button type="button" data-dm-reputation-source-track="${escapeAttribute(s.trackId)}" data-dm-reputation-source-type="${escapeAttribute(s.source.type)}"
      data-dm-reputation-source-kind="${reputationSourceKind(s.source)}" data-dm-reputation-source-ref="${escapeAttribute(reputationSourceValue(s.source))}">Ver lançamentos desta fonte</button></td></tr>`).join("");
  const entryRows = detail.entries.map(e => `<tr><td>${escapeHtml(e.id)}</td><td>${escapeHtml(trackName(e.trackId))}</td><td>${reputationEntryLabels[e.kind]}</td>
    <td>${escapeHtml(signed(e.delta))}</td><td>${e.before} → ${e.after}</td><td>${escapeHtml(e.source.type)} · ${reputationSourceKind(e.source).toUpperCase()}: ${escapeHtml(reputationSourceValue(e.source))}</td>
    <td>${escapeHtml(e.reason)}</td><td>${e.worldTick ?? "Sem tick registrado"}</td><td>${escapeHtml(timestamp(e.at))}</td><td>${escapeHtml(e.reversalOf ?? "—")}</td></tr>`).join("");
  const pageLabel = (offset: number, length: number, total: number) => length ? `${offset + 1}–${offset + length} de ${total}` : `0 nesta página; ${total} no filtro`;
  return `<section><h3>Histórico de reputação — GM</h3>
    <form data-dm-form="reputation-history"><label>Trilha<select name="trackId">${option("", "Todas as trilhas", values.trackId)}${detail.tracks.map(t => option(t.definitionId, trackName(t.definitionId), values.trackId)).join("")}</select></label>
      <label>Tipo de lançamento<select name="kind">${option("", "Todos", values.kind)}${REPUTATION_ENTRY_KINDS.map(k => option(k, reputationEntryLabels[k], values.kind)).join("")}</select></label>
      ${input("sourceType", "Tipo da fonte (opcional)")}<label>Tipo de referência<select name="sourceKind">${option("id", "ID", values.sourceKind)}${option("uuid", "UUID", values.sourceKind)}</select></label>
      ${input("sourceRef", "Referência exata da fonte (opcional; exige tipo)")}${input("from", "Do tick (inclusive)", true)}${input("to", "Até o tick (inclusive)", true)}
      <button>Aplicar filtros</button><button type="button" data-dm-reputation-history-clear="true">Limpar filtros</button></form>
    <p>Filtros aplicados: ${scope.map(escapeHtml).join(" · ")}.</p>
    <p>Os filtros selecionam lançamentos, sem alterar valores atuais ou políticas. Intervalos de ticks são inclusivos e excluem lançamentos sem tick registrado. Datas exibidas em horário de São Paulo.</p>
    <p>${summary.total} lançamentos no filtro: ${summary.byKind.adjustment} ajustes, ${summary.byKind.reversal} reversões e ${summary.byKind.decay} decadências.</p>
    <h4>Fontes dos lançamentos filtrados</h4><p>Contagens e valores abrangem todos os lançamentos filtrados, antes da paginação. Cada fonte é separada por trilha, tipo e referência (ID/UUID). Ganhos, perdas e saldo usam o delta aplicado; reversões e decadência permanecem no histórico. O saldo desta seleção não substitui o valor atual da trilha.</p>
    <p>${pageLabel(summary.sources.offset, summary.sources.items.length, summary.sources.total)} fontes.</p>
    ${sourceRows ? `<div class="dm-reputation-history-table"><table><thead><tr><th>Trilha</th><th>Tipo</th><th>Referência</th><th>Lançamentos</th><th>Ganhos</th><th>Perdas</th><th>Saldo aplicado</th><th>Ajustes / reversões / decadência</th><th>Primeiro / último</th><th>Ação</th></tr></thead><tbody>${sourceRows}</tbody></table></div>` : "<p>Nenhuma fonte nesta página/filtro.</p>"}
    <button type="button" data-dm-reputation-source-page="-1" ${summary.sources.offset === 0 ? "disabled" : ""}>Fontes anteriores</button><button type="button" data-dm-reputation-source-page="1" ${summary.sources.offset + summary.sources.limit >= summary.sources.total ? "disabled" : ""}>Próximas fontes</button>
    <h4>Lançamentos</h4><p>${pageLabel(summary.offset, detail.entries.length, summary.total)} lançamentos.</p>
    ${entryRows ? `<div class="dm-reputation-history-table"><table><thead><tr><th>ID</th><th>Trilha</th><th>Tipo</th><th>Delta aplicado</th><th>Antes / depois</th><th>Fonte</th><th>Motivo</th><th>Tick</th><th>Momento</th><th>Reverte lançamento</th></tr></thead><tbody>${entryRows}</tbody></table></div>` : "<p>Nenhum lançamento nesta página/filtro.</p>"}
    <button type="button" data-dm-history="-1" ${summary.offset === 0 ? "disabled" : ""}>Histórico anterior</button><button type="button" data-dm-history="1" ${summary.offset + summary.limit >= summary.total ? "disabled" : ""}>Próximo histórico</button>
  </section>`;
}
