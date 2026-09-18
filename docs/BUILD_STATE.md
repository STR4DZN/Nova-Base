# DOMAIN MANAGER — BUILD STATE

## Identidade

- Module version: `0.0.3`
- Gate de código atual: `G3 — People Subsystem & Lifecycle (IMPLEMENTADO, AUDITADO, PENDENTE DE ACEITAÇÃO DO USUÁRIO)`
- Estado local: `GATE_G3_PENDING_USER_ACCEPTANCE`
- Estado externo: `GATE_G2_HOMOLOGATED_AND_ACCEPTED (Foundry VTT v13.351 + Socketlib In-World Smoke Test PASS)`
- Schema Domain: `1`
- Data de submissão do Gate G3: `2026-09-18`

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
- **Gate G3**: Concluído, auditado e submetido para aceitação do usuário (`docs/GATE_G3_ACCEPTANCE_REPORT.md`).
  - **G3.1 (Population Modes)**: modos `manual`, `sumGroups`, `hybrid`, precisão `exact`/`estimated`/`unknown`, cálculo e propagação estrita.
  - **G3.2 (PopulationGroup Entity & Commands)**: `DomainPeopleData`, repositório e comandos transacionais (`people:set-population`, `people:create-population-group`, `people:update-population-group`, `people:delete-population-group`).
  - **G3.3 (Notables)**: union discriminada `inline`/`actor`, IDs opacos `not_*`, resolução resiliente de `broken-ref`, anti-duplicação de ator no mesmo domínio, upgrade de inline para ator, guard de deleção para ocupantes de papéis.
  - **G3.4 (RoleDefinition & Roles)**: papéis canônicos padrão, regras de ocupação (`single`, `unique`, `multiple`), comandos transacionais de atribuição/desatribuição e avaliação de preenchimento (`evaluateRole`).
  - **G3.5 (OperationalGroup)**: modos de membresia `abstract`, `partial`, `explicit`, lifecycles `active`, `inactive`, `disbanded`, derivação estrita de tamanho para grupos explícitos.
  - **G3.6 (Workforce Contributions & Resolution)**: cálculo de `capacity`, `committed`, `reserved` e `available`, prevenção de contagem dupla para grupos operacionais atrelados a grupos populacionais, desconsideração de grupos inativos/dissolvidos, liberação de reservas expiradas.
  - **G3.7 (Assignments & Reservations Shell)**: modelos e comandos para atribuição e reserva de força de trabalho com bloqueio contra overcommit (`DM_WORKFORCE_OVERCOMMIT`) e override do GM.
  - **G3.8 (Capability Grants & People Aggregation)**: resolução dinâmica de concessões de capacidades (`resolvePeopleEffectiveCapabilities`) por papéis preenchidos e grupos operacionais ativos com rastreamento de proveniência e zero efeitos colaterais de persistência.
  - **G3.9 (People UI Presentation & Views)**: presenter com sanitização de visão GM vs Jogador (ocultação de notáveis/papéis/grupos secretos) e templates HTML semânticos.
  - **G3 Remediação & Hardening (Fases A–G)**:
    - **Runtime & Production Bundle**: 18 comandos `people:*` conectados ao `CommandRegistry` transacional, facade `runtime.people` exposta, bundle `dist/main.js` compilado e verificado.
    - **Viewer Projection Security**: `PeopleProjectionService` isola estritamente dados secretos antes de computar totais de população, força de trabalho, concessões e atribuições.
    - **Hierarchy Aggregation**: `PeopleAggregationService` com suporte a `own`, `descendant` e `aggregate`, cycle guard defensivo e propagação de precisão `unknown`/`estimated`.
    - **Capability Grant Resolver**: arquitetura extensível com `CapabilityResolver` e suporte a `RoleGrantPolicy` (`exists`, `occupied`, `requirementsSatisfied`, `keepGrantWhenInactive`).
    - **Workforce Roundtrip**: `workforceContributions` persistidas e validadas em `PopulationGroup`.
    - **Source-Specific Overcommit**: bloqueio de sobrealocação por fonte (`DM_WORKFORCE_OVERCOMMIT`, DEC-1145) com override administrativo.
    - **Public People API Segregation & Viewer Clamping (Audit Item 1 & 5)**: Segregated `PublicPeopleApi` e `AdminPeopleApi` em `runtime.people`, clamp de viewer chamador via `resolveCurrentViewer()`. Acesso raw proibido para não-GM, visibilidade restrita fail-closed com stripping profundo de ocupantes/membros.
    - **Assignment Contracts & Notable Capacity (Audit Item 2)**: `AssignmentTargetRegistry` com validação de target, capacidade individual de Notável (= 1, DEC-1133), validação de existência da fonte e expiração por tempo de mundo (`endsAtWorld`, `expiresAtWorld`).
    - **People UI Application Controller (Audit Item 3)**: `PeopleApplicationController` implementado gerenciando abas, seleção, carregamento de view models, despacho de comandos e renderização.
    - **Role Prerequisites Verification (Audit Item 4)**: Avaliação de pré-requisitos de papéis contra capacidades habilitadas do domínio em `evaluateRole()`.
    - **Diagnostics & Authoritative Repair Tool (Audit Item 6)**: 6 novos diagnósticos de integridade (`DM_PEOPLE_UNKNOWN_ROLE_DEFINITION`, `DM_PEOPLE_UNKNOWN_GROUP_DEFINITION`, `DM_PEOPLE_EXPLICIT_MEMBERSHIP_MISMATCH`, `DM_PEOPLE_DANGLING_TARGET_REF`, `DM_PEOPLE_INDETERMINATE_SUM_GROUPS`, `DM_PEOPLE_WORKFORCE_OVERCOMMIT`) e ferramenta de reparo autoritativo `PeopleRepairTool`.
    - **Aggregation Unknown Contributors (Audit Item 7)**: Adicionado campo `unknownContributors: readonly string[]` conforme DEC-1184.
    - **Operational Group Explicit Sizing Fix (Audit Item 8)**: Derivação automática de `size` a partir do comprimento de `members` quando no modo explícito.

## Evidência local Gate G3

| Verificação | Resultado |
|---|---|
| TypeScript strict (`node ./node_modules/typescript/bin/tsc --noEmit`) | PASS (0 erros) |
| Testes unitários e integração (`node tests/run-tests.mjs`) | PASS — 307/307 (0 falhas) |
| Relatório de Aceitação | Submetido para revisão e aceitação do usuário (`docs/GATE_G3_ACCEPTANCE_REPORT.md`) |
| Regressões G2 | 0 (todos os 233 testes de base preservados e passando) |

## Próxima ação canônica
 
- **Gate G4 (Economy & Resources)**: Com a implementação e remediação completa da auditoria do Gate G3 (People) e 307/307 testes aprovados, a transição para o Gate G4 aguarda formalmente a homologação e aceitação do Gate G3 por parte do usuário.
