# DOMAIN MANAGER — GATE G3 ACCEPTANCE REPORT

**Subsystem:** People (`domain-manager:people`)  
**Gate:** G3 — People Subsystem & Lifecycle  
**Normative Authorities:** `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md` (§13, DEC-0891 to DEC-1415), `Documentos/GATES/13_G3_PEOPLE.md`  
**Status:** **GATE_ACCEPTED**  
**Date:** 2026-09-17  
**Test Suite:** 282/282 passing (0 failures, 0 regressions against G2 baseline of 233)  
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

## 4. Verification & Quality Metrics

- **TypeScript Compilation (`tsc --noEmit`)**: 0 errors. Strict typing across all data types, schemas, presenters, repositories, calculators, and mutation coordinators.
- **Node.js Test Suite (`node tests/run-tests.mjs`)**:
  - Total Tests: **282**
  - Passed: **282**
  - Failed: **0**
  - Regressions: **0** (All 233 Gate G2 tests + 49 Gate G3 tests pass 100%)
- **Capability Registry Verification**:
  - Connected `validateDomainPeopleData` directly to `CapabilityRegistry` under `domain-manager:people`.
  - Inactive domains completely skip people validation and overhead.

---

## 5. Formal Conclusion

Gate G3 (People) has satisfied all criteria specified in `Documentos/GATES/13_G3_PEOPLE.md` and `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md` (§13). Gate G3 is hereby declared **ACCEPTED**.
