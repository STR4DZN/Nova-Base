# 03 — Protocolo Chat + Codex/Luna em microtarefas

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Permitir desenvolver o projeto com limite de contexto/uso, usando Luna Low como executor de tarefas pequenas sem perder a arquitetura.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## Modelo recomendado

- **Luna Low:** implementação de microtarefas fechadas.
- **Luna Medium:** revisão de um pequeno cluster/microbuild.
- **High/Sol quando disponível:** bugs sistêmicos, concurrency, recovery, migration perigosa, fechamento de gate.

## Tamanho de tarefa

### Ideal para Low
- 1 interface;
- 1 codec;
- 1 repository method cluster;
- 1 validator;
- 1 component primitive;
- 1 Command simples;
- 1 conjunto pequeno de testes.

### Subir esforço
Quando:
- 3+ boundaries interagem;
- concurrency;
- unknown outcome;
- migration destrutiva;
- refactor cross-system;
- segurança/projection;
- final de gate.

## Prompt deve sempre conter

1. objetivo;
2. gate/microbuild;
3. documentos a ler;
4. arquivos permitidos;
5. arquivos proibidos;
6. comportamento esperado;
7. invariantes;
8. testes;
9. definição de conclusão;
10. ordem para parar em conflito.

## Regra de edição

Codex não recebe “melhore o projeto”.
Recebe:
> “Implemente exclusivamente X conforme Master §Y e Gate Gx.y. Não altere Z. Rode T. Se precisar mudar contract, pare.”

## Revisão em camadas

```text
Low implementa
→ targeted tests
→ Low implementa próxima
→ targeted tests
→ Medium revisa microbuild
→ gate docs atualizados
→ checkpoint
```

## Controle de contexto

Não passar os 23 mil lines do Master inteiro a cada tarefa se Codex puder ler o arquivo no repo. Fornecer:
- Master no repo;
- Gate doc;
- microtask doc/prompt;
- BUILD_STATE.

## Proibições

- não pedir “continue de onde parou” sem BUILD_STATE;
- não confiar em memória de sessão;
- não aceitar “testes parecem bons” sem comando/resultado;
- não permitir alteração fora do escopo só para resolver TypeScript;
- não reformatar o projeto inteiro;
- não atualizar dependências por iniciativa própria;
- não trocar biblioteca/build tooling sem decisão.

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
