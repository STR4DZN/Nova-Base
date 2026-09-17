# 06 — Definition of Done operacional

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Converter a Definition of Done do Master em checklist executável por microfeature, microbuild e gate.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.
# 55. DEFINITION OF DONE

Feature is NOT Done until all applicable items are satisfied:

- [ ] contract/schema defined;
- [ ] ownership/source-of-truth clear;
- [ ] happy path works;
- [ ] validation path works;
- [ ] failure path works;
- [ ] permission/authority correct;
- [ ] revision/idempotency handled;
- [ ] secret/projection behavior tested;
- [ ] Receipt/audit correct;
- [ ] repository/storage boundary respected;
- [ ] migration impact reviewed;
- [ ] diagnostics exist;
- [ ] tests exist;
- [ ] performance considered/measured if hot path;
- [ ] loading/empty/error/permission states exist if UI;
- [ ] keyboard/accessibility handled if UI;
- [ ] documentation/spec updated;
- [ ] recovery/rollback documented for critical mutation;
- [ ] no unresolved blocker hidden behind feature flag.

---
## DoD por microtarefa

Mínimo:
- [ ] código compila;
- [ ] objetivo da tarefa está completo;
- [ ] nenhum arquivo fora do escopo mudou sem justificativa;
- [ ] teste alvo passou;
- [ ] não introduziu TODO crítico;
- [ ] não mudou contract silenciosamente.

## DoD por microbuild

Além do acima:
- [ ] integração do pequeno cluster passa;
- [ ] error/edge path principal existe;
- [ ] docs do gate refletem realidade;
- [ ] BUILD_STATE atualizado;
- [ ] revisão Medium quando microbuild é estrutural.

## DoD por gate

Usar checklist completo do Master + acceptance report.
