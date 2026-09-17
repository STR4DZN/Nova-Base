# G2 — Microtarefa de Fundação — Composition Root do Runtime

## Status

**VALIDATED_SOURCE**

Esta microtarefa prepara a passagem segura de G1 para G2 sem implementar Authority, CommandBus, transport, locks ou mutations.

## Objetivo

Fazer o runtime real do módulo compor os serviços canônicos já implementados em G1, em vez de manter `src/main.ts` restrito ao bootstrap G0.

## Base normativa

- `Documentos/GATES/12_G2_AUTHORITY_COMMANDS_MUTATIONCOORDINATOR.md`
- Master §11–12 e regras de dependency boundaries
- Authority é resolvida em `ready`, não em `init`
- UI e outros subsistemas não recebem caminho de write direto ao repository

## Implementado

### `src/bootstrap/domain-manager-runtime.ts`

- criado composition root explícito;
- `FoundryDomainDocumentStore` é a boundary de produção padrão;
- `DomainRepository` é construído uma única vez pela composição;
- store pode ser injetado em testes;
- o objeto de runtime é congelado;
- nenhum write ocorre durante composição.

### `src/main.ts`

- `init` continua registration-only;
- runtime dependente de world é composto apenas em `ready`;
- removido comentário obsoleto que ainda descrevia o entrypoint como G0.1.3;
- nenhum command, mutation path ou Authority foi antecipado.

### Testes

Criados:

- `tests/core/runtime-composition.test.ts`
  - composição usa a boundary injetada;
  - composição não causa writes.
- `tests/core/main-bootstrap.test.ts`
  - `init` não depende de collections do mundo;
  - `ready` compõe o runtime Foundry;
  - bootstrap não cria JournalEntry por efeito colateral.

## Testes executados

- `tsc --noEmit`: **PASS**
- suíte completa via transpile TypeScript + `node --test`: **71/71 PASS**

O runner nativo `npm run test:unit` não foi executado porque o checkpoint não inclui `node_modules` e o registry npm não está acessível neste ambiente.

## Packaging / runtime

O `dist/main.js` **não foi regenerado** nesta microtarefa. O build oficial usa `esbuild 0.27.2`, indisponível localmente sem o registry. Por isso este checkpoint deve ser tratado como **source checkpoint**, não como novo ZIP de runtime Foundry.

Nenhum resultado de runtime novo foi inventado.

## Invariantes preservados

- G1 continua owner da persistência Domain;
- nenhum caminho UI → repository write foi criado;
- nenhuma mutation importante ganhou bypass de Authority;
- `init` não usa world state;
- dependências Foundry ficam na composition boundary;
- G2.2+ não foi antecipado.

## Próxima microtarefa exata

**G2.1 — Primary Authority election/status**

Escopo inicial:

1. contrato `PrimaryAuthorityService`;
2. preferred GM configurável por abstração de settings;
3. fallback determinístico por `userId` entre GMs ativos;
4. authority epoch;
5. status read-only;
6. testes para zero, um e dois GMs ativos, preferred offline/online e ordem incidental diferente.

Não incluir ainda transport/socket, CommandBus, dedupe ou locks.
