# G2 MT01 — Primary Authority deterministic election

## Resultado

**VALIDATED_SOURCE** — microtarefa G2.1a concluída sem blocker conhecido.

Esta microtarefa implementa apenas o núcleo puro de eleição da Primary Authority. Persistência, epoch, lifecycle Foundry e transport permanecem explicitamente fora do escopo.

## Base normativa

- `Documentos/GATES/12_G2_AUTHORITY_COMMANDS_MUTATIONCOORDINATOR.md` — G2.1 Primary Authority election/status.
- Master `DEC-511–520` — uma Primary Authority global por mundo e serviço explícito.
- Master `DEC-521–530` — preferred GM, fallback determinístico por User ID e independência da ordem incidental da collection.
- Master `DEC-531–540` — lifecycle será conectado em `ready` em microtarefa posterior; não foi antecipado aqui.

## Implementação

### G2-MT01-001 — Resolver puro de eleição

Arquivo:
- `src/authority/primary-authority-election.ts`

Foi criada uma projeção mínima `AuthorityElectionUser` contendo apenas:
- `id`;
- `isGM`;
- `active`.

`resolvePrimaryAuthorityUserId(users, preferredUserId)` aplica a regra:

1. filtra somente GMs ativos com ID não vazio;
2. se o preferred `userId` estiver entre os elegíveis, retorna-o;
3. caso contrário, deduplica IDs e aplica ordenação lexical explícita;
4. retorna o menor `userId` elegível;
5. retorna `null` quando não existe GM elegível.

A função retorna `userId`, não o objeto fornecido pela collection. Isso evita que duplicatas ou identidade de instância tornem o resultado dependente da ordem de entrada.

## Testes adicionados

Arquivo:
- `tests/authority/primary-authority-election.test.ts`

Casos cobertos:
1. preferred GM ativo vence;
2. preferred GM offline usa fallback;
3. preferred que é Player nunca é eleito;
4. fallback independe da ordem da collection;
5. Players e GMs inativos são ignorados;
6. nenhum GM ativo retorna `null`;
7. IDs vazios/whitespace são ignorados;
8. projeções duplicadas não alteram o resultado;
9. preferred ID exige match exato e não é silenciosamente reescrito.

## Verificações executadas

| Verificação | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| Testes novos G2.1a | PASS — 9/9 |
| Regressão completa | PASS — 80/80 |
| `npm run validate:package` | PASS |
| `npm run test:unit` oficial | NÃO EXECUTADO — `esbuild` ausente neste ambiente |

Para a regressão completa, os arquivos TypeScript foram transpilados com a instalação TypeScript disponível no ambiente e executados via `node --test`. O resultado do runner oficial não foi inventado.

## Não alterado / fora de escopo

- `src/main.ts`;
- composition root;
- Domain repository/storage;
- Foundry settings;
- authority epoch;
- transport/socket;
- authenticated sender;
- CommandBus;
- rate limit;
- dedupe;
- locks;
- Plan/Receipt;
- MutationCoordinator.

## Blockers

Nenhum blocker local conhecido nesta microtarefa.

## Dívida / pendência

O bundle `dist/main.js` não foi reconstruído porque esta microtarefa ainda não está ligada ao runtime e o `esbuild` oficial continua indisponível no ambiente. Não existe divergência funcional de runtime causada por esta etapa: o novo resolver ainda não é importado pelo entrypoint.

## Próxima microtarefa

**G2.1b — Authority epoch + stateful status service**

Objetivo:
- criar o serviço stateful que consome o resolver puro;
- manter current authority/status;
- expor `getCurrent`, `isCurrentUser`, `resolve`, `onChanged`;
- adicionar `authorityEpoch` com incremento somente quando a authority efetiva muda;
- ainda sem Foundry adapter/socket.
