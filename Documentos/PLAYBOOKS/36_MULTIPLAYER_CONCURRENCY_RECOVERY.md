# 36 — Multiplayer, Concurrency e Recovery Playbook

> **Pacote:** DOMAIN_MANAGER_IMPLEMENTATION_PACKAGE_V1  
> **Autoridade normativa:** `DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`  
> **Status:** operacional / implementação  
> **Regra:** este documento explica COMO executar o Master; não pode contrariá-lo.

## Propósito

Padronizar testes e implementação para concorrência, failover, locks, retries e outcomes desconhecidos.

## Regra de conflito

Se este arquivo divergir do Master:
1. parar a implementação da parte afetada;
2. identificar a seção/DEC conflitante;
3. aplicar o Master;
4. atualizar este documento;
5. nunca improvisar uma terceira regra.
# 11. AUTHORITY E MUTATION PIPELINE

## 11.1. Uma autoridade técnica por vez

Existe `PrimaryAuthorityService`.

GM ≠ automaticamente authority.

Deve existir:
- preferred GM;
- deterministic fallback;
- authority epoch;
- failover;
- status.

## 11.2. Pipeline

```text
Client Intent
  ↓
CommandTransport
  ↓
CommandBus
  ├─ authenticate sender
  ├─ schema validate
  ├─ permission
  ├─ rate limit
  ├─ dedupe
  └─ handler lookup
  ↓
MutationCoordinator (quando necessário)
  ├─ lock planning
  ├─ ordered multi-key locks
  ├─ fresh read
  ├─ expectedRevision
  ├─ Plan
  ├─ transaction lifecycle
  ├─ commit
  ├─ compensation
  └─ recovery
  ↓
Owning Service(s)
  ↓
Persistence
  ↓
Receipt
  ↓
Refetch / projection / UI
```

## 11.3. Command envelope

Todo mutable command:
- commandId;
- type;
- contract version;
- payload;
- expected revisions quando relevantes;
- client-generated commandId antes do envio;
- authenticated sender vem do transport/server context, nunca confiado do payload.

Fingerprint:
- canonical;
- calculado/validado authority-side;
- mesmo commandId + payload diferente = conflict/security error.

## 11.4. Public vs internal commands

Registry deve marcar handler:
- public-callable;
- internal-only.

Internal-only via socket é rejeitado mesmo para GM.

## 11.5. Locks

- multi-key;
- order determinístico;
- somente resources realmente afetados;
- fresh state após lock;
- operações independentes podem paralelizar;
- recovery pode bloquear keys afetadas, não o mundo inteiro.

## 11.6. Preview

Preview:
- read-only;
- não segura locks longamente;
- não cria Transaction;
- pode ter hash/fingerprint;
- é estimativa sobre state atual.

Confirm:
- re-lê state;
- replaneja;
- se mudança for material, pode pedir reconfirmação.

## 11.7. TransactionRecord

Usar quando há valor real:
- multi-write de risco;
- external provider;
- Economy transfer;
- Project completion cross-service;
- outras operações com partial failure/recovery real.

Lifecycle:
```text
planned
claimed
prepared
committing
committed
needs-recovery
compensating
compensated
failed
```

`failed` ≠ `needs-recovery`.

## 11.8. Prepare/claim

Antes de irreversible external write:
- durable claim;
- minimum recovery data;
- provider refs;
- snapshots necessários;
- authority epoch.

Se prepare obrigatório não persiste, abortar.

## 11.9. Compensation

- somente strategy declarada;
- apenas quando segura;
- audit próprio;
- failure → needs-recovery;
- não apaga original.

## 11.10. Recovery

RecoveryService:
- trabalha sobre durable TransactionRecord;
- idempotente;
- reconciliation antes de compensation quando outcome é unknown;
- unresolved transaction não é auto-collected;
- manual GM resolution exige reason/audit;
- invariants verificadas após recovery.

## 11.11. Retry/timeout

- timeout != failure;
- status query por commandId;
- retry técnico usa mesmo commandId;
- backoff/jitter;
- outcome unknown não cria novo ID automaticamente;
- novo commandId só após falha comprovada ou nova intenção deliberada.

## 11.12. Queue

- FIFO por default;
- priority somente system/policy;
- recovery/system-critical pode subir;
- user não escolhe priority;
- scheduler evita starvation;
- queue não serializa unrelated lock sets.

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
## Perguntas antes de mutation concorrente

- qual lock key?
- mais de uma key?
- ordem determinística?
- expectedRevision?
- operação idempotente?
- commandId estável?
- commit boundary?
- timeout deixa outcome unknown?
- reconciliation possível?
- compensation segura?
- como novo authority retoma?

## Proibição

Nunca resolver race apenas “desabilitando botão” no client.
Client UX pode prevenir spam; correctness pertence à authority.
