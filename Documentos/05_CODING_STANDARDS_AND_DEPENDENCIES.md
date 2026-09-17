# 05 — Coding Standards e regras de dependência

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Impedir que a estrutura física do código destrua os boundaries definidos pelo Master.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.
# 56. FILE / MODULE STRUCTURE — IMPLEMENTATION BLUEPRINT

This is a recommended physical map derived from the contracts; names may be refined without changing boundaries.

```text
src/
├── core/
│   ├── ids/
│   ├── refs/
│   ├── result/
│   ├── errors/
│   ├── registries/
│   ├── versioning/
│   └── contexts/
│
├── storage/
│   ├── codecs/
│   ├── repositories/
│   ├── indexes/
│   ├── caches/
│   └── integrity/
│
├── authority/
│   ├── primary-authority-service.ts
│   ├── authority-epoch.ts
│   └── authority-status.ts
│
├── commands/
│   ├── command-bus.ts
│   ├── command-registry.ts
│   ├── command-transport.ts
│   ├── command-status.ts
│   ├── dedupe-store.ts
│   └── rate-limiter.ts
│
├── mutations/
│   ├── mutation-coordinator.ts
│   ├── lock-manager.ts
│   ├── plans/
│   ├── transaction-store.ts
│   ├── recovery-service.ts
│   └── compensation/
│
├── audit/
├── diagnostics/
├── domains/
├── people/
├── economy/
├── projects/
├── facilities/
├── downtime/
├── relations/
├── reputation/
├── agreements/
├── territory/
├── requests/
├── missions/
├── knowledge/
├── secrets/
├── time/
├── scheduler/
├── events/
├── conditions/
├── actions/
├── automation/
├── projection/
├── aggregation/
├── migrations/
├── import-export/
│
└── ui/
    ├── foundations/
    ├── tokens/
    ├── primitives/
    ├── patterns/
    ├── domain-patterns/
    ├── explorer/
    ├── operations/
    ├── timeline/
    └── diagnostics/
```

Rule:
> Folder structure may evolve; dependency boundaries may not be casually collapsed.

---

# 57. CROSS-SYSTEM DEPENDENCY RULES

Allowed direction examples:

```text
Projects ─query/plan→ People
Projects ─child plan→ Economy
Facility ─capability provider→ Domain
Agreement ─right grant→ CapabilityResolver
Mission ─resolution plan→ Projects/Economy/Diplomacy
Scheduler ─command→ Owning Service
Knowledge ─projection context→ UI
```

Forbidden:

```text
People → Project internals
Economy → Project lifecycle
Scheduler → Economy ledger direct
Mission → ResourceAccount direct
UI → Repository save
Relation → Reputation direct field rewrite
Agreement → Territory ownership rewrite
```

Cross-service mutation uses explicit child plans/operations.

---
## Regras adicionais

### Imports
- subsystem não importa internals privados de outro subsystem;
- compartilhar apenas contracts/public API;
- evitar circular dependencies;
- pure core não importa Foundry runtime quando desnecessário.

### TypeScript
- strict sempre que praticável;
- evitar `any`;
- unknown + narrowing em boundaries;
- DTOs readonly;
- IDs branded quando útil;
- discriminated unions para result/state;
- enums persistidos preferencialmente string unions/versionados.

### Errors
- boundaries retornam/lançam erros estruturados conforme contract;
- UI não parseia texto de error;
- provider error é traduzido.

### Logging
- sem secret payload em log normal;
- correlationId quando útil;
- console não substitui Diagnostics/Audit.

### Functions
- separar pure planning/validation de commit;
- funções de resolver sem writes;
- writes centralizados no owner.

### Comments
Comentar o “por quê” de invariants, não repetir sintaxe.
