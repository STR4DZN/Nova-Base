# 37 — Release e Packaging Playbook

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Definir como transformar checkpoints em Alpha/Beta/RC/Stable reproduzíveis e recuperáveis.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.
# 52. RELEASE ENGINEERING

Version channels:
```text
dev → alpha → beta → rc → stable
```

Semantic versioning.

Stable requires:
- no known data-loss blocker;
- no known secret leakage blocker;
- no known authority bypass;
- critical migrations rehearsed;
- package install tested;
- supported upgrade tested;
- recovery path;
- diagnostics;
- release notes;
- performance smoke pass;
- multiplayer smoke pass.

Build:
- reproducible;
- validates module manifest;
- validates entrypoints/assets;
- excludes unnecessary dev artifacts;
- deterministic where possible;
- final ZIP itself is tested.

CI:
- lint/static;
- unit;
- critical integration;
- migrations;
- security/projection;
- package validation;
- selected E2E/performance gates.

---
## Artefato que vale

O que foi testado é o ZIP final, não apenas source tree.

Antes de publicar:
- package clean;
- module manifest correto;
- clean install;
- supported upgrade;
- migration rehearsal;
- restore/recovery;
- changelog;
- known issues;
- diagnostics;
- compatibility.

## Stable blockers absolutos

- data loss;
- secret leakage;
- authority bypass;
- migration unsafe;
- package incompatível com promessa suportada.
