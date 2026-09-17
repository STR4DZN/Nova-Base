# 01 — Autoridade documental, rastreabilidade e precedência

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Definir de maneira inequívoca qual documento é normativo, qual é operacional e como rastrear uma decisão até os 12 Decision Registers.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## Hierarquia documental

### Nível 1 — Norma
`DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`

Define:
- source-of-truth;
- contratos;
- invariantes;
- boundaries;
- semântica dos subsistemas;
- gates finais;
- Definition of Done.

### Nível 2 — Execução
Este pacote.

Define:
- ordem de implementação;
- decomposição em microbuilds;
- arquivos esperados;
- acceptance operacional;
- procedimentos de teste, handoff e release.

### Nível 3 — Estado real do repositório
`docs/BUILD_STATE.md`

Define:
- gate atual;
- build atual;
- o que realmente existe;
- testes que realmente passaram;
- bugs conhecidos;
- próxima tarefa exata.

### Nível 4 — Evidência
- tests;
- acceptance reports;
- diagnostic reports;
- release artifacts;
- Decision Registers históricos.

## Regra de precedência

```text
MASTER-NORM explícita
> decisão posterior que substitui anterior
> regra subsystem-specific válida
> regra global
> Decision Register histórico
> plano operacional
> comentário / memória / palpite
```

## O que exige reabertura formal

Exige nova decisão quando alterar:
- source-of-truth;
- autoridade;
- IDs;
- public contract;
- lifecycle;
- storage semantics;
- secret/projection;
- ownership cross-system;
- migration semantics;
- destructive safety;
- compatibility promise;
- scope material de gate.

Não exige nova DEC:
- nome de helper privado;
- organização interna de função;
- tamanho de página;
- threshold de benchmark ajustado por medição;
- estrutura interna de índice;
- CSS exato dentro dos tokens;
- framework interno de teste.

## Traceability tag recomendada

Em comentários ou docs, quando útil:
```text
SPEC: Master §11.3
ROUND: R04 / DEC-...
GATE: G2.4
```

Não poluir todo código com DEC; usar em contracts sensíveis e pontos não óbvios.
