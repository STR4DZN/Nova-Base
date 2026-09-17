# 98 — Índice de rastreabilidade Master → Gates → Playbooks

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Permitir localizar rapidamente onde uma regra do Master deve ser implementada e testada.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.

| Master | Conteúdo | Gate principal | Playbook |
|---|---|---|---|
| §3–4 | visão/invariantes | todos | 39 Spec Change |
| §5–7 | runtime/contracts | G0 | Coding Standards |
| §8–10 | Domain/hierarchy/capabilities | G1 | Storage |
| §11–12 | Authority/Receipt/Audit | G2 | Multiplayer/Recovery |
| §13 | People | G3 | Testing |
| §14 | Economy | G4 | Testing + Recovery |
| §15–17 | Projects/Facilities/Downtime | G5 | Testing |
| §18–21 | Diplomacy/Territory | G6 | Security |
| §22–25 | Requests/Missions/Knowledge/Secrets | G7 | Security |
| §26–32 | Time/Scheduler/Conditions/Actions | G8 | Recovery |
| §33–41 | UI/UX | G9 | UI Playbook |
| §42–46 | Storage/Migrations/Boot | G10 | Storage/Recovery |
| §47–51 | Tests/Perf | G11 | Testing/Performance |
| §52–55 | Release/Diagnostics/DoD | G12 | Release |
| §56–58 | structure/dependencies/checklist | todos | Coding Standards |
| §59 | product acceptance | G11/G12 | Testing |
| §60–61 | freedoms/status | todos | Spec Change |

## Rondas históricas

- R01 → foundation
- R02 → schema v1 histórico
- R03 → IDs/contracts
- R04 → authority
- R05 → People
- R06 → Economy
- R07 → Projects/Facilities/Downtime
- R08 → Relations/Reputation/Agreements/Territory
- R09 → Requests/Missions/Knowledge/Secrets
- R10 → Time/Events/Conditions/Actions
- R11 → UI/UX
- R12 → Storage/Migrations/Tests/Performance/Release

O Master já contém normalizações quando uma decisão histórica foi superseded.
