# 30 — Testing e Acceptance Playbook

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Definir a estratégia prática de testes que acompanha todas as microbuilds e gates.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.
# 47. TEST STRATEGY

Layers:
```text
Unit
Integration
E2E/System
Manual Exploratory
```

Unit priorities:
- math;
- resolvers;
- validators;
- serialization;
- projection;
- condition stacking;
- scheduler ordering;
- migrations.

Integration:
- Command→Plan→Commit→Receipt;
- service/repository;
- cross-subsystem boundaries;
- scheduler;
- migration/index;
- import/export.

E2E:
- Domain;
- People;
- Economy;
- Projects;
- Request→Mission;
- Agreements;
- Time/Resolve Period;
- Conditions/Actions;
- Explorer/Search;
- destructive actions;
- migrations.

---

# 48. MULTIPLAYER / CONCURRENCY TESTS

Must test:
- one GM + player;
- multiple players;
- multiple GMs;
- authority failover;
- duplicate socket;
- out-of-order delivery;
- same commandId simultaneous;
- same revision conflict;
- lock timeout;
- scheduler vs manual mutation;
- Resolve Period vs manual edit;
- reservation/capacity races;
- reconnect during pending command;
- GM/player payload difference.

Security test inspects payload received by player, not just rendered UI.

---

# 49. FAULT INJECTION

Inject:
- repository write failure;
- socket timeout;
- missing handler;
- missing provider;
- partial storage corruption;
- crash after child commit;
- crash before checkpoint;
- compensation failure;
- duplicate ScheduledOperation after restart;
- migration interruption;
- cache/index corruption.

Verify:
- final invariants;
- no duplicate effects;
- receipts;
- recovery path;
- diagnostics.

---

# 50. PROPERTY / FUZZ / RNG

Use property-based tests for:
- Economy conservation;
- reservation invariants;
- progress invariants;
- hierarchy cycles;
- scheduler ordering;
- visibility combinations;
- malformed import;
- parsers.

Randomized failures record seed.
Seed must be replayable.

System RNG is injected via RandomProvider.
Technical retry does not reroll when semantics say same occurrence.

---
## Pirâmide operacional

- unit: muito frequente, barata;
- integration: cada boundary importante;
- E2E: critical user flows;
- exploratory: Foundry real;
- fault/race/performance: gates específicos e regressões.

## Regra para bug descoberto

Todo bug real corrigido deve, quando viável:
1. ganhar reprodução;
2. ganhar teste de regressão;
3. ser corrigido;
4. provar que o teste falhava antes e passa depois;
5. atualizar BUILD_STATE se afetar gate atual/fechado.

## Acceptance report

Não escrever “testado” genericamente. Registrar:
- comando;
- ambiente;
- fixture;
- resultado;
- evidência/observação;
- limitações.
