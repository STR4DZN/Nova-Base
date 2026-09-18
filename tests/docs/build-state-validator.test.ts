import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = process.cwd();
const buildStatePath = join(projectRoot, "docs", "BUILD_STATE.md");
const buildHistoryPath = join(projectRoot, "docs", "history", "G2_BUILD_HISTORY.md");

test("Validator: docs/BUILD_STATE.md é um snapshot canônico sem microtarefas antigas ou baselines obsoletos", () => {
  assert.ok(existsSync(buildStatePath), "docs/BUILD_STATE.md deve existir");
  assert.ok(existsSync(buildHistoryPath), "docs/history/G2_BUILD_HISTORY.md deve existir como arquivo histórico");

  const content = readFileSync(buildStatePath, "utf-8");

  // 1. Não contém 'Implementar G2.1'
  assert.equal(
    content.includes("Implementar G2.1"),
    false,
    "docs/BUILD_STATE.md não deve conter 'Implementar G2.1'"
  );

  // 2. Não apresenta baselines obsoletos parciais como se fossem atuais
  const obsoleteBaselines = [
    "71/71",
    "80/80",
    "94/94",
    "108/108",
    "132/132",
    "142/142",
    "150/150",
    "154/154",
    "159/159",
    "166/166",
    "169/169",
    "173/173",
    "177/177"
  ];
  for (const baseline of obsoleteBaselines) {
    assert.equal(
      content.includes(baseline),
      false,
      `docs/BUILD_STATE.md não deve conter o baseline obsoleto '${baseline}'`
    );
  }

  // 3. Contém apenas uma única seção canônica de Próxima ação / Próximo Gate
  const proximaAcaoMatches = content.match(/##\s*Próxima\s*ação/gi) ?? [];
  assert.equal(
    proximaAcaoMatches.length,
    1,
    `docs/BUILD_STATE.md deve conter exatamente 1 seção canônica de 'Próxima ação', encontrou ${proximaAcaoMatches.length}`
  );

  // 4. Aponta para Gate G4 (Economy & Resources) após homologação / aceitação do Gate G3
  const proximaAcaoSection = content.split(/##\s*Próxima\s*ação/i)[1] ?? "";
  assert.ok(
    proximaAcaoSection.includes("Gate G4"),
    "A próxima ação canônica deve referenciar Gate G4"
  );
  assert.ok(
    proximaAcaoSection.includes("Economy") || proximaAcaoSection.includes("Economia") || proximaAcaoSection.includes("Resources"),
    "A próxima ação canônica deve referenciar Economy / Resources"
  );
  assert.ok(
    proximaAcaoSection.toLowerCase().includes("após a homologação") ||
      proximaAcaoSection.toLowerCase().includes("aceitação") ||
      proximaAcaoSection.toLowerCase().includes("conclusão"),
    "A transição para Gate G4 deve ser estritamente condicionada à conclusão / homologação / aceitação do G3"
  );
});
