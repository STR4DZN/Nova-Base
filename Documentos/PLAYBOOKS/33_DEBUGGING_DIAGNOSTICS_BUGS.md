# 33 — Debugging, Diagnostics e Bug-Fix Playbook

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Definir como investigar bugs sem aplicar patches aleatórios ou quebrar contracts.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## Fluxo de bug

```text
REPRODUCE
→ CLASSIFY
→ IDENTIFY OWNER
→ IDENTIFY CONTRACT
→ MINIMAL ROOT CAUSE
→ REGRESSION TEST
→ FIX
→ TARGETED TEST
→ ADJACENT TEST
→ BUILD_STATE
```

## Classificação

- UI/presentation;
- validation;
- permission;
- revision/conflict;
- storage/codec;
- broken ref;
- registry;
- provider;
- socket;
- authority;
- transaction/recovery;
- projection/leakage;
- performance;
- migration.

## Regra de correção

Não corrigir symptom em layer errada.

Exemplo:
- botão duplica Command → não “desabilitar por 2s” como única solução; corrigir idempotency/submit lock apropriado.
- dado secreto aparece → não esconder CSS; corrigir projection.
- total errado → não ajustar display; corrigir resolver/source.

## Pacote mínimo para bug vindo do Foundry

- versão/build;
- gate;
- passos;
- expected;
- actual;
- console;
- screenshot;
- world/fixture;
- usuário/role;
- diagnostic report quando disponível.

## Regressão em gate fechado

Se tocar contract de gate fechado:
- marcar gate afetado;
- reexecutar acceptance subset;
- atualizar report.
# 53. DIAGNOSTICS / SUPPORT

GM Diagnostics should expose:
- module/build/schema versions;
- Foundry/dependency versions;
- Primary Authority + epoch;
- queue;
- locks;
- transactions/recoveries;
- provider health;
- registry conflicts;
- unknown IDs;
- broken refs;
- migrations pending/history;
- quarantine;
- index/cache state;
- scheduler backlog;
- performance summaries when enabled.

Generate Diagnostic Report:
- sanitized by default;
- no secret narrative/raw payload unnecessary;
- user can knowingly include extra detail.

---
