import { ok, type Result } from "../../../core/contracts/result.js";
import { failure } from "../../../core/validation/value-validation.js";
import { validateReputationTrackDefinition, type ReputationTrackDefinition } from "../../../reputation/reputation-model.js";
import { escapeHtml, escapeAttribute } from "../facilities/facility-view.js";
export interface ReputationTrackInput { readonly definition: ReputationTrackDefinition; readonly initialScore: number; }
export const defaultReputationTrackFields = (index = 0): Record<string, string> => ({
  id: "", label: index === 0 ? "Reputação" : `Trilha ${index + 1}`, minimum: "-100", maximum: "100", baseline: "0",
  initialScore: "0", visibility: "public", publicPresentation: "band", decayEnabled: "", decayAmount: "1", decayPeriod: "1",
  bands: "Desconfiança | -100 | -1\nNeutralidade | 0 | 0\nConfiança | 1 | 100"
});
export function reputationTrackDefinitionFields(d: ReputationTrackDefinition): Record<string, string> {
  return { id: d.id, label: d.label, minimum: String(d.minimum), maximum: String(d.maximum), baseline: String(d.baseline),
    initialScore: String(d.baseline), visibility: d.visibility, publicPresentation: d.publicPresentation,
    decayEnabled: d.decay ? "on" : "", decayAmount: String(d.decay?.amount ?? 1), decayPeriod: String(d.decay?.periodTicks ?? 1),
    bands: d.bands.map(b => `${b.label} | ${b.minimum} | ${b.maximum}`).join("\n") };
}
export function parseReputationTrackFields(fields: Record<string, string>, prefix: string, identity?: { id: string; version: number; bandIds?: readonly string[] }): Result<ReputationTrackInput> {
  const get = (key: string) => fields[prefix + key] ?? "";
  const number = (key: string): number => get(key).trim() === "" ? NaN : Number(get(key));
  const id = identity?.id ?? (get("id").trim() || `domain-manager:reputation-${crypto.randomUUID()}`);
  const bands = [];
  for (const [i, line] of get("bands").split("\n").map(x => x.trim()).filter(Boolean).entries()) {
    const parts = line.split("|").map(x => x.trim());
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2])
      return failure("DM_REPUTATION_BAND_INVALID", "Cada faixa usa Nome | mínimo | máximo, uma por linha.");
    bands.push({ id: identity?.bandIds?.[i] ?? `${id}.band-${i}`, label: parts[0], minimum: Number(parts[1]), maximum: Number(parts[2]) });
  }
  const definition = validateReputationTrackDefinition({ id, version: identity?.version ?? 1, label: get("label").trim(),
    minimum: number("minimum"), maximum: number("maximum"), baseline: number("baseline"),
    visibility: get("visibility"), publicPresentation: get("publicPresentation"), bands,
    decay: get("decayEnabled") === "on" ? { amount: number("decayAmount"), periodTicks: number("decayPeriod") } : null });
  if (!definition.ok) return definition;
  const initialScore = identity ? definition.value.baseline : number("initialScore");
  if (!Number.isSafeInteger(initialScore) || initialScore < definition.value.minimum || initialScore > definition.value.maximum)
    return failure("DM_REPUTATION_SCORE_INVALID", "O valor inicial precisa ser inteiro e estar no intervalo da trilha.");
  return ok({ definition: definition.value, initialScore });
}
export function renderReputationTrackFields(prefix: string, values: Record<string, string>, existing = false): string {
  const name = (key: string) => escapeAttribute(prefix + key);
  const input = (key: string, label: string, type = "text", readonly = false) =>
    `<label>${label}<input name="${name(key)}" type="${type}" ${type === "number" ? 'step="1"' : ""}
      value="${escapeAttribute(values[key] ?? "")}" ${readonly ? "readonly" : ""} ${key === "id" && !existing ? "" : "required"}></label>`;
  const select = (key: string, label: string, options: readonly [string, string][]) =>
    `<label>${label}<select name="${name(key)}">${options.map(([value, text]) =>
      `<option value="${escapeAttribute(value)}" ${values[key] === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
  return input("label", "Nome da trilha") + input("id", "Identificador (em branco: automático)", "text", existing)
    + input("minimum", "Mínimo", "number", existing) + input("maximum", "Máximo", "number", existing)
    + input("baseline", "Valor de referência", "number") + (existing ? "" : input("initialScore", "Valor inicial", "number"))
    + select("visibility", "Visibilidade da trilha", [["public", "Pública"], ["restricted", "Participantes"], ["secret", "Somente GM"]])
    + select("publicPresentation", "Apresentação para jogadores", [["band", "Somente faixa"], ["score", "Valor e faixa"], ["hidden", "Oculta"]])
    + `<label>Faixas: Nome | mínimo | máximo, uma por linha<textarea name="${name("bands")}">${escapeHtml(values.bands ?? "")}</textarea></label>
      <label><input type="checkbox" name="${name("decayEnabled")}" ${values.decayEnabled === "on" ? "checked" : ""}>Ativar decadência em direção ao valor de referência</label>`
    + input("decayAmount", "Unidades por período", "number") + input("decayPeriod", "Duração do período em ticks", "number");
}
