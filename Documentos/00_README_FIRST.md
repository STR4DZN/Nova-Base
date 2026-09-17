# 00 — LEIA PRIMEIRO — Mapa do pacote de implementação

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Ser o ponto de entrada obrigatório para qualquer conversa, sessão de Codex ou desenvolvedor que vá continuar o Domain Manager.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

## O que existe neste pacote

Este pacote NÃO substitui o Master. Ele quebra o Master em documentos executáveis.

### Ordem obrigatória de leitura para começar uma sessão

1. `00_README_FIRST.md`
2. `01_DOCUMENT_AUTHORITY_AND_TRACEABILITY.md`
3. `02_IMPLEMENTATION_PLAN_MASTER.md`
4. `03_CHAT_CODEX_MICROTASK_PROTOCOL.md`
5. `04_BUILD_VERSIONING_CHECKPOINTS.md`
6. Documento do **gate atual**
7. Playbook específico se a tarefa envolver storage, UI, segurança, concorrência, performance ou release
8. `docs/BUILD_STATE.md` do repositório quando ele existir

### Documentos-raiz

- `01_DOCUMENT_AUTHORITY_AND_TRACEABILITY.md` — qual documento manda em quê.
- `02_IMPLEMENTATION_PLAN_MASTER.md` — ordem G0→G12 e mapa de trabalho.
- `03_CHAT_CODEX_MICROTASK_PROTOCOL.md` — como trabalhar com Luna/Codex em partes pequenas.
- `04_BUILD_VERSIONING_CHECKPOINTS.md` — como versionar, congelar e retomar.
- `05_CODING_STANDARDS_AND_DEPENDENCIES.md` — limites físicos do código.
- `06_FEATURE_DEFINITION_OF_DONE.md` — quando uma feature pode ser considerada pronta.

### Gates

- `GATES/10_G0_SKELETON_INFRASTRUCTURE.md`
- `GATES/11_G1_CANONICAL_STORAGE_DOMAIN.md`
- `GATES/12_G2_AUTHORITY_COMMANDS_MUTATIONS.md`
- `GATES/13_G3_PEOPLE.md`
- `GATES/14_G4_ECONOMY.md`
- `GATES/15_G5_PROJECTS_FACILITIES_DOWNTIME.md`
- `GATES/16_G6_RELATIONS_REPUTATION_AGREEMENTS_TERRITORY.md`
- `GATES/17_G7_REQUESTS_MISSIONS_KNOWLEDGE_SECRETS.md`
- `GATES/18_G8_TIME_SCHEDULER_EVENTS_CONDITIONS_ACTIONS.md`
- `GATES/19_G9_UI_UX_EXPLORER_OPERATIONS.md`
- `GATES/20_G10_MIGRATIONS_IMPORT_EXPORT_RECOVERY.md`
- `GATES/21_G11_HARDENING_PERFORMANCE_MULTIPLAYER.md`
- `GATES/22_G12_BETA_RC_STABLE.md`

### Playbooks transversais

- Testing / Acceptance
- Storage / Migration / Recovery
- UI / UX
- Debugging / Diagnostics
- Security / Secrets / Projection
- Performance / Scalability
- Multiplayer / Concurrency / Recovery
- Release / Packaging
- Handoff / Continuidade
- Mudança de especificação / reabertura de DEC

### Templates

Os templates existem para impedir sessões “sem memória operacional”.
Copiar para o repositório quando começarmos G0.

## Regra fundamental

```text
MASTER
  ↓
IMPLEMENTATION PLAN
  ↓
GATE
  ↓
MICROBUILD
  ↓
MICROTASK
  ↓
TEST
  ↓
BUILD_STATE
  ↓
ACCEPTANCE
```

Nunca inverter essa ordem.

## Quando começar código

Somente depois de:
- confirmar gate atual;
- confirmar microbuild;
- criar/atualizar `BUILD_STATE.md`;
- informar ao Codex o escopo permitido;
- fornecer Master + documento do gate + microtarefa relevante.

## Quando NÃO continuar

Parar imediatamente quando:
- a tarefa exigir alterar uma fonte de verdade;
- aparecer conflito entre dois contracts;
- for necessário bypass de Authority;
- migration necessária não estiver definida;
- secret data teria que chegar ao player;
- uma mudança aparentemente simples afetar outro gate estruturalmente;
- testes não conseguem distinguir comportamento esperado.

Nesses casos, abrir `SPEC CONFLICT`.
