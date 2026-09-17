# 35 — Performance e Scalability Playbook

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Garantir que o mesmo core funcione na base pequena e no império sem transformar performance em desculpa para quebrar invariants.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.
# 51. PERFORMANCE

Measure first.

Budgets/categories:
- micro interaction;
- navigation/open;
- common query;
- heavy read;
- batch;
- migration/import/export.

Measure:
- duration;
- records scanned;
- cache hit/miss;
- invalidations;
- socket payload;
- render time;
- DOM count;
- rerenders;
- index rebuild;
- memory growth.

## 51.1. Rendering

- hidden tabs not fully rendered;
- collapsed branches no descendants;
- inspector history lazy;
- thousands rows use paging/virtualization;
- Gantt/Graph range-limited;
- avoid expensive effects in repeated rows.

## 51.2. Memory

- indices store minimal lookup data;
- histories not all resident;
- caches bounded;
- listeners/timers cleaned;
- object URLs revoked;
- long-running Foundry sessions tested.

## 51.3. Socket

- commands compact;
- receipts compact;
- targeted audience updates;
- no broadcast of secrets;
- visual refresh coalescing;
- chunk large result;
- full resync as recovery, not default.

## 51.4. Workers

Optional only for pure derived work:
- search index;
- graph layout;
- diagnostics;
- analytics.

Worker:
- no authority;
- no direct Foundry mutation;
- receives serializable sanitized snapshots.

---
## Datasets padrão

- SMALL: base ~12 NPCs;
- MEDIUM: centenas de records;
- LARGE: muitos Domains + milhares de records;
- HISTORY: long history/scheduler backlog;
- MULTIUSER: players simultâneos.

## Antes de otimizar

Registrar:
- cenário;
- hardware;
- dataset;
- metric;
- baseline;
- target.

Depois:
- alterar;
- medir novamente;
- provar correctness;
- reverter se complexidade não compensar.

## Weak PC

É acceptance target real, não nota de rodapé.
