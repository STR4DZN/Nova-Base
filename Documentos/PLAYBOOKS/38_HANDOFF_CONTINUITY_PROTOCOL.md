# 38 — Handoff e Continuidade entre chats/Codex

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Garantir retomada exata mesmo quando limite bate, uma conversa termina ou outra IA assume.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## Handoff Pack mínimo

1. Master;
2. este Implementation Package;
3. source ZIP/repository atual;
4. BUILD_STATE;
5. gate doc;
6. último Acceptance Report;
7. bugs conhecidos;
8. próxima microtask;
9. último prompt executado;
10. resultados de testes.

## BUILD_STATE deve responder

- onde estamos?
- o que está pronto?
- o que não está?
- o que quebrou?
- o que foi testado?
- quais arquivos são sensíveis?
- qual é a próxima alteração exata?
- qual esforço de modelo recomendado?

## Nova sessão nunca começa com

“Continue o projeto.”

Começa com algo como:
> “Abra BUILD_STATE, Master e G4. Estamos em G4.5/dev.37. Execute apenas a próxima microtask registrada.”

## Antes de encerrar por limite

Se houver tempo para uma única ação:
**atualizar BUILD_STATE**.

Não iniciar nova microtask perto do limite se não houver espaço para testar e registrar resultado.
