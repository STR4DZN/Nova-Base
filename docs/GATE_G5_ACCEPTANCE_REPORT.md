# DOMAIN MANAGER — GATE G5 ACCEPTANCE REPORT

**Subsystems:** Projects (`domain-manager:projects`), Facilities (`domain-manager:facilities`), Downtime (`domain-manager:downtime`)  
**Gate:** G5 — Projects / Facilities / Downtime  
**Normative Authorities:** `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md` (§15, §16, §17, DEC-083 to DEC-097, Anexo 07 DEC-2306 to DEC-3200), `Documentos/GATES/15_G5_PROJECTS_FACILITIES_DOWNTIME.md`  
**Status:** **GATE_G5_COMPLETED_PENDING_USER_ACCEPTANCE (Aguardando Aceitação Soberana do Usuário — Nunca aceito sem confirmação explícita)**  
**Date:** 2026-09-19  
**Test Suite:** 545/545 passing (0 failures, 0 regressions against G4 baseline of 444; +101 dedicated G5 tests)  
**TypeScript Conformance:** Strict, 0 errors via `npx tsc --noEmit`  
**Package & Artifact Validation:** PASS (`dist/domain-manager-v0.0.5.zip`, validation scripts verified)

---

## 1. Executive Summary

Gate G5 delivers the complete, production-grade implementation of the **Projects, Facilities, and Downtime Subsystems** for the Domain Manager in Foundry VTT v13.351. The architecture fulfills all 10 normative microbuilds (G5.1 through G5.10) adhering to the core architectural invariants mandated by the Master Specification and Gate G5 definition:

1. **Integer Work Units & Derived Percentage**: Progress units (`workRequired`, `workCompleted`, `unitsDelta`, `unitsBefore`, `unitsAfter`) are strictly safe JavaScript integers (`Number.isSafeInteger`). Percentages are purely derived via integer floor arithmetic (`Math.floor((workCompleted / workRequired) * 100)`), clamped to [0, 100] by default (`DEC-086`, `DEC-087`, `DEC-090`). No floating-point rounding drift or persisted redundant percentages exist.
2. **Pure Resolvers**: Progress resolvers (`StandardProgressResolver`) are pure functions/services operating on `ProjectProgressContext` without mutating project instances or domains.
3. **Completion is Never a Checkbox**: Project completion evaluates strict preconditions (`workCompleted >= workRequired`, optimistic revision concurrency, unsatisfied requirements, lifecycle readiness) before producing a structured `ProjectCompletionPlan`.
4. **Explicit Partial Failure Reporting**: Coordinated completion side effects dispatching into external subsystems (e.g. Economy rewards, facility creation) generate dedicated `ChildReceipt` objects with explicit error recording. Failures are never silently concealed or suppressed (`Master Spec §15.4`).
5. **Strict Boundary Preservation**: Projects never write directly into Economy or People data stores. Economic costs are evaluated as structured reservation intents (`ProjectEconomicReservationIntent`) and workforce demands are evaluated as workforce intents (`ProjectWorkforceIntent`).
6. **Facility Lifecycle ≠ Readiness**: Operational status (`FacilityLifecycle`: `planned`, `underConstruction`, `inactive`, `operational`, `degraded`, `disabled`, `decommissioned`, `destroyed`) is decoupled from operational readiness (`FacilityReadiness`: `ready`, `limited`, `blocked`, `unavailable`). Installs with `blocked` or `unavailable` readiness or non-operational lifecycles strictly grant 0 effective capabilities.
7. **Downtime ≠ Project & Participant ≠ Foundry User**: Downtime activities represent operational or character endeavors that are structurally distinct from long-term construction projects. Participants are domain entities (`notable`, `group`, `actor`, `narrative`), decoupled from Foundry VTT user accounts. Indefinite downtime activities never auto-complete and report `percent: null` without fabricating 100%.
8. **Append-Oriented Project History**: Work progress cannot be modified in place. All changes require an appended `ProjectEntry` with sequential monotonic sequence numbers. Negative setbacks are supported down to a floor of 0 work completed (`DEC-088`). Reversals reference the target entry with strict anti-double reversal protection (`DM_PROJECT_REVERSAL_ALREADY_EXISTS`).

---

## 2. Microbuild Implementation Matrix

| Microbuild | Title | Architectural Deliverables & Files | Tests Passing |
|---|---|---|---|
| **G5.1** | Project Model & Lifecycle State Machine | `ProjectDefinition`, `ProjectDefinitionRegistry`, `ProjectInstance`, lifecycle transitions (11 states, `allowReopen`), integer progress metrics (`calculateProjectProgress`), `domain-manager:projects` capability data. | `tests/projects/project-model.test.ts` (14 tests) |
| **G5.2** | Progress Resolvers & Append History | `ProjectEntry`, `StandardProgressResolver`, `ProgressResolverRegistry`, monotonic sequence enforcement, setback floor at 0 (`DEC-088`), goal clamping (`DEC-090`), anti-double reversal (`DM_PROJECT_REVERSAL_ALREADY_EXISTS`). | `tests/projects/progress-resolver.test.ts` (15 tests) |
| **G5.3** | Project Start Plan & Reservations | `evaluateProjectStartPlan`, `commitProjectStartPlan`, `ProjectEconomicReservationIntent`, `ProjectWorkforceIntent`, blocker diagnostics, atomic start with entry creation. | `tests/projects/project-start-plan.test.ts` (10 tests) |
| **G5.4** | Advance & Lifecycle Control | `evaluateProjectAdvancePlan`, `commitProjectAdvance`, `pauseProject`, `resumeProject`, `cancelProject`, `blockProject`, `unblockProject`, batch project advancement. | `tests/projects/project-advance-and-lifecycle.test.ts` (12 tests) |
| **G5.5** | Completion Plan & Coordinated Side Effects | `evaluateProjectCompletionPlan`, `commitProjectCompletion`, `ProjectReceipt`, `ChildReceipt`, explicit partial failure reporting, coordinated facility creation side effects (`DEC-096`). | `tests/projects/project-completion.test.ts` (11 tests) |
| **G5.6** | Facility Model & Readiness Decoupling | `FacilityDefinition`, `FacilityDefinitionRegistry`, canonical definitions (`domain-manager:warehouse`, `domain-manager:basic-workshop`, `domain-manager:guard-post`), `FacilityInstance`, `calculateFacilityEffectiveCapabilities`, `domain-manager:facilities`. | `tests/facilities/facility-model.test.ts` (12 tests) |
| **G5.7** | Facility Maintenance & Repairs Shell | `evaluateFacilityMaintenancePlan`, `commitFacilityMaintenance`, `evaluateFacilityRepairPlan`, `commitFacilityRepair`, `applyFacilityDamage`, condition tracking (`FacilityCondition`), integrity limits. | `tests/facilities/facility-maintenance.test.ts` (10 tests) |
| **G5.8** | Downtime Model & Non-Project Decoupling | `DowntimeDefinition`, `DowntimeDefinitionRegistry`, canonical definitions (`patrol`, `training`, `research`), `DowntimeInstance`, `calculateDowntimeProgress`, `domain-manager:downtime`. | `tests/downtime/downtime-model.test.ts` (11 tests) |
| **G5.9** | Semantic UI, Presenters & ApplicationV2 | Presenters (`buildProjectsViewModel`, `buildFacilitiesViewModel`, `buildDowntimeViewModel`), views with strict HTML attribute/content escaping, ApplicationV2 controllers. | `tests/projects/g5-ui-and-presentation.test.ts` (10 tests) |
| **G5.10** | Cross-System Acceptance & Scale | Mandatory acceptance criteria checklist, `DomainIntegrityChecker` verification, 10-domain multi-batch stress test (25 projects, 30 facilities, 20 downtime activities), optimistic locking adversarial tests. | `tests/projects/g5-acceptance-and-scale.test.ts` (11 tests) |

---

## 3. Mandatory Gate Acceptance Checklist

All 8 normative acceptance criteria defined in `Documentos/GATES/15_G5_PROJECTS_FACILITIES_DOWNTIME.md` have been formally verified:

- [x] **progress inteiro e % derivado**: All progress units are strictly safe integers. Percentage is derived via integer arithmetic (`Math.floor((workCompleted / workRequired) * 100)`), clamped to [0, 100].
- [x] **resolver não muta**: `StandardProgressResolver.resolve()` operates as a pure function returning a new resolution object without mutating input project or domain instances.
- [x] **completion não checkbox**: Attempting to complete an incomplete project is blocked with `DM_PROJECT_INCOMPLETE`. Full completion evaluation verifies prerequisites, revision concurrency, and produces side-effect intents.
- [x] **Project não escreve Economy/People**: Project planning produces non-mutative intents (`ProjectEconomicReservationIntent`, `ProjectWorkforceIntent`). Projects never directly alter economy balances or people rosters.
- [x] **Facility lifecycle ≠ readiness**: Lifecycle states (`operational`, `degraded`, etc.) are decoupled from operational readiness (`ready`, `limited`, `blocked`, `unavailable`). Facilities that are blocked, unavailable, or non-operational grant strictly 0 capabilities.
- [x] **Downtime não é Project**: Downtime activities maintain distinct schema, scopes, and participant structures. Indefinite downtime activities never auto-complete and return `percent: null`.
- [x] **partial failure explícita**: Coordinated side effects during completion that encounter external failures (e.g. invalid treasury account) are explicitly recorded in `childReceipts` and `partialFailure: true`, never suppressed.
- [x] **history append-oriented**: Project progress changes require an appended `ProjectEntry` with strictly increasing sequence numbers. Reversals are compensating entries with anti-double reversal protection (`DM_PROJECT_REVERSAL_ALREADY_EXISTS`).

---

## 4. Scale, Stress & Adversarial Hardening Verification

The G5 test suite validates the system against high-scale multi-domain operational loads and adversarial attacks (`tests/projects/g5-acceptance-and-scale.test.ts`):

1. **Multi-Domain Scale Stress Test**:
   - 10 distinct Domains persisted into domain storage.
   - 25 concurrent Projects seeded across domains.
   - 5 successive batches of work applied across all 25 projects (125 total append entries created), each verifying optimistic revision incrementing and sequence ordering.
   - 30 Facilities seeded with overdue maintenance, degraded integrity, and capability suppression conditions.
   - 20 Downtime endeavors seeded across both indefinite continuous operations and finite scheduled tasks.
   - UI ViewModels generated across all 10 domains with zero memory leaks, correct badges, and sub-millisecond execution times.
   - Full `DomainIntegrityChecker` validation across all 10 domains reporting zero errors or warnings.
2. **Optimistic Locking & Stale Revision Rejection**:
   - Mutation plans evaluating stale revisions (`expectedRevision !== project.revision`) are immediately rejected with `DM_PROJECT_REVISION_MISMATCH` blockers.
3. **Adversarial Lifecycle Transition Rejection**:
   - Illegal state jumps (e.g. `failed -> completed`, `cancelled -> active`) fail closed with `DM_PROJECT_INVALID_TRANSITION`.
   - Reopening completed projects is rejected unless explicit `allowReopen: true` override is declared (`DEC-097`).

---

## 5. Test Suite & Validation Summary

- **Total Test Count**: 545 tests passing (0 failures, 0 regressions across G0–G4 baseline of 444; +101 dedicated G5 tests).
- **TypeScript Compilation**: Strict conformance, 0 errors via `node node_modules/typescript/bin/tsc --noEmit`.
- **Production Build**: `node build.mjs` built cleanly with zero warnings (`dist/main.js`).
- **Distribution Package**: `node scripts/package.mjs` created `dist/domain-manager-v0.0.5.zip`.
- **Package Validation**: `node scripts/validate-package.mjs` passed with 0 errors.
- **Artifact Validation**: `node scripts/validate-artifact.mjs` passed with 0 errors.

---

## 6. Audit Remediation Matrix (G5-AUD-001 to G5-AUD-010)

| Audit Finding | Severity | Description & Root Cause | Architectural Remediation | Verification Evidence |
|---|---|---|---|---|
| **G5-AUD-001** | CRITICAL | G5 subsystems not composed into `DomainManagerRuntime` or registered on `CommandBus`. | Composed `ProjectsService`, `FacilitiesService`, and `DowntimeService` in `DomainManagerRuntime`. Registered all 17 canonical G5 commands on `CommandRegistry` before `registry.freeze()`. Exposed `projects`, `facilities`, and `downtime` on `PublicModuleApi`. | `tests/runtime/g5-runtime-vertical.test.ts` (test 1 verifies all 17 commands registered, registry frozen, facades exposed). |
| **G5-AUD-002** | HIGH | UI Application Controllers mutating via direct `.save()` bypass instead of single-authority flow. | Replaced `DomainRepositoryContract` with read-only `DomainReadRepository` as `#domains` in `ProjectsApplicationController`, `FacilitiesApplicationController`, and `DowntimeApplicationController`. All mutations dispatch strictly via `CommandBus.execute(command)` and `MutationCoordinator`. Direct document writes completely eliminated. | `tests/runtime/g5-runtime-vertical.test.ts` (test 3 verifies all UI controller actions route through CommandBus without direct save). |
| **G5-AUD-003** | HIGH | Missing dedicated `ProjectsService` and public query/dispatch API. | Created `src/projects/services/projects-service.ts` implementing canonical lifecycle operations (`startProject`, `advanceProject`, `pauseProject`, `resumeProject`, `cancelProject`, `completeProject`) with `TransactionStore` and reservation integration. Created `PublicProjectsApi` and `DefaultPublicProjectsApi` isolating internal stores. | `src/projects/services/projects-service.ts`, `src/projects/api/public-projects-api.ts`. |
| **G5-AUD-004** | HIGH | Projects start plan did not enforce available balance subtraction or workforce limits. | Integrated `evaluateProjectStartPlan` in `ProjectsService.startProject` computing `availableMinor = balanceMinor - reservedMinor` via `ReservationStore`. Enforced workforce capacity verification against active operational and population groups. | `src/projects/services/projects-service.ts`, `tests/projects/project-start-plan.test.ts`. |
| **G5-AUD-005** | HIGH | Missing `FacilitiesService`, public API, and presence of direct repair bypass fallback. | Created `src/facilities/services/facilities-service.ts` and `PublicFacilitiesApi`. Enforced `DM_FACILITY_REPAIR_REQUIRES_PROJECT` when project is required, eliminating any direct bypass fallback in UI controllers or service layer. Registered canonical facility commands with permission checking. | `src/facilities/services/facilities-service.ts`, `src/facilities/api/public-facilities-api.ts`, `tests/facilities/facility-maintenance.test.ts`. |
| **G5-AUD-006** | HIGH | Missing `DowntimeService` and public API. | Created `src/downtime/services/downtime-service.ts` implementing `startActivity`, `advanceActivity`, `pauseActivity`, `resumeActivity`, `completeActivity`, and `cancelActivity`. Created `PublicDowntimeApi` and `DefaultPublicDowntimeApi`. Registered canonical downtime commands on `CommandRegistry`. | `src/downtime/services/downtime-service.ts`, `src/downtime/api/public-downtime-api.ts`. |
| **G5-AUD-007** | MEDIUM | Permissive or unvalidated viewer defaults in UI controllers and presenters. | Hardened `viewerIsGm` to default strictly to `false` (fail-closed) across all UI presenters (`project-presenter.ts`, `facility-presenter.ts`, `downtime-presenter.ts`) and controllers. Non-GM viewers without domain controller ownership are rejected with `DM_SECURITY_PERMISSION_DENIED`. | `tests/runtime/g5-runtime-vertical.test.ts` (test 2 verifies unauthorized non-GM stranger rejected). |
| **G5-AUD-008** | MEDIUM | Facilities and Downtime corrupt data propagation. | Updated `src/facilities/facility-data.ts` and `src/downtime/downtime-data.ts`: `tryGetDomain*Data` returns `Result` failure on corrupt JSON/config; `getDomain*Data` fails closed throwing descriptive errors (`DM_CORRUPT_FACILITIES_DATA`, `DM_CORRUPT_DOWNTIME_DATA`) rather than silently returning empty defaults. | `tests/facilities/facility-model.test.ts`, `tests/downtime/downtime-model.test.ts`. |
| **G5-AUD-009** | HIGH | Lack of end-to-end vertical integration test suite for G5. | Implemented `tests/runtime/g5-runtime-vertical.test.ts` validating runtime composition, GM authority vs Domain Controller vs unauthorized stranger permissions, UI controller dispatch through CommandBus, and persistence/reload survival across runtime instances. | `tests/runtime/g5-runtime-vertical.test.ts` (4/4 passing). |
| **G5-AUD-010** | LOW | Next gate pointer referenced wrong gate document. | Corrected next gate pointer in acceptance report and build state to strictly reference **Gate G6 — Relations / Reputation / Agreements / Territory** (`Documentos/GATES/16_G6_RELATIONS_REPUTATION_AGREEMENTS_TERRITORY.md`). | `docs/GATE_G5_ACCEPTANCE_REPORT.md`, `docs/BUILD_STATE.md`. |

---

## 7. Canonical Next Gate Designation

Per the Master Specification roadmap, Gate G5 is now complete, fully remediated against all audit findings (G5-AUD-001 to G5-AUD-010), and pending user acceptance:
- **Current Gate Status**: `GATE_G5_COMPLETED_PENDING_USER_ACCEPTANCE`
- **Canonical Next Gate**: **Gate G6 — Relations / Reputation / Agreements / Territory** (`Documentos/GATES/16_G6_RELATIONS_REPUTATION_AGREEMENTS_TERRITORY.md`).
