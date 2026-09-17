# 11 — G1 — Canonical Storage / Domain

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Especificar em nível executável tudo que deve ser feito no G1, como o código deve ficar ao terminar e qual condição permite seguir ao gate seguinte.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## Fonte normativa principal

Master: **§8–10, §42, §45–46**

## O que este gate possui

- JournalEntry canônico de Domain
- flag namespace/codec
- DomainRepository
- schema/revision
- identity/classification/lifecycle
- hierarchy
- capability shell
- World/Domain indexes
- integrity checks

## O que NÃO pertence a este gate

- socket/public Command pipeline definitivo
- People
- Economy
- complex UI

## Estado esperado ao finalizar

Ao encerrar este gate, o repositório deve possuir uma implementação vertical coerente, sem caminhos temporários públicos que serão “consertados depois”. Interfaces/shells de gates futuros podem existir apenas quando necessários para contract/compilação, sem business behavior falso.

## Microbuilds planejadas

| Microbuild | Objetivo | Saída verificável |
|---|---|---|
| G1.1 | Domain schema lógico + validators | shape canônico versionado |
| G1.2 | Domain codec JournalEntry/flags | round-trip sem duplicar name |
| G1.3 | DomainRepository read/query/save | storage boundary funcional |
| G1.4 | Create/load/update/archive/restore internos | lifecycle testável antes de G2 |
| G1.5 | Revision/no-op semantics | optimistic contract provado |
| G1.6 | Hierarchy + cycle validator | reparent interno seguro |
| G1.7 | Capability config/effective shell | enabled/config + resolver base |
| G1.8 | Index rebuild/incremental update | queries sem full scan comum |
| G1.9 | Integrity checker Domain | broken ref/schema/cycle diagnostics |
| G1.10 | Acceptance + migration seed | primeiro formato canônico congelado |

## Áreas/arquivos esperados

```text
src/domains/*
src/storage/codecs/domain*
src/storage/repositories/domain*
src/storage/indexes/domain*
src/storage/integrity/domain*
tests/domains/*
tests/storage/domain*
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

- [ ] JournalEntry.name é única verdade do nome
- [ ] round-trip codec
- [ ] revision correta
- [ ] archive/restore
- [ ] cycle bloqueado
- [ ] index rebuild reproduz estado
- [ ] UI/consumer não usa raw flags
- [ ] unknown IDs preserváveis conforme policy

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
