# DOMAIN MANAGER — BUILD STATE

## Identidade

- Module version: `0.0.3`
- Gate de código atual: `G3 — People Subsystem & Lifecycle (COMPLETO, AUDITADO E ACEITO)`
- Estado local: `GATE_G3_ACCEPTED`
- Estado externo: `GATE_G2_HOMOLOGATED_AND_ACCEPTED (Foundry VTT v13.351 + Socketlib In-World Smoke Test PASS)`
- Schema Domain: `1`
- Data de fechamento do Gate G3: `2026-09-17`

## Estado canônico

- **Gate G0**: Concluído e verificado.
- **Gate G1**: Concluído e verificado (Domain schema, validators, JournalEntry adapter, repository, index incremental, cycle prevention).
- **Gate G2**: Concluído, auditado, homologado e aceito em ambiente real Foundry VTT v13.351 + Socketlib.
  - Primary Authority determinística com epoch monotônico e persistência leve em world settings.
  - Command Transport seguro estritamente via Socketlib directed RPC (`executeAsUser`), autenticando o remetente via `this.socketdata.userId`.
  - Fail-closed no canal nativo de broadcast do Foundry (`module.domain-manager`).
  - Concorrência de até 10 conexões concorrentes demonstrada em testes de carga, sem vazamento de permits ou locks.
  - Anti-spoofing estrito, rate limiting pré-validação, dedupe store em memória com compartilhamento in-flight, LockManager ordenado e Transaction/Recovery shell.
  - Smoke test in-world (`scripts/foundry-v13-socketlib-smoke-test.js`) 100% aprovado no Foundry VTT v13.351.
- **Gate G3**: Concluído e aceito (`docs/GATE_G3_ACCEPTANCE_REPORT.md`).
  - **G3.1 (Population Modes)**: modos `manual`, `sumGroups`, `hybrid`, precisão `exact`/`estimated`/`unknown`, cálculo e propagação estrita.
  - **G3.2 (PopulationGroup Entity & Commands)**: `DomainPeopleData`, repositório e comandos transacionais (`people:set-population`, `people:create-population-group`, `people:update-population-group`, `people:delete-population-group`).
  - **G3.3 (Notables)**: union discriminada `inline`/`actor`, IDs opacos `not_*`, resolução resiliente de `broken-ref`, anti-duplicação de ator no mesmo domínio, upgrade de inline para ator, guard de deleção para ocupantes de papéis.
  - **G3.4 (RoleDefinition & Roles)**: papéis canônicos padrão, regras de ocupação (`single`, `unique`, `multiple`), comandos transacionais de atribuição/desatribuição e avaliação de preenchimento (`evaluateRole`).
  - **G3.5 (OperationalGroup)**: modos de membresia `abstract`, `partial`, `explicit`, lifecycles `active`, `inactive`, `disbanded`, derivação estrita de tamanho para grupos explícitos.
  - **G3.6 (Workforce Contributions & Resolution)**: cálculo de `capacity`, `committed`, `reserved` e `available`, prevenção de contagem dupla para grupos operacionais atrelados a grupos populacionais, desconsideração de grupos inativos/dissolvidos, liberação de reservas expiradas.
  - **G3.7 (Assignments & Reservations Shell)**: modelos e comandos para atribuição e reserva de força de trabalho com bloqueio contra overcommit (`DM_WORKFORCE_OVERCOMMIT`) e override do GM.
  - **G3.8 (Capability Grants & People Aggregation)**: resolução dinâmica de concessões de capacidades (`resolvePeopleEffectiveCapabilities`) por papéis preenchidos e grupos operacionais ativos com rastreamento de proveniência e zero efeitos colaterais de persistência.
  - **G3.9 (People UI Presentation & Views)**: presenter com sanitização de visão GM vs Jogador (ocultação de notáveis/papéis/grupos secretos) e templates HTML semânticos.
  - **G3.10 (Scale & Subsystem Integrity)**: ativação por capability (`domain-manager:people`), fixture de escala com 14 Notables, >75.000 de população, múltiplos grupos operacionais, papéis e integridade 100% verificada.

## Evidência local Gate G3

| Verificação | Resultado |
|---|---|
| TypeScript strict (`node ./node_modules/typescript/bin/tsc --noEmit`) | PASS (0 erros) |
| Testes unitários e integração (`node tests/run-tests.mjs`) | PASS — 282/282 (0 falhas) |
| Relatório de Aceitação | Concluído (`docs/GATE_G3_ACCEPTANCE_REPORT.md`) |
| Regressões G2 | 0 (todos os 233 testes de base preservados e passando) |

## Próxima ação canônica

- **Gate G4 (Projects & Construction)**: Com a conclusão, aceitação e testes 100% verdes do Gate G3 (People), o Gate G4 está formalmente liberado para especificação e implementação.
