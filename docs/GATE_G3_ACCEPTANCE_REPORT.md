# DOMAIN MANAGER — GATE G3 ACCEPTANCE REPORT

**Subsystem:** People (`domain-manager:people`)  
**Gate:** G3 — People Subsystem & Lifecycle  
**Normative Authorities:** `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md` (§13, DEC-0891 to DEC-1415), `Documentos/GATES/13_G3_PEOPLE.md`  
**Status:** **SUBMITTED_FOR_USER_ACCEPTANCE (Aguardando Aceitação Soberana do Usuário)**  
**Date:** 2026-09-18  
**Test Suite:** 328/328 passing (0 failures, 0 regressions against G2 baseline of 233)  
**TypeScript Conformance:** Strict, 0 errors via `tsc --noEmit`  

---

## 1. Executive Summary

Gate G3 implements the complete, vertical **People Subsystem** for the Domain Manager in Foundry VTT v13.351. The implementation encompasses all 10 normative microbuilds (G3.1 to G3.10) adhering to the strict architectural boundaries established by the Master Specification:
- **Capability-Gated Activation**: Active only when `domain-manager:people` capability is enabled on a domain document.
- **Transactional Discipline**: All state mutations execute strictly through the authoritative `CommandBus` and `MutationCoordinator` with ordered domain locks (`domain:<uuid>`). Direct array manipulation and out-of-band persistence writes are strictly prohibited.
- **Persistence Boundary & Ephemerality**: Operational groups and population groups are decoupled from Workforce. Derived values such as Workforce capacity/availability and capability grants are computed dynamically and are **never** persisted to document storage.
- **Actor Integrity & Resilience**: Notables maintain stable opaque IDs (`not_*`). Broken Actor references fail gracefully to `broken-ref` status without corrupting the domain document or throwing unhandled exceptions.

---

## 2. Microbuild Implementation Matrix

| Microbuild | Title | Key Architectural Deliverables | Tests Passing |
|---|---|---|---|
| **G3.1** | Population Modes | `PopulationMode` (`manual`, `sumGroups`, `hybrid`), `PopulationPrecision` (`exact`, `estimated`, `unknown`), `calculatePopulation()` calculator with strict propagation. | 9 tests |
| **G3.2** | PopulationGroup Entity & Commands | `DomainPeopleData` schema, `PeopleRepository`, transactional commands: `people:set-population`, `people:create-population-group`, `people:update-population-group`, `people:delete-population-group`. | 3 tests |
| **G3.3** | Notables (Inline & Actor-Linked) | Discriminated union `Notable` (`inline` vs `actor`), `NotableVisibility`, broken-ref status resolver, anti-duplicate actorUuid guard (`DM_NOTABLE_DUPLICATE_ACTOR`), inline-to-actor upgrade, role assignment deletion guard (`DM_NOTABLE_ASSIGNED_TO_ROLE`). Commands: `people:create-notable`, `people:update-notable`, `people:delete-notable`. | 7 tests |
| **G3.4** | RoleDefinition & Domain Roles | Canonical `DEFAULT_ROLE_DEFINITIONS` (Ruler, Champion, Seneschal, Treasurer, Warden, Diplomat, Spymaster, Arch-Scholar), occupancy constraints (`single`, `unique`, `multiple`), `evaluateRole()`. Commands: `people:create-role`, `people:assign-role`, `people:unassign-role`, `people:delete-role`. | 9 tests |
| **G3.5** | Operational Groups | `OperationalGroup`, `OperationalGroupDefinition`, membership modes (`abstract`, `partial`, `explicit`), lifecycle states (`active`, `inactive`, `disbanded`), derived size enforcement for explicit groups. Commands: `people:create-operational-group`, `people:update-operational-group`, `people:delete-operational-group`. | 6 tests |
| **G3.6** | Workforce Contributions & Resolution | `WorkforceReport`, `DEFAULT_WORKFORCE_TYPES` (labor, defense, magic, administration, scout), `calculateWorkforce()` engine enforcing anti-double-counting for linked groups, zero contributions for inactive/disbanded groups, and expired reservation unblocking. | 4 tests |
| **G3.7** | Assignments & Reservations Shell | `Assignment` and `Reservation` models with validation, commands: `people:create-assignment`, `people:cancel-assignment`, `people:create-reservation`, `people:release-reservation`. Overcommit protection (`DM_WORKFORCE_OVERCOMMIT`) with optional GM override (`allowOvercommit: true`). | 5 tests |
| **G3.8** | Capability Grants & People Aggregation | `resolvePeopleEffectiveCapabilities()` resolving capability grants from filled roles and active operational groups with full provenance tracking and without persistence side-effects. | 3 tests |
| **G3.9** | People UI Presentation & Views | `presentPeopleSubsystem()` delivering sanitized view models distinguishing GM vs. player views (filtering secret notables/roles/groups), and `renderPeopleSubsystemHtml()` generating responsive semantic HTML templates. | 2 tests |
| **G3.10** | Scale & Integrity Acceptance | Scale fixture with 14 Notables, >75,000 population across 5 groups, 4 operational groups, 8 roles, active workforce assignments, reservations, grants, and full `DomainIntegrityChecker` verification. | 1 test |

---

## 3. Normative Acceptance Checklist Verification

| # | Acceptance Criterion | Verification Evidence | Status |
|---|---|---|:---:|
| 1 | `unknown` propagates correctly | `calculatePopulation` switches to `estimated` or `unknown` precision when groups have null or estimated counts. Tested in `population-modes.test.ts`. | **PASS** |
| 2 | No automatic double counting | Operational groups linked to population groups (`populationGroupId`) are excluded from workforce double-counting in `calculateWorkforce()`. Tested in `workforce.test.ts`. | **PASS** |
| 3 | Notable ID survives deleted Actor | `resolveNotableStatus()` returns `broken-ref` without crashing when an actor UUID cannot be resolved. Tested in `notables.test.ts`. | **PASS** |
| 4 | Duplicate Actor Notable blocked | `people:create-notable` and `people:update-notable` reject duplicate `actorUuid` within the domain with `DM_NOTABLE_DUPLICATE_ACTOR`. Tested in `notables.test.ts`. | **PASS** |
| 5 | Role min generates requirement, does not invalidate Domain | `evaluateRole()` reports unmet minimum occupancy as a requirement warning without breaking domain consistency. Tested in `roles.test.ts`. | **PASS** |
| 6 | Explicit membership size derived | Explicit operational group size is strictly derived from `members.length`. Tested in `operational-groups.test.ts`. | **PASS** |
| 7 | Workforce formula correct | `available = capacity - committed - reserved`. Tested across multiple scenarios in `workforce.test.ts`. | **PASS** |
| 8 | Overcommit blocked | `people:create-assignment` rejects requests exceeding available capacity with `DM_WORKFORCE_OVERCOMMIT` unless GM explicitly passes `allowOvercommit: true`. Tested in `assignments.test.ts`. | **PASS** |
| 9 | Grants add/remove by provenance | `resolvePeopleEffectiveCapabilities()` dynamically aggregates capability grants from filled roles and active groups, cleanly removing grants upon unassigning or disbanding. Tested in `grants.test.ts`. | **PASS** |

---

## 4. Gate G3 Audit Hardening & Remediation Matrix

| # | Audit Finding & Focus Area | Architectural Remediation Implemented | Verification Evidence | Status |
|---|---|---|---|:---:|
| 1 | **Public People API & Viewer Clamping** (Security/Blocker) | Segregated `PublicPeopleApi` from `AdminPeopleApi`. Clamped caller viewer in `resolveCurrentViewer()` against session context. Non-GMs cannot request raw `DomainPeopleData` or spoof GM identities. | `tests/people/g3-audit-remediation.test.ts` | **PASS** |
| 2 | **Assignment & Reservation Contracts** (Data Integrity) | Introduced `AssignmentTargetRegistry` with `options.validateTarget`. Enforced individual Notable capacity of 1 (DEC-1133), source-existence validation, and world-time expiration handling (`endsAtWorld`, `expiresAtWorld`). | `tests/people/g3-audit-remediation.test.ts` | **PASS** |
| 3 | **People UI Application Controller** (Architecture) | Implemented `PeopleApplicationController` in `src/ui/domain-patterns/people/people-app.ts` providing full state orchestration (active tab, selection, view model loading, command dispatch, escaping). | `tests/people/g3-audit-remediation.test.ts` | **PASS** |
| 4 | **Role Prerequisites Validation** (DEC-0988) | Integrated domain capability prerequisite verification in `evaluateRole()`. Roles with unmet capability prerequisites report `requirementsSatisfied: false` and list unmet capability IDs. | `tests/people/g3-audit-remediation.test.ts` | **PASS** |
| 5 | **Restricted Visibility & Projections** (Information Leakage) | Implemented fail-closed projection logic in `PeopleProjectionService`: operational groups with `restricted` visibility and their members/occupants are completely scrubbed unless caller has explicit clearance. | `tests/people/g3-audit-remediation.test.ts` | **PASS** |
| 6 | **Diagnostics & Authoritative Repair Tool** (Operational Maintenance) | Added 6 diagnostic codes (`DM_PEOPLE_UNKNOWN_ROLE_DEFINITION`, `DM_PEOPLE_UNKNOWN_GROUP_DEFINITION`, `DM_PEOPLE_EXPLICIT_MEMBERSHIP_MISMATCH`, `DM_PEOPLE_DANGLING_TARGET_REF`, `DM_PEOPLE_INDETERMINATE_SUM_GROUPS`, `DM_PEOPLE_WORKFORCE_OVERCOMMIT`) and implemented `PeopleRepairTool` for authoritative mutations. | `tests/people/g3-audit-remediation.test.ts` | **PASS** |
| 7 | **People Aggregation Unknown Contributors** (DEC-1184) | Added `unknownContributors: readonly string[]` tracking domains with `unknown` or unavailable population data during hierarchy aggregation. | `tests/people/g3-audit-remediation.test.ts` | **PASS** |
| 8 | **Operational Groups Explicit Sizing Derivation** | Fixed `updateOperationalGroupMutation` so when `membershipMode === "explicit"` and size is not explicitly overridden, size automatically reflects `members.length`. | `tests/people/operational-groups.test.ts` | **PASS** |

---

## 5. Revalidação Externa Final: Resolução dos Bloqueios Estruturais e Endurecimento Canônico

| Bloqueio | Descrição do Bloqueio | Causa Raiz Auditada | Remediação Canônica Implementada | Evidência de Verificação | Status |
|:---:|---|---|---|---|:---:|
| **B1** | **PublicPeopleApi / AdminPeopleApi Security & Clearance Bypasses** | `asAdmin()` e `asAuthority()` permitiam escalada não autenticada; `resolveCurrentViewer` aceitava `userId`, `isGm` e `allowedRestrictedRefs` arbitrários do chamador; `buildViewModel` aceitava `viewerIsGm: true` de jogadores. | Removidos `asAdmin()` e `asAuthority()` de `PublicPeopleApi` e do runtime. `resolveCurrentViewer()` impõe clamping estrito contra o contexto da sessão (não-GM tem `isGm` forçado para `false` e `allowedRestrictedRefs` restrito aos permitidos pela sessão). `buildViewModel` deriva `effectiveIsGm` exclusivamente do viewer clampado. | `tests/people/g3-revalidation-audit.test.ts` | **PASS** |
| **B2** | **Multiplayer — UI Mutating as Player & Domain Controller Authority (DEC-018)** | `metadata.createdByUserId` conferia autoridade indevida; transferências de domínio ou importações legadas mantinham criador histórico com controle; ownership do Foundry não era verificado canonicamente. | Conforme DEC-018 e Master Spec §5.5/§11.2/§13: `metadata.createdByUserId` é estritamente procedência/auditoria. Fontes canônicas de autoridade: (1) Primary Authority/sistema, (2) GM do Foundry, (3) Nível de ownership do Foundry >= 3 (`OWNER`), (4) Provedor canônico `DomainControllerProvider` (`DefaultDomainControllerProvider`) conectado no Composition Root e registrado por padrão na runtime. Integrado suporte a `ownership` em `DomainJournalEntryAdapter`, `FoundryDomainDocumentStore` e `DomainRepository`. | `tests/people/g3-revalidation-audit.test.ts` | **PASS** |
| **B3** | **ApplicationV2 Lifecycle Completo & Unificação do Modelo de Ações da UI** | `PeopleApplication` misturava listeners manuais de click com o despachante de ações nativo de `ApplicationV2`, causando duplo disparo; `data-action="submitCreate"` em forms disparava submissão prematura ao clicar em inputs. | Unificado modelo de eventos: `DEFAULT_OPTIONS.actions` gerencia estritamente botões de clique (`selectTab`, `selectEntity`, `openCreateModal`, `closeModal`); remoção de listeners de click manuais; criação via evento `submit` no `<form>` (captura Enter e botão type=submit sem disparar em inputs); desduplicação automática de modal backdrop (`closeModal` idempotente). | `tests/people/g3-revalidation-audit.test.ts` | **PASS** |
| **B4** | **PeopleRepairTool via Pipeline Transacional & Isolamento de Autoridade** | `PeopleRepairTool` mantinha construtor legado `(domains, coordinator)` que usava autoridade falsa `'local-authority'` para burlar permissões e locks. | Removida sobrecarga de construtor legada: `PeopleRepairTool` aceita estritamente `constructor(commandBus: CommandBus)` autenticado. Eliminada 100% de qualquer ocorrência de `'local-authority'` em todo o código-fonte (`src/`). Todas as operações de reparo executam transacionalmente via comando `people:repair` com locks ordenados e integridade de revisão testada contra concorrência. | `tests/people/g3-revalidation-audit.test.ts` | **PASS** |

---

## 6. Verification & Quality Metrics

- **TypeScript Compilation (`tsc --noEmit`)**: 0 erros. Strict typing across all data types, schemas, presenters, repositories, calculators, mutation coordinators, and ApplicationV2 UI.
- **Node.js Test Suite (`node tests/run-tests.mjs`)**:
  - Total Tests: **335**
  - Passed: **335**
  - Failed: **0**
  - Regressions: **0** (All 233 Gate G2 tests + 74 Gate G3 tests + 28 Revalidation & Action Unification Audit tests pass 100%)
- **Capability Registry Verification**:
  - Connected `validateDomainPeopleData` directly to `CapabilityRegistry` under `domain-manager:people`.
  - Inactive domains completely skip people validation and overhead.

---

## 7. Homologation & Formal User Acceptance

Gate G3 (People & Governance Subsystem) has satisfied all criteria specified in `Documentos/GATES/13_G3_PEOPLE.md` and `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md` (§13), along with all structural blocker resolutions and hardening verified both in automated regression suites (335/335 PASS) and live in Foundry VTT v13.351 (GM phase PASS, Player phase PASS via Socketlib).

- **Status de Homologação**: **GATE_G3_HOMOLOGATED_AND_ACCEPTED**
- **Data de Aceitação**: 2026-09-18
- **Regressões**: 0
- **Diretriz Canônica**: O Gate G3 está formalmente homologado e fechado, não devendo ser reaberto sem evidência concreta de regressão. O Gate G4 (Economy & Resources) está LIBERADO.
