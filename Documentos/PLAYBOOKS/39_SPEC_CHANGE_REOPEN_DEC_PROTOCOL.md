# 39 — Spec Conflict, mudança arquitetural e reabertura de DEC

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Definir como reagir quando o código provar que uma regra precisa ser revista, sem criar arquitetura paralela silenciosamente.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.
# 60. IMPLEMENTATION FREEDOMS THAT DO NOT REQUIRE A NEW DECISION

A developer may refine without architectural reapproval:
- internal function names;
- file names;
- private helper classes;
- exact CSS values within approved token semantics;
- exact pagination page size;
- exact performance threshold after benchmarks;
- exact index data structure;
- whether a pure calculation uses loop/map/reduce;
- internal test framework configuration.

A new DEC/spec update IS required if changing:
- source-of-truth;
- authority boundary;
- identity/ID semantics;
- public contract;
- lifecycle meaning;
- storage meaning;
- secret/projection rule;
- cross-system ownership;
- migration semantics;
- destructive safety tier;
- supported compatibility promise;
- final implementation gate scope materially.

---
## Formato SPEC CONFLICT

```markdown
# SPEC CONFLICT — SC-XXXX

## Contexto
Gate/build/microtask.

## Regra atual
Master §...

## Problema concreto
Por que a implementação não consegue satisfazer a regra.

## Evidência
Foundry/API/test/limitação observada.

## Opções
A...
B...

## Impacto
Schema / migration / authority / UI / tests / compatibility.

## Recomendação
...

## Decisão
PENDENTE
```

Enquanto pendente:
- não improvisar solução permanente;
- pode criar teste reproduzindo o conflito;
- pode criar spike isolado sem merge.
