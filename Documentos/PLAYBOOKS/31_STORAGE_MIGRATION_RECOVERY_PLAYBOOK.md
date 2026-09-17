# 31 — Storage, Migration e Recovery Playbook

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Centralizar procedimentos para canonical storage, codecs, repositories, migrations, quarantine, backup e recovery.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.
# 42. STORAGE FINAL

## 42.1. Canonical

- JournalEntry + module flags/repository data.
- Domain canonical document is JournalEntry.
- Large independent lifecycle entities may have independent persisted records/stores behind repositories.
- Physical storage is an implementation boundary; consumers see contracts.

## 42.2. Repository contract

Repositories handle:
- load/get/query;
- save;
- revision checks;
- codec;
- schema validation;
- batch operations;
- storage errors.

They do NOT:
- run cross-subsystem business workflow;
- invent events;
- bypass authority.

## 42.3. Index

Rebuildable:
- by entity kind;
- Domain/parent;
- status;
- dueAt;
- target/source refs;
- visibility/audience where necessary.

## 42.4. Cache

Discardable:
- audience/context key included;
- never reuse GM projection for player;
- selective invalidation;
- size limits/eviction;
- TTL only where semantics allow.

---

# 43. MIGRATIONS

MigrationManager:
- stable migration IDs;
- fromVersion/toVersion;
- incremental;
- idempotent;
- preconditions;
- postconditions;
- MigrationPlan;
- backup policy;
- report.

Never:
- guess unknown semantic value;
- infer identity by name;
- silently reinterpret dates/calendar;
- silently overwrite conflicts.

Quarantine categories:
```text
corrupt
ambiguous
unsupported
missing-reference
```

Quarantine:
- preserves raw source where safe;
- reason;
- source ref;
- migration ID;
- excluded from normal operational indexes;
- repair/relink workflow.

---

# 44. IMPORT / EXPORT / BACKUP

Differentiate:
- full backup;
- share/package export.

Full backup may contain secrets with explicit warning.
Share export sanitized by default.

Export:
- formatVersion;
- schemaVersion;
- dependency manifest;
- external refs list;
- provenance.

Import:
- version validation;
- migration pipeline;
- preview;
- create/update/conflict/skipped;
- collision policy;
- remapping;
- checkpoints for large imports;
- final receipt/report.

Recovery snapshot:
- module version;
- Foundry version;
- schema version;
- checksum if possible.

Backup creation is useless without restore tests.

---

# 45. INTEGRITY CHECKING

`StorageIntegrityChecker` read-only by default.

Checks:
- schema mismatch;
- broken refs;
- duplicate IDs;
- impossible lifecycle;
- revision inconsistency;
- hierarchy cycles;
- orphan ScheduledOperations;
- orphan reservations;
- deleted parents;
- invalid Secret/audience policies;
- unknown definitions;
- workforce overcommit;
- invalid role occupancy;
- explicit membership mismatch.

Repair:
- separate;
- previewable;
- audited;
- ambiguity requires human review.

---

# 46. BOOT / SAFE MODE

Boot phases:
```text
runtime compatibility check
→ storage/schema inspection
→ required migrations
→ index load/rebuild
→ registry/capability validation
→ recovery scan
→ services ready
→ UI ready
```

If integrity cannot be guaranteed:
- prevent risky mutation;
- allow recoverable reads/Diagnostics when safe;
- affected subsystem may safe-mode while independent areas remain available.

---
## Checklist antes de alterar schema

- [ ] schemaVersion muda?
- [ ] reader antigo ainda funciona?
- [ ] precisa migration?
- [ ] migration é inferível sem palpite?
- [ ] refs permanecem estáveis?
- [ ] backup exigido?
- [ ] index rebuild necessário?
- [ ] import/export format muda?
- [ ] fixture antiga atualizada?
- [ ] rollback ou recovery path definido?

## Regra de corrupção

Nunca deletar automaticamente dado canônico ambíguo.
Preferir:
```text
detect → quarantine/read-only → preview repair → backup → repair → validate
```
