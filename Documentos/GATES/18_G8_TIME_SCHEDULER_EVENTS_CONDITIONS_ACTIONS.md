# 18 — G8 — Time / Scheduler / Events / Conditions / Actions

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Especificar em nível executável tudo que deve ser feito no G8, como o código deve ficar ao terminar e qual condição permite seguir ao gate seguinte.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## Fonte normativa principal

Master: **§26–32, §11–12**

## O que este gate possui

- TimeProvider
- CalendarAdapter
- Scheduler
- ScheduledOperation
- Events
- Conditions
- Actions
- Triggers
- AutomationPolicy
- Resolve Period

## O que NÃO pertence a este gate

- direct game.time em subsystem
- setTimeout como scheduler persistente
- Event implicar mutation
- safeAuto irrestrito

## Estado esperado ao finalizar

Ao encerrar este gate, o repositório deve possuir uma implementação vertical coerente, sem caminhos temporários públicos que serão “consertados depois”. Interfaces/shells de gates futuros podem existir apenas quando necessários para contract/compilação, sem business behavior falso.

## Microbuilds planejadas

| Microbuild | Objetivo | Saída verificável |
|---|---|---|
| G8.1 | TimeProvider + Foundry adapter | canonical time boundary |
| G8.2 | CalendarAdapter | presentation-only |
| G8.3 | ScheduledOperation persistence | stable/versioned/idempotent |
| G8.4 | Scheduler queue/retry/checkpoint | due≠happened |
| G8.5 | Events/correlation/causation | append-oriented occurrence |
| G8.6 | Conditions | stack/expiry/resistance |
| G8.7 | Actions | availability→Command façade |
| G8.8 | Trigger/AutomationPolicy | manual/advisory/review first |
| G8.9 | Resolve Period | ordered child plans |
| G8.10 | Catch-up/restart acceptance | deterministic/idempotent |

## Áreas/arquivos esperados

```text
src/time/*
src/scheduler/*
src/events/*
src/conditions/*
src/actions/*
src/automation/*
tests/{time,scheduler,events,conditions,actions,automation}/*
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

- [ ] no direct clock coupling
- [ ] rollback time não desfaz state
- [ ] scheduler retry idempotente
- [ ] event não muta
- [ ] condition não sobrescreve base
- [ ] action gera Command
- [ ] safeAuto opt-in
- [ ] Resolve Period order correto
- [ ] large jump sem microtick brute force quando agregável

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
