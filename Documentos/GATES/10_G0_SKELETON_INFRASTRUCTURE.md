# 10 — G0 — Skeleton / Infrastructure

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Especificar em nível executável tudo que deve ser feito no G0, como o código deve ficar ao terminar e qual condição permite seguir ao gate seguinte.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## Fonte normativa principal

Master: **§5–7, §46, §52–53, §56–58**

## O que este gate possui

- bootstrap do módulo
- toolchain TypeScript/esbuild
- core Result/Error/IDs/Refs
- registries base
- version/build metadata
- logging/diagnostics shell
- interfaces de repository
- test harness
- package validation

## O que NÃO pertence a este gate

- Domain business behavior
- Authority real
- People/Economy
- UI final
- migrations reais

## Estado esperado ao finalizar

Ao encerrar este gate, o repositório deve possuir uma implementação vertical coerente, sem caminhos temporários públicos que serão “consertados depois”. Interfaces/shells de gates futuros podem existir apenas quando necessários para contract/compilação, sem business behavior falso.

## Microbuilds planejadas

| Microbuild | Objetivo | Saída verificável |
|---|---|---|
| G0.1 | Bootstrap Foundry + module.json | módulo instala e hooks init/ready executam |
| G0.2 | TypeScript + esbuild + scripts | build limpo e reproduzível |
| G0.3 | Version/build metadata | versão disponível em runtime/diagnostics |
| G0.4 | Result/PublicError/contracts base | boundaries tipadas e testadas |
| G0.5 | IDs/Refs/namespaces | factories/validators sem depender de Foundry onde possível |
| G0.6 | Registry infrastructure | registro, freeze, collision detection |
| G0.7 | Logging + Diagnostics shell | diagnostic snapshot mínimo sem secrets |
| G0.8 | Repository interfaces/storage adapter shell | interfaces existem sem business logic |
| G0.9 | Test harness + fixtures mínimas | unit tests executáveis |
| G0.10 | Packaging/smoke | ZIP instala em world vazio |

## Áreas/arquivos esperados

```text
module.json
package.json
tsconfig.json
esbuild config
src/main.ts
src/core/*
src/diagnostics/*
src/storage/repositories/contracts/*
tests/core/*
docs/BUILD_STATE.md
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

- [ ] instalação limpa
- [ ] sem erro crítico no console
- [ ] build determinístico o suficiente
- [ ] tests executam
- [ ] registry collision falha de forma estruturada
- [ ] Result/Error contracts validados
- [ ] package contém somente runtime/docs necessários

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
