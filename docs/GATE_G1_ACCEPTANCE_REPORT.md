# GATE G1 — ACCEPTANCE REPORT

## Resultado

`LOCAL_VALIDATED_AFTER_AUDIT`

O G1 passou pela segunda auditoria com correções e 68 testes locais. O estado formal permanece `READY_FOR_EXTERNAL_FOUNDRY_SMOKE` porque a evidência real do Foundry ainda não foi registrada desde G0.

## Acceptance criteria

| Critério | Resultado |
|---|---|
| `JournalEntry.name` é única verdade do nome | PASS |
| codec round-trip e canonicalização | PASS |
| revision/stale/no-op | PASS |
| archive/restore | PASS |
| hierarchy por full UUID e cycles bloqueados | PASS |
| save/update não burlam hierarchy validator | PASS |
| index rebuild + incremental update | PASS |
| queries comuns usam índice após rebuild | PASS |
| UUID/name/aliases/kind/scale/parent/tags/capabilities indexáveis | PASS |
| unknown capability IDs preserváveis | PASS |
| integrity checker read-only | PASS |
| production JournalEntry boundary existe | PASS |
| ordinary JournalEntries não entram no Domain store | PASS |
| migration seed v1 determinístico | PASS |

## Correções de auditoria

Ver `docs/G1_AUDIT_FIX_REPORT.md`.

## Test matrix

- TypeScript strict: PASS
- Testes executados: 68/68 PASS
- Package manifest: PASS
- Runtime artifact: PASS
- Full G1 checkpoint: PASS
- Entry point syntax: PASS

## Limitação de ambiente

`npm run test:unit` e `npm run build` dependem do `esbuild` instalado em `node_modules`. O upload não contém dependencies e o registry não ficou disponível neste ambiente. A suíte foi executada integralmente por transpile TypeScript + `node --test`; o bundle já recebido foi mantido porque `src/main.ts` não foi alterado.

## Blockers

Nenhum blocker local conhecido.

## Pendência

Smoke externo Foundry VTT v13.351+ ainda não registrado.

## Próximo gate

`G2.1 — Primary Authority election/status`, somente após o closeout externo previsto pelo protocolo.
