# G6 — execução contínua

Autorização em 2026-09-29: “Pode continuar até finalizar o G6”. Esta autorização
substitui a pausa por microbuild. Continuar sem iniciar G7. Cada microbuild só
muda para PASS após teste. Estado final exige integração vertical, não somente modelos.

| Etapa | Estado | Entrega / critério |
| --- | --- | --- |
| G6.1 | PASS (61 testes) | Definitions/instances/parties/axes/lifecycle |
| G6.2 | PASS (10 testes) | Modificadores base/temporários, stacking, expiry, incidents/reversals/ended; projeção filtra fontes antes do cálculo |
| G6.3 | PASS (9 testes) | Tracks, audience, entries/reversals, decay/bands/projeção |
| G6.4 | PENDENTE | Agreement independente, proposals/counter/accept, lifecycle/amendments |
| G6.5 | PENDENTE | Obligations/evidence/compliance, rights/grants via contratos |
| G6.6 | PENDENTE | Hierarquia física/admin, raízes/ciclos/reparent |
| G6.7 | PENDENTE | Claims/recognition/presence/influence/access, links/transfers/disputes |
| G6.8 | PENDENTE | CapabilityResolver com provenance; expiry retira grants |
| G6.9 | PENDENTE | Runtime/Commands/storage/authority/secret projection, UI/listas/inspectors |
| G6.10 | PENDENTE | Aceitação sem colapso de conceitos; regressões/escala/smoke/release |

## Invariantes

- Relations, Reputation, Agreements e Territory têm fontes de verdade independentes.
- Não alterar Economy/People/Facilities diretamente; effects por contratos owners.
- Não calcular legitimidade nem vencedor de guerras; crise exige decisão do GM.
- Expiry remove grants derivados sem apagar história; breach não encerra acordo.
- Scope/base/modifiers/derived distintos; secrets não influenciam payload público.
- Multiplayer usa CommandBus, Primary Authority e MutationCoordinator existentes.
- Mutação requer fresh state, revision, locks, idempotência durável e receipt.
- Journals canônicos de diplomacia devem ter acesso GM; Players recebem projeções
  por queries de autoridade, sem flags secretas inteiras replicadas para OBSERVER.
- Não disponibilizar stores/writes internos na API pública.

## Normativa já lida

Master §18–21, DEC-098–104, DEC-3201–4100 (Rodada 08); Gate G6;
protocolos de storage e microbuild. Acceptance completo da Rodada 08 inclui
incidents/stances, decay/bands, negotiation/amendment/renewal, hierarchy/rights,
claim/recognition, links/transfer/occupation/dispute e autoridade/projeção/escala.

## Continuidade

Checkout: Nova-Base-smoke-fix, baseline main `99f8d0c` (PR #3).
G6.1 não é ligado ao runtime. Release G5 v0.0.6 não contém G6 funcional ainda.
Próxima ação exata: implementar e testar G6.4. Atualizar este arquivo e
BUILD_STATE a cada etapa, preservar relatórios e criar checkpoints git duráveis.
