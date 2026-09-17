# 34 — Security, Secrets e Projection Playbook

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Tratar visibility e secret handling como boundary de segurança e não como styling.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.
# 25. SECRETS E PROJECTION

Secret = restriction/discoverability.

Can protect:
- entity;
- field;
- claim;
- term;
- objective;
- fact;
- source/evidence.

Disclosure levels:
```text
hidden
hinted
partial
full
```

Rules:
- authority-side projection;
- unauthorized fields omitted;
- `***` mask not default;
- unknown/rumored uses dedicated DTO;
- revoking access does not erase already acquired Knowledge by default;
- discovery is explicit/auditable;
- discovery may reveal partial;
- sharing cannot exceed possessed disclosure unless authorized;
- counts/search/sort/grouping/cache must not leak secret existence.

`ProjectionService` is a critical security boundary.

---
## Regras de implementação

- canonical secret data preferencialmente authority/GM-side;
- projection ocorre antes de transporte;
- DTO unauthorized omite field;
- cache key inclui audience/context;
- search index é sanitizado;
- counts/grouping/sort não inferem secret;
- logs/diagnostics sanitizados;
- export share sanitizado;
- hooks públicos não carregam payload secreto.

## Testes negativos obrigatórios

Tentar vazar por:
- payload socket;
- DOM;
- autocomplete;
- no-results count;
- group count;
- sort order;
- error details;
- diagnostic report;
- export;
- cache reutilizado entre audiences.
