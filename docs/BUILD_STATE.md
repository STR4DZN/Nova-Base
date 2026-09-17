# DOMAIN MANAGER — BUILD STATE

## Identidade

- Module version: `0.0.2`
- Gate de código atual: `G2 — Authority / Commands / MutationCoordinator (COMPLETO, AUDITADO E RESOLVIDO)`
- Estado local: `GATE_G2_ACCEPTED_EXTERNAL_AUDIT_RESOLVED`
- Estado externo: `GATE_G2_HOMOLOGATED_AND_ACCEPTED (Foundry VTT v13.351 + Socketlib In-World Smoke Test PASS)`
- Schema Domain: `1`
- Data da auditoria / fechamento: `2026-09-17`

## Estado canônico

- **Gate G0**: Concluído e verificado.
- **Gate G1**: Concluído e verificado (Domain schema, validators, JournalEntry adapter, repository, index incremental, cycle prevention).
- **Gate G2**: Concluído, auditado, homologado e aceito em ambiente real Foundry VTT v13.351 + Socketlib.
  - Primary Authority determinística com epoch monotônico e persistência leve em world settings.
  - **Command Transport seguro**: mutations e status queries remotas operam **estritamente via Socketlib directed RPC** (`executeAsUser`), autenticando o remetente via `this.socketdata.userId`.
  - **Fail-closed no canal nativo**: o socket broadcast nativo do Foundry (`module.domain-manager`) não aceita nem emite pacotes de comando (`DM_CMD_*`), eliminando qualquer surface não-autenticada.
  - Concorrência de até 10 conexões concorrentes demonstrada em testes de carga, sem vazamento de permits ou locks sob cancelamento ou timeout.
  - Anti-spoofing estrito, rate limiting pré-validação, dedupe store em memória com compartilhamento in-flight, LockManager ordenado livre de deadlocks e Transaction/Recovery shell com isolamento de locks.
  - Smoke test in-world (`scripts/foundry-v13-socketlib-smoke-test.js`) 100% aprovado no Foundry VTT v13.351.
  - O histórico detalhado das microtarefas que construíram o G2 está arquivado em `docs/history/G2_BUILD_HISTORY.md`.

## Evidência local Gate G2

| Verificação | Resultado |
|---|---|
| TypeScript strict (`cmd.exe /c npm run typecheck`) | PASS (0 erros) |
| Testes unitários e integração (`node tests/run-tests.mjs`) | PASS — 233/233 (0 falhas) |
| Manifest/package validation (`node scripts/validate-package.mjs`) | PASS |
| Runtime ZIP generation (`node scripts/package.mjs`) | PASS |
| Runtime artifact validation (`node scripts/validate-artifact.mjs`) | PASS |
| Full Gate G2 checkpoint generation (`node scripts/package-checkpoint.mjs`) | PASS |
| Full Gate G2 checkpoint validation (`node scripts/validate-g2-full.mjs`) | PASS |
| `node --check dist/main.js` | PASS |
| Smoke Test In-World no Foundry VTT v13.351 | PASS (100% checks verdes) |

## Próxima ação canônica

- **Gate G3 (Domain Lifecycle & State Machine / People)**: Com a homologação e aceitação externa do Gate G2 formalmente concluída (todos os testes verdes in-world no Foundry VTT v13.351 + Socketlib), o Gate G3 está plenamente autorizado para início de especificação e desenvolvimento.

## Pendências externas

- Nenhuma pendência restante para o Gate G2. Homologação externa concluída com sucesso no Foundry VTT v13.351.

