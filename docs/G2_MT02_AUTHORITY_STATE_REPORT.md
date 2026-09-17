# G2 MT02 — Authority Epoch + Stateful Status Service

## Resultado

**VALIDATED_SOURCE**

A microtarefa G2.1b foi implementada e validada localmente sem introduzir dependências de Foundry, socketlib, CommandBus ou MutationCoordinator.

## Escopo normativo

Fonte principal: `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`, Authority DEC-511–540, e `GATES/12_G2_AUTHORITY_COMMANDS_MUTATIONCOORDINATOR.md`.

Invariantes aplicadas:
- uma Primary Authority técnica efetiva por mundo;
- preferred GM e fallback continuam sendo resolvidos pelo core puro já aprovado em G2.1a;
- existe `authorityEpoch`;
- epoch muda somente quando a authority efetiva muda;
- reordenação de collection e alterações irrelevantes não criam churn;
- o serviço expõe `getCurrent()`, `isCurrentUser()`, `resolve()` e `onChanged()`;
- Foundry lifecycle/persistence continuam fora desta microtarefa.

## Implementação

### Novo arquivo

`src/authority/primary-authority-service.ts`

Responsabilidades:
- manter `authorityUserId` e `authorityEpoch` em memória;
- consumir a eleição determinística de `primary-authority-election.ts`;
- expor status interno e snapshot reidratável;
- comparar o usuário local com a authority atual;
- notificar listeners apenas em mudança efetiva;
- impedir overflow de epoch sem aplicar estado parcial.

### Estado inicial e epoch

Uma instância não inicializada usa o primeiro `resolve()` apenas para estabelecer baseline. Isso evita incrementar epoch simplesmente porque o módulo foi carregado novamente.

Quando um adapter futuro reidrata estado conhecido (`initialized: true`), uma diferença entre a authority persistida/anterior e a nova eleição incrementa o epoch normalmente.

A persistência real será responsabilidade da G2.1c; esta microtarefa não inventa world settings nem source-of-truth novo.

## Testes adicionados

`tests/authority/primary-authority-service.test.ts`

14 casos novos:
1. primeiro resolve estabelece baseline sem incrementar epoch;
2. reordenação da collection não gera churn;
3. failover efetivo incrementa uma única vez;
4. preferred GM que volta reassume e incrementa uma vez;
5. preferred irrelevante não incrementa epoch;
6. perda total de authority incrementa epoch;
7. retorno após estado sem authority incrementa epoch;
8. `isCurrentUser()` compara somente o ID efetivamente resolvido;
9. `onChanged()` dispara apenas em mudança real e unsubscribe é idempotente;
10. reidratação com mesma authority preserva epoch;
11. reidratação com authority obsoleta incrementa epoch;
12. snapshot é congelado e adequado a adapter de persistência;
13. epochs iniciais inválidos são rejeitados;
14. overflow de epoch falha atomicamente, sem trocar authority parcialmente.

## Testes executados

- `npm run typecheck` — **PASS**
- suíte completa por transpile TypeScript + `node --test` — **PASS: 94/94**
- testes novos G2.1b — **PASS: 14/14**
- `npm run validate:package` — **PASS**

O runner oficial `npm run test:unit` continua indisponível neste ambiente porque `esbuild` não está instalado localmente e o registry externo não está acessível. Nenhum resultado desse runner foi inventado.

## Erro encontrado durante a própria implementação

### MT02-ERR-001 — overflow poderia produzir estado parcial

**Severidade:** alta defensiva.

Durante a revisão antes da suíte, a primeira versão alterava `authorityUserId` antes de calcular o próximo epoch. Se o epoch já estivesse em `Number.MAX_SAFE_INTEGER`, o incremento falharia depois da authority ter sido trocada.

### Solução

O próximo epoch passou a ser calculado e validado **antes** de qualquer alteração de estado. Assim, overflow mantém tanto authority quanto epoch inalterados.

Teste de regressão incluído.

## Não alterado

- G1 repository/storage;
- composition root do MT00;
- algoritmo puro de eleição do MT01;
- manifest e versão do módulo;
- `dist/main.js` / runtime package;
- transport/socket;
- CommandBus;
- dedupe;
- locks;
- MutationCoordinator;
- transaction/recovery.

## Risco / dívida

O Master exige persistência leve do epoch e lifecycle ligado a `ready`/mudanças de usuários. Isso permanece explicitamente pendente para **G2.1c** e não foi simulado dentro do core stateful.

## Próxima microtarefa

**G2.1c — Foundry authority adapter + ready/reconciliation lifecycle + lightweight state persistence.**

Objetivo: integrar `game.users`, `game.user` e world settings ao core já testado, resolver a authority em `ready` e recalcular em eventos apropriados, sem ainda implementar CommandTransport/socket.

## Errata posterior — G2.1c

A integração Foundry da G2.1c revelou um problema de convergência na semântica original dos itens 6–7 deste relatório: incrementar epoch ao entrar em um estado sem GM e incrementá-lo novamente ao sair dele pode produzir epochs locais impossíveis de persistir enquanto não existe autoridade com permissão de world setting.

A implementação canônica atual, validada em G2.1c, substitui essa semântica:
- ausência temporária de GM torna a authority indisponível, mas preserva a identidade do último executor técnico e o epoch;
- retorno do mesmo GM não incrementa epoch;
- entrada de um GM diferente incrementa exatamente uma vez;
- a identidade + epoch são persistidos atomicamente pelo adapter Foundry.

Esta errata não invalida os demais contratos do MT02; corrige especificamente a semântica de disponibilidade/failover descoberta somente quando o lifecycle persistido foi integrado.
