# 04 — Build, versionamento, checkpoints e congelamento

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Padronizar como cada microbuild vira um estado recuperável e como retomamos após limite de Codex, troca de chat ou bug.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## Versionamento durante desenvolvimento

Formato recomendado:
```text
0.1.0-dev.N
```

O número N é monotônico no ciclo inicial.

Um gate pode conter várias dev builds:
```text
G0.1 → dev.1
G0.2 → dev.2
...
```

Não reiniciar numeração sem motivo.

## Checkpoint de build

Uma build só é checkpoint quando:
- compila;
- testes definidos para ela passam;
- package validation passa quando aplicável;
- BUILD_STATE foi atualizado;
- não há alteração local desconhecida.

## Fechamento de gate

Artifact:
```text
DomainManager-0.1.0-dev.N-GX-ACCEPTED.zip
GATE_X_ACCEPTANCE_REPORT.md
BUILD_STATE.md
```

## BUILD_STATE é obrigatório

Campos:
- versão;
- gate;
- microbuild;
- último commit/checkpoint se houver;
- implementado;
- incompleto;
- testes;
- bugs;
- dívida;
- arquivos sensíveis;
- próxima tarefa;
- prompt sugerido.

## Regra para retomar

Nova conversa/sessão:
1. abrir BUILD_STATE;
2. conferir Master;
3. abrir gate;
4. conferir código atual;
5. executar smoke test curto;
6. só então continuar.

## Nunca sobrescrever checkpoint aceito

Correção posterior gera nova build.
Se regressão exigir tocar gate fechado:
- registrar motivo;
- listar acceptance afetada;
- reexecutar testes desse gate.
