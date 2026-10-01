import { ok, type Result } from "../../../core/contracts/result.js";
import { failure, isNamespaced, isTimestamp, isSafeInteger, isText, isVisibility } from "../../../core/validation/value-validation.js";
import { validateRelationPartyRef } from "../../../relations/types/relation-validation.js";
import type { TypedRef } from "../../../core/identity/refs.js";
import { temporalSourceIsEffective, type TerritoryInfluence, type InfluenceAxis, type InfluenceModifier, type TerritoryAction } from "../../../territory/territory-state.js";
import { escapeHtml as h, escapeAttribute as attr } from "../facilities/facility-view.js";
export const INFLUENCE_ACTIONS = ["influence", "add-influence-modifier", "end-influence-modifier", "end-influence"] as const;
export const MAX_INFLUENCE_ROWS = 32;
const parties = [["domain", "Domínio"], ["actor", "Actor"], ["narrative", "Parte narrativa"], ["populationGroup", "Grupo populacional"], ["operationalGroup", "Grupo operacional"], ["notable", "Notável"]] as const;
const partyLabel = (p: any) => `${p.type}: ${p.uuid ?? p.id}${p.domainUuid ? ` (${p.domainUuid})` : ""}`;
const text = (f: Record<string, string>, k: string) => f[k]?.trim() ?? "";
export function influenceFields(i?: TerritoryInfluence): Record<string, string> {
  const f: Record<string, string> = { influencePartyType: i?.partyRef.type ?? "domain", influencePartyRef: i?.partyRef.uuid ?? i?.partyRef.id ?? "", influenceDomainUuid: i?.partyRef.domainUuid ?? "",
    influenceVisibility: i?.visibility ?? "public", influenceStarts: i ? String(i.startsAtWorldTick) : "", influenceExpires: i?.expiresAtWorldTick == null ? "" : String(i.expiresAtWorldTick),
    influenceActive: i?.active === false ? "" : "on", influenceAxisCount: String(i?.axes.length ?? 1), influenceModifierCount: String(i?.modifiers.length ?? 0) };
  const axes = i?.axes ?? [{ axisId: "domain-manager:political", base: 0, minimum: -100, maximum: 100, decay: null }];
  axes.forEach((a, index) => { const p = `axis_${index}_`; Object.assign(f, { [p+"id"]: a.axisId, [p+"base"]: String(a.base), [p+"minimum"]: String(a.minimum), [p+"maximum"]: String(a.maximum),
    [p+"decay"]: a.decay ? "on" : "", [p+"amount"]: String(a.decay?.amount ?? 0), [p+"period"]: String(a.decay?.periodTicks ?? 1), [p+"from"]: a.decay ? String(a.decay.fromWorldTick) : "", [p+"baseline"]: String(a.decay?.baseline ?? a.base) }); });
  i?.modifiers.forEach((m,index) => Object.assign(f, modifierFields(m, `modifier_${index}_`)));
  return f;
}
export function modifierFields(m?: InfluenceModifier, p = "modifier_"): Record<string, string> {
  return { [p+"id"]: m?.id ?? "", [p+"axis"]: m?.axisId ?? "", [p+"delta"]: m ? String(m.delta) : "", [p+"visibility"]: m?.visibility ?? "public", [p+"starts"]: m ? String(m.startsAtWorldTick) : "",
    [p+"expires"]: m?.expiresAtWorldTick == null ? "" : String(m.expiresAtWorldTick), [p+"active"]: m?.active === false ? "" : "on" };
}
function count(f: Record<string, string>, key: string, minimum: number): Result<number> {
  const n = Number(f[key]); return text(f,key) && isTimestamp(n) && n >= minimum && n <= MAX_INFLUENCE_ROWS ? ok(n) : failure("DM_TERRITORY_INFLUENCE_ROWS_INVALID", `Use de ${minimum} a ${MAX_INFLUENCE_ROWS} linhas.`);
}
function window(f: Record<string, string>, starts: string, expires: string, tick: number): Result<{ startsAtWorldTick: number; expiresAtWorldTick: number | null }> {
  const start = text(f, starts) ? Number(f[starts]) : tick, end = text(f, expires) ? Number(f[expires]) : null;
  return isTimestamp(start) && (end === null || isTimestamp(end) && end > start) ? ok({ startsAtWorldTick: start, expiresAtWorldTick: end }) : failure("DM_TERRITORY_INFLUENCE_TIME_INVALID", "Use ticks inteiros não negativos e fim posterior ao início.");
}
export function parseInfluenceModifier(f: Record<string, string>, axes: readonly InfluenceAxis[], tick: number, id: string, sourceRef: TypedRef, p = "modifier_"): Result<InfluenceModifier> {
  const axisId = text(f,p+"axis"), delta = text(f,p+"delta") ? Number(f[p+"delta"]) : NaN, w = window(f,p+"starts",p+"expires",tick);
  if (!axes.some(a => a.axisId === axisId)) return failure("DM_TERRITORY_INFLUENCE_AXIS_UNAVAILABLE", "Selecione um eixo da influência visível.", "not-found");
  if (!isSafeInteger(delta) || !isVisibility(f[p+"visibility"]) || !isText(id)) return failure("DM_TERRITORY_INFLUENCE_MODIFIER_INVALID", "Informe delta inteiro e visibilidade válidos.");
  if (!w.ok) return w;
  return ok({ id, sourceRef, axisId, delta, visibility: f[p+"visibility"] as InfluenceModifier["visibility"], active: f[p+"active"] === "on", ...w.value });
}
export function parseInfluenceFields(fields: Record<string, string>, tick: number, id: string, sourceRef: TypedRef): Result<{ kind: "influence"; value: TerritoryInfluence }> {
  const f = fields, ac = count(f,"influenceAxisCount",1), mc = count(f,"influenceModifierCount",0); if (!ac.ok) return ac; if (!mc.ok) return mc;
  const type = f.influencePartyType, ref = text(f,"influencePartyRef"), origin = text(f,"influenceDomainUuid"), embedded = ["populationGroup","operationalGroup","notable"].includes(type);
  if (!parties.some(([k]) => k === type) || !ref || !embedded && origin) return failure("DM_TERRITORY_INFLUENCE_PARTY_INVALID", "Informe uma parte válida e origem somente para grupos/notáveis.");
  const party = validateRelationPartyRef({ type, ...(type === "domain" || type === "actor" ? { uuid: ref } : { id: ref }), ...(embedded ? { domainUuid: origin } : {}) }); if (!party.ok) return party;
  const w = window(f,"influenceStarts","influenceExpires",tick); if (!w.ok) return w;
  if (!isVisibility(f.influenceVisibility) || !isText(id)) return failure("DM_TERRITORY_INFLUENCE_INVALID", "Selecione uma visibilidade válida.");
  const axes: InfluenceAxis[] = [], modifiers: InfluenceModifier[] = [];
  for (let index=0; index<ac.value; index++) {
    const p = `axis_${index}_`, axisId = text(f,p+"id"), number = (key: string) => text(f,p+key) ? Number(f[p+key]) : NaN,
      base = number("base"), minimum = number("minimum"), maximum = number("maximum");
    if (!isNamespaced(axisId) || axes.some(a => a.axisId === axisId) || ![base,minimum,maximum].every(isSafeInteger) || maximum < minimum || base < minimum || base > maximum)
      return failure("DM_TERRITORY_INFLUENCE_AXIS_INVALID", "Eixos precisam de ID único com namespace, limites inteiros e base dentro dos limites.");
    let decay: InfluenceAxis["decay"] = null;
    if (f[p+"decay"] === "on") {
      const amount = number("amount"), periodTicks = number("period"), fromWorldTick = text(f,p+"from") ? number("from") : tick, baseline = number("baseline");
      if (!isTimestamp(amount) || !isTimestamp(periodTicks) || periodTicks < 1 || !isTimestamp(fromWorldTick) || !isSafeInteger(baseline) || baseline < minimum || baseline > maximum)
        return failure("DM_TERRITORY_INFLUENCE_DECAY_INVALID", "Decadência exige quantidade não negativa, período positivo, tick e baseline dentro dos limites.");
      decay = { amount, periodTicks, fromWorldTick, baseline };
    }
    axes.push({ axisId, base, minimum, maximum, decay });
  }
  for (let index=0;index<mc.value;index++) {
    const p = `modifier_${index}_`, m = parseInfluenceModifier(f,axes,tick,text(f,p+"id") || `${id}:modifier-${index}`, { ...sourceRef }, p); if (!m.ok) return m;
    if (modifiers.some(x => x.id === m.value.id)) return failure("DM_TERRITORY_INFLUENCE_MODIFIER_INVALID", "Modificadores precisam de IDs únicos."); modifiers.push(m.value);
  }
  return ok({ kind: "influence", value: { id, sourceRef, partyRef: party.value, visibility: f.influenceVisibility, active: f.influenceActive === "on", axes, modifiers, ...w.value } });
}
export function parseInfluenceOperation(f: Record<string, string>, influences: readonly TerritoryInfluence[], tick: number, id: string, sourceRef: TypedRef): Result<TerritoryAction> {
  const target = influences.find(i => i.id === f.influenceId);
  if (!target) return failure("DM_TERRITORY_INFLUENCE_UNAVAILABLE", "Selecione uma influência visível.", "not-found");
  if (f.kind === "add-influence-modifier") {
    if (!target.active) return failure("DM_TERRITORY_INFLUENCE_INACTIVE", "A influência foi encerrada.", "conflict");
    const m = parseInfluenceModifier(f,target.axes,tick,id,sourceRef); return m.ok ? ok({ kind: "add-influence-modifier", id: target.id, value: m.value }) : m;
  }
  if (f.kind === "end-influence-modifier" && target.modifiers.some(m => m.id === f.modifierId)) return ok({ kind: "end-influence-modifier", id: target.id, modifierId: f.modifierId });
  if (f.kind === "end-influence") return ok({ kind: "end-influence", id: target.id });
  return failure("DM_TERRITORY_INFLUENCE_UNAVAILABLE", "Selecione um modificador visível.", "not-found");
}
/** Row changes preserve other fields and existing modifier IDs; dangling axis selection stays an explicit validation error. */
export function editInfluenceRows(f: Record<string, string>, collection: "axis" | "modifier", operation: "add" | "remove", index = -1): Result<Record<string, string>> {
  const key = collection === "axis" ? "influenceAxisCount" : "influenceModifierCount", c = count(f,key,collection === "axis" ? 1 : 0); if (!c.ok) return c;
  const minimum = collection === "axis" ? 1 : 0;
  if (operation === "add" && c.value >= MAX_INFLUENCE_ROWS || operation === "remove" && (!Number.isInteger(index) || index < 0 || index >= c.value || c.value <= minimum)) return failure("DM_TERRITORY_INFLUENCE_ROWS_INVALID", "Não foi possível alterar esta linha.");
  const result = { ...f }, rows: Record<string,string>[] = [];
  for (let i=0;i<c.value;i++) { const row: Record<string,string> = {}; for (const [k,v] of Object.entries(f)) if (k.startsWith(`${collection}_${i}_`)) row[k.slice(`${collection}_${i}_`.length)] = v; rows.push(row); }
  if (operation === "remove") rows.splice(index,1);
  else rows.push(collection === "axis" ? { id: "", base: "0", minimum: "-100", maximum: "100", decay: "", amount: "0", period: "1", from: "", baseline: "0" }
    : { id: crypto.randomUUID(), axis: "", delta: "", visibility: "public", starts: "", expires: "", active: "on" });
  for (const k of Object.keys(result)) if (k.startsWith(collection+"_")) delete result[k];
  rows.forEach((row,i) => Object.entries(row).forEach(([k,v]) => result[`${collection}_${i}_${k}`] = v)); result[key] = String(rows.length); return ok(result);
}
const input = (f: Record<string,string>, name: string, label: string, args = "") => `<label>${label}<input name="${name}" value="${attr(f[name] ?? "")}" ${args}></label>`;
const integer = 'type="number" step="1" required';
const checkbox = (f: Record<string,string>, name: string, label: string) => `<label><input type="checkbox" name="${name}"${f[name] === "on" ? " checked" : ""}>${label}</label>`;
const visibility = (f: Record<string,string>, name: string) => `<label>Visibilidade<select name="${name}">${[["public","Pública"],["restricted","Participantes"],["secret","Somente GM"]].map(([k,v])=>`<option value="${k}"${f[name]===k?" selected":""}>${v}</option>`).join("")}</select></label>`;
const vigency = (f: Record<string,string>, p: string) => visibility(f,p+"visibility") + input(f,p+"starts","Início (em branco: tick da consulta)",'type="number" min="0" step="1"') + input(f,p+"expires","Fim exclusivo (em branco: sem limite)",'type="number" min="0" step="1"');
export function renderModifierFields(f: Record<string,string>, axes: readonly InfluenceAxis[], p = "modifier_"): string {
  return `<input type="hidden" name="${p}id" value="${attr(f[p+"id"] ?? "")}"><label>Eixo<select name="${p}axis" required><option value="">Selecione</option>${axes.map(a=>`<option value="${attr(a.axisId)}"${f[p+"axis"]===a.axisId?" selected":""}>${h(a.axisId)}</option>`).join("")}</select></label>${input(f,p+"delta","Delta inteiro (positivo, negativo ou zero)",integer)}${checkbox(f,p+"active","Modificador ativo")}<details><summary>Visibilidade e vigência do modificador</summary>${vigency(f,p)}</details>`;
}
export function renderInfluenceFields(values: Record<string,string>): string {
  const f = { ...influenceFields(), ...values }, ac = count(f,"influenceAxisCount",1), mc = count(f,"influenceModifierCount",0);
  if (!ac.ok || !mc.ok) return '<p role="alert">Quantidade de linhas inválida. Limpe o rascunho antes de continuar.</p>';
  const axes: InfluenceAxis[] = Array.from({length:ac.value},(_,i)=>({axisId:f[`axis_${i}_id`] ?? "",base:0,minimum:0,maximum:0,decay:null}));
  return `<label>Tipo da parte<select name="influencePartyType">${parties.map(([k,v])=>`<option value="${k}"${f.influencePartyType===k?" selected":""}>${v}</option>`).join("")}</select></label>${input(f,"influencePartyRef","UUID de Domínio/Actor ou ID de parte/grupo/notável","required")}
    <details${["populationGroup","operationalGroup","notable"].includes(f.influencePartyType)?" open":""}><summary>Origem de grupos e notáveis</summary>${input(f,"influenceDomainUuid","UUID do Domínio de origem")}</details>
    ${checkbox(f,"influenceActive","Influência ativa")}<details><summary>Visibilidade e vigência da influência</summary>${visibility(f,"influenceVisibility")}${input(f,"influenceStarts","Início (em branco: tick da consulta)",'type="number" min="0" step="1"')}${input(f,"influenceExpires","Fim exclusivo (em branco: sem limite)",'type="number" min="0" step="1"')}</details>
    <input type="hidden" name="influenceAxisCount" value="${ac.value}"><input type="hidden" name="influenceModifierCount" value="${mc.value}">
    <h4>Eixos independentes</h4>${axes.map((a,i)=>{ const p=`axis_${i}_`;return `<fieldset><legend>Eixo ${i+1}</legend>${input(f,p+"id","ID (namespace:eixo)","required")}${input(f,p+"base","Base",integer)}${input(f,p+"minimum","Mínimo",integer)}${input(f,p+"maximum","Máximo",integer)}
      <details${f[p+"decay"]==="on"?" open":""}><summary>Decadência opcional até o baseline</summary>${checkbox(f,p+"decay","Usar decadência")}${input(f,p+"amount","Quantidade por período",'type="number" min="0" step="1"')}${input(f,p+"period","Período em ticks",'type="number" min="1" step="1"')}${input(f,p+"from","Tick inicial (em branco: consulta)",'type="number" min="0" step="1"')}${input(f,p+"baseline","Baseline",'type="number" step="1"')}</details><button type="button" data-dm-influence-rows="axis" data-dm-influence-operation="remove" data-dm-influence-index="${i}" ${ac.value===1?"disabled":""}>Remover eixo</button></fieldset>`;}).join("")}
    <button type="button" data-dm-influence-rows="axis" data-dm-influence-operation="add" ${ac.value>=MAX_INFLUENCE_ROWS?"disabled":""}>Adicionar eixo</button>
    <h4>Modificadores iniciais</h4>${Array.from({length:mc.value},(_,i)=>`<fieldset><legend>Modificador ${i+1}</legend>${renderModifierFields(f,axes,`modifier_${i}_`)}<button type="button" data-dm-influence-rows="modifier" data-dm-influence-operation="remove" data-dm-influence-index="${i}">Remover modificador</button></fieldset>`).join("")}
    <button type="button" data-dm-influence-rows="modifier" data-dm-influence-operation="add" ${mc.value>=MAX_INFLUENCE_ROWS?"disabled":""}>Adicionar modificador inicial</button><p>Até ${MAX_INFLUENCE_ROWS} eixos e ${MAX_INFLUENCE_ROWS} modificadores por formulário. Remover um eixo não apaga seus modificadores silenciosamente; revise as seleções antes de enviar.</p>`;
}
export function renderInfluenceOperation(influences: readonly TerritoryInfluence[], f: Record<string,string>, kind: string, fixedId?: string): string {
  const id = fixedId ?? f.influenceId, selected = influences.find(i=>i.id===id);
  return `<input type="hidden" name="kind" value="${attr(kind)}"><label>Influência visível<select name="influenceId" data-dm-influence-target="true" required><option value="">Selecione</option>${influences.filter(i=>!fixedId||i.id===fixedId).map(i=>`<option value="${attr(i.id)}"${i.id===id?" selected":""}>${h(i.id)} · ${h(partyLabel(i.partyRef))} · ${i.active?"ativa":"encerrada"}</option>`).join("")}</select></label>
    ${kind==="add-influence-modifier"?renderModifierFields({...modifierFields(),...f},selected?.axes??[]):kind==="end-influence-modifier"?`<label>Modificador visível<select name="modifierId" required><option value="">Selecione</option>${(selected?.modifiers??[]).map(m=>`<option value="${attr(m.id)}"${m.id===f.modifierId?" selected":""}>${h(m.id)} · ${h(m.axisId)} · ${m.delta} · ${m.active?"ativo":"encerrado"}</option>`).join("")}</select></label>`:"<p>Encerrar desativa esta fonte sem apagar eixos, modificadores ou histórico.</p>"}`;
}
export function renderInfluenceRequest(a: any, title = "Influência solicitada"): string {
  return `<section><h3>${h(title)}</h3>${a.kind==="influence"?`<p>Parte: ${h(partyLabel(a.value.partyRef))} · ${a.value.active?"ativa":"inativa"} · ${h(a.value.visibility)} · ${a.value.startsAtWorldTick} → ${a.value.expiresAtWorldTick??"sem limite"}</p><pre>${h(JSON.stringify({axes:a.value.axes,modifiers:a.value.modifiers},null,2))}</pre>`:a.kind==="add-influence-modifier"?`<p>Influência: ${h(a.id)} · Eixo: ${h(a.value.axisId)} · Delta: ${a.value.delta} · ${h(a.value.visibility)} · ${a.value.startsAtWorldTick} → ${a.value.expiresAtWorldTick??"sem limite"}</p>`:`<p>Influência: ${h(a.id)}${a.modifierId?` · Modificador: ${h(a.modifierId)}`:""} · ${h(a.kind)}</p>`}</section>`;
}
export function renderTerritoryInfluence(d: any, tick: number, isGm: boolean, draft: Record<string,string>, modifierDraft: Record<string,string>, endDraft: Record<string,string>): string {
  const sources: readonly TerritoryInfluence[] = d.influence ?? [], effective = d.effectiveInfluence ?? [], eligible = sources.filter(i=>i.active&&temporalSourceIsEffective(i,tick)),
    reason = (f: Record<string,string>) => `<input type="hidden" name="influenceRevision" value="${attr(f.influenceRevision??String(d.revision))}"><p>Revisão atual: ${d.revision}; rascunho: ${h(f.influenceRevision??String(d.revision))}.</p>${input(f,"reason","Motivo auditável","required")}`;
  return `<section><h3>Influência territorial</h3><p>${sources.length} fontes visíveis; ${eligible.length} ativas e vigentes no tick ${tick}. Eixos permanecem independentes: influência não concede propriedade, presença ou controle.</p>
    ${sources.map(i=>`<details><summary>${h(i.id)} · ${h(partyLabel(i.partyRef))} · ${!i.active?"Encerrada":tick<i.startsAtWorldTick?"Agendada":temporalSourceIsEffective(i,tick)?"Vigente":"Expirada"}</summary><p>${h(i.visibility)} · ${i.startsAtWorldTick} → ${i.expiresAtWorldTick??"sem limite"}</p><pre>${h(JSON.stringify({axes:i.axes,modifiers:i.modifiers},null,2))}</pre></details>`).join("")}
    ${effective.length?`<table><thead><tr><th>Fonte / parte / eixo</th><th>Base</th><th>Decadência aplicada</th><th>Modificadores</th><th>Valor final</th></tr></thead><tbody>${effective.map((e:any)=>`<tr><td>${h(e.influenceId)} · ${h(partyLabel(e.partyRef))} · ${h(e.axisId)}</td><td>${e.base}</td><td>${e.decay}</td><td>${e.modifiers}</td><td>${e.value}</td></tr>`).join("")}</tbody></table>`:"<p>Nenhum eixo de influência efetiva visível.</p>"}<p>Valores finais respeitam os limites de cada eixo. Breakdown usa inteiros seguros limitados pelo resolver; não soma eixos em uma pontuação universal.</p>
    <h4>${isGm?"Registrar influência":"Propor influência ao GM"}</h4><form data-dm-form="territory-influence">${renderInfluenceFields(draft)}${reason(draft)}<button>${isGm?"Registrar":"Enviar proposta ao GM"}</button><button type="button" data-dm-influence-reset="true">Limpar rascunhos / usar revisão atual</button></form>
    ${sources.length?`<h4>${isGm?"Adicionar modificador":"Propor modificador ao GM"}</h4><form data-dm-form="territory-influence-modifier">${renderInfluenceOperation(sources,modifierDraft,"add-influence-modifier")}${reason(modifierDraft)}<button>${isGm?"Adicionar":"Enviar proposta ao GM"}</button></form>
    <h4>${isGm?"Encerrar fonte ou modificador":"Propor encerramento ao GM"}</h4><form data-dm-form="territory-influence-end"><label>Operação<select name="endKind" data-dm-influence-target="true"><option value="end-influence-modifier"${endDraft.endKind!=="end-influence"?" selected":""}>Encerrar modificador</option><option value="end-influence"${endDraft.endKind==="end-influence"?" selected":""}>Encerrar influência</option></select></label>${renderInfluenceOperation(sources,endDraft,endDraft.endKind==="end-influence"?"end-influence":"end-influence-modifier")}${reason(endDraft)}<button>${isGm?"Encerrar":"Enviar proposta ao GM"}</button><button type="button" data-dm-influence-reset="true">Limpar rascunhos / usar revisão atual</button></form>`:""}</section>`;
}
