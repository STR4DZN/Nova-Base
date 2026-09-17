# 12 — G2 — Authority / Commands / MutationCoordinator

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Especificar em nível executável tudo que deve ser feito no G2, como o código deve ficar ao terminar e qual condição permite seguir ao gate seguinte.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## Fonte normativa principal

Master: **§11–12, §6–7, §47–49**

## O que este gate possui

- PrimaryAuthorityService
- authority epoch/failover
- CommandTransport
- AuthenticatedCommandContext
- CommandBus/registry
- dedupe
- rate limiting
- LockManager
- Plan/Receipt
- MutationCoordinator
- transaction/recovery shells
- multiplayer harness

## O que NÃO pertence a este gate

- duplicar business rules de subsystems
- permitir UI→repository write
- full advanced recovery de G10/G11

## Estado esperado ao finalizar

Ao encerrar este gate, o repositório deve possuir uma implementação vertical coerente, sem caminhos temporários públicos que serão “consertados depois”. Interfaces/shells de gates futuros podem existir apenas quando necessários para contract/compilação, sem business behavior falso.

## Microbuilds planejadas

| Microbuild | Objetivo | Saída verificável |
|---|---|---|
| G2.1 | Primary Authority election/status | uma authority técnica por vez |
| G2.2 | Transport adapter + authenticated sender | client não controla identity |
| G2.3 | Command envelope/registry | public/internal handlers diferenciados |
| G2.4 | Validation/permission/rate limit | pipeline antes de handler |
| G2.5 | Dedupe + command status | retry mesmo ID sem duplicação |
| G2.6 | LockManager ordered multi-key | sem deadlock básico |
| G2.7 | Plan + Receipt contracts | preview/commit separáveis |
| G2.8 | MutationCoordinator mínimo | fresh read após locks + revision |
| G2.9 | Transaction/Recovery shell | states existem sem fingir atomicidade |
| G2.10 | Multiplayer/failover acceptance | bypass importante impossível |

## Áreas/arquivos esperados

```text
src/authority/*
src/commands/*
src/mutations/*
src/audit/*
tests/authority/*
tests/commands/*
tests/mutations/*
tests/multiplayer/*
```

Os nomes exatos podem mudar, mas os boundaries não.

## Como implementar cada microbuild

Para cada linha da tabela:
1. abrir Master nas seções indicadas;
2. listar contracts afetados;
3. responder o Breach-Prevention Checklist relevante;
4. dividir em microtarefas Luna Low;
5. implementar código;
6. executar teste alvo;
7. revisar cluster em Medium quando necessário;
8. atualizar BUILD_STATE;
9. não iniciar microbuild seguinte com erro conhecido blocker.

## Acceptance obrigatório do gate

- [ ] sender autenticado no authority side
- [ ] internal-only rejeitado via socket
- [ ] same commandId/same intent dedupe
- [ ] same commandId/different payload conflict
- [ ] ordered locks
- [ ] stale revision conflict
- [ ] timeout não tratado como failure
- [ ] Receipt não substitui state
- [ ] mutation importante não bypassa Authority

## Testes mínimos

Além dos testes específicos:
- happy path;
- invalid input;
- missing ref/provider/capability quando aplicável;
- stale revision quando houver mutation;
- no-op;
- permission/authority;
- serialization/round-trip quando persistido;
- reload/restart quando houver estado persistente;
- player vs GM quando houver visibility;
- small fixture;
- scale fixture quando o subsystem puder crescer.

## Diagnóstico

Todo erro que um GM possa encontrar em uso real deve ter uma forma razoável de ser:
- identificado;
- categorizado;
- correlacionado;
- explicado sem expor secret;
- recuperado ou encaminhado para repair.

## Condição de parada

Emitir `SPEC CONFLICT` se a implementação exigir:
- novo source-of-truth;
- bypass de owner;
- alterar public contract;
- persistir derived value contraditório;
- entregar secret ao client;
- comportamento incompatível com lifecycle aprovado;
- mudança de gate para “facilitar”.

## Como continuar depois

Quando acceptance estiver verde:
1. gerar `GATE_{gate}_ACCEPTANCE_REPORT.md`;
2. gerar ZIP/checkpoint aceito;
3. atualizar BUILD_STATE para `GATE_ACCEPTED`;
4. registrar dívidas non-blocking;
5. apontar primeira microbuild do próximo gate;
6. só então começar o próximo gate.

## Regra de microtarefas para Codex/Luna

Por padrão, uma microtarefa deve:
- ter **um objetivo verificável**;
- tocar preferencialmente **1–3 arquivos** e, quando necessário, no máximo um pequeno cluster coeso;
- declarar explicitamente arquivos permitidos e arquivos proibidos;
- citar as seções do Master e deste gate;
- não introduzir feature adjacente;
- não fazer refactor transversal por conveniência;
- executar testes direcionados;
- registrar o resultado em `docs/BUILD_STATE.md` somente depois de validação;
- parar e emitir `SPEC CONFLICT` se a especificação não permitir uma implementação inequívoca.

Formato de conclusão esperado:
```text
IMPLEMENTADO
- ...

TESTADO
- ...

NÃO ALTERADO
- ...

RISCO / DÍVIDA
- ...

PRÓXIMA MICROPARTE
- ...
```
