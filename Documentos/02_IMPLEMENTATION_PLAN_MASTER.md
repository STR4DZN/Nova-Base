# 02 — Implementation Plan Master — G0 a G12

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Transformar a arquitetura congelada em uma sequência executável, testável e retomável de desenvolvimento.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## Estratégia

Não construiremos subsistemas inteiros em uma única solicitação. Cada gate é dividido em microbuilds; cada microbuild é dividida em microtarefas.

### Sequência normativa

```text
G0  Skeleton / Infrastructure
G1  Canonical Storage / Domain
G2  Authority / Commands / MutationCoordinator
G3  People
G4  Economy
G5  Projects / Facilities / Downtime
G6  Relations / Reputation / Agreements / Territory
G7  Requests / Missions / Knowledge / Secrets
G8  Time / Scheduler / Events / Conditions / Actions
G9  UI / UX / Explorer / Operations
G10 Migrations / Import-Export / Recovery
G11 Hardening / Performance / Multiplayer
G12 Beta / RC / Stable
```

## Dependência entre gates

- G1 depende do bootstrap/core de G0.
- G2 depende dos IDs/contracts/repository boundaries de G0–G1.
- G3–G8 dependem de G2 para mutations públicas.
- G4 reutiliza People workforce; não o duplica.
- G5 reutiliza G3/G4; não toca internals.
- G6 fornece rights/capabilities consumíveis pelos gates seguintes.
- G7 exige ProjectionService robusto.
- G8 integra tudo por Commands/Plans, nunca por writes diretos.
- G9 apresenta os read models; não cria verdade paralela.
- G10 consolida evolução/recovery depois que formatos reais existem.
- G11 tenta quebrar tudo antes de release.
- G12 empacota apenas o que passou nos gates anteriores.

## Regra de passagem

Um gate NÃO fecha porque “a tela abriu”.
Fecha somente quando:
- deliverables existem;
- acceptance tests passam;
- erros esperados são tratados;
- documentação foi atualizada;
- BUILD_STATE registra evidência;
- bugs blockers estão zerados;
- não existe bypass conhecido.

## Outputs por gate

Cada gate deve produzir:
1. código;
2. testes;
3. `GATE_<N>_ACCEPTANCE_REPORT.md`;
4. BUILD_STATE atualizado;
5. ZIP/checkpoint quando o gate fechar;
6. lista de dívida explicitamente não-blocking;
7. próxima tarefa exata.

## Política de escopo

Nunca puxar feature de gate posterior “porque é fácil”.
É permitido criar interface/shell necessária para compilar, desde que:
- não tenha business behavior falso;
- esteja marcada;
- não vire caminho público;
- seja completada no gate dono.

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
