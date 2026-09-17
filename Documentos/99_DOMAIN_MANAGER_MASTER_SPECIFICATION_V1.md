# DOMAIN MANAGER — MASTER SPECIFICATION
## Especificação Normativa Consolidada — Rodadas 01–12 — DEC-0001–7700

**Versão do Master:** 1.0  
**Estado:** BASELINE ARQUITETURAL CONSOLIDADA  
**Alvo inicial:** Foundry VTT v13.351+  
**Stack principal:** TypeScript + esbuild + HTML/CSS nativo/Foundry APIs  
**Escala-alvo:** de uma base pequena (~12 NPCs) até um império/sistema solar  
**Total de decisões rastreadas:** 7.700

---

# 0. COMO LER ESTE DOCUMENTO

Este arquivo é a ponte oficial entre as 7.700 decisões arquiteturais e a implementação.

Ele tem quatro responsabilidades simultâneas:

1. **Consolidar** as decisões das Rodadas 01–12 numa arquitetura única.
2. **Normalizar** decisões antigas que foram refinadas ou superseded depois.
3. **Eliminar brechas de interpretação** para quem implementar o módulo sem ter participado das conversas.
4. **Preservar integralmente a trilha de decisão**: os 12 Decision Registers originais são anexados ao final deste Master.

Este documento NÃO autoriza mudanças silenciosas. Quando uma implementação exigir mudança arquitetural real:
- identificar a regra afetada;
- identificar DEC(s) relacionadas;
- registrar a nova decisão;
- descrever impacto em schema, migration, authority, UI, tests e release;
- atualizar este Master.

## 0.1. Ordem de precedência normativa

Quando duas decisões parecem incompatíveis, aplicar nesta ordem:

1. **Normalizações explícitas deste Master**.
2. **Decisão posterior que explicitamente refine ou substitua uma anterior**.
3. **Regra subsystem-specific posterior**, quando ela especializa uma regra genérica anterior sem violar invariantes globais.
4. **Regra global posterior**, quando foi criada precisamente para unificar os subsistemas.
5. Decision Register original.

Nunca resolver conflito por “parece fazer mais sentido”.

## 0.2. O que permanece histórico, mas não normativo

Os anexos preservam decisões antigas mesmo quando sua implementação física foi substituída. Isso é proposital.

Exemplo: as primeiras rodadas tratavam Domain como Actor e usavam caminhos `system.*`. A arquitetura final de storage determina JournalEntry + flags/repositories. O **significado conceitual** de `schemaVersion`, `revision`, `definition`, `state` e `metadata` permanece; o **local físico legado** é superseded.

---

# 1. MATRIZ DE FONTES OFICIAIS

| Rodada | Faixa | Tema | Papel no Master |

|---|---:|---|---|

| 01 | DEC-0001–0182 | Foundation / Domain / cross-system first principles | Fonte normativa / histórico rastreável |

| 02 | DEC-0183–0338 | DomainDataModel V1 / Schema T0 | Fonte normativa / histórico rastreável |

| 03 | DEC-0339–0510 | IDs / References / Namespaces / Shared Contracts | Fonte normativa / histórico rastreável |

| 04 | DEC-0511–0890 | Primary Authority / Commands / MutationCoordinator / Multiplayer | Fonte normativa / histórico rastreável |

| 05 | DEC-0891–1415 | People / Roles / Operational Groups / Workforce | Fonte normativa / histórico rastreável |

| 06 | DEC-1416–2305 | Economy / Resources | Fonte normativa / histórico rastreável |

| 07 | DEC-2306–3200 | Projects / Downtime / Facilities | Fonte normativa / histórico rastreável |

| 08 | DEC-3201–4100 | Relations / Reputation / Agreements / Territory | Fonte normativa / histórico rastreável |

| 09 | DEC-4101–5000 | Requests / Missions / Knowledge / Secrets | Fonte normativa / histórico rastreável |

| 10 | DEC-5001–5900 | Time / Ticks / Events / Conditions / Actions | Fonte normativa / histórico rastreável |

| 11 | DEC-5901–6800 | UI / UX / Explorer / Operations | Fonte normativa / histórico rastreável |

| 12 | DEC-6801–7700 | Storage / Migrations / Tests / Performance / Release | Fonte normativa / histórico rastreável |


---

# 2. NORMALIZAÇÕES E SUPERSESSÕES EXPLÍCITAS DO MASTER

Esta seção é deliberadamente explícita para impedir que um implementador combine duas fases incompatíveis da arquitetura.

## MASTER-NORM-001 — Domain: Actor legado → JournalEntry/flags final

**Histórico:** Rodadas 01–02 modelaram Domain como Actor nativo e usaram `Actor.name`, `Actor.img` e `system.*`.

**Regra atual:** Rodada 12 fixa **JournalEntry + flags do Domain Manager como canonical storage**.

**Normalização obrigatória:**
- Domain é persistido por um **JournalEntry canônico**.
- Dados estruturados do Domain vivem atrás de `DomainRepository`.
- O payload conceitual mantém `schemaVersion`, `revision`, `definition`, `state` e `metadata`.
- A UI, Services, Resolvers e Commands nunca dependem de acesso direto a flags.
- Qualquer caminho antigo `system.X` deve ser entendido como **campo conceitual**, não como path físico obrigatório.

## MASTER-NORM-002 — Nome oficial do Domain

A intenção da DEC-007 permanece: **uma única fonte de verdade para o nome principal**.

No storage final:
- `JournalEntry.name` é a fonte de verdade do nome principal do Domain;
- não persistir `definition.identity.name` duplicado;
- `aliases[]` continuam separados;
- snapshot `lastKnownName` pode existir somente em referências/histórico/diagnóstico;
- rename é mutation administrativa e incrementa revision.

## MASTER-NORM-003 — Imagem/presentation do Domain

A antiga regra `Actor.img` era presentation-only.

No modelo JournalEntry:
- imagem/banner/portrait é **presentation metadata**, não identidade;
- sua alteração não deve invalidar business operations por si só;
- não deve virar source-of-truth do nome/classificação;
- o local concreto deve ficar atrás do Domain codec/repository, não espalhado em consumers.

## MASTER-NORM-004 — Hierarquia de Domain vs Territory

Não misturar duas ontologias.

**Domain hierarchy:**
- árvore/floresta administrativa;
- single parent lógico;
- children e ancestors derivados;
- sem children array como segunda verdade;
- reparent é Command validado;
- cycles são proibidos.

**Territory/location hierarchy:**
- pode distinguir `locatedInUuid` de `administrativeParentUuid`;
- physical parent e administrative parent podem divergir;
- ownership, administration e control são claims independentes;
- Territory não reescreve automaticamente hierarchy de Domain.

## MASTER-NORM-005 — `state.conditions` placeholder

O placeholder genérico das Rodadas iniciais é substituído pelo subsystem formal de **Condition** da Rodada 10:
- ConditionDefinition;
- ConditionInstance;
- lifecycle;
- stacking;
- severity/modifiers;
- expiry;
- resistance/immunity;
- source/provenance;
- Scheduler integration.

Não criar um segundo formato ad hoc de conditions no Domain.

## MASTER-NORM-006 — worldTime direto → TimeProvider

`worldTime` continua substrato padrão no Foundry, mas consumers não devem acessar `game.time` diretamente.

Regra atual:
- `TimeProvider` é a abstraction;
- Foundry world time é o adapter default;
- `CalendarAdapter` é presentation/conversion;
- real timestamp e world time continuam dimensões distintas.

## MASTER-NORM-007 — antigos gates T0/T1/T2/T3/T4/T5/T6

Eles permanecem úteis como histórico de evolução, mas **não são a ordem final de implementação**.

A ordem normativa atual é G0–G12, definida na Rodada 12.

## MASTER-NORM-008 — UI antiga “Sheet” → UI System final

A ideia inicial de Sheet/Explorer/Operations foi refinada.

Regra atual:
- App Shell;
- Domain Explorer;
- Collections;
- Inspectors/Drawers;
- Operations;
- Timeline/Schedule;
- Forms/Preview;
- Advanced views opcionais.

Nenhuma Sheet é source-of-truth.

## MASTER-NORM-009 — visibility ≠ Foundry ownership

Foundry ownership permanece autorização nativa de Document, mas:
- audience;
- Secret;
- Knowledge;
- disclosure;
- role;
- request assignment;
- mission participation

são camadas próprias.

Nunca usar Foundry ownership como substituto universal de visibility.

## MASTER-NORM-010 — implementação física atrás de Repository

Quando um register descreve uma entidade como embedded, separada ou “store”, a regra final é:
- **ownership lógico é normativo**;
- **Repository é a boundary física**;
- mudanças futuras de layout físico não podem alterar IDs, lifecycle ou semantics sem migration.

---

# 3. VISÃO DO PRODUTO

## 3.1. Objetivo

Domain Manager é uma infraestrutura Foundry system-agnostic para administrar entidades organizacionais/territoriais/operacionais de qualquer escala.

Deve funcionar igualmente para:
- uma base com 12 NPCs;
- uma vila;
- uma estação orbital;
- uma organização;
- um reino;
- um planeta;
- um sistema solar;
- um império.

Escala NÃO determina features obrigatórias. Behavior vem de capabilities e subsystems.

## 3.2. Regra de granularidade

**Escala não exige granularidade.**

É válido:
- império abstrato com Population total + alguns Groups;
- base pequena totalmente detalhada;
- Project sem Gantt;
- Mission sem stages;
- Domain sem People;
- Economy sem inventário;
- Territory sem mapa;
- Relation sem Agreement.

O módulo nunca deve obrigar o GM a modelar mais do que precisa.

## 3.3. UX target

Tempo-alvo conceitual:
- pequena base: administração rotineira em aproximadamente 10 minutos;
- império: triagem/resolução rotineira também em aproximadamente 10 minutos por meio de summaries, filters, Operations e bulk tooling.

## 3.4. Não-objetivos

O core NÃO é:
- simulador universal de economia;
- inventory system obrigatório;
- marketplace;
- war game estratégico automático;
- legitimidade/política automática;
- social simulator autônomo;
- epidemiology engine;
- quest engine monolítica;
- graph database;
- rules engine arbitrária com `eval`;
- workflow engine que executa JavaScript persistido;
- substituto do sistema RPG do Foundry.

---

# 4. INVARIANTES GLOBAIS

Estas regras devem aparecer em code review e acceptance tests.

1. UI envia intenção; não calcula realidade autoritativa.
2. Resolver nunca muta.
3. Read model nunca é source-of-truth.
4. Cache nunca autoriza write.
5. Index nunca é source-of-truth.
6. Client nunca recebe secret completo para “esconder com CSS”.
7. Nenhum subsystem cria authority paralela.
8. Commands mutáveis relevantes possuem `commandId`.
9. Retry técnico reutiliza o mesmo commandId.
10. Timeout não significa failure.
11. Fresh state é lido depois de locks.
12. Preview não congela o mundo.
13. Confirm replaneja/revalida.
14. No-op não incrementa revision.
15. Receipt não substitui persisted truth.
16. Correction/reversal não apaga história.
17. Compensation não apaga história.
18. Recovery é idempotente.
19. Broken refs são preservadas/reparáveis quando seguro.
20. Nome nunca é identidade técnica.
21. Derived values não são persisted truth salvo exceção explícita.
22. External authoritative provider não é duplicado como native truth.
23. Missing optional integration degrada capability; não derruba o core.
24. Secrets são projetados antes de agregações que poderiam vazar informação.
25. Performance nunca justifica violar correctness, authority, security, audit ou accessibility.
26. Small base e empire usam o mesmo core.
27. Basic UX esconde complexidade; não cria segunda engine.
28. Bulk usa o mesmo Command/Plan pipeline.
29. Import/migration nunca adivinha identidade ou semantic meaning.
30. Archive é preferível a hard delete.
31. Hard delete é protegido por dependency/impact analysis.
32. Domain deve possuir ao menos uma capability funcional ativa.
33. Unknown registered IDs são preservados quando possível.
34. `core` não conta como capability funcional.
35. Foundry Folder é organização visual, não hierarchy semântica.
36. Events registram; não implicam mutation.
37. Conditions descrevem estado temporário; não sobrescrevem base.
38. Actions descrevem intenção; geram Commands.
39. Scheduler decide quando tentar; owning service decide o que pode acontecer.
40. Resolve Period orquestra; não possui estado dos child subsystems.

---

# 5. STACK, RUNTIME E BOUNDARIES

## 5.1. Runtime inicial

- Foundry VTT v13.351+.
- TypeScript.
- esbuild.
- CSS nativo.
- Sem React como requisito do core.
- Socket transport encapsulado.
- socketlib pode ser adapter/dependency conforme build suportado, mas business logic não depende diretamente da API de socketlib.

## 5.2. Camadas obrigatórias

```text
UI / Applications
        ↓
Public/Application Use Cases
        ↓
Commands / Query Services
        ↓
Authority / MutationCoordinator
        ↓
Owning Services
        ↓
Repositories / Providers
        ↓
Foundry Documents / flags / external providers
```

Read path:

```text
Canonical Storage
   ↓
Repositories
   ↓
Indexes / Projection / Aggregation
   ↓
Read Models / DTOs
   ↓
UI
```

## 5.3. Proibições de dependência

- UI → flags diretamente: PROIBIDO.
- UI → ledger internals: PROIBIDO.
- Project → People internal arrays: PROIBIDO.
- Agreement → Economy account mutation direta: PROIBIDO.
- Scheduler → Project progress mutation direta: PROIBIDO.
- Graph → relationship mutation direta: PROIBIDO.
- Provider callback → bypass de Authority: PROIBIDO.
- Addon hook → arbitrary state mutation: PROIBIDO.

---

# 6. IDENTIDADE, IDs, REFS E NAMESPACES

## 6.1. Identidade Foundry vs local

- Foundry Documents: UUID completo.
- Registros locais: ID local estável.
- Runtime operations: IDs opacos/prefixados.

Exemplos:
```text
cmd_<random>
tx_<random>
prj_<random>
rel_<random>
rep_<random>
led_<random>
resv_<random>
req_<random>
role_<random>
```

O prefixo ajuda debugging; não é autoridade de type checking.

## 6.2. Namespaces

Formato semântico:
```text
domain-manager:<id>
world:<id>
<addon-id>:<id>
```

Usos:
- capabilities;
- actions;
- resources;
- relation types;
- condition kinds;
- event kinds;
- resolvers;
- providers;
- registries.

Colisão após normalization é erro.

## 6.3. Refs

Contract conceitual:

```ts
interface DocumentRef {
  uuid: string;
  lastKnownName?: string;
  lastKnownImg?: string;
}

interface TypedRef {
  type: string;     // technical ID
  id?: string;
  uuid?: string;
}
```

Regras:
- nunca resolver por name;
- Compendium/EmbeddedDocument usam UUID Foundry resolvível;
- broken ref continua representável;
- repair/relink é operação explícita;
- histórico de relink pode ser preservado;
- URL externa usa contract separado.

## 6.4. Tempo técnico em contracts

Audit pode carregar:
```ts
createdAtReal: number;
worldTime?: number | null;
```

Não confundir:
- wall-clock real;
- campaign/world time;
- sequence number.

---

# 7. VERSIONAMENTO E CONTRACTS COMPARTILHADOS

Separar:
- module/package version;
- public contract version;
- storage schema version;
- export format version;
- Definition version;
- entity/subsystem schema version quando necessário.

Payload externo deve carregar contract version quando a boundary exigir.

Consumidores detectam **capability/contract**, não presumem comportamento apenas por package version.

## 7.1. Result

```ts
type Result<T, E = PublicError> =
  | { ok: true; value: T; warnings?: readonly Warning[] }
  | { ok: false; error: E };
```

## 7.2. PublicError

```ts
interface PublicError {
  code: `DM_${string}`;
  message: string;
  details?: unknown;
  retryable?: boolean;
  userActionRequired?: boolean;
  correlationId?: string;
}
```

- `code` é estável;
- message pode traduzir/mudar;
- detalhes sanitizados;
- stack fica em Diagnostics apropriado.

Categorias operacionais:
```text
validation
permission
conflict
not-found
busy
provider
timeout
integrity
recovery
internal
```

---

# 8. DOMAIN — MODELO CANÔNICO

## 8.1. Documento

Cada Domain possui um JournalEntry canônico administrado por `DomainRepository`.

Shape lógico:

```ts
interface DomainRecord {
  schemaVersion: number;
  revision: number;

  definition: {
    identity: {
      aliases: string[];
      summary: string;
      description: string;
    };

    classification: {
      kind: string;
      scale: string;
      tags: string[];
    };

    hierarchy: {
      parentDomainUuid: string | null;
    };

    capabilities: {
      enabled: string[];
      config: Record<string, unknown>;
    };
  };

  state: {
    lifecycle: "active" | "inactive" | "archived";
  };

  metadata: {
    createdByUserId: string | null;
    archivedAt: number | null;
    source: {
      type: "manual" | "template" | "import" | "migration";
      ref: string | null;
    };
  };
}
```

A Condition efetiva fica no subsystem formal; não criar array paralelo legacy.

## 8.2. Identity

- name = `JournalEntry.name`;
- aliases max/normalization conforme codec;
- aliases comparados normalizados, apresentados conforme entrada;
- summary curto;
- rich description sanitizada;
- duplicate Domain names são válidos;
- name não gera ID.

## 8.3. Classification

`kind`:
- string aberta;
- presets;
- addon registry;
- unknown preservado + warning.

`scale`:
- classificação/preset;
- não concede capability;
- pode mudar sem redefinir ontologia.

`tags`:
- livres + namespaced;
- usadas para busca/filtragem;
- não executam business logic automaticamente.

## 8.4. Lifecycle

```text
active
inactive
archived
```

Archive:
- não apaga;
- refs continuam resolvíveis;
- normalmente read-only/hidden da navegação comum;
- não cascata automaticamente;
- restore permitido.

## 8.5. Revision

- criação começa revision 0;
- mutation semântica incrementa;
- UI state não incrementa;
- rename incrementa;
- presentation-only não deve invalidar operation;
- no-op não incrementa.

## 8.6. Functional capability rule

Domain deve ter pelo menos uma capability funcional.

Enable:
- pode criar shell/default mínimo;
- não inventa narrative data.

Disable:
- preserva data.

Purge:
- separate destructive command;
- impact preview;
- strong confirmation.

EffectiveCapability:
- derivada de base + grants;
- provenance obrigatória;
- cache rebuildable.

---

# 9. HIERARCHY

## 9.1. Domain administrative hierarchy

- single parent;
- root = null;
- children derived;
- ancestors derived;
- no artificial depth limit;
- cycle detection;
- reparent = Command;
- subtree follows naturally;
- Foundry Folder independent.

Delete parent com children:
- bloqueado até explicit resolution.

Archive parent:
- GM decide child behavior.

## 9.2. Large-scale requirements

Deve suportar:
- hundreds of children;
- deep trees;
- lazy Explorer;
- index by parent;
- no O(world) render per expansion.

---

# 10. CAPABILITIES E EXTENSION REGISTRIES

Uma capability:
- possui technical namespaced ID;
- pode possuir config schema;
- pode ser core/addon/world;
- pode ser unavailable se addon sumir;
- unavailable não implica purge.

Capability sources:
- explicit enablement;
- Role;
- OperationalGroup;
- Facility;
- Agreement/right;
- Conditions;
- providers/outros sources registrados.

`CapabilityResolver`:
- read-only;
- agrega sources;
- preserva provenance;
- resolve conflicts por policy;
- nunca grava Domain.

---

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

# 12. RECEIPTS, AUDIT E EVENTS

## 12.1. Receipt

Imutável.

Deve poder carregar:
- commandId;
- transactionId?;
- correlationId?;
- resulting revisions;
- status;
- warnings;
- changed flag;
- childReceipts;
- summary sanitizada.

Não é source-of-truth.

## 12.2. Audit

Audit ≠ console log.

Registra:
- executor;
- requestedBy;
- executedByAuthority;
- source/provenance;
- real/world time;
- command/transaction/correlation/causation;
- category/severity;
- redacted summary/fingerprint.

Append-oriented.

Automation não deve ser atribuída falsamente ao GM.

## 12.3. Hooks

Post-commit only.
- refs/IDs/revisions;
- não objeto mutável completo;
- consumer failure não desfaz commit;
- public hooks separados de internal orchestration.

---

# 13. PEOPLE

## 13.1. Princípios

```text
Population ≠ roster
PopulationGroup ≠ OperationalGroup
Role ≠ person
Role ≠ Foundry permission
Workforce ≠ population
Assignment ≠ Project private field
```

People é capability opcional.

## 13.2. Population

Modes:
```text
manual
sumGroups
hybrid
```

State:
```ts
interface PopulationState {
  mode: "manual" | "sumGroups" | "hybrid";
  total: number | null;
  precision: "exact" | "estimated" | "unknown";
}
```

Rules:
- unknown propagates quando necessário;
- overlap não deve double-count automaticamente;
- safe integers;
- group count pode ser unknown;
- `includedInTotal` define subset semantics.

## 13.3. PopulationGroup

```ts
interface PopulationGroup {
  id: string;
  name: string;
  count: number | null;
  includedInTotal: boolean;
  tags: string[];
  notes?: string;
}
```

- ID estável;
- zero não é registro operacional normal;
- mutations via PeopleService/Commands;
- pode representar subconjunto sem roster individual.

## 13.4. Notable

Modes:
- inline;
- Actor-linked.

NotableId permanece identidade do Domain mesmo se Actor ref quebrar.

Dentro do mesmo Domain:
- evitar duplicate Notable apontando para mesmo Actor;
- drag Actor pode criar/reutilizar Notable.

Foundry ownership do Actor não substitui Notable visibility.

## 13.5. Roles

RoleDefinition ≠ Role instance.

Role:
- cargo/posição;
- existe vazio;
- occupancy min/max;
- `max=null` ilimitado;
- min não atendido gera requirement/advisory; não invalida Domain;
- occupants inicialmente pessoas individuais;
- occupant referencia preferencialmente NotableId.

Scopes:
```text
domain
operational-group
```

Liderança de OperationalGroup usa internal roles, não `leaderId` universal.

## 13.6. OperationalGroup

É unidade funcional identificável.

Membership modes:
```text
abstract
partial
explicit
```

- abstract: sem roster individual;
- partial: roster conhecido é subset de size;
- explicit: roster representa todos; size derivado;
- Notable pode pertencer a múltiplos Groups;
- inactive normalmente remove grants;
- Definition/policy pode manter grant quando explicitamente definido;
- disbanded não apaga história.

## 13.7. Workforce

Workforce é capacidade operacional derivada.

```text
capacity
reserved
committed
available = capacity - committed - reserved
```

- type registry;
- contributions;
- provenance;
- overcommit normalmente bloqueado;
- não inferir automaticamente população = workforce;
- external/system adapter pode contribuir sem redefinir ontologia.

## 13.8. Assignment

Entidade operacional própria:
- source;
- target;
- workforce type;
- amount;
- lifecycle;
- optional world-time window.

Projects consultam/allocam via contracts; não embedam workforce.

---

# 14. ECONOMY / RESOURCES

## 14.1. Separações obrigatórias

```text
Economy ≠ Inventory
Resource ≠ Item
ResourceDefinition ≠ ResourceAccount
Balance ≠ Available
Reservation ≠ Debit
Transaction ≠ LedgerEntry
Receipt ≠ Transaction
Preview ≠ Commit
```

## 14.2. ResourceDefinition

- stable namespaced ID;
- version;
- label;
- optional description/icon/category/tags;
- precision 0..4 inicialmente;
- unit display metadata;
- minimum/maximum;
- allowNegative;
- capacity policy;
- lifecycle active/archived.

## 14.3. Minor units

Persistir inteiros.

Exemplo:
```text
320.010,00
precision=2
→ 32001000
```

- `Number.isSafeInteger`;
- overflow é error;
- nunca clamp;
- nunca BigInt silencioso;
- mudar precision com history exige migration.

## 14.4. ResourceAccount

Modes:
- native;
- derived;
- provider-backed.

Native é Domain Manager truth.
Derived é read-only/resolver-backed.
Provider-backed respeita provider truth.

Natural key:
```text
domainUuid + resourceId
```

## 14.5. Capacity

- null = unlimited/not applicable;
- zero = zero;
- modifiers podem vir de Facilities/capabilities;
- effective capacity guarda provenance.

Policies:
```text
block
allow-with-warning
overflow
provider
```

## 14.6. Balance mutations

Somente EconomyService.

Toda native mutation relevante gera LedgerEntry:
- opening-balance;
- adjustment;
- transfer;
- conversion;
- production;
- income;
- upkeep;
- fees;
- decay;
- migration;
- reversal.

Set balance é convertido em delta autoritativo.
No-op +0 não gera ledger.
Manual adjustment exige reason.

## 14.7. Reservation

Reservation ≠ debit.

Lifecycle separado.
Operações:
- reserve;
- consume;
- release;
- expire.

`available` deve considerar reserved.
Reservation possui source/provenance.
Expiração pode usar Scheduler.

## 14.8. Ledger

Append-oriented.
Não editar history.
Correção:
- reversal;
- compensating adjustment.

LedgerStore separado para não crescer blob infinito do Domain.

## 14.9. Transfer / Conversion

Cross-account/domain operations podem ser transactional.
Transfer deve manter invariants e produzir entries coordenadas.
Conversion usa definitions/rates explicitamente fornecidos por policy/provider; não inventar FX.

## 14.10. Providers

ProviderRegistry:
- ResourceProvider;
- CurrencyProvider;
- InventoryProvider.

Provider declara capabilities transacionais e health.

Se authoritative:
- provider vence cache;
- timeout pode deixar outcome unknown;
- reconciliation antes de compensation;
- stale value não autoriza debit.

## 14.11. EconomyPlan

Plan pode conter:
- reservation effects;
- ledger intents;
- provider operations;
- warnings;
- blockers;
- revisions/preconditions.

---

# 15. PROJECTS

## 15.1. Separação

Project = processo persistente de trabalho/progresso.

Não é:
- Facility;
- Downtime;
- Mission.

## 15.2. Definition / Instance

Definition:
- reusable content/config;
- resolver ID;
- requirements/cost policies;
- possible outputs.

Instance:
- runtime identity/revision;
- Domain refs;
- lifecycle;
- progress;
- source/provenance.

## 15.3. Progress

Canonical progress usa integers.
Percentual é derived.

Resolver:
- namespaced;
- readonly input;
- returns delta/reasons/warnings;
- never mutates.

Progress history:
- append-oriented entries;
- corrections/reversals explicit.

## 15.4. Lifecycle

```text
draft
planned
approved
active
blocked
paused
completed
failed
cancelled
archived
```

Completion:
- não checkbox;
- plan;
- final requirements;
- coordinated side effects;
- child receipts;
- partial failure explicit.

## 15.5. Start

ProjectStartPlan avalia:
- requirements;
- reservations;
- costs;
- workforce;
- capabilities;
- revisions.

`initializing` pode existir como estado técnico para evitar partial start.

## 15.6. People boundary

Project não edita People.

Usa:
- workforce query;
- assignment/allocation;
- reservation contracts;
- capabilities.

## 15.7. Economy boundary

Project não edita balances.
Custos/reservas/consumo via EconomyPlan/child plans.

## 15.8. Time boundary

Project não lê clock diretamente.
Time/Scheduler conta periods/occurrences; ProjectService calcula delta.

---

# 16. FACILITIES

Facility:
- entidade persistente de instalação/estrutura/módulo/capacidade;
- não é Domain;
- não é Resource;
- não é Project.

Conceitos:
- Definition/Instance;
- lifecycle;
- readiness;
- level/upgrades;
- slots/modules;
- capacity;
- staffing;
- maintenance;
- damage/conditions;
- repair;
- outputs;
- dependencies.

Rules:
- lifecycle ≠ readiness;
- damage não implica ownership change;
- Project completion pode criar/alterar Facility via coordinated plan;
- Facility não avança Project diretamente;
- maintenance uses Scheduler + owning FacilityService;
- outputs/capabilities are derived/provenanced.

---

# 17. DOWNTIME

Downtime:
- atividade limitada no tempo;
- individual/coletiva;
- não Project.

Possui:
- Definition/Instance;
- participants;
- lifecycle;
- duration/stages;
- requirements;
- costs;
- Facility usage;
- optional checks/RNG;
- outcomes/consequences.

Rules:
- participant ≠ Foundry User;
- indefinite downtime não auto-completa;
- Time only schedules/revalidates;
- outcomes usam public APIs/Commands;
- não edita Economy/People/Project/Facility diretamente.

---

# 18. RELATIONS

Relation = vínculo entre parties.

Pode ser:
- bilateral;
- multiparty;
- symmetric/asymmetric;
- scoped.

Parties podem ser:
- Domain;
- Population/Operational Group;
- Notable;
- Actor/integration ref;
- narrative entity ref.

Axes extensíveis:
```text
trust
fear
respect
influence
dependence
resentment
...
```

- integer scores;
- ranges by definition;
- stance optional;
- stance may be derived/manual by policy;
- temporary modifiers separate from base;
- history survives termination.

Relation não é Reputation e não é Agreement.

---

# 19. REPUTATION

Reputation = percepção de subject por audience.

```text
subjectRef
audienceRef
tracks
```

- may exist without Relation;
- multiple tracks;
- namespaced definitions;
- integer score;
- append-oriented entries;
- correction/reversal compensatory;
- optional decay;
- can be secret;
- public view may expose qualitative band only;
- aggregate is read model.

ReputationEntry:
```text
delta
before
after
source
time
track
```

---

# 20. AGREEMENTS

Agreement = structured commitments/rights/obligations/terms.

Lifecycle:
```text
draft
proposed
pendingApproval
active
suspended
breached
expired
terminated
```

- 2+ parties;
- party roles;
- structured terms + narrative text;
- term may create obligation/right/capability;
- economic term uses Economy;
- territorial term can grant access without changing ownership;
- breach does not auto-terminate;
- expiry deactivates derived capabilities;
- amendment preserves history;
- proposal is distinct from active agreement;
- renewal can be policy-driven;
- due ≠ breached unless compliance policy says so.

---

# 21. TERRITORY

Territory = space/hierarchy where claims, presence, influence and rights exist.

Mandatory separation:
```text
ownership
administration
control
presence
influence
access/rights
```

Claims:
- can compete;
- can be contested;
- no automatic winner;
- optional strength;
- inheritance by policy;
- secret possible.

Hierarchy:
- physical `locatedIn`;
- administrative parent may diverge;
- cycles blocked;
- roots valid.

Ownership/admin/control may point to different Domains simultaneously.

Dispute ≠ war simulation.
Crisis ≠ automatic threshold event.
Occupation/transition are records/policies, not automatic political judgments.

---

# 22. REQUESTS

Request = submitted intention for review.

Persistent.
Lifecycle:
```text
draft
submitted
underReview
approved
rejected
withdrawn
fulfilled
expired
cancelled
```

- approved ≠ fulfilled;
- original payload immutable after submit;
- clarification thread append-oriented;
- decision records reviewer/time/reason;
- handler registry;
- handler produces Commands/Plans;
- fulfillment idempotent;
- results/receipts referenced.

Request Inbox:
- filters;
- Domain/requester/kind/status;
- priority vs urgency;
- saved views;
- pagination/virtualization;
- delegation;
- reviewer ≠ authority.

---

# 23. MISSIONS

Mission = narrative/operational work.
Not Project.
Not Request subtype.

Lifecycle:
```text
draft
available
accepted
active
blocked
resolved
failed
cancelled
expired
archived
```

Contains:
- participants;
- audience;
- assignments;
- objectives;
- optional stages;
- deadlines;
- outcome/evidence;
- source refs.

Objective:
- stable ID;
- public/secret;
- dependencies;
- no cycles;
- integer progress;
- may reference real Project/evidence.

Resolution:
- MissionResolutionPlan;
- child effects through public APIs;
- MissionReceipt preserves child receipts.

Deadline expiry does not automatically mean failure without policy.

Recurring Mission creates new instance.

---

# 24. KNOWLEDGE

Knowledge = what an audience knows/believes.

Never world truth.

KnowledgeRecord includes:
- subject;
- audience;
- kind;
- confidence?;
- provenance;
- evidence;
- observedAt/validAt/expiresAt?;
- staleness;
- disclosure/source lineage.

Knowledge may be:
- correct;
- incorrect;
- partial;
- contradictory.

Kinds extensible:
```text
fact
rumor
theory
testimony
interpretation
warning
...
```

`stale ≠ false`.

Multiple competing records are allowed.

Sharing creates/updates Knowledge for another audience; it does not mutate source truth.

---

# 25. SECRETS E PROJECTION

Secret = restriction/discoverability.

Can protect:
- entity;
- field;
- claim;
- term;
- objective;
- fact;
- source/evidence.

Disclosure levels:
```text
hidden
hinted
partial
full
```

Rules:
- authority-side projection;
- unauthorized fields omitted;
- `***` mask not default;
- unknown/rumored uses dedicated DTO;
- revoking access does not erase already acquired Knowledge by default;
- discovery is explicit/auditable;
- discovery may reveal partial;
- sharing cannot exceed possessed disclosure unless authorized;
- counts/search/sort/grouping/cache must not leak secret existence.

`ProjectionService` is a critical security boundary.

---

# 26. TIME

## 26.1. TimeProvider

Abstraction:
- current;
- compare;
- add/diff;
- canonical serialization;
- Foundry world time adapter default.

No direct `game.time` in subsystems.

## 26.2. CalendarAdapter

Presentation/conversion only.
Changing calendar:
- does not rewrite canonical timestamps;
- does not reprocess historical operations.

## 26.3. Advance Time

Explicit Command/Plan.
Preview:
- from → to;
- due operations;
- costs;
- expirations;
- progress;
- blockers.

External Foundry time changes produce reconciliation, not silent side effects.

Moving clock backward does not undo committed state.

---

# 27. SCHEDULER

Scheduler answers **when to try**, not **what is allowed**.

ScheduledOperation:
- stable operationId;
- kind;
- dueAt;
- source/targets;
- versioned payload;
- no arbitrary JS.

Lifecycle:
```text
scheduled
due
processing
completed
cancelled
failed
blocked
```

Rules:
- due ≠ happened;
- retry policy;
- idempotency;
- dependency graph;
- cycle detection;
- deterministic order;
- persistent across reload;
- catch-up;
- checkpoints;
- partial batches;
- diagnostics.

Cross-system phase order:
```text
expirations / releases
→ costs / maintenance
→ progress
→ completions
→ outcomes / follow-ups
```

---

# 28. EVENTS

TimeEvent/Event:
- append-oriented occurrence;
- kind namespaced;
- source/targets;
- world + real timestamp;
- correlation/causation;
- visibility;
- source operation ref.

Event ≠ mutation.

EventSubscription observes.
TriggerRule evaluates.
AutomationPolicy decides autonomy.

Causal chains:
- bounded depth;
- bounded firings/descendants;
- loop detection;
- rate/debounce/coalesce for presentation/advisory;
- source audit preserved.

---

# 29. CONDITIONS

ConditionDefinition → ConditionInstance.

Lifecycle:
```text
pending
active
suppressed
expired
removed
cancelled
```

Supports:
- targetRef;
- kind;
- severity;
- start/end;
- indefinite;
- source;
- modifiers;
- capabilities/facts;
- stacking;
- mutual exclusion;
- resistance/immunity/susceptibility;
- scheduled expiry.

Stack policies may include:
```text
replace
stack
refresh
extend
highest
lowest
unique
```

Condition effects are derived.
They never permanently rewrite base state.

---

# 30. ACTIONS

ActionDefinition:
- namespaced ID;
- label/metadata;
- commandKind;
- requirements;
- target rules;
- costs;
- cooldown;
- confirmation policy.

Availability:
```text
available
unavailable(reason)
hidden
```

Derived from:
- capabilities;
- Conditions;
- Agreement rights;
- Knowledge;
- permissions;
- target context.

Action:
- does not mutate;
- generates Command/Plan.

Cooldown is structured temporal state, not arbitrary UI timestamp.

---

# 31. AUTOMATION POLICY

Modes:
```text
manual
advisory
review
safeAuto
```

Defaults conservative.

- manual: no automatic commit;
- advisory: suggestion only;
- review: pending Plan;
- safeAuto: only handlers explicitly classified safe.

Narrative/human decisions are not safe-auto by default.

Global emergency pause must preserve pending work and allow reconciliation.

---

# 32. RESOLVE PERIOD

Resolve Period is cross-system orchestration.

Input:
- from;
- to;
- execution policy.

Produces:
- ResolvePeriodPlan;
- child plans;
- blockers;
- warnings;
- impact summary.

Policies:
```text
atomic         // only if truly guaranteed
stopOnBlocker
bestEffort
```

Receipt:
- summary;
- references child receipts;
- never replaces them.

Time/Scheduler decide when evaluate.
Each Service decides and applies its own mutation.

---

# 33. UI DESIGN SYSTEM

## 33.1. Architecture

```text
Foundations
→ Tokens
→ Primitives
→ Compound Patterns
→ Domain Patterns
→ Screens / Workspaces
```

No per-screen visual foundation.

## 33.2. Design direction

- dark-first;
- military-tech / gothic-tech;
- console operacional, not cinematic HUD;
- low performance cost;
- CSS-first;
- decoration subordinate to clarity.

Avoid:
- permanent glitch on functional text;
- strong scanlines;
- heavy blur;
- huge shadows on repeated rows;
- tiny text;
- constant animation;
- images as structural dependency.

## 33.3. Token categories

Namespace `--dm-*`.

At minimum:
- color primitives;
- semantic surfaces;
- foreground/text;
- border;
- semantic status;
- spacing;
- typography;
- radius;
- elevation;
- motion duration/easing;
- z-layer;
- responsive/density values.

Status grammar:
```text
neutral
info
success
warning
danger
special
```

Never color-only meaning.

## 33.4. Density

```text
compact
default
comfortable
```

Density changes presentation, not semantics.

## 33.5. Motion

Jobs:
```text
feedback
continuity
attention
progress
```

If motion has no job, default = remove.

`prefers-reduced-motion` mandatory.

---

# 34. APP SHELL E NAVIGATION

Global navigation small/stable.

Concept:
```text
Domains
Operations
Timeline
Search / Command Palette
```

Domain-local navigation separate:
```text
Overview
People
Economy
Projects
Facilities
Diplomacy
Missions
Knowledge
```

Exact grouping can evolve without changing information architecture.

Domain Explorer:
- lazy tree;
- keyboard navigation;
- selected vs expanded distinct;
- physical/admin labels when needed;
- preserves expanded state as local preference;
- audience-filtered before client.

Breadcrumb:
- ancestry;
- clickable;
- compress long middle segments;
- not substitute for tree.

Preserve Context is formal:
- filters;
- sort;
- scroll;
- selection;
- current section;
- inspector state when reasonable.

---

# 35. COLLECTIONS / DATAGRID

`DMCollection` separates data/query state from representation.

Representations:
- Table;
- List;
- Cards;
- Tree;
- Board;
- Gantt;
- Timeline.

Choose by task, not beauty.

`DMDataGrid`:
- declarative columns;
- stable column keys;
- formatting presentation-only;
- search;
- filters;
- sort;
- grouping;
- selection;
- bulk;
- pagination;
- virtualization;
- optional inline edit;
- keyboard contracts.

Large datasets:
- pagination/virtualization;
- provider/index sorting/filter;
- no rendering thousands blindly.

Cards:
- overview/small sets;
- not default at empire scale.

Empty ≠ No Results ≠ Permission Denied ≠ Missing Capability ≠ Error.

---

# 36. INSPECTOR / SPLIT VIEW / DRAWERS

Inspector hierarchy:
```text
Summary
Explanation
Details
Related
History
Actions
```

- preserves list context;
- history lazy;
- destructive actions separated;
- widths compact/standard/wide;
- narrow layout becomes sheet/page.

Split view:
```text
Collection | Detail
```

Useful for Requests, Missions, Knowledge, Agreements.

Avoid nested Dialogs/Drawers.

---

# 37. OPERATIONS WORKSPACE

Operations is decision surface, not truth store.

Answers:
1. What needs attention?
2. What is upcoming?
3. What changed?
4. What can I do?

Sections:
- Needs Attention;
- Action Queue;
- Upcoming;
- Activity;
- metrics.

Needs Attention sources:
- Requests waiting;
- blocked Projects;
- obligations;
- scheduler failures;
- resource pressure;
- deadlines;
- recoveries.

Action Queue ≠ Activity Feed.

Activity Feed = readable recent history.
Audit log = technical trace.

Drill-down always routes to owning subsystem/source.

---

# 38. FORMS / QUICK CREATE / WIZARDS

## Quick Create

- essential fields only;
- safe defaults;
- can expand to Advanced without losing input;
- Create and open / Create another when useful.

## Advanced Create

- sections or Wizard;
- Wizard only when sequential dependencies justify it.

## Validation

Client:
- fast feedback.

Authority:
- final validation.

Distinguish:
- error;
- warning;
- advisory.

Never erase user input on failure.

## Draft

Draft ≠ committed entity.
Autosave mainly for safe preferences/drafts, not financial/rights mutations.

## Preview/Diff

`DMChangePreview` is based on Plan.
Shows:
- before/after;
- added/changed/removed;
- reserve/release;
- target count;
- blockers/warnings;
- grouped child subsystem impacts.

State changing after preview may require replan/reconfirmation.

---

# 39. DESTRUCTIVE ACTIONS

Safety proportional to impact.

```text
Tier 1 reversible
→ direct / undo

Tier 2 meaningful
→ confirmation

Tier 3 destructive
→ impact summary + confirmation

Tier 4 irreversible
→ impact summary + type-to-confirm + audit/recovery guidance
```

Hard delete Domain, purge history, destructive migration:
- strongest protection.

Avoid confirmation fatigue.

---

# 40. ADVANCED VIEWS

## Timeline
- past/present/future;
- filters;
- lazy history;
- secret-safe.

## Schedule
- list/day/week;
- CalendarAdapter;
- drag reschedule only via Command/Plan;
- list fallback.

## Gantt
- optional;
- lazy;
- Project remains usable without it;
- drag/resize generates commands;
- windowing for scale.

## Kanban
- lifecycle/stage alternative;
- drag transition generates Command;
- invalid transition blocked/explained.

## Graph
- optional;
- Relations/Knowledge/dependencies;
- node/depth caps;
- lazy expansion;
- authority-side secret filtering;
- fallback table/tree/list;
- no required heavy graph library.

---

# 41. GLOBAL SEARCH E COMMAND PALETTE

Search:
- audience-aware index;
- grouped results;
- exact/prefix/fuzzy weighting;
- context disambiguation;
- incremental/rebuildable;
- no secret leakage through autocomplete/counts/snippets.

Command Palette:
- Ctrl/Cmd+K candidate;
- pages + entities + Actions;
- availability from Action Registry;
- destructive actions still require preview/confirm;
- power tool, not sole navigation.

Shortcuts:
- central registry;
- conflict detection;
- input-context aware;
- discoverable;
- optional personal remapping.

---

# 42. STORAGE FINAL

## 42.1. Canonical

- JournalEntry + module flags/repository data.
- Domain canonical document is JournalEntry.
- Large independent lifecycle entities may have independent persisted records/stores behind repositories.
- Physical storage is an implementation boundary; consumers see contracts.

## 42.2. Repository contract

Repositories handle:
- load/get/query;
- save;
- revision checks;
- codec;
- schema validation;
- batch operations;
- storage errors.

They do NOT:
- run cross-subsystem business workflow;
- invent events;
- bypass authority.

## 42.3. Index

Rebuildable:
- by entity kind;
- Domain/parent;
- status;
- dueAt;
- target/source refs;
- visibility/audience where necessary.

## 42.4. Cache

Discardable:
- audience/context key included;
- never reuse GM projection for player;
- selective invalidation;
- size limits/eviction;
- TTL only where semantics allow.

---

# 43. MIGRATIONS

MigrationManager:
- stable migration IDs;
- fromVersion/toVersion;
- incremental;
- idempotent;
- preconditions;
- postconditions;
- MigrationPlan;
- backup policy;
- report.

Never:
- guess unknown semantic value;
- infer identity by name;
- silently reinterpret dates/calendar;
- silently overwrite conflicts.

Quarantine categories:
```text
corrupt
ambiguous
unsupported
missing-reference
```

Quarantine:
- preserves raw source where safe;
- reason;
- source ref;
- migration ID;
- excluded from normal operational indexes;
- repair/relink workflow.

---

# 44. IMPORT / EXPORT / BACKUP

Differentiate:
- full backup;
- share/package export.

Full backup may contain secrets with explicit warning.
Share export sanitized by default.

Export:
- formatVersion;
- schemaVersion;
- dependency manifest;
- external refs list;
- provenance.

Import:
- version validation;
- migration pipeline;
- preview;
- create/update/conflict/skipped;
- collision policy;
- remapping;
- checkpoints for large imports;
- final receipt/report.

Recovery snapshot:
- module version;
- Foundry version;
- schema version;
- checksum if possible.

Backup creation is useless without restore tests.

---

# 45. INTEGRITY CHECKING

`StorageIntegrityChecker` read-only by default.

Checks:
- schema mismatch;
- broken refs;
- duplicate IDs;
- impossible lifecycle;
- revision inconsistency;
- hierarchy cycles;
- orphan ScheduledOperations;
- orphan reservations;
- deleted parents;
- invalid Secret/audience policies;
- unknown definitions;
- workforce overcommit;
- invalid role occupancy;
- explicit membership mismatch.

Repair:
- separate;
- previewable;
- audited;
- ambiguity requires human review.

---

# 46. BOOT / SAFE MODE

Boot phases:
```text
runtime compatibility check
→ storage/schema inspection
→ required migrations
→ index load/rebuild
→ registry/capability validation
→ recovery scan
→ services ready
→ UI ready
```

If integrity cannot be guaranteed:
- prevent risky mutation;
- allow recoverable reads/Diagnostics when safe;
- affected subsystem may safe-mode while independent areas remain available.

---

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

# 51. PERFORMANCE

Measure first.

Budgets/categories:
- micro interaction;
- navigation/open;
- common query;
- heavy read;
- batch;
- migration/import/export.

Measure:
- duration;
- records scanned;
- cache hit/miss;
- invalidations;
- socket payload;
- render time;
- DOM count;
- rerenders;
- index rebuild;
- memory growth.

## 51.1. Rendering

- hidden tabs not fully rendered;
- collapsed branches no descendants;
- inspector history lazy;
- thousands rows use paging/virtualization;
- Gantt/Graph range-limited;
- avoid expensive effects in repeated rows.

## 51.2. Memory

- indices store minimal lookup data;
- histories not all resident;
- caches bounded;
- listeners/timers cleaned;
- object URLs revoked;
- long-running Foundry sessions tested.

## 51.3. Socket

- commands compact;
- receipts compact;
- targeted audience updates;
- no broadcast of secrets;
- visual refresh coalescing;
- chunk large result;
- full resync as recovery, not default.

## 51.4. Workers

Optional only for pure derived work:
- search index;
- graph layout;
- diagnostics;
- analytics.

Worker:
- no authority;
- no direct Foundry mutation;
- receives serializable sanitized snapshots.

---

# 52. RELEASE ENGINEERING

Version channels:
```text
dev → alpha → beta → rc → stable
```

Semantic versioning.

Stable requires:
- no known data-loss blocker;
- no known secret leakage blocker;
- no known authority bypass;
- critical migrations rehearsed;
- package install tested;
- supported upgrade tested;
- recovery path;
- diagnostics;
- release notes;
- performance smoke pass;
- multiplayer smoke pass.

Build:
- reproducible;
- validates module manifest;
- validates entrypoints/assets;
- excludes unnecessary dev artifacts;
- deterministic where possible;
- final ZIP itself is tested.

CI:
- lint/static;
- unit;
- critical integration;
- migrations;
- security/projection;
- package validation;
- selected E2E/performance gates.

---

# 53. DIAGNOSTICS / SUPPORT

GM Diagnostics should expose:
- module/build/schema versions;
- Foundry/dependency versions;
- Primary Authority + epoch;
- queue;
- locks;
- transactions/recoveries;
- provider health;
- registry conflicts;
- unknown IDs;
- broken refs;
- migrations pending/history;
- quarantine;
- index/cache state;
- scheduler backlog;
- performance summaries when enabled.

Generate Diagnostic Report:
- sanitized by default;
- no secret narrative/raw payload unnecessary;
- user can knowingly include extra detail.

---

# 54. IMPLEMENTATION GATES — ORDEM NORMATIVA

## G0 — Skeleton / Infrastructure
Deliver:
- module boot;
- version metadata;
- logging;
- diagnostics shell;
- registries;
- repository interfaces;
- test harness;
- CI/build/package skeleton.

Exit:
- clean install;
- boot without critical error;
- tests runnable;
- package reproducible.

## G1 — Canonical Storage / Domain
Deliver:
- JournalEntry Domain repository/codec;
- core Domain schema;
- IDs/revision;
- hierarchy;
- capability shell;
- integrity checker;
- indexes.

Exit:
- create/read/update/archive/restore/reparent through proper paths;
- no direct UI flags;
- cycles blocked;
- index rebuild works.

## G2 — Authority / Commands / MutationCoordinator
Deliver:
- PrimaryAuthorityService;
- transport;
- authenticated context;
- CommandBus;
- dedupe;
- revision;
- locks;
- Plan/Receipt;
- basic Diagnostics;
- multiplayer harness.

Critical gate:
> important mutations cannot accidentally bypass Authority.

## G3 — People
Deliver full minimum People vertical slice.

Exit:
- manual/sumGroups/hybrid;
- Groups;
- Notables;
- Roles;
- OperationalGroups;
- Workforce;
- Assignment;
- grants;
- UI;
- tests.

## G4 — Economy
Deliver:
- definitions/accounts;
- ledger;
- reservation;
- transfer/adjustment;
- providers shell;
- Economy UI;
- correctness tests.

## G5 — Projects / Facilities / Downtime
Deliver:
- lifecycle;
- progress;
- Economy/People integration;
- Facilities;
- maintenance;
- downtime;
- cross-service Plans.

## G6 — Relations / Reputation / Agreements / Territory
Deliver four separate subsystems with shared refs/capabilities.

## G7 — Requests / Missions / Knowledge / Secrets
Deliver:
- Player request;
- GM decision;
- idempotent Mission;
- Knowledge;
- Secrets;
- ProjectionService;
- leakage tests.

## G8 — Time / Scheduler / Conditions / Actions
Deliver:
- TimeProvider;
- Scheduler persistence/retry/catch-up;
- Events;
- Conditions;
- Actions;
- automation manual/review first;
- Resolve Period.

## G9 — UI System / Explorer / Operations
Deliver:
- tokens/primitives;
- App Shell;
- Explorer;
- DataGrid;
- Inspector;
- Forms/preview;
- Operations;
- global search;
- Timeline/Schedule;
- optional advanced views later in gate.

## G10 — Migrations / Import-Export / Recovery
Deliver production-grade evolution/recovery tooling.

## G11 — Hardening / Performance / Multiplayer
Deliver:
- race/fault suite;
- benchmarks;
- memory tests;
- accessibility;
- visual regression;
- large-world testing.

## G12 — Beta / RC / Stable
Freeze scope, rehearse upgrades, ship verified artifacts.

---

# 55. DEFINITION OF DONE

Feature is NOT Done until all applicable items are satisfied:

- [ ] contract/schema defined;
- [ ] ownership/source-of-truth clear;
- [ ] happy path works;
- [ ] validation path works;
- [ ] failure path works;
- [ ] permission/authority correct;
- [ ] revision/idempotency handled;
- [ ] secret/projection behavior tested;
- [ ] Receipt/audit correct;
- [ ] repository/storage boundary respected;
- [ ] migration impact reviewed;
- [ ] diagnostics exist;
- [ ] tests exist;
- [ ] performance considered/measured if hot path;
- [ ] loading/empty/error/permission states exist if UI;
- [ ] keyboard/accessibility handled if UI;
- [ ] documentation/spec updated;
- [ ] recovery/rollback documented for critical mutation;
- [ ] no unresolved blocker hidden behind feature flag.

---

# 56. FILE / MODULE STRUCTURE — IMPLEMENTATION BLUEPRINT

This is a recommended physical map derived from the contracts; names may be refined without changing boundaries.

```text
src/
├── core/
│   ├── ids/
│   ├── refs/
│   ├── result/
│   ├── errors/
│   ├── registries/
│   ├── versioning/
│   └── contexts/
│
├── storage/
│   ├── codecs/
│   ├── repositories/
│   ├── indexes/
│   ├── caches/
│   └── integrity/
│
├── authority/
│   ├── primary-authority-service.ts
│   ├── authority-epoch.ts
│   └── authority-status.ts
│
├── commands/
│   ├── command-bus.ts
│   ├── command-registry.ts
│   ├── command-transport.ts
│   ├── command-status.ts
│   ├── dedupe-store.ts
│   └── rate-limiter.ts
│
├── mutations/
│   ├── mutation-coordinator.ts
│   ├── lock-manager.ts
│   ├── plans/
│   ├── transaction-store.ts
│   ├── recovery-service.ts
│   └── compensation/
│
├── audit/
├── diagnostics/
├── domains/
├── people/
├── economy/
├── projects/
├── facilities/
├── downtime/
├── relations/
├── reputation/
├── agreements/
├── territory/
├── requests/
├── missions/
├── knowledge/
├── secrets/
├── time/
├── scheduler/
├── events/
├── conditions/
├── actions/
├── automation/
├── projection/
├── aggregation/
├── migrations/
├── import-export/
│
└── ui/
    ├── foundations/
    ├── tokens/
    ├── primitives/
    ├── patterns/
    ├── domain-patterns/
    ├── explorer/
    ├── operations/
    ├── timeline/
    └── diagnostics/
```

Rule:
> Folder structure may evolve; dependency boundaries may not be casually collapsed.

---

# 57. CROSS-SYSTEM DEPENDENCY RULES

Allowed direction examples:

```text
Projects ─query/plan→ People
Projects ─child plan→ Economy
Facility ─capability provider→ Domain
Agreement ─right grant→ CapabilityResolver
Mission ─resolution plan→ Projects/Economy/Diplomacy
Scheduler ─command→ Owning Service
Knowledge ─projection context→ UI
```

Forbidden:

```text
People → Project internals
Economy → Project lifecycle
Scheduler → Economy ledger direct
Mission → ResourceAccount direct
UI → Repository save
Relation → Reputation direct field rewrite
Agreement → Territory ownership rewrite
```

Cross-service mutation uses explicit child plans/operations.

---

# 58. BREACH-PREVENTION CHECKLIST

Before implementing ANY feature, answer:

1. Who owns this state?
2. Is it canonical, derived, cached or projected?
3. What is its stable ID?
4. What revision protects it?
5. Can it be secret?
6. What does a Player receive?
7. What Command represents the intent?
8. What permission is checked authority-side?
9. What locks are needed?
10. What fresh reads happen?
11. Is a Plan required?
12. Is TransactionRecord required?
13. What happens on timeout?
14. Is retry idempotent?
15. What Receipt is produced?
16. What Audit/Event is produced?
17. What cache/index invalidates?
18. What migration impact exists?
19. What happens if provider/addon is missing?
20. What happens after restart/crash?
21. What does empty/error/permission UI show?
22. How does it scale from 12 to thousands?
23. What tests prove the invariant?
24. How is it diagnosed?
25. What is the recovery path?

If any answer is “não sei”, feature is not ready to code.

---

# 59. ACCEPTANCE SCENARIOS DO PRODUTO

## Scenario A — Small base
- 12 people;
- few resources;
- 2–5 Projects;
- one Facility;
- few Relations;
- no advanced graph required.

Must feel light and human-readable.

## Scenario B — Medium Domain
- hundreds of People records/groups;
- multiple resources;
- dozens Projects/Facilities;
- active Agreements/Missions;
- Scheduler operations.

Must remain fast with filters and Operations.

## Scenario C — Empire
- many Domain nodes;
- thousands of records;
- large history;
- many future operations;
- secrets/projections;
- multiple players.

Must not require rendering or scanning everything.

## Scenario D — Multiplayer conflict
Two actors issue conflicting mutations.
Expected:
- one authoritative outcome;
- conflict result for stale operation;
- no double effect;
- clear Receipt/diagnostic.

## Scenario E — Authority failover
GM authority disconnects during risky transaction.
Expected:
- durable transaction state;
- safe recovery;
- no blind retry;
- unresolved keys blocked only where necessary.

## Scenario F — Secret
GM has full data; Player should see partial/none.
Expected:
- payload itself sanitized;
- search/count/grouping cannot infer secret;
- no raw hidden fields in DOM.

## Scenario G — Long offline interval
World time jumps.
Expected:
- reconciliation;
- catch-up preview if large;
- deterministic phase ordering;
- no million-microtick brute force where aggregation is safe.

## Scenario H — Upgrade old world
Expected:
- schema detection;
- MigrationPlan;
- backup;
- incremental migrations;
- quarantine ambiguity;
- rebuild indexes;
- report.

---

# 60. IMPLEMENTATION FREEDOMS THAT DO NOT REQUIRE A NEW DECISION

A developer may refine without architectural reapproval:
- internal function names;
- file names;
- private helper classes;
- exact CSS values within approved token semantics;
- exact pagination page size;
- exact performance threshold after benchmarks;
- exact index data structure;
- whether a pure calculation uses loop/map/reduce;
- internal test framework configuration.

A new DEC/spec update IS required if changing:
- source-of-truth;
- authority boundary;
- identity/ID semantics;
- public contract;
- lifecycle meaning;
- storage meaning;
- secret/projection rule;
- cross-system ownership;
- migration semantics;
- destructive safety tier;
- supported compatibility promise;
- final implementation gate scope materially.

---

# 61. MASTER STATUS

```text
DECISIONS CONSOLIDATED: 7700
ROUNDS: 12 / 12
ARCHITECTURE: FROZEN BASELINE
NEXT PHASE:
  MASTER → IMPLEMENTATION PLAN → G0 → ... → G12
```

The following appendices contain the original Decision Registers verbatim for auditability.
Where an appendix conflicts with an explicit MASTER-NORM rule, the MASTER-NORM rule is current and the appendix remains historical evidence.

---

# 62. SOURCE MANIFEST / CHECKSUMS

| Arquivo | Bytes | SHA-256 |

|---|---:|---|

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_01_1-182.md` | 67,929 | `9b38c22dc8114144ae98be5423f919ec17ba8449a725f99e2fefb7b2cafa974a` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_02_SCHEMA_V1_183-338.md` | 35,281 | `74236c97d63cf3342848f51a18017f29522345d583a9180d47943b623d3966f5` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_03_IDS_CONTRACTS_339-510.md` | 39,400 | `86a6d67e4ee0b57cf8e9be2a128a3faa7aa2f63c50fe76829c0335e652edd472` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_04_AUTHORITY_COMMANDS_511-890.md` | 28,630 | `c150e2278d52138812163614e7bdf94c34daffda1c9f2d5379331d1f9681c731` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_05_PEOPLE_891-1415.md` | 81,166 | `f428eb2deafb99042b10e1832c461d060bb70caf6668ea1dbc9082ba9630a322` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_06_ECONOMY_1416-2305.md` | 40,407 | `02457f7f66fde2f25d748f4fa8897622c09a3f54e3b41443d786bd071ecef956` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_07_PROJECTS_DOWNTIME_FACILITIES_2306-3200.md` | 45,153 | `5c8a5cec5f86e05615a76d468af5b4e420e986c472dd297d6b2a6721ea831c93` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_08_RELATIONS_REPUTATION_AGREEMENTS_TERRITORY_3201-4100.md` | 26,933 | `b4a3659bf9eb329da013beaf123cff97f892df90e8aa91b6099a69fd615fef75` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_09_REQUESTS_MISSIONS_KNOWLEDGE_SECRETS_4101-5000.md` | 17,969 | `2a06a2ffe694835dd3ae45189440298d49f9ad19add615febb5cfd9eab683bb5` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_10_TIME_TICKS_EVENTS_CONDITIONS_ACTIONS_5001-5900.md` | 11,224 | `f63e576fb67c81c1145163b1ec779d93664a7eaf283244483571315fa6aa4942` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_11_UI_UX_EXPLORER_OPERATIONS_5901-6800.md` | 13,315 | `ac1691c42eb2ca6b91deb1adf0af6af4a5022c003bf641af0c330db362e2b701` |

| `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_12_STORAGE_MIGRATIONS_TESTS_PERFORMANCE_RELEASE_6801-7700.md` | 10,871 | `3a6bf4766df17e84465b86236bfdb7e4c716ea37975455b2ea427e01820e9503` |


---
# 63. ANEXOS — DECISION REGISTERS ORIGINAIS INTEGRAIS

---

# ANEXO 01 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_01_1-182.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 01

> Snapshot consolidado das decisões arquiteturais aprovadas nas perguntas 1–182.
>
> **Status:** CONGELADO PARA A PRÓXIMA RODADA, salvo decisão explicitamente reaberta depois.
>
> Perguntas 1–10 foram respondidas individualmente. Nas perguntas 11–182, o usuário aprovou em bloco todas as opções marcadas como **RECOMENDADO**. A decisão 7 foi posteriormente refinada: `Actor.name` é a única fonte de verdade do nome do Domain.

---

# 0. Política de preservação

Este arquivo existe para que decisões tomadas em rodadas grandes de perguntas não dependam apenas do histórico do chat.

Regras:

- nenhuma decisão deste snapshot deve ser alterada silenciosamente;
- se uma decisão for reaberta, registrar a nova decisão e a anterior;
- `AJUSTADO` significa que houve refinamento explícito após a escolha inicial;
- decisões futuras de schema/contracts devem referenciar os IDs deste register quando alterarem comportamento;
- após cada nova rodada grande, gerar novo `.md` de snapshot antes de continuar;
- posteriormente os snapshots podem ser incorporados ao MASTER, mantendo o original preservado.

---

# 1. Resumo executivo

Total de decisões congeladas: **182**.

A arquitetura aprovada fixa, entre outros pontos:

- Foundry v13.351+ como alvo inicial;
- TypeScript + esbuild;
- Domain como Actor nativo, com `Actor.name` como nome oficial;
- kind aberto, scale descritivo e capabilities como composição funcional;
- pelo menos uma capability funcional por Domain;
- hierarchy com `parentDomainUuid` como única verdade persistente;
- People, Roles, OperationalGroups e Population separados;
- Economy com ledger obrigatório, reservations e transactions coordenadas;
- Projects com Definition/Instance/Entry/Plan/Receipt;
- Relations, Reputation e view state separados;
- secrets sanitizados antes de chegar ao player;
- worldTime como substrato temporal;
- PrimaryAuthorityService com dedupe, retries e ordered multi-key locks;
- API versionada, contexts/DTOs e extension registries;
- UI separada em Explorer, Sheet, Operations e Player View;
- migrations/testes/backup desde o começo;
- `0.1.0-dev.x` durante desenvolvimento e 1.0 por estabilidade, não quantidade.

---

# 2. Índice por categoria

| Categoria | IDs | Quantidade |
|---|---:|---:|
| Contrato Técnico Zero | 1–10 | 10 |
| DomainDataModel / Identidade | 11–25 | 15 |
| Capabilities | 26–33 | 8 |
| Hierarchy | 34–42 | 9 |
| People / Population | 43–57 | 15 |
| Facilities | 58–67 | 10 |
| Economy / Resources | 68–82 | 15 |
| Projects | 83–97 | 15 |
| Relations / Reputation | 98–109 | 12 |
| Territory | 110–114 | 5 |
| Requests / Player Interaction | 115–120 | 6 |
| Knowledge / Secrets | 121–125 | 5 |
| Time / Ticks | 126–131 | 6 |
| Events / Conditions | 132–136 | 5 |
| Authority / Multiplayer | 137–143 | 7 |
| API / Extensibilidade | 144–149 | 6 |
| UI / UX | 150–160 | 11 |
| Import / Export / Backup | 161–166 | 6 |
| Migrations | 167–171 | 5 |
| Tests / Quality | 172–178 | 7 |
| Release / Versionamento | 179–182 | 4 |

---

# 3. Decisões detalhadas

## Contrato Técnico Zero

### DEC-001 — Foundry alvo inicial

**Escolha aprovada:** `A`

**Decisão:** Suportar inicialmente Foundry VTT v13.351+; não assumir suporte simultâneo a v12/v14 no primeiro ciclo.

**Motivo / consequência arquitetural:** Reduz compatibilidade prematura e permite validar uma base moderna e estável antes de ampliar a matriz de suporte.

**Status:** `DECIDIDO`

---

### DEC-002 — Linguagem

**Escolha aprovada:** `A`

**Decisão:** TypeScript como linguagem principal.

**Motivo / consequência arquitetural:** Ajuda a formalizar DataModels, Commands, Plans, Receipts, Providers, API pública e contracts complexos.

**Status:** `DECIDIDO`

---

### DEC-003 — Build/tooling

**Escolha aprovada:** `B`

**Decisão:** esbuild + TypeScript.

**Motivo / consequência arquitetural:** Pipeline pequeno, rápido e previsível, adequado a um módulo Foundry sem introduzir framework de UI pesado.

**Status:** `DECIDIDO`

---

### DEC-004 — Significado de scale

**Escolha aprovada:** `A`

**Decisão:** `scale` é classificação/preset administrativo e visual; não determina features obrigatórias.

**Motivo / consequência arquitetural:** Mantém a ontologia flexível: capability define comportamento; escala ajuda UX, filtros e presets.

**Status:** `DECIDIDO`

---

### DEC-005 — Modelo de kind

**Escolha aprovada:** `A`

**Decisão:** `kind` é string aberta com presets/registries; addons podem registrar novos kinds.

**Motivo / consequência arquitetural:** Evita enum fechado e mantém o módulo system-agnostic/extensível.

**Status:** `DECIDIDO`

---

### DEC-006 — Modelo de capabilities

**Escolha aprovada:** `C`

**Decisão:** Domain possui capabilities-base simples, mas o conceito de `CapabilityGrant` existe desde o início para fontes derivadas.

**Motivo / consequência arquitetural:** Permite começar simples e evoluir para Roles, Facilities, OperationalGroups e providers sem refatoração ontológica.

**Status:** `DECIDIDO`

---

### DEC-007 — Nome oficial do Domain

**Escolha aprovada:** `AJUSTADO`

**Decisão:** `Actor.name` é a única fonte de verdade do nome principal. IDs/UUIDs nunca são derivados do nome.

**Motivo / consequência arquitetural:** A escolha inicial foi revista para evitar duas fontes de verdade. Referências quebráveis podem manter `lastKnownName` apenas para diagnóstico.

**Status:** `DECIDIDO`

---

### DEC-008 — Domain sem subsystem funcional

**Escolha aprovada:** `B`

**Decisão:** Todo Domain deve possuir pelo menos uma capability funcional ativa.

**Motivo / consequência arquitetural:** Evita Documents semanticamente vazios. A criação rápida precisa aplicar ou pedir ao menos uma capability funcional.

**Status:** `DECIDIDO`

---

### DEC-009 — Número de parents administrativos

**Escolha aprovada:** `A`

**Decisão:** Um único `parentDomainUuid` administrativo.

**Motivo / consequência arquitetural:** Hierarquia estrutural permanece uma árvore/floresta; vínculos adicionais pertencem a Relations.

**Status:** `DECIDIDO`

---

### DEC-010 — Fluxo de criação

**Escolha aprovada:** `C`

**Decisão:** Dois fluxos: Criação Rápida e Criação Avançada.

**Motivo / consequência arquitetural:** A rápida serve bases pequenas e uso cotidiano; a avançada expõe configuração detalhada sem poluir o caminho comum.

**Status:** `DECIDIDO`

---

## DomainDataModel / Identidade

### DEC-011 — Descrição do Domain

**Escolha aprovada:** `C`

**Decisão:** Manter resumo curto + descrição rica.

**Motivo / consequência arquitetural:** O resumo serve listas/Explorer; a descrição rica serve dossier/sheet sem forçar textos extensos em contextos compactos.

**Status:** `DECIDIDO`

---

### DEC-012 — Aliases

**Escolha aprovada:** `A`

**Decisão:** Permitir `aliases: string[]`.

**Motivo / consequência arquitetural:** Ajuda busca, lore, renomes e identificação sem conflitar com `Actor.name`.

**Status:** `DECIDIDO`

---

### DEC-013 — Imagem

**Escolha aprovada:** `A`

**Decisão:** No núcleo inicial usar apenas `Actor.img`.

**Motivo / consequência arquitetural:** Evita campos visuais prematuros; banner/background podem ser adicionados mais tarde sem alterar identidade.

**Status:** `DECIDIDO`

---

### DEC-014 — Lifecycle administrativo

**Escolha aprovada:** `A`

**Decisão:** Usar `active`, `inactive`, `archived` como lifecycle universal.

**Motivo / consequência arquitetural:** Estados narrativos como danificado/instável pertencem a Conditions/State, não ao lifecycle administrativo.

**Status:** `DECIDIDO`

---

### DEC-015 — Semântica de archive

**Escolha aprovada:** `A`

**Decisão:** Domain arquivado continua resolvível por UUID e fica normalmente oculto/read-only.

**Motivo / consequência arquitetural:** Preserva histórico, relations, projects e referências.

**Status:** `DECIDIDO`

---

### DEC-016 — Tags

**Escolha aprovada:** `C`

**Decisão:** Tags livres + namespaces/presets registrados.

**Motivo / consequência arquitetural:** Combina liberdade do GM com interoperabilidade e autocomplete para tags conhecidas.

**Status:** `DECIDIDO`

---

### DEC-017 — Metadata própria

**Escolha aprovada:** `B`

**Decisão:** Persistir apenas metadata administrativa que o Domain Manager realmente precisa.

**Motivo / consequência arquitetural:** Evita duplicar metadata nativa do Foundry e criar fontes de verdade concorrentes.

**Status:** `DECIDIDO`

---

### DEC-018 — createdByUserId

**Escolha aprovada:** `A`

**Decisão:** Guardar explicitamente o criador do Domain.

**Motivo / consequência arquitetural:** Útil para auditoria, import e diagnóstico.

**Status:** `DECIDIDO`

---

### DEC-019 — Último editor

**Escolha aprovada:** `C`

**Decisão:** Não persistir como campo global a cada update; operações relevantes registram autoria em receipts/audit.

**Motivo / consequência arquitetural:** Audit real é mais confiável do que um único `lastModifiedBy` sobrescrito continuamente.

**Status:** `DECIDIDO`

---

### DEC-020 — Revision inicial

**Escolha aprovada:** `A`

**Decisão:** Uma revision global do Domain no núcleo inicial.

**Motivo / consequência arquitetural:** Mantém concurrency simples; subsistemas transacionais podem ganhar revisions próprias quando necessário.

**Status:** `DECIDIDO`

---

### DEC-021 — State no schema v1

**Escolha aprovada:** `A`

**Decisão:** `state` existe desde schema v1, mesmo inicialmente pequeno.

**Motivo / consequência arquitetural:** Evita migration estrutural imediata e preserva a separação Definition/State.

**Status:** `DECIDIDO`

---

### DEC-022 — Definition no schema v1

**Escolha aprovada:** `A`

**Decisão:** `definition` existe desde schema v1.

**Motivo / consequência arquitetural:** Identidade/configuração durável não deve ficar misturada com estado temporário.

**Status:** `DECIDIDO`

---

### DEC-023 — Root Domains

**Escolha aprovada:** `A`

**Decisão:** `parentDomainUuid = null` é válido.

**Motivo / consequência arquitetural:** Permite múltiplas raízes independentes sem root artificial.

**Status:** `DECIDIDO`

---

### DEC-024 — Mudança de kind

**Escolha aprovada:** `B`

**Decisão:** Kind pode mudar, mas passa por validação/migration quando necessário.

**Motivo / consequência arquitetural:** O mundo pode evoluir sem tornar kind imutável, preservando consistência de configuração.

**Status:** `DECIDIDO`

---

### DEC-025 — Mudança de scale

**Escolha aprovada:** `A`

**Decisão:** Scale pode mudar livremente por ser classificação/preset.

**Motivo / consequência arquitetural:** Como scale não controla capabilities, promoção de posto→base→cidade não exige migration estrutural.

**Status:** `DECIDIDO`

---

## Capabilities

### DEC-026 — Capabilities iniciais na criação rápida

**Escolha aprovada:** `B`

**Decisão:** Presets de kind/scale sugerem capabilities-base editáveis.

**Motivo / consequência arquitetural:** Acelera criação sem tornar presets regras rígidas.

**Status:** `DECIDIDO`

---

### DEC-027 — Desabilitar capability

**Escolha aprovada:** `A`

**Decisão:** Desabilitar capability preserva os dados existentes.

**Motivo / consequência arquitetural:** Desabilitar UI/comportamento não deve ser operação destrutiva.

**Status:** `DECIDIDO`

---

### DEC-028 — Purge de subsystem

**Escolha aprovada:** `A`

**Decisão:** Purge é ação separada, destrutiva e explicitamente confirmada.

**Motivo / consequência arquitetural:** Separa enablement de destruição permanente de dados.

**Status:** `DECIDIDO`

---

### DEC-029 — Storage de capabilities-base

**Escolha aprovada:** `A`

**Decisão:** Persistir array de IDs de capabilities habilitadas.

**Motivo / consequência arquitetural:** Modelo simples para enablement; configuração específica vive em contracts próprios.

**Status:** `DECIDIDO`

---

### DEC-030 — Effective Capability Grants

**Escolha aprovada:** `C`

**Decisão:** Grants efetivos são derivados, podendo usar cache reconstruível se performance exigir.

**Motivo / consequência arquitetural:** Source records permanecem verdade; cache nunca vira autoridade.

**Status:** `DECIDIDO`

---

### DEC-031 — Registro por addons

**Escolha aprovada:** `A`

**Decisão:** Addons podem registrar capabilities namespaced.

**Motivo / consequência arquitetural:** Essencial para packs/system integrations sem hardcode no core.

**Status:** `DECIDIDO`

---

### DEC-032 — Capability de addon removido

**Escolha aprovada:** `A`

**Decisão:** Preservar ID e marcar como unavailable/unknown.

**Motivo / consequência arquitetural:** Evita perda de dados quando addon é removido ou temporariamente indisponível.

**Status:** `DECIDIDO`

---

### DEC-033 — Configuração por capability

**Escolha aprovada:** `A`

**Decisão:** Cada capability pode registrar schema/config próprio.

**Motivo / consequência arquitetural:** Permite settings especializados sem converter capability em simples boolean universal.

**Status:** `DECIDIDO`

---

## Hierarchy

### DEC-034 — Escala de children

**Escolha aprovada:** `A`

**Decisão:** Arquitetura deve suportar centenas de filhos por Domain.

**Motivo / consequência arquitetural:** Impérios e organizações grandes não podem depender de limites arbitrários.

**Status:** `DECIDIDO`

---

### DEC-035 — Persistência de children

**Escolha aprovada:** `A`

**Decisão:** Não persistir `children[]` no parent; derivar por índice a partir de `parentDomainUuid`.

**Motivo / consequência arquitetural:** Evita dual-write e inconsistências.

**Status:** `DECIDIDO`

---

### DEC-036 — Persistência de ancestors

**Escolha aprovada:** `A`

**Decisão:** Ancestors são derivados por índice.

**Motivo / consequência arquitetural:** Caches podem existir, mas precisam ser reconstruíveis.

**Status:** `DECIDIDO`

---

### DEC-037 — Reparent

**Escolha aprovada:** `B`

**Decisão:** Mover Domain de parent é Command validado.

**Motivo / consequência arquitetural:** Permite checar cycles, permission, revision e audit.

**Status:** `DECIDIDO`

---

### DEC-038 — Mover subtree

**Escolha aprovada:** `A`

**Decisão:** Reparent do nó move naturalmente todo o subtree.

**Motivo / consequência arquitetural:** Descendentes mantêm seus parents diretos; não exige rewrite em massa.

**Status:** `DECIDIDO`

---

### DEC-039 — Profundidade máxima

**Escolha aprovada:** `A`

**Decisão:** Sem limite artificial de profundidade.

**Motivo / consequência arquitetural:** Cycle detection é a proteção correta; profundidade pode variar por mundo.

**Status:** `DECIDIDO`

---

### DEC-040 — Foundry Folder vs parent

**Escolha aprovada:** `A`

**Decisão:** Folders de UI são independentes da hierarquia administrativa.

**Motivo / consequência arquitetural:** Organização visual não altera semântica do mundo.

**Status:** `DECIDIDO`

---

### DEC-041 — Excluir parent com filhos

**Escolha aprovada:** `A`

**Decisão:** Bloquear delete até o GM reparentar/arquivar filhos.

**Motivo / consequência arquitetural:** Evita orphaning/cascade destrutivo acidental.

**Status:** `DECIDIDO`

---

### DEC-042 — Arquivar parent

**Escolha aprovada:** `C`

**Decisão:** O GM escolhe se filhos também serão arquivados.

**Motivo / consequência arquitetural:** Arquivar uma organização nem sempre significa arquivar todas as entidades subordinadas.

**Status:** `DECIDIDO`

---

## People / Population

### DEC-043 — População manual

**Escolha aprovada:** `A`

**Decisão:** Population pode ser apenas um número manual.

**Motivo / consequência arquitetural:** Mantém o módulo rápido para bases pequenas.

**Status:** `DECIDIDO`

---

### DEC-044 — Modos de população

**Escolha aprovada:** `A`

**Decisão:** Suportar `manual`, `sumGroups` e `hybrid`.

**Motivo / consequência arquitetural:** Atende tanto uso simples quanto detalhado; hybrid permite subconjuntos sem dupla contagem.

**Status:** `DECIDIDO`

---

### DEC-045 — PopulationGroup zero

**Escolha aprovada:** `B`

**Decisão:** Grupo com quantidade zero não é registro operacional normal.

**Motivo / consequência arquitetural:** Evita lixo persistente; templates podem guardar grupos potenciais.

**Status:** `DECIDIDO`

---

### DEC-046 — Tags em PopulationGroup

**Escolha aprovada:** `A`

**Decisão:** PopulationGroups podem ter tags.

**Motivo / consequência arquitetural:** Facilita filtros, regras e agregação.

**Status:** `DECIDIDO`

---

### DEC-047 — Identidade de PopulationGroup

**Escolha aprovada:** `A`

**Decisão:** ID interno basta; não vira Document global por padrão.

**Motivo / consequência arquitetural:** Reduz overhead e preserva coesão com o Domain.

**Status:** `DECIDIDO`

---

### DEC-048 — Notable sem Actor

**Escolha aprovada:** `B`

**Decisão:** Link a Actor é opcional.

**Motivo / consequência arquitetural:** Permite registrar pessoas relevantes sem obrigar criação de Actor.

**Status:** `DECIDIDO`

---

### DEC-049 — Actor de Notable apagado

**Escolha aprovada:** `B`

**Decisão:** Manter orphan com `lastKnownName` e ação de repair.

**Motivo / consequência arquitetural:** Preserva contexto/histórico sem bloquear lifecycle de Actors.

**Status:** `DECIDIDO`

---

### DEC-050 — Portrait override de Notable

**Escolha aprovada:** `B`

**Decisão:** Usar `Actor.img` quando houver Actor; não adicionar override no núcleo inicial.

**Motivo / consequência arquitetural:** Mantém modelo simples; override pode entrar por necessidade real.

**Status:** `DECIDIDO`

---

### DEC-051 — Role vazio

**Escolha aprovada:** `A`

**Decisão:** DomainRole pode existir sem occupant.

**Motivo / consequência arquitetural:** Permite cargos vagos e requisitos não satisfeitos.

**Status:** `DECIDIDO`

---

### DEC-052 — Actor em múltiplos Roles

**Escolha aprovada:** `A`

**Decisão:** Um Actor pode ocupar vários Roles.

**Motivo / consequência arquitetural:** Evita restrição artificial em organizações pequenas.

**Status:** `DECIDIDO`

---

### DEC-053 — Vários ocupantes no mesmo Role

**Escolha aprovada:** `A`

**Decisão:** A definição do Role decide multiplicidade.

**Motivo / consequência arquitetural:** Suporta cargos unitários e conselhos/equipes.

**Status:** `DECIDIDO`

---

### DEC-054 — Role concede capability

**Escolha aprovada:** `A`

**Decisão:** Roles podem ser fontes de CapabilityGrant.

**Motivo / consequência arquitetural:** Conecta governança a capacidades operacionais sem hardcode.

**Status:** `DECIDIDO`

---

### DEC-055 — PopulationGroup vs OperationalGroup

**Escolha aprovada:** `A`

**Decisão:** São modelos distintos.

**Motivo / consequência arquitetural:** Demografia não é a mesma coisa que unidade funcional.

**Status:** `DECIDIDO`

---

### DEC-056 — OperationalGroup ligado a Actors

**Escolha aprovada:** `A`

**Decisão:** Pode referenciar Actors concretos opcionalmente.

**Motivo / consequência arquitetural:** Mantém abstração sem impedir detalhe quando necessário.

**Status:** `DECIDIDO`

---

### DEC-057 — Workforce disponível

**Escolha aprovada:** `A`

**Decisão:** Derivar disponibilidade de groups, assignments e commitments.

**Motivo / consequência arquitetural:** Evita armazenar número que pode divergir da realidade operacional.

**Status:** `DECIDIDO`

---

## Facilities

### DEC-058 — Ordem de implementação

**Escolha aprovada:** `B`

**Decisão:** Facilities entram depois de Projects.

**Motivo / consequência arquitetural:** Projects podem construir/reparar Facilities; é melhor estabilizar Project engine primeiro.

**Status:** `DECIDIDO`

---

### DEC-059 — Storage físico

**Escolha aprovada:** `C`

**Decisão:** Manter `FacilityRepository` abstrato até protótipo decidir se vira Item ou outro storage.

**Motivo / consequência arquitetural:** Evita congelar storage antes de validar lifecycle e UX.

**Status:** `DECIDIDO`

---

### DEC-060 — Definition vs Instance

**Escolha aprovada:** `A`

**Decisão:** Separar FacilityDefinition de FacilityInstance.

**Motivo / consequência arquitetural:** Permite templates/compendia e várias instâncias do mesmo tipo.

**Status:** `DECIDIDO`

---

### DEC-061 — Onde vivem Definitions

**Escolha aprovada:** `A`

**Decisão:** FacilityDefinitions em Compendium/content packs.

**Motivo / consequência arquitetural:** Separa engine de conteúdo e permite packs temáticos.

**Status:** `DECIDIDO`

---

### DEC-062 — Facility sem layout visual

**Escolha aprovada:** `A`

**Decisão:** Facility pode existir sem posição em mapa/grid.

**Motivo / consequência arquitetural:** A administração não depende de um minigame de base.

**Status:** `DECIDIDO`

---

### DEC-063 — Lifecycle de Facility

**Escolha aprovada:** `A`

**Decisão:** Facility possui lifecycle próprio (planned/construction/operational/damaged/etc.).

**Motivo / consequência arquitetural:** Permite Projects, Conditions e effects coerentes.

**Status:** `DECIDIDO`

---

### DEC-064 — Efeitos sob dano

**Escolha aprovada:** `A`

**Decisão:** FacilityDefinition decide comportamento de efeitos quando danificada/disabled.

**Motivo / consequência arquitetural:** Evita regra universal inadequada.

**Status:** `DECIDIDO`

---

### DEC-065 — CapabilityGrant por Facility

**Escolha aprovada:** `A`

**Decisão:** Facilities podem conceder capabilities.

**Motivo / consequência arquitetural:** Infraestrutura pode habilitar ações/serviços do Domain.

**Status:** `DECIDIDO`

---

### DEC-066 — Upkeep

**Escolha aprovada:** `A`

**Decisão:** Facilities podem declarar upkeep.

**Motivo / consequência arquitetural:** Integração futura com Economy/Tick sem exigir automação imediata.

**Status:** `DECIDIDO`

---

### DEC-067 — Produção automática no v1

**Escolha aprovada:** `B`

**Decisão:** Não automatizar production chains no v1.

**Motivo / consequência arquitetural:** Evita transformar a fundação em simulador econômico antes da hora.

**Status:** `DECIDIDO`

---

## Economy / Resources

### DEC-068 — Resources em todos Domains

**Escolha aprovada:** `B`

**Decisão:** Economy/resources só existe quando capability `resources` está ativa.

**Motivo / consequência arquitetural:** Mantém Domains simples quando economia não interessa.

**Status:** `DECIDIDO`

---

### DEC-069 — ResourceDefinition

**Escolha aprovada:** `A`

**Decisão:** Definitions são reutilizáveis/globalmente registradas com Accounts por Domain.

**Motivo / consequência arquitetural:** Evita redefinir 'Fuel' em cada entidade.

**Status:** `DECIDIDO`

---

### DEC-070 — Resource custom do GM

**Escolha aprovada:** `A`

**Decisão:** GM pode criar ResourceDefinitions custom.

**Motivo / consequência arquitetural:** Preserva generalidade do módulo.

**Status:** `DECIDIDO`

---

### DEC-071 — Identidade do Resource

**Escolha aprovada:** `A`

**Decisão:** Usar ID estável/UUID lógico; label pode mudar.

**Motivo / consequência arquitetural:** Renomear recurso não quebra ledger ou referências.

**Status:** `DECIDIDO`

---

### DEC-072 — Moeda

**Escolha aprovada:** `B`

**Decisão:** Moeda pode ser Resource nativo ou vir de CurrencyProvider externo.

**Motivo / consequência arquitetural:** Permite economia abstrata e integração com sistemas sem dual-write.

**Status:** `DECIDIDO`

---

### DEC-073 — Saldo negativo

**Escolha aprovada:** `A`

**Decisão:** ResourceDefinition decide se negativos são permitidos.

**Motivo / consequência arquitetural:** Dívida, influência ou outros recursos podem precisar disso.

**Status:** `DECIDIDO`

---

### DEC-074 — Capacity

**Escolha aprovada:** `A`

**Decisão:** Capacity é opcional por account/definition.

**Motivo / consequência arquitetural:** Nem todo recurso possui limite físico.

**Status:** `DECIDIDO`

---

### DEC-075 — Overflow policy

**Escolha aprovada:** `A`

**Decisão:** Definition escolhe block/overflow/allow.

**Motivo / consequência arquitetural:** Regras diferentes exigem políticas diferentes.

**Status:** `DECIDIDO`

---

### DEC-076 — Reservations no primeiro release

**Escolha aprovada:** `A`

**Decisão:** Reservations fazem parte do Economy core inicial.

**Motivo / consequência arquitetural:** Projects dependem de saldo comprometido sem consumo imediato.

**Status:** `DECIDIDO`

---

### DEC-077 — Ledger obrigatório

**Escolha aprovada:** `A`

**Decisão:** Toda mutação de saldo passa por LedgerEntry.

**Motivo / consequência arquitetural:** Garante provenance, audit e recovery.

**Status:** `DECIDIDO`

---

### DEC-078 — Ajuste manual de GM

**Escolha aprovada:** `B`

**Decisão:** Editar saldo cria Adjustment LedgerEntry.

**Motivo / consequência arquitetural:** Evita mutação crua sem explicação.

**Status:** `DECIDIDO`

---

### DEC-079 — Editar LedgerEntry

**Escolha aprovada:** `B`

**Decisão:** Entries são imutáveis; corrigir por reversal/adjustment.

**Motivo / consequência arquitetural:** Histórico auditável não deve ser reescrito.

**Status:** `DECIDIDO`

---

### DEC-080 — Apagar LedgerEntry

**Escolha aprovada:** `A`

**Decisão:** Não apagar normalmente; hard repair é exceção diagnóstica.

**Motivo / consequência arquitetural:** Preserva trilha histórica.

**Status:** `DECIDIDO`

---

### DEC-081 — Transferência entre Domains

**Escolha aprovada:** `A`

**Decisão:** Transfer é uma transaction coordenada.

**Motivo / consequência arquitetural:** Evita debit sem credit ou vice-versa.

**Status:** `DECIDIDO`

---

### DEC-082 — Provider externo indisponível

**Escolha aprovada:** `A`

**Decisão:** Fail-closed quando provider é necessário para integridade.

**Motivo / consequência arquitetural:** Cache stale não pode autorizar operação financeira.

**Status:** `DECIDIDO`

---

## Projects

### DEC-083 — Capability opcional

**Escolha aprovada:** `A`

**Decisão:** Projects só existem em Domains com capability correspondente.

**Motivo / consequência arquitetural:** Mantém Domains mínimos quando Projects não são usados.

**Status:** `DECIDIDO`

---

### DEC-084 — ProjectDefinition reutilizável

**Escolha aprovada:** `A`

**Decisão:** Separar template/definition de instance.

**Motivo / consequência arquitetural:** Permite instanciar o mesmo tipo de Project em vários Domains.

**Status:** `DECIDIDO`

---

### DEC-085 — Project custom

**Escolha aprovada:** `A`

**Decisão:** GM pode criar Project custom sem template.

**Motivo / consequência arquitetural:** Templates aceleram; não restringem criatividade.

**Status:** `DECIDIDO`

---

### DEC-086 — Unidade de progresso

**Escolha aprovada:** `A`

**Decisão:** Usar work units inteiras.

**Motivo / consequência arquitetural:** Mais auditável e preciso que float percent.

**Status:** `DECIDIDO`

---

### DEC-087 — Percentual

**Escolha aprovada:** `A`

**Decisão:** Percentual é derivado de completed/required.

**Motivo / consequência arquitetural:** Evita duas fontes de verdade.

**Status:** `DECIDIDO`

---

### DEC-088 — Regressão de progresso

**Escolha aprovada:** `A`

**Decisão:** Permitir ProjectEntry negativa.

**Motivo / consequência arquitetural:** Suporta setbacks e perdas sem reescrever histórico.

**Status:** `DECIDIDO`

---

### DEC-089 — Completion automática

**Escolha aprovada:** `C`

**Decisão:** ProjectDefinition decide auto-complete ou confirmação.

**Motivo / consequência arquitetural:** Alguns Projects são mecânicos; outros exigem resolução narrativa.

**Status:** `DECIDIDO`

---

### DEC-090 — Overprogress

**Escolha aprovada:** `A`

**Decisão:** Clamp no goal por padrão.

**Motivo / consequência arquitetural:** Evita estado 120/100 sem semântica definida.

**Status:** `DECIDIDO`

---

### DEC-091 — Multi-domain ownership

**Escolha aprovada:** `A`

**Decisão:** V1 usa owner principal único, mas arquitetura pode reconhecer participantes no futuro.

**Motivo / consequência arquitetural:** Reduz complexidade inicial sem fechar evolução.

**Status:** `DECIDIDO`

---

### DEC-092 — Dependencies

**Escolha aprovada:** `B`

**Decisão:** Não modelar dependency graph no schema inicial sem necessidade comprovada.

**Motivo / consequência arquitetural:** Evita abstração prematura.

**Status:** `DECIDIDO`

---

### DEC-093 — Reserva de custos

**Escolha aprovada:** `A`

**Decisão:** Project pode reservar recursos antes de começar.

**Motivo / consequência arquitetural:** Integra corretamente com Economy Reservations.

**Status:** `DECIDIDO`

---

### DEC-094 — Consumo progressivo

**Escolha aprovada:** `A`

**Decisão:** Projects podem consumir recursos progressivamente.

**Motivo / consequência arquitetural:** Suporta construção/downtime por etapas.

**Status:** `DECIDIDO`

---

### DEC-095 — Contributor obrigatório

**Escolha aprovada:** `A`

**Decisão:** Não é obrigatório em toda entry.

**Motivo / consequência arquitetural:** Eventos, ajustes GM e automações também podem gerar progresso.

**Status:** `DECIDIDO`

---

### DEC-096 — Completion cria Facility

**Escolha aprovada:** `A`

**Decisão:** Pode criar via reward/action coordenada.

**Motivo / consequência arquitetural:** Mantém cross-service mutation explícita e testável.

**Status:** `DECIDIDO`

---

### DEC-097 — Roll obrigatório

**Escolha aprovada:** `A`

**Decisão:** ProgressResolver decide estratégia; roll nunca é universal.

**Motivo / consequência arquitetural:** Preserva system-agnostic design.

**Status:** `DECIDIDO`

---

## Relations / Reputation

### DEC-098 — Relations opcionais

**Escolha aprovada:** `A`

**Decisão:** Relations são capability opcional.

**Motivo / consequência arquitetural:** Nem todo Domain precisa de diplomacia.

**Status:** `DECIDIDO`

---

### DEC-099 — Target non-Domain

**Escolha aprovada:** `A`

**Decisão:** Relation pode usar generic ref para outros Documents quando tipo permitir.

**Motivo / consequência arquitetural:** Domain↔Domain continua principal, mas não limita integrações.

**Status:** `DECIDIDO`

---

### DEC-100 — Múltiplas relations por par

**Escolha aprovada:** `A`

**Decisão:** Permitir relações semânticas simultâneas.

**Motivo / consequência arquitetural:** Dois Domains podem cooperar num eixo e competir em outro.

**Status:** `DECIDIDO`

---

### DEC-101 — Duplicata do mesmo relation type

**Escolha aprovada:** `A`

**Decisão:** Bloquear por padrão, salvo type que explicitamente permita múltiplas.

**Motivo / consequência arquitetural:** Evita duplicatas acidentais sem impedir casos válidos.

**Status:** `DECIDIDO`

---

### DEC-102 — Strength universal

**Escolha aprovada:** `A`

**Decisão:** Strength é opcional/type-specific, não campo universal obrigatório.

**Motivo / consequência arquitetural:** Evita números artificiais em relações qualitativas.

**Status:** `DECIDIDO`

---

### DEC-103 — Relação secreta

**Escolha aprovada:** `A`

**Decisão:** Relations podem ter visibility restrita.

**Motivo / consequência arquitetural:** KnowledgeService controla projection para viewers.

**Status:** `DECIDIDO`

---

### DEC-104 — Encerrar relation

**Escolha aprovada:** `A`

**Decisão:** Usar status `ended`, preservando history.

**Motivo / consequência arquitetural:** Não apagar passado institucional.

**Status:** `DECIDIDO`

---

### DEC-105 — Reputation no v1

**Escolha aprovada:** `A`

**Decisão:** Reputation básica entra junto de Relations.

**Motivo / consequência arquitetural:** Modelo já está claro e é útil mesmo sem graph.

**Status:** `DECIDIDO`

---

### DEC-106 — Subject de Reputation

**Escolha aprovada:** `C`

**Decisão:** Suportar subject types distintos; personagens usam Actor UUID.

**Motivo / consequência arquitetural:** Evita acoplar reputação a User e permite Party/Domain/Actor.

**Status:** `DECIDIDO`

---

### DEC-107 — Escalas custom

**Escolha aprovada:** `A`

**Decisão:** ReputationScale configurável.

**Motivo / consequência arquitetural:** Permite -3..+3, -100..100 ou escalas narrativas.

**Status:** `DECIDIDO`

---

### DEC-108 — Reputation sem Relation

**Escolha aprovada:** `A`

**Decisão:** Permitida.

**Motivo / consequência arquitetural:** Standing pessoal não depende de relação institucional.

**Status:** `DECIDIDO`

---

### DEC-109 — Graph no v1

**Escolha aprovada:** `B`

**Decisão:** V1 administra relations por list/table; graph fica posterior.

**Motivo / consequência arquitetural:** Protege foco, performance e acessibilidade.

**Status:** `DECIDIDO`

---

## Territory

### DEC-110 — Territory opcional

**Escolha aprovada:** `A`

**Decisão:** Territory é capability opcional.

**Motivo / consequência arquitetural:** Organizations abstratas podem não possuir território.

**Status:** `DECIDIDO`

---

### DEC-111 — Múltiplas Regions

**Escolha aprovada:** `A`

**Decisão:** Domain pode referenciar várias Scene Regions.

**Motivo / consequência arquitetural:** Suporta territórios fragmentados e grandes entidades.

**Status:** `DECIDIDO`

---

### DEC-112 — Múltiplos Domains por Region

**Escolha aprovada:** `A`

**Decisão:** Uma Region pode ter vínculos territoriais de vários Domains.

**Motivo / consequência arquitetural:** Controle, claim e operação podem coexistir.

**Status:** `DECIDIDO`

---

### DEC-113 — Tipos de vínculo

**Escolha aprovada:** `A`

**Decisão:** Registry extensível com built-ins.

**Motivo / consequência arquitetural:** Permite owns/controls/claims/etc. sem enum rígido.

**Status:** `DECIDIDO`

---

### DEC-114 — Overlay no v1

**Escolha aprovada:** `B`

**Decisão:** Primeiro estabilizar data model; overlay vem depois.

**Motivo / consequência arquitetural:** Separa integridade dos dados de visualização Canvas.

**Status:** `DECIDIDO`

---

## Requests / Player Interaction

### DEC-115 — Request sem controlar Domain

**Escolha aprovada:** `A`

**Decisão:** Policy pode permitir requests pessoais ou de usuários sem Domain.

**Motivo / consequência arquitetural:** Sistema de Request não fica preso a ownership administrativo.

**Status:** `DECIDIDO`

---

### DEC-116 — Editar Request após envio

**Escolha aprovada:** `A`

**Decisão:** Não editar conteúdo original; pode withdraw/recriar.

**Motivo / consequência arquitetural:** Preserva audit e evita mudança após revisão GM.

**Status:** `DECIDIDO`

---

### DEC-117 — GM editar Request

**Escolha aprovada:** `A`

**Decisão:** GM não altera conteúdo original; decisão/resposta é separada.

**Motivo / consequência arquitetural:** Preserva autoria e intenção enviada.

**Status:** `DECIDIDO`

---

### DEC-118 — Vários resultados

**Escolha aprovada:** `A`

**Decisão:** Request pode gerar `resultRefs[]`.

**Motivo / consequência arquitetural:** Uma aprovação pode produzir Project, Mission, Transaction etc.

**Status:** `DECIDIDO`

---

### DEC-119 — Request→Project

**Escolha aprovada:** `A`

**Decisão:** GM escolhe se/como converter.

**Motivo / consequência arquitetural:** Não transformar toda aprovação em Project automaticamente.

**Status:** `DECIDIDO`

---

### DEC-120 — Request→Mission

**Escolha aprovada:** `A`

**Decisão:** Pode converter via MissionProvider.

**Motivo / consequência arquitetural:** Mantém quest engine externo e workflow integrado.

**Status:** `DECIDIDO`

---

## Knowledge / Secrets

### DEC-121 — Knowledge no v1

**Escolha aprovada:** `A`

**Decisão:** Knowledge/visibility mínimo entra cedo.

**Motivo / consequência arquitetural:** Segurança de player contexts depende disso.

**Status:** `DECIDIDO`

---

### DEC-122 — Unknown/Rumored entities

**Escolha aprovada:** `B`

**Decisão:** Knowledge pode projetar placeholder sem revelar entidade real.

**Motivo / consequência arquitetural:** Permite narrativa de informação parcial sem vazamento.

**Status:** `DECIDIDO`

---

### DEC-123 — GM View As

**Escolha aprovada:** `A`

**Decisão:** GM pode renderizar a mesma sanitized projection de outro viewer.

**Motivo / consequência arquitetural:** Ferramenta essencial para testar secrets e UX.

**Status:** `DECIDIDO`

---

### DEC-124 — Dados GM-only no cliente

**Escolha aprovada:** `B`

**Decisão:** Não enviar; sanitizar antes de sair da authority.

**Motivo / consequência arquitetural:** Template/CSS hiding não é controle de segurança.

**Status:** `DECIDIDO`

---

### DEC-125 — Player abrindo Domain Actor

**Escolha aprovada:** `A`

**Decisão:** Usar sheet/context sanitizado conforme permissions.

**Motivo / consequência arquitetural:** Permite acesso legítimo sem expor raw GM data.

**Status:** `DECIDIDO`

---

## Time / Ticks

### DEC-126 — Tempo sem calendário

**Escolha aprovada:** `A`

**Decisão:** Funcionar sobre Foundry `worldTime` mesmo sem calendar provider.

**Motivo / consequência arquitetural:** Calendário é representação/integration, não dependency obrigatória.

**Status:** `DECIDIDO`

---

### DEC-127 — Commit automático de ticks

**Escolha aprovada:** `C`

**Decisão:** Configuração de mundo; default é preview antes de commit.

**Motivo / consequência arquitetural:** GM mantém controle, mas mundos confiantes podem automatizar.

**Status:** `DECIDIDO`

---

### DEC-128 — Tick manual

**Escolha aprovada:** `A`

**Decisão:** GM pode executar processamento manual.

**Motivo / consequência arquitetural:** Útil para testes, mundos sem avanço de worldTime e correções.

**Status:** `DECIDIDO`

---

### DEC-129 — Rewind

**Escolha aprovada:** `B`

**Decisão:** Não reverter automaticamente; gerar reconciliation warning.

**Motivo / consequência arquitetural:** Desfazer economia/projects por relógio seria perigoso.

**Status:** `DECIDIDO`

---

### DEC-130 — Large time jump

**Escolha aprovada:** `B`

**Decisão:** Calcular todos os períodos, apresentar preview agregado e então commit.

**Motivo / consequência arquitetural:** Evita dezenas de commits opacos e melhora audit.

**Status:** `DECIDIDO`

---

### DEC-131 — Random event audit

**Escolha aprovada:** `A`

**Decisão:** Registrar seed/result suficiente para provenance/replay quando aplicável.

**Motivo / consequência arquitetural:** Eventos aleatórios precisam ser explicáveis.

**Status:** `DECIDIDO`

---

## Events / Conditions

### DEC-132 — Event vs Condition

**Escolha aprovada:** `A`

**Decisão:** Modelos separados.

**Motivo / consequência arquitetural:** Evento é acontecimento/lifecycle; Condition é estado aplicado.

**Status:** `DECIDIDO`

---

### DEC-133 — Event gera Condition

**Escolha aprovada:** `A`

**Decisão:** Via action/plan coordenado.

**Motivo / consequência arquitetural:** Evita EventService mutando subsistemas arbitrariamente.

**Status:** `DECIDIDO`

---

### DEC-134 — Duração de Condition

**Escolha aprovada:** `A`

**Decisão:** Conditions podem ter duração temporal/tick/manual.

**Motivo / consequência arquitetural:** Permite expiração coerente sem forçar um único modelo.

**Status:** `DECIDIDO`

---

### DEC-135 — Modifier system inicial

**Escolha aprovada:** `A`

**Decisão:** Introduzir núcleo mínimo e tipado de modifier/source.

**Motivo / consequência arquitetural:** Necessário para derived values explicáveis, sem criar DSL completa.

**Status:** `DECIDIDO`

---

### DEC-136 — Rule scripting DSL

**Escolha aprovada:** `A`

**Decisão:** Não criar linguagem própria no v1.

**Motivo / consequência arquitetural:** Action registry/provider contracts resolvem extensibilidade com menos dívida.

**Status:** `DECIDIDO`

---

## Authority / Multiplayer

### DEC-137 — Primary GM selection

**Escolha aprovada:** `C`

**Decisão:** GM preferido se disponível; fallback determinístico entre ativos.

**Motivo / consequência arquitetural:** Combina previsibilidade com resiliência.

**Status:** `DECIDIDO`

---

### DEC-138 — Sem GM ativo

**Escolha aprovada:** `B`

**Decisão:** Command privilegiado falha claramente.

**Motivo / consequência arquitetural:** Não permitir player virar authority; durable queue pode ser futuro.

**Status:** `DECIDIDO`

---

### DEC-139 — Retry após timeout

**Escolha aprovada:** `A`

**Decisão:** Reenviar mesmo commandId.

**Motivo / consequência arquitetural:** Dedupe torna retry seguro.

**Status:** `DECIDIDO`

---

### DEC-140 — Dedupe durável

**Escolha aprovada:** `A`

**Decisão:** Operações críticas usam registro persistente além de cache em memória.

**Motivo / consequência arquitetural:** Restart não pode permitir replay financeiro/projetual duplicado.

**Status:** `DECIDIDO`

---

### DEC-141 — Locks

**Escolha aprovada:** `B`

**Decisão:** Usar ordered multi-key locks para todas as entidades tocadas.

**Motivo / consequência arquitetural:** Evita races e deadlocks em operações multi-Document.

**Status:** `DECIDIDO`

---

### DEC-142 — Plan do client

**Escolha aprovada:** `A`

**Decisão:** Client pode sugerir/previewar; authority recalcula com fresh state.

**Motivo / consequência arquitetural:** Nunca confiar em preço/disponibilidade/plan enviado pelo cliente.

**Status:** `DECIDIDO`

---

### DEC-143 — Audit de rejeição

**Escolha aprovada:** `B`

**Decisão:** Operações sensíveis podem registrar rejeições relevantes.

**Motivo / consequência arquitetural:** Ajuda segurança/diagnóstico sem logar todo erro trivial.

**Status:** `DECIDIDO`

---

## API / Extensibilidade

### DEC-144 — API desde T0

**Escolha aprovada:** `A`

**Decisão:** Public API shell versionado nasce cedo.

**Motivo / consequência arquitetural:** Força boundaries estáveis e contract thinking desde o início.

**Status:** `DECIDIDO`

---

### DEC-145 — Raw Actor na API

**Escolha aprovada:** `B`

**Decisão:** Context/DTO é padrão; raw Document só em API explicitamente low-level.

**Motivo / consequência arquitetural:** Reduz acoplamento ao storage e protege visibility.

**Status:** `DECIDIDO`

---

### DEC-146 — UI extension points

**Escolha aprovada:** `A`

**Decisão:** Addons poderão registrar UI extensions depois que contracts estabilizarem.

**Motivo / consequência arquitetural:** Evita congelar extension API antes da UI amadurecer.

**Status:** `DECIDIDO`

---

### DEC-147 — DomainAction registration

**Escolha aprovada:** `A`

**Decisão:** Addons podem registrar actions namespaced.

**Motivo / consequência arquitetural:** Permite automação modular sem scripting arbitrário.

**Status:** `DECIDIDO`

---

### DEC-148 — TickProcessor registration

**Escolha aprovada:** `A`

**Decisão:** Addons podem registrar processors namespaced.

**Motivo / consequência arquitetural:** Tempo/ticks ficam extensíveis sem hardcode.

**Status:** `DECIDIDO`

---

### DEC-149 — Provider incompatível

**Escolha aprovada:** `A`

**Decisão:** Falha apenas feature dependente.

**Motivo / consequência arquitetural:** Core deve continuar saudável sem integrations.

**Status:** `DECIDIDO`

---

## UI / UX

### DEC-150 — Domain Explorer surfaces

**Escolha aprovada:** `C`

**Decisão:** Sidebar quick-nav + Explorer completo em Application dedicada.

**Motivo / consequência arquitetural:** Combina acesso rápido e administração densa sem sobrecarregar uma única UI.

**Status:** `DECIDIDO`

---

### DEC-151 — Domain Sheet

**Escolha aprovada:** `A`

**Decisão:** Usar tabs.

**Motivo / consequência arquitetural:** Progressive disclosure e separação por capability.

**Status:** `DECIDIDO`

---

### DEC-152 — Tabs de capabilities desativadas

**Escolha aprovada:** `A`

**Decisão:** Ocultar no uso diário.

**Motivo / consequência arquitetural:** Reduz poluição; configuração avançada continua acessível.

**Status:** `DECIDIDO`

---

### DEC-153 — Overview

**Escolha aprovada:** `A`

**Decisão:** Mostrar resumo e informações acionáveis, não todos os campos.

**Motivo / consequência arquitetural:** Evita ERP visual e segue Summary→Explanation→Detail→Action.

**Status:** `DECIDIDO`

---

### DEC-154 — Advanced configuration

**Escolha aprovada:** `B`

**Decisão:** Application separada.

**Motivo / consequência arquitetural:** Mantém a Sheet operacional limpa.

**Status:** `DECIDIDO`

---

### DEC-155 — Domain Operations

**Escolha aprovada:** `A`

**Decisão:** Fila global GM.

**Motivo / consequência arquitetural:** Centraliza requests, recovery, alerts e approvals entre Domains.

**Status:** `DECIDIDO`

---

### DEC-156 — Player Domain View

**Escolha aprovada:** `A`

**Decisão:** Application própria.

**Motivo / consequência arquitetural:** Segurança e UX melhores do que reutilizar Sheet GM com elementos ocultos.

**Status:** `DECIDIDO`

---

### DEC-157 — Administração de relations

**Escolha aprovada:** `A`

**Decisão:** List/table primeiro.

**Motivo / consequência arquitetural:** É a UI canônica; graph é visualização posterior.

**Status:** `DECIDIDO`

---

### DEC-158 — Folders

**Escolha aprovada:** `A`

**Decisão:** Preferir Foundry Folders quando possível.

**Motivo / consequência arquitetural:** Evita reinventar organização visual.

**Status:** `DECIDIDO`

---

### DEC-159 — UI state

**Escolha aprovada:** `A`

**Decisão:** Preferências pessoais ficam client-specific por padrão.

**Motivo / consequência arquitetural:** Tamanho/painel selecionado não precisa gerar world writes.

**Status:** `DECIDIDO`

---

### DEC-160 — Animações

**Escolha aprovada:** `A`

**Decisão:** Animações apenas quando comunicam estado/interação.

**Motivo / consequência arquitetural:** Mantém visual imersivo sem custo constante ou ruído.

**Status:** `DECIDIDO`

---

## Import / Export / Backup

### DEC-161 — Export individual

**Escolha aprovada:** `A`

**Decisão:** Permitir export de Domain individual.

**Motivo / consequência arquitetural:** Útil para templates, suporte e transferência.

**Status:** `DECIDIDO`

---

### DEC-162 — Export subtree

**Escolha aprovada:** `A`

**Decisão:** Suportar futuramente Domain + descendentes.

**Motivo / consequência arquitetural:** Permite mover organizações completas entre mundos.

**Status:** `DECIDIDO`

---

### DEC-163 — Template export

**Escolha aprovada:** `A`

**Decisão:** Remover state/history não-portável; preservar definition/template.

**Motivo / consequência arquitetural:** Template deve representar configuração reutilizável, não snapshot operacional completo.

**Status:** `DECIDIDO`

---

### DEC-164 — Backup antes de migration

**Escolha aprovada:** `A`

**Decisão:** Gerar backup automático antes de migration destrutiva.

**Motivo / consequência arquitetural:** Reduz risco de perda irreversível.

**Status:** `DECIDIDO`

---

### DEC-165 — Import collision

**Escolha aprovada:** `A`

**Decisão:** Remapear IDs/refs em vez de overwrite por nome.

**Motivo / consequência arquitetural:** Nome não é identidade.

**Status:** `DECIDIDO`

---

### DEC-166 — Mesmo nome ≠ mesma entidade

**Escolha aprovada:** `A`

**Decisão:** Nunca deduplicar por nome.

**Motivo / consequência arquitetural:** UUID/ID é identidade; nomes podem repetir.

**Status:** `DECIDIDO`

---

## Migrations

### DEC-167 — Migration infrastructure

**Escolha aprovada:** `A`

**Decisão:** Existe desde schema v1.

**Motivo / consequência arquitetural:** Evita adicionar migrations tardiamente de forma improvisada.

**Status:** `DECIDIDO`

---

### DEC-168 — Migration falhou

**Escolha aprovada:** `A`

**Decisão:** Entrar em safe/read-only para dados afetados + Diagnostics.

**Motivo / consequência arquitetural:** Não continuar writes em schema parcialmente migrado.

**Status:** `DECIDIDO`

---

### DEC-169 — Future schema

**Escolha aprovada:** `A`

**Decisão:** Bloquear unsafe writes.

**Motivo / consequência arquitetural:** Nunca down-convert silenciosamente dados de versão mais nova.

**Status:** `DECIDIDO`

---

### DEC-170 — Migration destrutiva

**Escolha aprovada:** `A`

**Decisão:** Exige backup.

**Motivo / consequência arquitetural:** Operações irreversíveis precisam proteção.

**Status:** `DECIDIDO`

---

### DEC-171 — Structural migration

**Escolha aprovada:** `A`

**Decisão:** Pode criar Documents e remapear refs.

**Motivo / consequência arquitetural:** Necessário para evoluções reais como embedded→standalone.

**Status:** `DECIDIDO`

---

## Tests / Quality

### DEC-172 — Início dos testes

**Escolha aprovada:** `A`

**Decisão:** Desde o primeiro commit.

**Motivo / consequência arquitetural:** Fundação, migrations e authority são muito caros de retrofitar sem testes.

**Status:** `DECIDIDO`

---

### DEC-173 — Coverage rígido inicial

**Escolha aprovada:** `B`

**Decisão:** Sem percentual arbitrário; usar behavior gates críticos.

**Motivo / consequência arquitetural:** Coverage numérico pode incentivar teste superficial.

**Status:** `DECIDIDO`

---

### DEC-174 — Migration fixtures

**Escolha aprovada:** `A`

**Decisão:** Obrigatórias para versões antigas relevantes.

**Motivo / consequência arquitetural:** Migration precisa ser comprovadamente reproduzível.

**Status:** `DECIDIDO`

---

### DEC-175 — Dois GMs

**Escolha aprovada:** `A`

**Decisão:** Authority só é considerada pronta após cenário multi-GM testado.

**Motivo / consequência arquitetural:** Evita broadcast races escondidas.

**Status:** `DECIDIDO`

---

### DEC-176 — Secret leakage tests

**Escolha aprovada:** `A`

**Decisão:** Testes automatizados obrigatórios.

**Motivo / consequência arquitetural:** Segurança não depende de inspeção visual.

**Status:** `DECIDIDO`

---

### DEC-177 — Large fixtures

**Escolha aprovada:** `A`

**Decisão:** Benchmarks grandes antes de stable.

**Motivo / consequência arquitetural:** Escala é requisito do produto, não otimização opcional.

**Status:** `DECIDIDO`

---

### DEC-178 — CSS isolation

**Escolha aprovada:** `A`

**Decisão:** Testar namespace/vazamentos básicos.

**Motivo / consequência arquitetural:** Foundry possui muitos módulos compartilhando DOM/CSS global.

**Status:** `DECIDIDO`

---

## Release / Versionamento

### DEC-179 — Builds de desenvolvimento

**Escolha aprovada:** `B`

**Decisão:** Usar `0.1.0-dev.x` até gates fechados.

**Motivo / consequência arquitetural:** Distingue desenvolvimento instável de release.

**Status:** `DECIDIDO`

---

### DEC-180 — SemVer pós-1.0

**Escolha aprovada:** `A`

**Decisão:** Usar SemVer real.

**Motivo / consequência arquitetural:** Consumidores de API/contracts precisam interpretar compatibilidade.

**Status:** `DECIDIDO`

---

### DEC-181 — Breaking changes em 0.x

**Escolha aprovada:** `A`

**Decisão:** Permitidas com changelog/documentação.

**Motivo / consequência arquitetural:** Não congelar design prematuramente durante desenvolvimento.

**Status:** `DECIDIDO`

---

### DEC-182 — Critério de 1.0

**Escolha aprovada:** `A`

**Decisão:** 1.0 é definido por estabilidade de core, authority, migrations, segurança, API e recovery.

**Motivo / consequência arquitetural:** Quantidade de features não substitui confiabilidade arquitetural.

**Status:** `DECIDIDO`

---

# 4. Registro compacto para referência

```json
[
  {
    "id": 1,
    "choice": "A",
    "title": "Foundry alvo inicial"
  },
  {
    "id": 2,
    "choice": "A",
    "title": "Linguagem"
  },
  {
    "id": 3,
    "choice": "B",
    "title": "Build/tooling"
  },
  {
    "id": 4,
    "choice": "A",
    "title": "Significado de scale"
  },
  {
    "id": 5,
    "choice": "A",
    "title": "Modelo de kind"
  },
  {
    "id": 6,
    "choice": "C",
    "title": "Modelo de capabilities"
  },
  {
    "id": 7,
    "choice": "AJUSTADO",
    "title": "Nome oficial do Domain"
  },
  {
    "id": 8,
    "choice": "B",
    "title": "Domain sem subsystem funcional"
  },
  {
    "id": 9,
    "choice": "A",
    "title": "Número de parents administrativos"
  },
  {
    "id": 10,
    "choice": "C",
    "title": "Fluxo de criação"
  },
  {
    "id": 11,
    "choice": "C",
    "title": "Descrição do Domain"
  },
  {
    "id": 12,
    "choice": "A",
    "title": "Aliases"
  },
  {
    "id": 13,
    "choice": "A",
    "title": "Imagem"
  },
  {
    "id": 14,
    "choice": "A",
    "title": "Lifecycle administrativo"
  },
  {
    "id": 15,
    "choice": "A",
    "title": "Semântica de archive"
  },
  {
    "id": 16,
    "choice": "C",
    "title": "Tags"
  },
  {
    "id": 17,
    "choice": "B",
    "title": "Metadata própria"
  },
  {
    "id": 18,
    "choice": "A",
    "title": "createdByUserId"
  },
  {
    "id": 19,
    "choice": "C",
    "title": "Último editor"
  },
  {
    "id": 20,
    "choice": "A",
    "title": "Revision inicial"
  },
  {
    "id": 21,
    "choice": "A",
    "title": "State no schema v1"
  },
  {
    "id": 22,
    "choice": "A",
    "title": "Definition no schema v1"
  },
  {
    "id": 23,
    "choice": "A",
    "title": "Root Domains"
  },
  {
    "id": 24,
    "choice": "B",
    "title": "Mudança de kind"
  },
  {
    "id": 25,
    "choice": "A",
    "title": "Mudança de scale"
  },
  {
    "id": 26,
    "choice": "B",
    "title": "Capabilities iniciais na criação rápida"
  },
  {
    "id": 27,
    "choice": "A",
    "title": "Desabilitar capability"
  },
  {
    "id": 28,
    "choice": "A",
    "title": "Purge de subsystem"
  },
  {
    "id": 29,
    "choice": "A",
    "title": "Storage de capabilities-base"
  },
  {
    "id": 30,
    "choice": "C",
    "title": "Effective Capability Grants"
  },
  {
    "id": 31,
    "choice": "A",
    "title": "Registro por addons"
  },
  {
    "id": 32,
    "choice": "A",
    "title": "Capability de addon removido"
  },
  {
    "id": 33,
    "choice": "A",
    "title": "Configuração por capability"
  },
  {
    "id": 34,
    "choice": "A",
    "title": "Escala de children"
  },
  {
    "id": 35,
    "choice": "A",
    "title": "Persistência de children"
  },
  {
    "id": 36,
    "choice": "A",
    "title": "Persistência de ancestors"
  },
  {
    "id": 37,
    "choice": "B",
    "title": "Reparent"
  },
  {
    "id": 38,
    "choice": "A",
    "title": "Mover subtree"
  },
  {
    "id": 39,
    "choice": "A",
    "title": "Profundidade máxima"
  },
  {
    "id": 40,
    "choice": "A",
    "title": "Foundry Folder vs parent"
  },
  {
    "id": 41,
    "choice": "A",
    "title": "Excluir parent com filhos"
  },
  {
    "id": 42,
    "choice": "C",
    "title": "Arquivar parent"
  },
  {
    "id": 43,
    "choice": "A",
    "title": "População manual"
  },
  {
    "id": 44,
    "choice": "A",
    "title": "Modos de população"
  },
  {
    "id": 45,
    "choice": "B",
    "title": "PopulationGroup zero"
  },
  {
    "id": 46,
    "choice": "A",
    "title": "Tags em PopulationGroup"
  },
  {
    "id": 47,
    "choice": "A",
    "title": "Identidade de PopulationGroup"
  },
  {
    "id": 48,
    "choice": "B",
    "title": "Notable sem Actor"
  },
  {
    "id": 49,
    "choice": "B",
    "title": "Actor de Notable apagado"
  },
  {
    "id": 50,
    "choice": "B",
    "title": "Portrait override de Notable"
  },
  {
    "id": 51,
    "choice": "A",
    "title": "Role vazio"
  },
  {
    "id": 52,
    "choice": "A",
    "title": "Actor em múltiplos Roles"
  },
  {
    "id": 53,
    "choice": "A",
    "title": "Vários ocupantes no mesmo Role"
  },
  {
    "id": 54,
    "choice": "A",
    "title": "Role concede capability"
  },
  {
    "id": 55,
    "choice": "A",
    "title": "PopulationGroup vs OperationalGroup"
  },
  {
    "id": 56,
    "choice": "A",
    "title": "OperationalGroup ligado a Actors"
  },
  {
    "id": 57,
    "choice": "A",
    "title": "Workforce disponível"
  },
  {
    "id": 58,
    "choice": "B",
    "title": "Ordem de implementação"
  },
  {
    "id": 59,
    "choice": "C",
    "title": "Storage físico"
  },
  {
    "id": 60,
    "choice": "A",
    "title": "Definition vs Instance"
  },
  {
    "id": 61,
    "choice": "A",
    "title": "Onde vivem Definitions"
  },
  {
    "id": 62,
    "choice": "A",
    "title": "Facility sem layout visual"
  },
  {
    "id": 63,
    "choice": "A",
    "title": "Lifecycle de Facility"
  },
  {
    "id": 64,
    "choice": "A",
    "title": "Efeitos sob dano"
  },
  {
    "id": 65,
    "choice": "A",
    "title": "CapabilityGrant por Facility"
  },
  {
    "id": 66,
    "choice": "A",
    "title": "Upkeep"
  },
  {
    "id": 67,
    "choice": "B",
    "title": "Produção automática no v1"
  },
  {
    "id": 68,
    "choice": "B",
    "title": "Resources em todos Domains"
  },
  {
    "id": 69,
    "choice": "A",
    "title": "ResourceDefinition"
  },
  {
    "id": 70,
    "choice": "A",
    "title": "Resource custom do GM"
  },
  {
    "id": 71,
    "choice": "A",
    "title": "Identidade do Resource"
  },
  {
    "id": 72,
    "choice": "B",
    "title": "Moeda"
  },
  {
    "id": 73,
    "choice": "A",
    "title": "Saldo negativo"
  },
  {
    "id": 74,
    "choice": "A",
    "title": "Capacity"
  },
  {
    "id": 75,
    "choice": "A",
    "title": "Overflow policy"
  },
  {
    "id": 76,
    "choice": "A",
    "title": "Reservations no primeiro release"
  },
  {
    "id": 77,
    "choice": "A",
    "title": "Ledger obrigatório"
  },
  {
    "id": 78,
    "choice": "B",
    "title": "Ajuste manual de GM"
  },
  {
    "id": 79,
    "choice": "B",
    "title": "Editar LedgerEntry"
  },
  {
    "id": 80,
    "choice": "A",
    "title": "Apagar LedgerEntry"
  },
  {
    "id": 81,
    "choice": "A",
    "title": "Transferência entre Domains"
  },
  {
    "id": 82,
    "choice": "A",
    "title": "Provider externo indisponível"
  },
  {
    "id": 83,
    "choice": "A",
    "title": "Capability opcional"
  },
  {
    "id": 84,
    "choice": "A",
    "title": "ProjectDefinition reutilizável"
  },
  {
    "id": 85,
    "choice": "A",
    "title": "Project custom"
  },
  {
    "id": 86,
    "choice": "A",
    "title": "Unidade de progresso"
  },
  {
    "id": 87,
    "choice": "A",
    "title": "Percentual"
  },
  {
    "id": 88,
    "choice": "A",
    "title": "Regressão de progresso"
  },
  {
    "id": 89,
    "choice": "C",
    "title": "Completion automática"
  },
  {
    "id": 90,
    "choice": "A",
    "title": "Overprogress"
  },
  {
    "id": 91,
    "choice": "A",
    "title": "Multi-domain ownership"
  },
  {
    "id": 92,
    "choice": "B",
    "title": "Dependencies"
  },
  {
    "id": 93,
    "choice": "A",
    "title": "Reserva de custos"
  },
  {
    "id": 94,
    "choice": "A",
    "title": "Consumo progressivo"
  },
  {
    "id": 95,
    "choice": "A",
    "title": "Contributor obrigatório"
  },
  {
    "id": 96,
    "choice": "A",
    "title": "Completion cria Facility"
  },
  {
    "id": 97,
    "choice": "A",
    "title": "Roll obrigatório"
  },
  {
    "id": 98,
    "choice": "A",
    "title": "Relations opcionais"
  },
  {
    "id": 99,
    "choice": "A",
    "title": "Target non-Domain"
  },
  {
    "id": 100,
    "choice": "A",
    "title": "Múltiplas relations por par"
  },
  {
    "id": 101,
    "choice": "A",
    "title": "Duplicata do mesmo relation type"
  },
  {
    "id": 102,
    "choice": "A",
    "title": "Strength universal"
  },
  {
    "id": 103,
    "choice": "A",
    "title": "Relação secreta"
  },
  {
    "id": 104,
    "choice": "A",
    "title": "Encerrar relation"
  },
  {
    "id": 105,
    "choice": "A",
    "title": "Reputation no v1"
  },
  {
    "id": 106,
    "choice": "C",
    "title": "Subject de Reputation"
  },
  {
    "id": 107,
    "choice": "A",
    "title": "Escalas custom"
  },
  {
    "id": 108,
    "choice": "A",
    "title": "Reputation sem Relation"
  },
  {
    "id": 109,
    "choice": "B",
    "title": "Graph no v1"
  },
  {
    "id": 110,
    "choice": "A",
    "title": "Territory opcional"
  },
  {
    "id": 111,
    "choice": "A",
    "title": "Múltiplas Regions"
  },
  {
    "id": 112,
    "choice": "A",
    "title": "Múltiplos Domains por Region"
  },
  {
    "id": 113,
    "choice": "A",
    "title": "Tipos de vínculo"
  },
  {
    "id": 114,
    "choice": "B",
    "title": "Overlay no v1"
  },
  {
    "id": 115,
    "choice": "A",
    "title": "Request sem controlar Domain"
  },
  {
    "id": 116,
    "choice": "A",
    "title": "Editar Request após envio"
  },
  {
    "id": 117,
    "choice": "A",
    "title": "GM editar Request"
  },
  {
    "id": 118,
    "choice": "A",
    "title": "Vários resultados"
  },
  {
    "id": 119,
    "choice": "A",
    "title": "Request→Project"
  },
  {
    "id": 120,
    "choice": "A",
    "title": "Request→Mission"
  },
  {
    "id": 121,
    "choice": "A",
    "title": "Knowledge no v1"
  },
  {
    "id": 122,
    "choice": "B",
    "title": "Unknown/Rumored entities"
  },
  {
    "id": 123,
    "choice": "A",
    "title": "GM View As"
  },
  {
    "id": 124,
    "choice": "B",
    "title": "Dados GM-only no cliente"
  },
  {
    "id": 125,
    "choice": "A",
    "title": "Player abrindo Domain Actor"
  },
  {
    "id": 126,
    "choice": "A",
    "title": "Tempo sem calendário"
  },
  {
    "id": 127,
    "choice": "C",
    "title": "Commit automático de ticks"
  },
  {
    "id": 128,
    "choice": "A",
    "title": "Tick manual"
  },
  {
    "id": 129,
    "choice": "B",
    "title": "Rewind"
  },
  {
    "id": 130,
    "choice": "B",
    "title": "Large time jump"
  },
  {
    "id": 131,
    "choice": "A",
    "title": "Random event audit"
  },
  {
    "id": 132,
    "choice": "A",
    "title": "Event vs Condition"
  },
  {
    "id": 133,
    "choice": "A",
    "title": "Event gera Condition"
  },
  {
    "id": 134,
    "choice": "A",
    "title": "Duração de Condition"
  },
  {
    "id": 135,
    "choice": "A",
    "title": "Modifier system inicial"
  },
  {
    "id": 136,
    "choice": "A",
    "title": "Rule scripting DSL"
  },
  {
    "id": 137,
    "choice": "C",
    "title": "Primary GM selection"
  },
  {
    "id": 138,
    "choice": "B",
    "title": "Sem GM ativo"
  },
  {
    "id": 139,
    "choice": "A",
    "title": "Retry após timeout"
  },
  {
    "id": 140,
    "choice": "A",
    "title": "Dedupe durável"
  },
  {
    "id": 141,
    "choice": "B",
    "title": "Locks"
  },
  {
    "id": 142,
    "choice": "A",
    "title": "Plan do client"
  },
  {
    "id": 143,
    "choice": "B",
    "title": "Audit de rejeição"
  },
  {
    "id": 144,
    "choice": "A",
    "title": "API desde T0"
  },
  {
    "id": 145,
    "choice": "B",
    "title": "Raw Actor na API"
  },
  {
    "id": 146,
    "choice": "A",
    "title": "UI extension points"
  },
  {
    "id": 147,
    "choice": "A",
    "title": "DomainAction registration"
  },
  {
    "id": 148,
    "choice": "A",
    "title": "TickProcessor registration"
  },
  {
    "id": 149,
    "choice": "A",
    "title": "Provider incompatível"
  },
  {
    "id": 150,
    "choice": "C",
    "title": "Domain Explorer surfaces"
  },
  {
    "id": 151,
    "choice": "A",
    "title": "Domain Sheet"
  },
  {
    "id": 152,
    "choice": "A",
    "title": "Tabs de capabilities desativadas"
  },
  {
    "id": 153,
    "choice": "A",
    "title": "Overview"
  },
  {
    "id": 154,
    "choice": "B",
    "title": "Advanced configuration"
  },
  {
    "id": 155,
    "choice": "A",
    "title": "Domain Operations"
  },
  {
    "id": 156,
    "choice": "A",
    "title": "Player Domain View"
  },
  {
    "id": 157,
    "choice": "A",
    "title": "Administração de relations"
  },
  {
    "id": 158,
    "choice": "A",
    "title": "Folders"
  },
  {
    "id": 159,
    "choice": "A",
    "title": "UI state"
  },
  {
    "id": 160,
    "choice": "A",
    "title": "Animações"
  },
  {
    "id": 161,
    "choice": "A",
    "title": "Export individual"
  },
  {
    "id": 162,
    "choice": "A",
    "title": "Export subtree"
  },
  {
    "id": 163,
    "choice": "A",
    "title": "Template export"
  },
  {
    "id": 164,
    "choice": "A",
    "title": "Backup antes de migration"
  },
  {
    "id": 165,
    "choice": "A",
    "title": "Import collision"
  },
  {
    "id": 166,
    "choice": "A",
    "title": "Mesmo nome ≠ mesma entidade"
  },
  {
    "id": 167,
    "choice": "A",
    "title": "Migration infrastructure"
  },
  {
    "id": 168,
    "choice": "A",
    "title": "Migration falhou"
  },
  {
    "id": 169,
    "choice": "A",
    "title": "Future schema"
  },
  {
    "id": 170,
    "choice": "A",
    "title": "Migration destrutiva"
  },
  {
    "id": 171,
    "choice": "A",
    "title": "Structural migration"
  },
  {
    "id": 172,
    "choice": "A",
    "title": "Início dos testes"
  },
  {
    "id": 173,
    "choice": "B",
    "title": "Coverage rígido inicial"
  },
  {
    "id": 174,
    "choice": "A",
    "title": "Migration fixtures"
  },
  {
    "id": 175,
    "choice": "A",
    "title": "Dois GMs"
  },
  {
    "id": 176,
    "choice": "A",
    "title": "Secret leakage tests"
  },
  {
    "id": 177,
    "choice": "A",
    "title": "Large fixtures"
  },
  {
    "id": 178,
    "choice": "A",
    "title": "CSS isolation"
  },
  {
    "id": 179,
    "choice": "B",
    "title": "Builds de desenvolvimento"
  },
  {
    "id": 180,
    "choice": "A",
    "title": "SemVer pós-1.0"
  },
  {
    "id": 181,
    "choice": "A",
    "title": "Breaking changes em 0.x"
  },
  {
    "id": 182,
    "choice": "A",
    "title": "Critério de 1.0"
  }
]
```

---

# 5. Regras que emergem desta rodada

1. Nome principal é `Actor.name`; nomes nunca são identidade técnica.
2. Domain precisa de ao menos uma capability funcional.
3. Scale classifica; capability habilita comportamento.
4. Hierarchy administrativa tem um único parent persistente.
5. Folders são organização visual, não estrutura administrativa.
6. Archive preserva identidade e referências.
7. Desabilitar capability não apaga dados; purge é separado.
8. Effective capabilities são derivadas de fontes explicáveis.
9. PopulationGroup não é OperationalGroup.
10. Role não é permission.
11. Facility não é Resource.
12. Economy não é Inventory.
13. Toda mutação de saldo possui LedgerEntry.
14. Ledger histórico é corrigido por reversal/adjustment, não edição destrutiva.
15. Transfer multi-Domain é uma transaction coordenada.
16. Project progress usa work units + ProjectEntry.
17. Project completion é lifecycle, não checkbox cru.
18. Relation não é Reputation.
19. Graph não é storage de Relation.
20. Territory referencia Regions e aceita múltiplos vínculos.
21. Request enviado é preservado; decisão é separada.
22. Segredo é removido do DTO antes de chegar ao player.
23. Time funciona sem calendário externo.
24. Tick grande é planejado/agregado antes de commit.
25. Rewind de tempo não desfaz administração automaticamente.
26. Client nunca é authority de operação privilegiada.
27. Authority recalcula plan usando fresh state.
28. Operações críticas usam idempotência durável.
29. Locks multi-entidade são ordenados.
30. API externa prefere DTO/context em vez de raw Document.
31. Provider incompatível degrada feature, não o core.
32. Player View é Application própria.
33. Migration e security são testadas desde o início.
34. 1.0 representa estabilidade estrutural.

---

# 6. Próximo passo

A próxima rodada pode entrar na **Especificação exata do Schema V1 e Contracts**, usando estas decisões como constraints obrigatórias. Depois dessa próxima rodada grande, deve ser gerado outro `.md` de snapshot antes de continuar.
````

---

# ANEXO 02 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_02_SCHEMA_V1_183-338.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 02
## DomainDataModel V1 / Schema T0 — Decisões 183–338

> **Status:** APROVADO.
>
> O usuário aprovou em bloco todas as recomendações apresentadas nas perguntas 183–338.
>
> Este arquivo é um snapshot de preservação. Nenhuma decisão aqui deve ser alterada silenciosamente em rodadas posteriores.

---

# 0. Resumo executivo

Total de decisões desta rodada: **156**.

A rodada congela o envelope mínimo do `DomainDataModel` para T0, incluindo:

- `system.schemaVersion = 1`;
- `system.revision = 0` na criação;
- separação `definition / state / metadata`;
- `Actor.name` fora do `system` como nome oficial;
- identidade com aliases, summary e rich description;
- classification com kind/scale/tags;
- `parentDomainUuid` como única verdade persistente da hierarquia;
- capabilities-base com `enabled` + config validada por registry;
- lifecycle `active | inactive | archived`;
- metadata administrativa mínima com source provenance;
- nenhuma `customData` genérica;
- IDs normalizados, warnings para registros desconhecidos e errors para invariantes quebradas;
- derived values não persistidos;
- rich text sanitizado pelo Foundry;
- templates/imports com provenance consistente;
- UUID completo para referências Foundry;
- delete físico protegido por impact preview e reference checks;
- índices/caches reconstruíveis;
- API pública baseada em DTO/context;
- People/Economy/Projects/Relations/etc. ficam fora do envelope T0 até seus contracts específicos.

---

# 1. Shape T0 aprovado

```ts
interface DomainSystemData {
  schemaVersion: 1;
  revision: number;

  definition: {
    identity: {
      aliases: string[];
      summary: string;
      description: string;
    };

    classification: {
      kind: string;
      scale: string;
      tags: string[];
    };

    hierarchy: {
      parentDomainUuid: string | null;
    };

    capabilities: {
      enabled: string[];
      config: Record<string, unknown>;
    };
  };

  state: {
    lifecycle: "active" | "inactive" | "archived";
    conditions: unknown[];
  };

  metadata: {
    createdByUserId: string | null;
    archivedAt: number | null;

    source: {
      type: "manual" | "template" | "import" | "migration";
      ref: string | null;
    };
  };
}
```

> `state.conditions` existe como ponto reservado, mas o contract concreto de Condition ainda NÃO é congelado nesta rodada.

---

# 2. Regras fundamentais derivadas desta rodada

1. O envelope T0 do Domain deve permanecer pequeno.
2. `Actor.name` continua sendo a única autoridade do nome principal.
3. `Actor.img` é apresentação e não incrementa revision.
4. Mudanças administrativas relevantes incrementam revision; estado de UI não.
5. Aliases são apresentados como digitados, mas comparados de forma normalizada.
6. Kind/scale/tags desconhecidos são preservados e geram warning, não perda.
7. Root é representado explicitamente por `parentDomainUuid = null`.
8. Children e ancestors não são persistidos.
9. Effective capabilities não são source of truth persistida.
10. Capabilities desconhecidas e suas configs são preservadas.
11. O Domain nunca pode ficar com zero capabilities funcionais.
12. `core` não conta como capability funcional.
13. Lifecycle é enum central fechado; narrativa fica em Conditions/Events.
14. Archive não cria boolean duplicado e não faz cascade automático.
15. Metadata não duplica ownership ou timestamps nativos sem necessidade.
16. Não existe `system.customData` genérico.
17. Extensões persistem via flags ou capability contracts.
18. Validation error bloqueia save inteiro; warning não.
19. Broken refs são preservadas para repair.
20. Nunca inferir identidade por nome.
21. Índices e caches são reconstruíveis.
22. Player index e contexts são sanitizados.
23. Schema de subsistemas entra somente após contracts próprios.

---

# 3. Decisões detalhadas

## Envelope principal

### DEC-183 — Local do schemaVersion

**Escolha aprovada:** `A`

**Decisão:** Usar `system.schemaVersion`.

**Racional:** É o ponto mais simples e direto para migrations.

**Status:** `DECIDIDO`

---

### DEC-184 — Valor inicial de schemaVersion

**Escolha aprovada:** `A`

**Decisão:** O primeiro schema real é `1`.

**Racional:** Evita uma versão 0 especial sem necessidade.

**Status:** `DECIDIDO`

---

### DEC-185 — Local da revision

**Escolha aprovada:** `A`

**Decisão:** Usar `system.revision`.

**Racional:** Revision é operacional e central.

**Status:** `DECIDIDO`

---

### DEC-186 — Valor inicial de revision

**Escolha aprovada:** `A`

**Decisão:** Começa em `0`.

**Racional:** Estado recém-criado ainda não sofreu mutação posterior.

**Status:** `DECIDIDO`

---

### DEC-187 — Criação conta como revision

**Escolha aprovada:** `B`

**Decisão:** Criação não incrementa para 1.

**Racional:** `revision=0` representa o snapshot inicial.

**Status:** `DECIDIDO`

---

### DEC-188 — Quais updates incrementam revision

**Escolha aprovada:** `B`

**Decisão:** Somente updates relevantes ao Domain Manager.

**Racional:** Mudanças de UI/apresentação não invalidam operações lógicas.

**Status:** `DECIDIDO`

---

### DEC-189 — Alterar Actor.name incrementa revision

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Nome é identidade administrativa.

**Status:** `DECIDIDO`

---

### DEC-190 — Alterar Actor.img incrementa revision

**Escolha aprovada:** `B`

**Decisão:** Não.

**Racional:** Imagem é apresentação, não estado lógico.

**Status:** `DECIDIDO`

---

## Estrutura do system

### DEC-191 — Shape principal

**Escolha aprovada:** `A`

**Decisão:** Usar `schemaVersion`, `revision`, `definition`, `state`, `metadata`.

**Racional:** Preserva Definition/State e separa metadata administrativa.

**Status:** `DECIDIDO`

---

### DEC-192 — Conteúdo de definition

**Escolha aprovada:** `A`

**Decisão:** Definition contém apenas dados duráveis/configuracionais.

**Racional:** Responde 'o que a entidade é'.

**Status:** `DECIDIDO`

---

### DEC-193 — Conteúdo de state

**Escolha aprovada:** `A`

**Decisão:** State contém estado operacional atual.

**Racional:** Evita misturar configuração permanente com situação corrente.

**Status:** `DECIDIDO`

---

### DEC-194 — Metadata vs ownership

**Escolha aprovada:** `A`

**Decisão:** Metadata não duplica ownership nativo do Foundry.

**Racional:** Foundry continua source of truth de ownership.

**Status:** `DECIDIDO`

---

## Identidade administrativa

### DEC-195 — definition.identity

**Escolha aprovada:** `A`

**Decisão:** Manter `definition.identity` para aliases/summary/description.

**Racional:** Coesão sem duplicar `Actor.name`.

**Status:** `DECIDIDO`

---

### DEC-196 — Campos iniciais de identity

**Escolha aprovada:** `A`

**Decisão:** `aliases`, `summary`, `description`.

**Racional:** É suficiente para T0.

**Status:** `DECIDIDO`

---

### DEC-197 — summary obrigatório

**Escolha aprovada:** `B`

**Decisão:** Summary pode ficar vazio.

**Racional:** Domain simples não precisa de texto obrigatório.

**Status:** `DECIDIDO`

---

### DEC-198 — Tipo de summary

**Escolha aprovada:** `A`

**Decisão:** Plain text.

**Racional:** Serve listas, tooltips e Explorer.

**Status:** `DECIDIDO`

---

### DEC-199 — Limite de summary

**Escolha aprovada:** `B`

**Decisão:** Máximo 500 caracteres.

**Racional:** Bom equilíbrio entre resumo e excesso.

**Status:** `DECIDIDO`

---

### DEC-200 — Excesso no summary

**Escolha aprovada:** `B`

**Decisão:** Validar/rejeitar; nunca truncar silenciosamente.

**Racional:** Evita perda de texto.

**Status:** `DECIDIDO`

---

### DEC-201 — Tipo de description

**Escolha aprovada:** `A`

**Decisão:** Rich text compatível com Foundry.

**Racional:** Permite conteúdo enriquecido na ficha.

**Status:** `DECIDIDO`

---

### DEC-202 — description vazia

**Escolha aprovada:** `A`

**Decisão:** Permitida.

**Racional:** Não forçar lore.

**Status:** `DECIDIDO`

---

### DEC-203 — Limite de description

**Escolha aprovada:** `B`

**Decisão:** Sem limite artificial do Domain Manager.

**Racional:** Lore grande pode migrar para Journal por UX, não por schema.

**Status:** `DECIDIDO`

---

## Aliases

### DEC-204 — Deduplicação case-insensitive

**Escolha aprovada:** `A`

**Decisão:** Aliases são comparados sem considerar case.

**Racional:** Evita Atlas/atlas duplicados.

**Status:** `DECIDIDO`

---

### DEC-205 — Capitalização de exibição

**Escolha aprovada:** `A`

**Decisão:** Preservar forma digitada.

**Racional:** Comparação pode ser normalizada sem destruir apresentação.

**Status:** `DECIDIDO`

---

### DEC-206 — Trim automático

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Remove espaços acidentais.

**Status:** `DECIDIDO`

---

### DEC-207 — Alias vazio

**Escolha aprovada:** `A`

**Decisão:** Remover automaticamente.

**Racional:** Campo vazio de UI não deve gerar erro relevante.

**Status:** `DECIDIDO`

---

### DEC-208 — Máximo de aliases

**Escolha aprovada:** `B`

**Decisão:** 20 aliases.

**Racional:** Evita abuso e já cobre casos reais.

**Status:** `DECIDIDO`

---

### DEC-209 — Alias igual ao Actor.name

**Escolha aprovada:** `B`

**Decisão:** Rejeitar/remover duplicata semântica.

**Racional:** Nome principal não precisa repetir em aliases.

**Status:** `DECIDIDO`

---

## Classification

### DEC-210 — Shape inicial

**Escolha aprovada:** `A`

**Decisão:** `kind`, `scale`, `tags`.

**Racional:** Suficiente para v1.

**Status:** `DECIDIDO`

---

### DEC-211 — Kind vazio

**Escolha aprovada:** `B`

**Decisão:** Não permitido.

**Racional:** Domain precisa de classificação mínima.

**Status:** `DECIDIDO`

---

### DEC-212 — Kind default

**Escolha aprovada:** `A`

**Decisão:** `generic`.

**Racional:** Fallback neutro.

**Status:** `DECIDIDO`

---

### DEC-213 — ID técnico vs label

**Escolha aprovada:** `A`

**Decisão:** ID técnico separado de label traduzida.

**Racional:** Permite i18n e estabilidade.

**Status:** `DECIDIDO`

---

### DEC-214 — IDs built-in de kind

**Escolha aprovada:** `A`

**Decisão:** Slug simples para core built-in.

**Racional:** Addons usam namespace.

**Status:** `DECIDIDO`

---

### DEC-215 — Kind de addon namespaced

**Escolha aprovada:** `A`

**Decisão:** Sim: `module-id:kind-id`.

**Racional:** Evita colisões.

**Status:** `DECIDIDO`

---

### DEC-216 — Kind desconhecido

**Escolha aprovada:** `A`

**Decisão:** Preservar.

**Racional:** Addon pode estar ausente temporariamente.

**Status:** `DECIDIDO`

---

## Scale

### DEC-217 — Scale vazia

**Escolha aprovada:** `B`

**Decisão:** Não permitida.

**Racional:** Mantém classificação mínima.

**Status:** `DECIDIDO`

---

### DEC-218 — Default

**Escolha aprovada:** `C`

**Decisão:** `generic`.

**Racional:** Não presume tamanho.

**Status:** `DECIDIDO`

---

### DEC-219 — Modelo de presets

**Escolha aprovada:** `C`

**Decisão:** Presets úteis, mas `scale` continua string aberta.

**Racional:** Não mistura scale com kind e preserva extensibilidade.

**Status:** `DECIDIDO`

---

### DEC-220 — Scale de addon namespaced

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Evita colisões.

**Status:** `DECIDIDO`

---

### DEC-221 — Scale desconhecida

**Escolha aprovada:** `A`

**Decisão:** Preservar.

**Racional:** Nunca resetar silenciosamente.

**Status:** `DECIDIDO`

---

## Tags

### DEC-222 — Persistência visual

**Escolha aprovada:** `B`

**Decisão:** Normalizar ID técnico; não depender da grafia como identidade.

**Racional:** Busca e comparação ficam estáveis.

**Status:** `DECIDIDO`

---

### DEC-223 — Shape de tags

**Escolha aprovada:** `A`

**Decisão:** Manter `tags: string[]`.

**Racional:** Objetos para toda tag seriam peso prematuro.

**Status:** `DECIDIDO`

---

### DEC-224 — Tags livres viram slug

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Normalização estável para comparação.

**Status:** `DECIDIDO`

---

### DEC-225 — Tags de addon namespaced

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Evita colisões.

**Status:** `DECIDIDO`

---

### DEC-226 — Tag desconhecida

**Escolha aprovada:** `A`

**Decisão:** Preservar.

**Racional:** Nunca apagar dado por addon ausente.

**Status:** `DECIDIDO`

---

### DEC-227 — Máximo de tags

**Escolha aprovada:** `A`

**Decisão:** 50.

**Racional:** Limite amplo e defensivo.

**Status:** `DECIDIDO`

---

## Hierarchy

### DEC-228 — Local de parentDomainUuid

**Escolha aprovada:** `A`

**Decisão:** `definition.hierarchy.parentDomainUuid`.

**Racional:** Agrupa a estrutura administrativa.

**Status:** `DECIDIDO`

---

### DEC-229 — Tipo de parentDomainUuid

**Escolha aprovada:** `A`

**Decisão:** `string | null`.

**Racional:** Representação explícita de root.

**Status:** `DECIDIDO`

---

### DEC-230 — Root serialization

**Escolha aprovada:** `A`

**Decisão:** Usar `null`.

**Racional:** Mais previsível que campo ausente.

**Status:** `DECIDIDO`

---

### DEC-231 — lastKnownParentName no próprio Domain

**Escolha aprovada:** `B`

**Decisão:** Não guardar.

**Racional:** Diagnostics resolve pelo UUID; snapshot pertence a refs que realmente precisam.

**Status:** `DECIDIDO`

---

### DEC-232 — Tipo do parent

**Escolha aprovada:** `A`

**Decisão:** Novo parent deve ser Domain Actor válido.

**Racional:** Mantém semântica da árvore.

**Status:** `DECIDIDO`

---

### DEC-233 — Reparent para parent arquivado

**Escolha aprovada:** `C`

**Decisão:** Somente com override GM.

**Racional:** Evita inserir acidentalmente entidades ativas em ramo arquivado.

**Status:** `DECIDIDO`

---

### DEC-234 — Parent arquivado com filhos ativos

**Escolha aprovada:** `A`

**Decisão:** Permitido.

**Racional:** Archive não deve destruir estrutura histórica.

**Status:** `DECIDIDO`

---

## Capabilities-base

### DEC-235 — Local

**Escolha aprovada:** `A`

**Decisão:** `definition.capabilities.enabled`.

**Racional:** Deixa espaço para config futura.

**Status:** `DECIDIDO`

---

### DEC-236 — Shape

**Escolha aprovada:** `A`

**Decisão:** `enabled: string[]` + `config: Record<string, unknown>`.

**Racional:** Evita migration de shape quando configs surgirem.

**Status:** `DECIDIDO`

---

### DEC-237 — Config arbitrária

**Escolha aprovada:** `B`

**Decisão:** Somente config validada pelo registry da capability.

**Racional:** Evita JSON-lixeira.

**Status:** `DECIDIDO`

---

### DEC-238 — Capability sem registry

**Escolha aprovada:** `A`

**Decisão:** Preservar em `enabled`.

**Racional:** Não perder dados.

**Status:** `DECIDIDO`

---

### DEC-239 — Config de capability desconhecida

**Escolha aprovada:** `A`

**Decisão:** Preservar.

**Racional:** Permite recuperação após addon voltar.

**Status:** `DECIDIDO`

---

### DEC-240 — Mínimo funcional contínuo

**Escolha aprovada:** `A`

**Decisão:** Exigir ao menos uma capability funcional também após edits.

**Racional:** Evita Domain semanticamente vazio.

**Status:** `DECIDIDO`

---

### DEC-241 — `core` conta como funcional

**Escolha aprovada:** `B`

**Decisão:** Não.

**Racional:** Não burlar a regra com capability técnica.

**Status:** `DECIDIDO`

---

### DEC-242 — Quem define `functional=true`

**Escolha aprovada:** `B`

**Decisão:** Registry da capability.

**Racional:** Classificação explícita e extensível.

**Status:** `DECIDIDO`

---

## State

### DEC-243 — Shape inicial

**Escolha aprovada:** `A`

**Decisão:** `lifecycle`, `conditions`; alerts não persistidos agora.

**Racional:** Mantém state pequeno.

**Status:** `DECIDIDO`

---

### DEC-244 — Lifecycle em state

**Escolha aprovada:** `A`

**Decisão:** `state.lifecycle`.

**Racional:** É situação administrativa atual.

**Status:** `DECIDIDO`

---

### DEC-245 — Lifecycle fechado

**Escolha aprovada:** `A`

**Decisão:** `active | inactive | archived`.

**Racional:** Infraestrutura central precisa de semântica previsível.

**Status:** `DECIDIDO`

---

### DEC-246 — Default lifecycle

**Escolha aprovada:** `A`

**Decisão:** `active`.

**Racional:** Novo Domain nasce ativo.

**Status:** `DECIDIDO`

---

### DEC-247 — Conditions field desde v1

**Escolha aprovada:** `A`

**Decisão:** Campo existe desde schema v1.

**Racional:** Evita migration estrutural imediata.

**Status:** `DECIDIDO`

---

### DEC-248 — Alerts persistidos

**Escolha aprovada:** `B`

**Decisão:** Não no v1.

**Racional:** Alerts devem ser derivados de services/Diagnostics quando possível.

**Status:** `DECIDIDO`

---

### DEC-249 — state.status narrativo genérico

**Escolha aprovada:** `B`

**Decisão:** Não.

**Racional:** Narrativa pertence a Conditions/Events.

**Status:** `DECIDIDO`

---

## Archive

### DEC-250 — Representação

**Escolha aprovada:** `A`

**Decisão:** Archive = `state.lifecycle = 'archived'`.

**Racional:** Evita boolean duplicado.

**Status:** `DECIDIDO`

---

### DEC-251 — archivedAt

**Escolha aprovada:** `A`

**Decisão:** Persistir.

**Racional:** Útil para administração e filtros.

**Status:** `DECIDIDO`

---

### DEC-252 — archivedByUserId

**Escolha aprovada:** `B`

**Decisão:** Autoria fica em audit/receipt.

**Racional:** Evita metadata redundante.

**Status:** `DECIDIDO`

---

### DEC-253 — Local de archivedAt

**Escolha aprovada:** `A`

**Decisão:** `metadata.archivedAt`.

**Racional:** Lifecycle fica em state; timestamp em metadata.

**Status:** `DECIDIDO`

---

### DEC-254 — Unarchive e archivedAt

**Escolha aprovada:** `A`

**Decisão:** Ao restaurar, limpar `archivedAt`.

**Racional:** Campo representa estado atual; histórico fica no audit.

**Status:** `DECIDIDO`

---

## Metadata administrativa

### DEC-255 — Shape inicial

**Escolha aprovada:** `A`

**Decisão:** `createdByUserId`, `archivedAt`, `source`.

**Racional:** Somente metadata própria relevante.

**Status:** `DECIDIDO`

---

### DEC-256 — createdBy null

**Escolha aprovada:** `A`

**Decisão:** Permitido em import/migration.

**Racional:** Origem pode ser desconhecida.

**Status:** `DECIDIDO`

---

### DEC-257 — Registrar source

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Provenance de criação é útil.

**Status:** `DECIDIDO`

---

### DEC-258 — Source shape

**Escolha aprovada:** `A`

**Decisão:** `manual | template | import | migration` + ref opcional.

**Racional:** Simples e suficiente.

**Status:** `DECIDIDO`

---

### DEC-259 — source.ref

**Escolha aprovada:** `A`

**Decisão:** Pode guardar template/UUID/ID de origem.

**Racional:** Provenance sem virar authority.

**Status:** `DECIDIDO`

---

### DEC-260 — Mutabilidade de source

**Escolha aprovada:** `A`

**Decisão:** Imutável após criação.

**Racional:** Origem histórica não deve ser reescrita.

**Status:** `DECIDIDO`

---

## Extensibilidade

### DEC-261 — customData genérico

**Escolha aprovada:** `B`

**Decisão:** Não criar `system.customData`.

**Racional:** Evita lixeira sem contrato.

**Status:** `DECIDIDO`

---

### DEC-262 — Persistência de addons

**Escolha aprovada:** `A`

**Decisão:** Flags ou capability config registrada.

**Racional:** Mantém ownership de dados claro.

**Status:** `DECIDIDO`

---

### DEC-263 — Addon escreve em definition arbitrariamente

**Escolha aprovada:** `B`

**Decisão:** Somente contracts/extensões registradas.

**Racional:** Protege schema principal.

**Status:** `DECIDIDO`

---

### DEC-264 — Campos desconhecidos em migration

**Escolha aprovada:** `B`

**Decisão:** Preservar apenas em pontos de extensão declarados.

**Racional:** Equilibra compatibilidade e higiene.

**Status:** `DECIDIDO`

---

## Normalização

### DEC-265 — Trim de strings simples

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Reduz inconsistência acidental.

**Status:** `DECIDIDO`

---

### DEC-266 — IDs técnicos lowercase

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Canonicalização previsível.

**Status:** `DECIDIDO`

---

### DEC-267 — Unicode em labels/textos

**Escolha aprovada:** `A`

**Decisão:** Permitido.

**Racional:** Suporte normal a i18n.

**Status:** `DECIDIDO`

---

### DEC-268 — Charset de IDs técnicos

**Escolha aprovada:** `A`

**Decisão:** Restringir aproximadamente a `[a-z0-9._:-]`.

**Racional:** Evita IDs frágeis.

**Status:** `DECIDIDO`

---

### DEC-269 — Deduplicação de arrays

**Escolha aprovada:** `A`

**Decisão:** Remover duplicatas onde semântica exige unicidade.

**Racional:** Tags/aliases/capabilities não precisam repetição.

**Status:** `DECIDIDO`

---

### DEC-270 — Ordem semântica de aliases/tags/capabilities

**Escolha aprovada:** `B`

**Decisão:** Não é semanticamente importante.

**Racional:** UI pode ordenar separadamente.

**Status:** `DECIDIDO`

---

## Validação

### DEC-271 — Erro de validação

**Escolha aprovada:** `A`

**Decisão:** Bloqueia save inteiro.

**Racional:** Evita partial save inconsistente.

**Status:** `DECIDIDO`

---

### DEC-272 — Warnings

**Escolha aprovada:** `A`

**Decisão:** Podem permitir save.

**Racional:** Warnings informam sem bloquear casos recuperáveis.

**Status:** `DECIDIDO`

---

### DEC-273 — Kind desconhecido

**Escolha aprovada:** `B`

**Decisão:** Warning.

**Racional:** Pode vir de addon ausente.

**Status:** `DECIDIDO`

---

### DEC-274 — Scale desconhecida

**Escolha aprovada:** `B`

**Decisão:** Warning.

**Racional:** Preservar extensibilidade.

**Status:** `DECIDIDO`

---

### DEC-275 — Capability desconhecida

**Escolha aprovada:** `B`

**Decisão:** Warning.

**Racional:** Preservar dados.

**Status:** `DECIDIDO`

---

### DEC-276 — Parent quebrado

**Escolha aprovada:** `B`

**Decisão:** Domain abre com orphan warning.

**Racional:** Repair é melhor que bloqueio total.

**Status:** `DECIDIDO`

---

### DEC-277 — Cycle

**Escolha aprovada:** `A`

**Decisão:** Impedir reparent.

**Racional:** Cycle quebraria hierarquia.

**Status:** `DECIDIDO`

---

### DEC-278 — Zero capabilities funcionais

**Escolha aprovada:** `A`

**Decisão:** Impedir save.

**Racional:** Regra estrutural do produto.

**Status:** `DECIDIDO`

---

## Derived values

### DEC-279 — children persistidos

**Escolha aprovada:** `B`

**Decisão:** Não.

**Racional:** Derivados pelo índice.

**Status:** `DECIDIDO`

---

### DEC-280 — ancestors persistidos

**Escolha aprovada:** `B`

**Decisão:** Não.

**Racional:** Derivados.

**Status:** `DECIDIDO`

---

### DEC-281 — effective capabilities persistidas

**Escolha aprovada:** `B`

**Decisão:** Não como truth; derivadas/cache externo.

**Racional:** Source records continuam autoridade.

**Status:** `DECIDIDO`

---

### DEC-282 — isArchived persistido

**Escolha aprovada:** `B`

**Decisão:** Derivado de lifecycle.

**Racional:** Evita duplicidade.

**Status:** `DECIDIDO`

---

### DEC-283 — displayName persistido

**Escolha aprovada:** `B`

**Decisão:** Derivado de Actor.name.

**Racional:** Nome oficial já existe.

**Status:** `DECIDIDO`

---

### DEC-284 — searchText persistido

**Escolha aprovada:** `B`

**Decisão:** Derivado/indexado em memória.

**Racional:** Evita dados redundantes.

**Status:** `DECIDIDO`

---

## Conditions shell

### DEC-285 — ID interno

**Escolha aprovada:** `A`

**Decisão:** Cada Condition futura terá ID interno.

**Racional:** Necessário para update/removal/audit.

**Status:** `DECIDIDO`

---

### DEC-286 — Schema mínimo agora

**Escolha aprovada:** `B`

**Decisão:** Não congelar Condition contract nesta rodada.

**Racional:** Events/Conditions terão rodada própria.

**Status:** `DECIDIDO`

---

### DEC-287 — state.conditions no T0

**Escolha aprovada:** `B`

**Decisão:** Campo reservado/placeholder até contract específico.

**Racional:** Evita design prematuro.

**Status:** `DECIDIDO`

---

## Rich text security

### DEC-288 — Sanitização

**Escolha aprovada:** `A`

**Decisão:** Usar mecanismos nativos do Foundry.

**Racional:** Evita XSS/HTML inseguro.

**Status:** `DECIDIDO`

---

### DEC-289 — Scripts em description

**Escolha aprovada:** `B`

**Decisão:** Não permitir.

**Racional:** Conteúdo não deve executar código.

**Status:** `DECIDIDO`

---

### DEC-290 — @UUID/enriched content

**Escolha aprovada:** `A`

**Decisão:** Permitir.

**Racional:** Integra com ecossistema Foundry.

**Status:** `DECIDIDO`

---

## Creation defaults

### DEC-291 — Nome obrigatório

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Actor.name é identidade principal.

**Status:** `DECIDIDO`

---

### DEC-292 — Kind generic automático

**Escolha aprovada:** `A`

**Decisão:** Permitido.

**Racional:** Criação rápida não precisa parar por classificação.

**Status:** `DECIDIDO`

---

### DEC-293 — Scale generic automático

**Escolha aprovada:** `A`

**Decisão:** Permitido.

**Racional:** Evita fricção desnecessária.

**Status:** `DECIDIDO`

---

### DEC-294 — Preset preenche capabilities

**Escolha aprovada:** `A`

**Decisão:** Sim, usuário confirma.

**Racional:** Criação rápida permanece rápida.

**Status:** `DECIDIDO`

---

### DEC-295 — Sem preset funcional

**Escolha aprovada:** `A`

**Decisão:** Wizard exige ao menos uma capability funcional.

**Racional:** Mantém invariável do Domain.

**Status:** `DECIDIDO`

---

### DEC-296 — Advanced mostra internals

**Escolha aprovada:** `B`

**Decisão:** Não; internals permanecem escondidos.

**Racional:** Usuário vê apenas configuração compreensível.

**Status:** `DECIDIDO`

---

## Templates

### DEC-297 — Campos prefill

**Escolha aprovada:** `A`

**Decisão:** Template pode preencher kind/scale/tags/capabilities/description.

**Racional:** Esses dados são portáveis.

**Status:** `DECIDIDO`

---

### DEC-298 — parentDomainUuid no template

**Escolha aprovada:** `B`

**Decisão:** Não.

**Racional:** Parent é contexto específico do mundo.

**Status:** `DECIDIDO`

---

### DEC-299 — Lifecycle no template

**Escolha aprovada:** `B`

**Decisão:** Novo Domain nasce `active`.

**Racional:** Template não deve criar archive/inactive por acidente.

**Status:** `DECIDIDO`

---

### DEC-300 — Revision no template

**Escolha aprovada:** `B`

**Decisão:** Não; novo Domain começa em 0.

**Racional:** Revision pertence à instância.

**Status:** `DECIDIDO`

---

### DEC-301 — Source metadata

**Escolha aprovada:** `B`

**Decisão:** Nova source aponta para o template.

**Racional:** Provenance correta da nova instância.

**Status:** `DECIDIDO`

---

## Import / serialization

### DEC-302 — schemaVersion em full export

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Necessário para migration/import.

**Status:** `DECIDIDO`

---

### DEC-303 — revision em full export

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Snapshot completo preserva estado.

**Status:** `DECIDIDO`

---

### DEC-304 — revision em template export

**Escolha aprovada:** `B`

**Decisão:** Não.

**Racional:** Template não é snapshot operacional.

**Status:** `DECIDIDO`

---

### DEC-305 — Migration antes de create

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Não criar Actor em schema antigo.

**Status:** `DECIDIDO`

---

### DEC-306 — Future schema

**Escolha aprovada:** `A`

**Decisão:** Rejeitar ou importar read-only.

**Racional:** Nunca tentar adivinhar downgrade.

**Status:** `DECIDIDO`

---

### DEC-307 — Nome duplicado no import

**Escolha aprovada:** `A`

**Decisão:** Preservar `Actor.name` exatamente.

**Racional:** Nomes duplicados são válidos.

**Status:** `DECIDIDO`

---

## UUIDs e referências

### DEC-308 — Formato de refs Foundry

**Escolha aprovada:** `A`

**Decisão:** Usar UUID completo.

**Racional:** Portabilidade e resolução melhores.

**Status:** `DECIDIDO`

---

### DEC-309 — Inferência por nome

**Escolha aprovada:** `A`

**Decisão:** Nunca usar nome como fallback de identidade.

**Racional:** Nome não é ID.

**Status:** `DECIDIDO`

---

### DEC-310 — Broken ref

**Escolha aprovada:** `A`

**Decisão:** Preservar até repair/remove explícito.

**Racional:** Evita perda silenciosa.

**Status:** `DECIDIDO`

---

### DEC-311 — Snapshot de nome em refs

**Escolha aprovada:** `A`

**Decisão:** Permitido quando útil.

**Racional:** Ajuda diagnostics e histórico.

**Status:** `DECIDIDO`

---

## Archive / delete / recovery

### DEC-312 — Delete mais difícil que archive

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Archive deve ser caminho normal.

**Status:** `DECIDIDO`

---

### DEC-313 — Bloquear delete com refs críticas

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Evita quebrar mundo silenciosamente.

**Status:** `DECIDIDO`

---

### DEC-314 — Impact preview

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** GM precisa saber consequências.

**Status:** `DECIDIDO`

---

### DEC-315 — Archive não cascata automaticamente

**Escolha aprovada:** `A`

**Decisão:** Correto.

**Racional:** GM escolhe comportamento dos filhos.

**Status:** `DECIDIDO`

---

### DEC-316 — Restore preserva UUID

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** É o mesmo Domain restaurado.

**Status:** `DECIDIDO`

---

## Index / cache

### DEC-317 — Source of truth do índice

**Escolha aprovada:** `A`

**Decisão:** Reconstruído a partir dos Actors.

**Racional:** Índice não vira database paralelo.

**Status:** `DECIDIDO`

---

### DEC-318 — Campos indexados

**Escolha aprovada:** `A`

**Decisão:** uuid/name/aliases/kind/scale/parent/tags/capabilities.

**Racional:** Suficiente para busca/navegação.

**Status:** `DECIDIDO`

---

### DEC-319 — Player index

**Escolha aprovada:** `A`

**Decisão:** Sanitizado.

**Racional:** Segredo não pode vazar pelo mecanismo de busca.

**Status:** `DECIDIDO`

---

### DEC-320 — Derived context cache

**Escolha aprovada:** `A`

**Decisão:** Descartável/reconstruível.

**Racional:** Cache nunca é authority.

**Status:** `DECIDIDO`

---

## Public Domain Context

### DEC-321 — DTO default

**Escolha aprovada:** `A`

**Decisão:** API retorna DTO/context por padrão.

**Racional:** Evita mutação externa do DataModel.

**Status:** `DECIDIDO`

---

### DEC-322 — Conteúdo básico

**Escolha aprovada:** `A`

**Decisão:** uuid/name/img + definition/state sanitizados.

**Racional:** Context útil e estável.

**Status:** `DECIDIDO`

---

### DEC-323 — schemaVersion no DTO comum

**Escolha aprovada:** `B`

**Decisão:** Não.

**Racional:** Detalhe técnico fica em diagnostics/low-level API.

**Status:** `DECIDIDO`

---

### DEC-324 — revision no DTO

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Forms/clients precisam detectar stale state.

**Status:** `DECIDIDO`

---

### DEC-325 — createdBy para player

**Escolha aprovada:** `B`

**Decisão:** Somente contexto administrativo.

**Racional:** Metadata interna não precisa ser pública.

**Status:** `DECIDIDO`

---

### DEC-326 — source para player

**Escolha aprovada:** `B`

**Decisão:** Apenas se policy explicitamente tornar público.

**Racional:** Provenance pode ser interna.

**Status:** `DECIDIDO`

---

## Campos fora do T0

### DEC-327 — Economy balances

**Escolha aprovada:** `B`

**Decisão:** Não entram no base schema ainda.

**Racional:** Economy terá contract próprio.

**Status:** `DECIDIDO`

---

### DEC-328 — Projects

**Escolha aprovada:** `B`

**Decisão:** Não entram ainda.

**Racional:** Project schema será decidido depois.

**Status:** `DECIDIDO`

---

### DEC-329 — Relations

**Escolha aprovada:** `B`

**Decisão:** Não entram ainda.

**Racional:** Relation repository/contract separado.

**Status:** `DECIDIDO`

---

### DEC-330 — Facilities

**Escolha aprovada:** `B`

**Decisão:** Não entram ainda.

**Racional:** Storage ainda está abstraído.

**Status:** `DECIDIDO`

---

### DEC-331 — Territory links

**Escolha aprovada:** `B`

**Decisão:** Não entram ainda.

**Racional:** Territory terá rodada própria.

**Status:** `DECIDIDO`

---

### DEC-332 — Requests

**Escolha aprovada:** `B`

**Decisão:** Não entram ainda.

**Racional:** Request lifecycle será especificado depois.

**Status:** `DECIDIDO`

---

### DEC-333 — People structures

**Escolha aprovada:** `B`

**Decisão:** Não entram no envelope T0.

**Racional:** Primeiro fechar People contract.

**Status:** `DECIDIDO`

---

### DEC-334 — Tamanho do DomainDataModel T0

**Escolha aprovada:** `A`

**Decisão:** Propositalmente pequeno.

**Racional:** Evita antecipar todos subsistemas.

**Status:** `DECIDIDO`

---

## Shape final T0

### DEC-335 — Princípio de T0 pequeno

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Subsistemas entram depois por contracts/migrations próprios.

**Status:** `DECIDIDO`

---

### DEC-336 — Seções por capability

**Escolha aprovada:** `A`

**Decisão:** Cada subsystem pode ganhar seção versionada própria.

**Racional:** Envelope principal permanece estável.

**Status:** `DECIDIDO`

---

### DEC-337 — Contract/schema version por subsystem

**Escolha aprovada:** `A`

**Decisão:** Sim, quando subsistema ficar complexo.

**Racional:** Versionamento localizado reduz acoplamento.

**Status:** `DECIDIDO`

---

### DEC-338 — Global schemaVersion

**Escolha aprovada:** `A`

**Decisão:** Continua autoridade para migrations estruturais do Domain inteiro.

**Racional:** Coordena mudanças cross-subsystem.

**Status:** `DECIDIDO`

---

# 4. Validação do envelope

Antes de considerar o T0 implementável, o código deve conseguir provar:

- [ ] criação rápida produz Domain válido com name, generic kind/scale e capability funcional;
- [ ] criação avançada não expõe internals técnicos;
- [ ] revision não muda por Actor.img, mas muda por Actor.name e updates lógicos;
- [ ] aliases/tags/capabilities são normalizados sem destruir label/apresentação relevante;
- [ ] cycle não pode ser salvo;
- [ ] broken parent pode existir apenas como estado diagnosticável, não como crash;
- [ ] unknown kind/scale/capability é preservado;
- [ ] archive preserva UUID;
- [ ] delete mostra impacto e pode ser bloqueado;
- [ ] template não carrega parent/revision/lifecycle arquivado;
- [ ] import de schema antigo migra antes de criar;
- [ ] future schema não é down-convertido silenciosamente;
- [ ] player context não expõe metadata administrativa não autorizada;
- [ ] DomainIndex pode ser apagado e reconstruído integralmente a partir dos Actors.

---

# 5. Próxima rodada

A Rodada 03 deve congelar **IDs, referências, namespaces e contracts compartilhados**, incluindo:

- local IDs vs Foundry UUIDs;
- canonical IDs;
- namespacing;
- reference snapshots;
- broken reference model;
- Command IDs;
- transaction IDs;
- public contract versioning;
- error codes;
- DTO/common envelopes;
- fingerprints;
- timestamps/time representation;
- serialization boundaries.
````

---

# ANEXO 03 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_03_IDS_CONTRACTS_339-510.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 03
## IDs, Referências, Namespaces e Contracts Compartilhados — Decisões 339–510

> **Status:** APROVADO.
>
> O usuário aprovou em bloco todas as recomendações apresentadas nas perguntas 339–510.
>
> Este snapshot deve permanecer preservado. Decisões futuras que o alterem devem registrar explicitamente a decisão anterior e a nova.

---

# 0. Resumo executivo

Esta rodada congela a gramática técnica compartilhada do Domain Manager: como entidades são identificadas, referenciadas, versionadas, serializadas, auditadas e expostas.

- IDs locais e UUIDs Foundry têm semânticas diferentes;
- IDs runtime são opacos e prefixados por tipo;
- registries funcionais usam namespaces;
- UUIDs completos são usados para Documents Foundry;
- referências quebradas são preservadas e reparáveis;
- timestamps reais e `worldTime` são dimensões distintas;
- histories podem usar sequence por aggregate;
- contract version, package version, storage schema e export format são versões distintas;
- DTOs são imutáveis, clonados e sanitizados;
- commandId, transactionId, correlationId e causationId são conceitos separados;
- fingerprints são calculados canonicamente pela authority;
- public errors possuem códigos estáveis;
- registries recusam colisão e congelam em lifecycle previsível;
- payload persistido é JSON-safe;
- audit preserva executor e source/provenance;
- import usa old→new remapping;
- consumers detectam contracts/capabilities, não package versions;
- contracts centrais são projetados agora, mas implementados conforme cada gate realmente precisar.

---

# 1. Convenções centrais aprovadas

```text
Foundry Document identity  -> uuid / *Uuid
Local record identity      -> id / *Id

Runtime ID examples:
  cmd_<random>
  tx_<random>
  prj_<random>
  rel_<random>
  rep_<random>
  led_<random>
  resv_<random>
  req_<random>

Semantic registry IDs:
  domain-manager:resources
  domain-manager:trade
  my-addon:orbital-logistics
  world:custom-resource

Classification presets:
  kind = settlement
  scale = generic

```

---

# 2. Contracts-base resultantes

```ts
type DomainUuid = Branded<string, "DomainUuid">;
type CommandId = Branded<string, "CommandId">;
type TransactionId = Branded<string, "TransactionId">;

interface DocumentRef {
  uuid: string;
  lastKnownName?: string;
}

interface DomainRef extends DocumentRef {
  uuid: DomainUuid;
}

interface OperationSource {
  type:
    | "user"
    | "tick"
    | "project"
    | "event"
    | "provider"
    | "migration";
  ref?: string;
}

interface AuditContext {
  commandId?: CommandId;
  transactionId?: TransactionId;
  correlationId?: string;
  causationId?: string;

  userId?: string;
  userName?: string;

  createdAtReal: number;
  worldTime?: number | null;

  source: OperationSource;
  reason?: string;
}

type PublicResult<T> =
  | {
      contractVersion: number;
      ok: true;
      data: T;
      warnings?: readonly PublicWarning[];
    }
  | {
      contractVersion: number;
      ok: false;
      error: PublicError;
    };

interface PublicError {
  code: string;      // stable, e.g. DM_REF_NOT_FOUND
  message: string;   // human/i18n, not stable contract
  details?: unknown; // sanitized for viewer
}

```

---

# 3. Decisões detalhadas

## Identidade geral

### DEC-339 — ID local vs UUID Foundry

**Escolha aprovada:** `A`

**Decisão:** Diferenciar `id` local de `uuid` Foundry global.

**Racional:** Evita ambiguidade em APIs e references.

**Status:** `DECIDIDO`

---

### DEC-340 — Sufixo para UUID

**Escolha aprovada:** `A`

**Decisão:** Campos de UUID terminam em `Uuid`.

**Racional:** O nome do campo comunica o tipo da referência.

**Status:** `DECIDIDO`

---

### DEC-341 — Sufixo para ID interno

**Escolha aprovada:** `A`

**Decisão:** Campos de ID interno terminam em `Id`.

**Racional:** Padroniza contracts e reduz erros.

**Status:** `DECIDIDO`

---

### DEC-342 — Evitar `ref` genérico

**Escolha aprovada:** `A`

**Decisão:** Preferir nomes específicos como `sourceRef`/`targetRef`.

**Racional:** Melhora legibilidade e typing.

**Status:** `DECIDIDO`

---

## IDs internos

### DEC-343 — Imutabilidade

**Escolha aprovada:** `A`

**Decisão:** IDs internos são gerados e imutáveis.

**Racional:** Nome/label pode mudar sem trocar identidade.

**Status:** `DECIDIDO`

---

### DEC-344 — Legibilidade por tipo

**Escolha aprovada:** `C`

**Decisão:** Definitions usam IDs legíveis; instances/entries usam IDs opacos.

**Racional:** Equilibra integração humana e segurança de identidade.

**Status:** `DECIDIDO`

---

### DEC-345 — Registry IDs legíveis

**Escolha aprovada:** `A`

**Decisão:** Entidades registráveis usam IDs estáveis e legíveis.

**Racional:** Addons precisam referenciar contracts previsivelmente.

**Status:** `DECIDIDO`

---

### DEC-346 — Runtime instance IDs

**Escolha aprovada:** `A`

**Decisão:** Instances usam IDs aleatórios.

**Racional:** Nomes podem repetir e mudar.

**Status:** `DECIDIDO`

---

### DEC-347 — Tamanho/colisão

**Escolha aprovada:** `A`

**Decisão:** IDs aleatórios devem ter espaço suficiente para colisão negligível.

**Racional:** Evita counters globais.

**Status:** `DECIDIDO`

---

### DEC-348 — Gerador Foundry

**Escolha aprovada:** `A`

**Decisão:** Usar `foundry.utils.randomID()` quando adequado.

**Racional:** Não reinventar primitive confiável.

**Status:** `DECIDIDO`

---

### DEC-349 — Prefixos por tipo

**Escolha aprovada:** `A`

**Decisão:** Usar prefixos como `cmd_`, `tx_`, `prj_`, `rel_`, `led_`, etc.

**Racional:** Melhora logs e Diagnostics.

**Status:** `DECIDIDO`

---

### DEC-350 — Prefixo como identidade

**Escolha aprovada:** `A`

**Decisão:** Prefixo faz parte do ID formal.

**Racional:** Permite validação de tipo em runtime.

**Status:** `DECIDIDO`

---

## Namespaces

### DEC-351 — Formato padrão

**Escolha aprovada:** `A`

**Decisão:** Usar `namespace:id`.

**Racional:** Formato simples e previsível.

**Status:** `DECIDIDO`

---

### DEC-352 — Core classification vs semantic registries

**Escolha aprovada:** `MISTO`

**Decisão:** Kind/scale built-in podem usar IDs simples; registries semânticos importantes usam namespace.

**Racional:** Classification fica amigável; contracts funcionais evitam colisão.

**Status:** `DECIDIDO`

---

### DEC-353 — Capability IDs

**Escolha aprovada:** `A`

**Decisão:** Capabilities sempre namespaced, inclusive built-ins.

**Racional:** São contracts extensíveis.

**Status:** `DECIDIDO`

---

### DEC-354 — Action IDs

**Escolha aprovada:** `A`

**Decisão:** Actions obrigatoriamente namespaced.

**Racional:** Evita colisões entre módulos.

**Status:** `DECIDIDO`

---

### DEC-355 — TickProcessor IDs

**Escolha aprovada:** `A`

**Decisão:** Namespaced.

**Racional:** Extensibilidade segura.

**Status:** `DECIDIDO`

---

### DEC-356 — RelationType IDs

**Escolha aprovada:** `A`

**Decisão:** Namespaced.

**Racional:** Evita colisões semânticas.

**Status:** `DECIDIDO`

---

### DEC-357 — ResourceDefinition IDs

**Escolha aprovada:** `A`

**Decisão:** Namespaced.

**Racional:** Resources precisam identidade interoperável.

**Status:** `DECIDIDO`

---

### DEC-358 — Custom GM resource IDs

**Escolha aprovada:** `A`

**Decisão:** Usar namespace reservado `world:`.

**Racional:** Distingue conteúdo local de módulos.

**Status:** `DECIDIDO`

---

### DEC-359 — Reserva de `world:`

**Escolha aprovada:** `A`

**Decisão:** `world:` é reservado ao Domain Manager.

**Racional:** Evita spoofing/colisão.

**Status:** `DECIDIDO`

---

### DEC-360 — Namespace de addon

**Escolha aprovada:** `A`

**Decisão:** Usar o `module.id` real.

**Racional:** Origem verificável e estável.

**Status:** `DECIDIDO`

---

## Canonicalização

### DEC-361 — Case de IDs

**Escolha aprovada:** `A`

**Decisão:** IDs técnicos persistidos lowercase.

**Racional:** Comparação previsível.

**Status:** `DECIDIDO`

---

### DEC-362 — Espaço em ID técnico

**Escolha aprovada:** `A`

**Decisão:** Não permitir.

**Racional:** Reduz fragilidade.

**Status:** `DECIDIDO`

---

### DEC-363 — Unicode em ID técnico

**Escolha aprovada:** `A`

**Decisão:** IDs técnicos ficam ASCII restrito; labels suportam Unicode.

**Racional:** Interoperabilidade e logs melhores.

**Status:** `DECIDIDO`

---

### DEC-364 — Pipeline

**Escolha aprovada:** `A`

**Decisão:** Normalizar antes de validar.

**Racional:** `trim → lowercase → canonicalize → validate`.

**Status:** `DECIDIDO`

---

### DEC-365 — Colisão após normalize

**Escolha aprovada:** `A`

**Decisão:** Tratar como colisão.

**Racional:** Canonical identity deve ser única.

**Status:** `DECIDIDO`

---

## Foundry UUID References

### DEC-366 — UUID completo

**Escolha aprovada:** `A`

**Decisão:** Persistir UUID completo.

**Racional:** Melhor resolução e portabilidade.

**Status:** `DECIDIDO`

---

### DEC-367 — documentName duplicado

**Escolha aprovada:** `A`

**Decisão:** Não guardar normalmente.

**Racional:** Derivável do UUID.

**Status:** `DECIDIDO`

---

### DEC-368 — Compendium refs

**Escolha aprovada:** `A`

**Decisão:** Permitir UUIDs de Compendium.

**Racional:** Necessário para templates/definitions.

**Status:** `DECIDIDO`

---

### DEC-369 — EmbeddedDocument refs

**Escolha aprovada:** `A`

**Decisão:** Permitir.

**Racional:** Necessário para Region/Item etc.

**Status:** `DECIDIDO`

---

### DEC-370 — Resolver nativo

**Escolha aprovada:** `A`

**Decisão:** Preferir resolver UUID pelo mecanismo nativo do Foundry.

**Racional:** Evita lookup paralelo.

**Status:** `DECIDIDO`

---

## Reference snapshots

### DEC-371 — lastKnownName universal

**Escolha aprovada:** `B`

**Decisão:** Só usar em refs onde histórico/repair beneficia.

**Racional:** Evita inflar todos os records.

**Status:** `DECIDIDO`

---

### DEC-372 — Atualizar lastKnownName

**Escolha aprovada:** `A`

**Decisão:** Atualizar em referências vivas quando target muda nome.

**Racional:** Snapshot útil acompanha target enquanto resolvível.

**Status:** `DECIDIDO`

---

### DEC-373 — Target removido

**Escolha aprovada:** `A`

**Decisão:** Preservar lastKnownName.

**Racional:** É mais útil quando ref quebra.

**Status:** `DECIDIDO`

---

### DEC-374 — lastKnownImg

**Escolha aprovada:** `C`

**Decisão:** Só onde UX realmente precisa.

**Racional:** Evita metadata visual excessiva.

**Status:** `DECIDIDO`

---

### DEC-375 — DocumentRef compartilhado

**Escolha aprovada:** `A`

**Decisão:** Ter contract comum `DocumentRef`.

**Racional:** Evita formatos inventados por subsystem.

**Status:** `DECIDIDO`

---

### DEC-376 — DomainRef especializado

**Escolha aprovada:** `A`

**Decisão:** Ter tipagem especializada para DomainRef.

**Racional:** TypeScript protege boundaries.

**Status:** `DECIDIDO`

---

## Broken References

### DEC-377 — Resolve inexistente

**Escolha aprovada:** `A`

**Decisão:** Resolver retorna `null` controlado.

**Racional:** Broken ref é estado esperado.

**Status:** `DECIDIDO`

---

### DEC-378 — Service exige target

**Escolha aprovada:** `A`

**Decisão:** Converter ausência em erro estruturado.

**Racional:** Nunca deixar NullReference acidental.

**Status:** `DECIDIDO`

---

### DEC-379 — Código estável

**Escolha aprovada:** `A`

**Decisão:** Usar códigos como `DM_REF_NOT_FOUND`.

**Racional:** Consumers/Diagnostics podem reagir sem parse de texto.

**Status:** `DECIDIDO`

---

### DEC-380 — Diagnostics

**Escolha aprovada:** `A`

**Decisão:** Broken refs entram automaticamente em Diagnostics.

**Racional:** Repair proativo.

**Status:** `DECIDIDO`

---

### DEC-381 — Relink

**Escolha aprovada:** `A`

**Decisão:** Repair permite relink.

**Racional:** Preserva entidade sem obrigar delete.

**Status:** `DECIDIDO`

---

### DEC-382 — Histórico de relink

**Escolha aprovada:** `A`

**Decisão:** Audit registra UUID anterior.

**Racional:** Repair também precisa provenance.

**Status:** `DECIDIDO`

---

### DEC-383 — Keep Placeholder

**Escolha aprovada:** `A`

**Decisão:** GM pode manter placeholder indefinidamente.

**Racional:** Não apagar automaticamente.

**Status:** `DECIDIDO`

---

## Tempo técnico e ordering

### DEC-384 — ID não ordena

**Escolha aprovada:** `A`

**Decisão:** Nunca usar ID aleatório como ordenação.

**Racional:** Identidade e ordem são conceitos diferentes.

**Status:** `DECIDIDO`

---

### DEC-385 — Timestamp em audit

**Escolha aprovada:** `A`

**Decisão:** Toda entry auditável tem timestamp.

**Racional:** Necessário para história/diagnóstico.

**Status:** `DECIDIDO`

---

### DEC-386 — Timestamp real

**Escolha aprovada:** `A`

**Decisão:** Usar Unix milliseconds para audit real.

**Racional:** Formato compacto e estável.

**Status:** `DECIDIDO`

---

### DEC-387 — Real vs world time

**Escolha aprovada:** `A`

**Decisão:** Separar `createdAtReal` e `worldTime`.

**Racional:** Tempo técnico e narrativo são dimensões diferentes.

**Status:** `DECIDIDO`

---

### DEC-388 — worldTime opcional

**Escolha aprovada:** `A`

**Decisão:** Pode ser null.

**Racional:** Nem toda operação tem contexto narrativo.

**Status:** `DECIDIDO`

---

### DEC-389 — ISO

**Escolha aprovada:** `A`

**Decisão:** ISO é derivado para apresentação/export.

**Racional:** Não duplicar storage.

**Status:** `DECIDIDO`

---

## Sequence

### DEC-390 — Histories rigorosos

**Escolha aprovada:** `A`

**Decisão:** Usar sequence quando ordem estrita for necessária.

**Racional:** Timestamp sozinho pode empatar.

**Status:** `DECIDIDO`

---

### DEC-391 — Escopo

**Escolha aprovada:** `B`

**Decisão:** Sequence por aggregate/store.

**Racional:** Evita contador global e contenção.

**Status:** `DECIDIDO`

---

### DEC-392 — Sequence como identity

**Escolha aprovada:** `A`

**Decisão:** Não faz parte da identidade.

**Racional:** Serve apenas ordering.

**Status:** `DECIDIDO`

---

## Contract Versioning

### DEC-393 — Versão explícita

**Escolha aprovada:** `A`

**Decisão:** Contracts públicos importantes têm versão própria.

**Racional:** Package version não descreve payload.

**Status:** `DECIDIDO`

---

### DEC-394 — Formato da versão

**Escolha aprovada:** `A`

**Decisão:** Inteiro incremental.

**Racional:** Mais simples em payloads.

**Status:** `DECIDIDO`

---

### DEC-395 — Package vs contract

**Escolha aprovada:** `A`

**Decisão:** Separados.

**Racional:** Evoluem independentemente.

**Status:** `DECIDIDO`

---

### DEC-396 — Contract muda sem storage

**Escolha aprovada:** `A`

**Decisão:** Permitido.

**Racional:** DTO/API pode evoluir sem migration de storage.

**Status:** `DECIDIDO`

---

### DEC-397 — Storage muda sem API

**Escolha aprovada:** `A`

**Decisão:** Permitido.

**Racional:** Repository isola persistência.

**Status:** `DECIDIDO`

---

### DEC-398 — Consumer detection

**Escolha aprovada:** `A`

**Decisão:** Detectar contract version, não package version.

**Racional:** Feature detection correta.

**Status:** `DECIDIDO`

---

## Common Contract Envelope

### DEC-399 — Envelope consistente

**Escolha aprovada:** `A`

**Decisão:** Boundaries públicos relevantes usam `contractVersion` + data/result.

**Racional:** Padroniza interoperabilidade.

**Status:** `DECIDIDO`

---

### DEC-400 — Uso interno

**Escolha aprovada:** `B`

**Decisão:** Código interno não precisa de envelope em toda função.

**Racional:** Evita burocracia.

**Status:** `DECIDIDO`

---

### DEC-401 — Versão no payload externo

**Escolha aprovada:** `A`

**Decisão:** Payload externo carrega `contractVersion`.

**Racional:** Compatibilidade explícita.

**Status:** `DECIDIDO`

---

### DEC-402 — Incompatibilidade

**Escolha aprovada:** `A`

**Decisão:** Erro estruturado.

**Racional:** Não adivinhar formato.

**Status:** `DECIDIDO`

---

## DTOs

### DEC-403 — Imutabilidade conceitual

**Escolha aprovada:** `A`

**Decisão:** DTO é read-only para consumers.

**Racional:** Mutação local não persiste.

**Status:** `DECIDIDO`

---

### DEC-404 — Readonly TypeScript

**Escolha aprovada:** `A`

**Decisão:** Usar `Readonly<>` quando apropriado.

**Racional:** Proteção em compile time.

**Status:** `DECIDIDO`

---

### DEC-405 — Compartilhar referência interna

**Escolha aprovada:** `A`

**Decisão:** Nunca compartilhar referência mutável com DataModel.

**Racional:** Evita writes acidentais.

**Status:** `DECIDIDO`

---

### DEC-406 — Omitir campos secretos

**Escolha aprovada:** `A`

**Decisão:** Campos não autorizados são omitidos.

**Racional:** Melhor que enviar null/secret shape.

**Status:** `DECIDIDO`

---

### DEC-407 — Máscara `***`

**Escolha aprovada:** `A`

**Decisão:** Não por padrão.

**Racional:** Placeholder só quando UX pede.

**Status:** `DECIDIDO`

---

### DEC-408 — Unknown/Rumored

**Escolha aprovada:** `A`

**Decisão:** Usar DTO próprio.

**Racional:** Evita vazar shape do Domain real.

**Status:** `DECIDIDO`

---

## Generic References

### DEC-409 — Union discriminada

**Escolha aprovada:** `A`

**Decisão:** Usar union com `type` técnico + uuid/ref.

**Racional:** Typing e validação melhores.

**Status:** `DECIDIDO`

---

### DEC-410 — Discriminante técnico

**Escolha aprovada:** `A`

**Decisão:** `type` é ID técnico, nunca label.

**Racional:** Labels podem traduzir.

**Status:** `DECIDIDO`

---

### DEC-411 — URL externa

**Escolha aprovada:** `A`

**Decisão:** Não usar DocumentRef para URL.

**Racional:** ExternalLink é outro contract.

**Status:** `DECIDIDO`

---

## Command IDs

### DEC-412 — Command mutável exige ID

**Escolha aprovada:** `A`

**Decisão:** Todo command mutável possui `commandId`.

**Racional:** Base da idempotência.

**Status:** `DECIDIDO`

---

### DEC-413 — Quem gera

**Escolha aprovada:** `A`

**Decisão:** Origin/client gera antes de enviar.

**Racional:** Permite retry do mesmo command.

**Status:** `DECIDIDO`

---

### DEC-414 — Escopo de unicidade

**Escolha aprovada:** `A`

**Decisão:** Praticamente único no mundo.

**Racional:** Evita colisão entre usuários.

**Status:** `DECIDIDO`

---

### DEC-415 — Prefixo

**Escolha aprovada:** `A`

**Decisão:** `cmd_`.

**Racional:** Legibilidade e validação.

**Status:** `DECIDIDO`

---

### DEC-416 — Retry

**Escolha aprovada:** `A`

**Decisão:** Retry reutiliza o mesmo commandId.

**Racional:** Retry não é nova intenção.

**Status:** `DECIDIDO`

---

### DEC-417 — Nova execução

**Escolha aprovada:** `A`

**Decisão:** Nova ação deliberada gera novo commandId.

**Racional:** Operações distintas.

**Status:** `DECIDIDO`

---

## Intent Fingerprints

### DEC-418 — Fingerprint importante

**Escolha aprovada:** `A`

**Decisão:** Commands mutáveis relevantes possuem fingerprint calculável.

**Racional:** Detecta commandId reaproveitado com payload diferente.

**Status:** `DECIDIDO`

---

### DEC-419 — Autoridade do hash

**Escolha aprovada:** `A`

**Decisão:** Authority calcula canonical fingerprint.

**Racional:** Nunca confiar em hash do client.

**Status:** `DECIDIDO`

---

### DEC-420 — Campos incidentais

**Escolha aprovada:** `A`

**Decisão:** Excluir timestamp/UI metadata semânticamente irrelevante.

**Racional:** Fingerprint representa intenção.

**Status:** `DECIDIDO`

---

### DEC-421 — Canonical serialization

**Escolha aprovada:** `A`

**Decisão:** Usar serialização JSON canônica.

**Racional:** Ordem de propriedades não altera hash.

**Status:** `DECIDIDO`

---

### DEC-422 — Algoritmo

**Escolha aprovada:** `A`

**Decisão:** SHA-256.

**Racional:** Estável e colisão negligível.

**Status:** `DECIDIDO`

---

## Transaction IDs

### DEC-423 — Transaction vs command

**Escolha aprovada:** `A`

**Decisão:** IDs diferentes.

**Racional:** Command e transaction têm responsabilidades diferentes.

**Status:** `DECIDIDO`

---

### DEC-424 — Command sem transaction

**Escolha aprovada:** `A`

**Decisão:** Permitido.

**Racional:** Operações simples não precisam engine transacional.

**Status:** `DECIDIDO`

---

### DEC-425 — Múltiplas tx por command

**Escolha aprovada:** `A`

**Decisão:** Evitar no v1; uma transaction lógica pode ter várias operations.

**Racional:** Recovery mais simples.

**Status:** `DECIDIDO`

---

### DEC-426 — Prefixo

**Escolha aprovada:** `A`

**Decisão:** `tx_`.

**Racional:** Legibilidade.

**Status:** `DECIDIDO`

---

## Receipts

### DEC-427 — Receipt ID próprio

**Escolha aprovada:** `B`

**Decisão:** Não por padrão.

**Racional:** commandId/transactionId já identificam.

**Status:** `DECIDIDO`

---

### DEC-428 — IDs relacionados

**Escolha aprovada:** `A`

**Decisão:** Receipt inclui commandId e transactionId quando existe.

**Racional:** Rastreabilidade completa.

**Status:** `DECIDIDO`

---

## Error Contracts

### DEC-429 — Código estável

**Escolha aprovada:** `A`

**Decisão:** Todo erro público esperado tem code estável.

**Racional:** Consumers não parseiam message.

**Status:** `DECIDIDO`

---

### DEC-430 — Shape base

**Escolha aprovada:** `A`

**Decisão:** `code`, `message`, `details?`.

**Racional:** Contrato claro.

**Status:** `DECIDIDO`

---

### DEC-431 — Message estável

**Escolha aprovada:** `A`

**Decisão:** Não; code é estável, message pode mudar/traduzir.

**Racional:** i18n e melhorias sem quebra.

**Status:** `DECIDIDO`

---

### DEC-432 — Prefixo

**Escolha aprovada:** `A`

**Decisão:** Códigos Domain Manager usam `DM_*`.

**Racional:** Evita colisões.

**Status:** `DECIDIDO`

---

### DEC-433 — Provider errors

**Escolha aprovada:** `A`

**Decisão:** Adapter traduz quando cruza nosso contract.

**Racional:** Não expor erro arbitrário.

**Status:** `DECIDIDO`

---

### DEC-434 — Secrets em details

**Escolha aprovada:** `A`

**Decisão:** Nunca em resposta sanitizada.

**Racional:** Segurança.

**Status:** `DECIDIDO`

---

### DEC-435 — Warning vs error

**Escolha aprovada:** `A`

**Decisão:** Diferenciar.

**Racional:** Warnings não são falhas.

**Status:** `DECIDIDO`

---

## Result Contracts

### DEC-436 — Success/failure union

**Escolha aprovada:** `A`

**Decisão:** Boundaries usam result discriminado `ok`.

**Racional:** Socket/provider/API previsíveis.

**Status:** `DECIDIDO`

---

### DEC-437 — `ok` discriminante TS

**Escolha aprovada:** `A`

**Decisão:** Sim.

**Racional:** Narrowing seguro.

**Status:** `DECIDIDO`

---

### DEC-438 — Warnings em success

**Escolha aprovada:** `A`

**Decisão:** Warnings não tornam `ok=false`.

**Racional:** Permite sucesso com ressalvas.

**Status:** `DECIDIDO`

---

## Version Fields

### DEC-439 — Definition version

**Escolha aprovada:** `A`

**Decisão:** Definitions persistíveis/importáveis têm `version`.

**Racional:** Evolução controlada.

**Status:** `DECIDIDO`

---

### DEC-440 — Versão em toda registry entry

**Escolha aprovada:** `A`

**Decisão:** Só contracts/config schemas persistentes precisam.

**Racional:** Evita versionamento inútil.

**Status:** `DECIDIDO`

---

### DEC-441 — Formato

**Escolha aprovada:** `A`

**Decisão:** Inteiro.

**Racional:** Migration simples.

**Status:** `DECIDIDO`

---

## Provider Identity

### DEC-442 — providerId

**Escolha aprovada:** `A`

**Decisão:** Provider tem ID namespaced.

**Racional:** Identidade estável.

**Status:** `DECIDIDO`

---

### DEC-443 — Label rename

**Escolha aprovada:** `A`

**Decisão:** providerId não muda.

**Racional:** Label não é identidade.

**Status:** `DECIDIDO`

---

### DEC-444 — Contract support

**Escolha aprovada:** `A`

**Decisão:** Provider declara contract version suportada.

**Racional:** Compatibilidade explícita.

**Status:** `DECIDIDO`

---

### DEC-445 — Provenance

**Escolha aprovada:** `A`

**Decisão:** Context externo mostra source/provider quando relevante.

**Racional:** Single source of truth visível.

**Status:** `DECIDIDO`

---

## Registry Contracts

### DEC-446 — Duplicate ID

**Escolha aprovada:** `A`

**Decisão:** Recusar por padrão.

**Racional:** Nunca last-write-wins silencioso.

**Status:** `DECIDIDO`

---

### DEC-447 — Override

**Escolha aprovada:** `A`

**Decisão:** Sem override no v1.

**Racional:** Reduz conflitos entre addons.

**Status:** `DECIDIDO`

---

### DEC-448 — Freeze lifecycle

**Escolha aprovada:** `A`

**Decisão:** Registries estruturais congelam após `ready`.

**Racional:** Cache/lifecycle previsíveis.

**Status:** `DECIDIDO`

---

### DEC-449 — Late registration

**Escolha aprovada:** `A`

**Decisão:** Erro claro.

**Racional:** Nunca ignorar silenciosamente.

**Status:** `DECIDIDO`

---

### DEC-450 — API de registry

**Escolha aprovada:** `A`

**Decisão:** Expor `has/get/list`.

**Racional:** Encapsula Map interno.

**Status:** `DECIDIDO`

---

## Registry Metadata

### DEC-451 — Entry metadata

**Escolha aprovada:** `A`

**Decisão:** Entry pode ter id/label/description/sourceModuleId/version.

**Racional:** Diagnóstico/documentação.

**Status:** `DECIDIDO`

---

### DEC-452 — sourceModuleId

**Escolha aprovada:** `A`

**Decisão:** Registry preenche/valida quando possível.

**Racional:** Reduz spoofing.

**Status:** `DECIDIDO`

---

### DEC-453 — Localization key

**Escolha aprovada:** `A`

**Decisão:** Labels podem/preferem localization keys.

**Racional:** i18n.

**Status:** `DECIDIDO`

---

## Serialization

### DEC-454 — JSON-safe

**Escolha aprovada:** `A`

**Decisão:** Contracts persistidos/socket são JSON-safe.

**Racional:** Previsibilidade.

**Status:** `DECIDIDO`

---

### DEC-455 — undefined

**Escolha aprovada:** `A`

**Decisão:** Evitar em payload persistido.

**Racional:** Ausência/null têm semântica definida.

**Status:** `DECIDIDO`

---

### DEC-456 — null vs missing

**Escolha aprovada:** `A`

**Decisão:** Diferenciar quando contract define.

**Racional:** Schema explícito.

**Status:** `DECIDIDO`

---

### DEC-457 — BigInt direto

**Escolha aprovada:** `A`

**Decisão:** Não usar em JSON contracts.

**Racional:** Não serializa nativamente.

**Status:** `DECIDIDO`

---

### DEC-458 — Integers econômicos

**Escolha aprovada:** `A`

**Decisão:** Usar safe integer `number` inicialmente, com validação.

**Racional:** Simplicidade sem floats fracionários.

**Status:** `DECIDIDO`

---

## DTO Clone/Freeze

### DEC-459 — Clone

**Escolha aprovada:** `A`

**Decisão:** Clonar DTO antes de sair.

**Racional:** Evita aliasing interno.

**Status:** `DECIDIDO`

---

### DEC-460 — Freeze dev

**Escolha aprovada:** `A`

**Decisão:** Freeze em dev/test quando útil.

**Racional:** Detecta mutação indevida.

**Status:** `DECIDIDO`

---

### DEC-461 — Deep freeze prod

**Escolha aprovada:** `B`

**Decisão:** Não obrigatório.

**Racional:** Evita custo desnecessário.

**Status:** `DECIDIDO`

---

## Audit Identity

### DEC-462 — Executor ID

**Escolha aprovada:** `A`

**Decisão:** Guardar userId real.

**Racional:** Autoridade/audit.

**Status:** `DECIDIDO`

---

### DEC-463 — userName snapshot

**Escolha aprovada:** `A`

**Decisão:** Permitido.

**Racional:** Histórico permanece legível após usuário sumir.

**Status:** `DECIDIDO`

---

### DEC-464 — Snapshot como authority

**Escolha aprovada:** `A`

**Decisão:** Não.

**Racional:** userId/sender continua autoridade.

**Status:** `DECIDIDO`

---

## Operation Source

### DEC-465 — Source discriminada

**Escolha aprovada:** `A`

**Decisão:** Auditável operation tem source técnico tipado.

**Racional:** Liga user/tick/project/event/provider/migration.

**Status:** `DECIDIDO`

---

### DEC-466 — Reason separado

**Escolha aprovada:** `A`

**Decisão:** Reason humano separado de source técnico.

**Racional:** Provenance e UX coexistem.

**Status:** `DECIDIDO`

---

### DEC-467 — Reason em manual sensitive adjustment

**Escolha aprovada:** `A`

**Decisão:** Obrigatório onde policy exigir, especialmente Economy.

**Racional:** Mudança sensível precisa explicação.

**Status:** `DECIDIDO`

---

## Correlation

### DEC-468 — correlationId

**Escolha aprovada:** `A`

**Decisão:** Cadeias de operações têm correlationId.

**Racional:** Diagnostics reconstrói saga.

**Status:** `DECIDIDO`

---

### DEC-469 — Default

**Escolha aprovada:** `A`

**Decisão:** Pode usar commandId inicial como correlationId.

**Racional:** Reduz IDs extras.

**Status:** `DECIDIDO`

---

### DEC-470 — Sub-operações

**Escolha aprovada:** `A`

**Decisão:** Mantêm correlationId.

**Racional:** Agrupamento completo.

**Status:** `DECIDIDO`

---

## Causation

### DEC-471 — causationId

**Escolha aprovada:** `A`

**Decisão:** Ter causation para audit complexo.

**Racional:** Aponta pai imediato.

**Status:** `DECIDIDO`

---

### DEC-472 — Correlation vs causation

**Escolha aprovada:** `A`

**Decisão:** São distintos.

**Racional:** Um agrupa saga; outro modela causalidade direta.

**Status:** `DECIDIDO`

---

## Import Reference Remapping

### DEC-473 — Old→new map

**Escolha aprovada:** `A`

**Decisão:** Construir tabela de remapeamento.

**Racional:** Nunca por nome.

**Status:** `DECIDIDO`

---

### DEC-474 — IDs internos

**Escolha aprovada:** `A`

**Decisão:** Remapear também quando necessário.

**Racional:** Coerência de pacote importado.

**Status:** `DECIDIDO`

---

### DEC-475 — External refs

**Escolha aprovada:** `A`

**Decisão:** Preservar mesmo unresolved.

**Racional:** Não apagar contexto externo.

**Status:** `DECIDIDO`

---

### DEC-476 — Import report

**Escolha aprovada:** `A`

**Decisão:** Listar unresolved refs.

**Racional:** GM sabe o que reparar.

**Status:** `DECIDIDO`

---

## Export Format

### DEC-477 — Versão própria

**Escolha aprovada:** `A`

**Decisão:** `exportFormatVersion` separado de schema.

**Racional:** Formato de pacote evolui independentemente.

**Status:** `DECIDIDO`

---

### DEC-478 — Campo explícito

**Escolha aprovada:** `A`

**Decisão:** Usar `exportFormatVersion: 1`.

**Racional:** Compatibilidade.

**Status:** `DECIDIDO`

---

### DEC-479 — Producer

**Escolha aprovada:** `A`

**Decisão:** Export identifica produtor e versão.

**Racional:** Provenance.

**Status:** `DECIDIDO`

---

### DEC-480 — ProducerVersion como authority

**Escolha aprovada:** `A`

**Decisão:** Não decide compatibilidade sozinho.

**Racional:** Schema/contracts são autoridade.

**Status:** `DECIDIDO`

---

## Contract Discovery

### DEC-481 — Mapa de contracts

**Escolha aprovada:** `A`

**Decisão:** API expõe contracts suportados.

**Racional:** Feature detection.

**Status:** `DECIDIDO`

---

### DEC-482 — Capabilities técnicas

**Escolha aprovada:** `A`

**Decisão:** API expõe disponibilidade técnica.

**Racional:** Evita try/catch como discovery.

**Status:** `DECIDIDO`

---

### DEC-483 — Consumer strategy

**Escolha aprovada:** `A`

**Decisão:** Detectar capabilities/contracts, não comparar package version.

**Racional:** Integrações resilientes.

**Status:** `DECIDIDO`

---

## Deprecation

### DEC-484 — Alias temporário pós-1.0

**Escolha aprovada:** `A`

**Decisão:** Manter quando custo razoável.

**Racional:** Compatibilidade gradual.

**Status:** `DECIDIDO`

---

### DEC-485 — Dev warning

**Escolha aprovada:** `A`

**Decisão:** Emitir warning.

**Racional:** Facilita migração.

**Status:** `DECIDIDO`

---

### DEC-486 — Removal version

**Escolha aprovada:** `A`

**Decisão:** Documentar versão prevista pós-1.0.

**Racional:** Contrato claro.

**Status:** `DECIDIDO`

---

## Identifier Privacy

### DEC-487 — userId em DTO comum

**Escolha aprovada:** `A`

**Decisão:** Evitar quando não necessário.

**Racional:** Minimização de metadata.

**Status:** `DECIDIDO`

---

### DEC-488 — Domain UUID público

**Escolha aprovada:** `A`

**Decisão:** Pode ser público quando Domain é visível.

**Racional:** Links/references legítimas.

**Status:** `DECIDIDO`

---

### DEC-489 — Secret relation IDs

**Escolha aprovada:** `A`

**Decisão:** Não enviar.

**Racional:** Nem existência deve vazar.

**Status:** `DECIDIDO`

---

## Stable Ordering

### DEC-490 — Arrays sem ordem semântica

**Escolha aprovada:** `A`

**Decisão:** Enviar deterministicamente quando razoável.

**Racional:** Testes/diff/cache.

**Status:** `DECIDIDO`

---

### DEC-491 — Registry canonical order

**Escolha aprovada:** `A`

**Decisão:** Ordenar por ID para export/internal deterministic output.

**Racional:** UI pode ordenar por label.

**Status:** `DECIDIDO`

---

### DEC-492 — History ordering

**Escolha aprovada:** `A`

**Decisão:** Cronológico/sequence.

**Racional:** Nunca alfabético.

**Status:** `DECIDIDO`

---

## Equality Semantics

### DEC-493 — DocumentRef equality

**Escolha aprovada:** `A`

**Decisão:** Igualdade pelo UUID canonicalizado.

**Racional:** Snapshot não altera identidade.

**Status:** `DECIDIDO`

---

### DEC-494 — Definition equality

**Escolha aprovada:** `A`

**Decisão:** ID namespaced canonicalizado.

**Racional:** Label não conta.

**Status:** `DECIDIDO`

---

### DEC-495 — Command equality

**Escolha aprovada:** `A`

**Decisão:** commandId identifica; fingerprint confirma intenção.

**Racional:** Funções distintas.

**Status:** `DECIDIDO`

---

## TypeScript Branding

### DEC-496 — Branded types

**Escolha aprovada:** `A`

**Decisão:** Usar em contracts críticos.

**Racional:** Evita trocar IDs incompatíveis.

**Status:** `DECIDIDO`

---

### DEC-497 — Brand em tudo

**Escolha aprovada:** `B`

**Decisão:** Somente boundaries importantes.

**Racional:** Evita typing excessivo.

**Status:** `DECIDIDO`

---

### DEC-498 — Runtime validation

**Escolha aprovada:** `A`

**Decisão:** Continua obrigatória.

**Racional:** TS não existe em runtime.

**Status:** `DECIDIDO`

---

## Common Validators

### DEC-499 — Centralização

**Escolha aprovada:** `A`

**Decisão:** Validators centrais para IDs/UUIDs/namespaces/versions.

**Racional:** Sem divergência entre subsystems.

**Status:** `DECIDIDO`

---

### DEC-500 — Resultado estruturado

**Escolha aprovada:** `A`

**Decisão:** Quando diagnóstico importa, retornar details/code.

**Racional:** Melhor UX e logging.

**Status:** `DECIDIDO`

---

### DEC-501 — Normalizer vs validator

**Escolha aprovada:** `A`

**Decisão:** Separar.

**Racional:** Normalização não deve mascarar invalid input.

**Status:** `DECIDIDO`

---

## Logging Identity

### DEC-502 — IDs em logs

**Escolha aprovada:** `A`

**Decisão:** Incluir IDs técnicos relevantes.

**Racional:** Diagnóstico preciso.

**Status:** `DECIDIDO`

---

### DEC-503 — Payload sensível

**Escolha aprovada:** `A`

**Decisão:** Evitar log integral.

**Racional:** Segurança/minimização.

**Status:** `DECIDIDO`

---

### DEC-504 — Command/tx/correlation

**Escolha aprovada:** `A`

**Decisão:** Incluir quando disponíveis.

**Racional:** Conecta logs e audit.

**Status:** `DECIDIDO`

---

## Central Shared Contracts

### DEC-505 — Pasta central

**Escolha aprovada:** `A`

**Decisão:** Contracts compartilhados ficam centralizados.

**Racional:** Evita duplicação.

**Status:** `DECIDIDO`

---

### DEC-506 — Especialização

**Escolha aprovada:** `A`

**Decisão:** Subsystems podem especializar sem contradizer.

**Racional:** Coerência global.

**Status:** `DECIDIDO`

---

### DEC-507 — Estabilidade pública

**Escolha aprovada:** `A`

**Decisão:** IDs/refs públicos entram na API estável.

**Racional:** Consumers dependem deles.

**Status:** `DECIDIDO`

---

### DEC-508 — Quebras em 0.x

**Escolha aprovada:** `A`

**Decisão:** Podem ocorrer com documentação.

**Racional:** Pré-1.0 continua fase de correção.

**Status:** `DECIDIDO`

---

## Princípio de Complexidade

### DEC-509 — Implementar tudo já

**Escolha aprovada:** `B`

**Decisão:** Congelar design, implementar apenas tipos necessários por gate.

**Racional:** Evita dezenas de classes vazias.

**Status:** `DECIDIDO`

---

### DEC-510 — Design ahead / implement just-in-time

**Escolha aprovada:** `A`

**Decisão:** Projetar o suficiente para evitar contradições; implementar conforme gate.

**Racional:** Evita overengineering e repetição do projeto anterior.

**Status:** `DECIDIDO`

---

# 4. Invariantes produzidas por esta rodada

1. `id` local e `uuid` Foundry nunca são tratados como sinônimos.
2. Nome/label nunca é identidade.
3. Registry ID funcional é canonical e namespaced.
4. Runtime ID não depende de slug ou nome.
5. Prefixos de runtime fazem parte da validação formal.
6. UUID resolution prefere o mecanismo nativo Foundry.
7. Broken reference não é automaticamente data loss.
8. Audit ordering não depende de IDs aleatórios.
9. Real time não substitui world time e vice-versa.
10. Package version não substitui contract version.
11. Storage schema não substitui public contract version.
12. DTO público não compartilha referência mutável com storage.
13. Secret omitido é preferível a secret mascarado.
14. commandId define a operação; fingerprint valida a intenção.
15. Transaction não é Command.
16. Receipt não precisa de identidade redundante sem necessidade.
17. Error code é contrato; message é apresentação.
18. Registry duplicate não usa last-write-wins.
19. JSON contracts não carregam BigInt/classes/Map/Set.
20. Audit source técnico e reason humano são distintos.
21. Correlation agrupa a cadeia; causation aponta o pai imediato.
22. Import remapeia por identidade, nunca por nome.
23. Feature detection usa contracts/capabilities.
24. Design congelado não implica implementação antecipada.

---

# 5. Estrutura de código indicada

```text
scripts/core/
├── contracts/
│   ├── public-result.ts
│   ├── audit-context.ts
│   └── versions.ts
├── ids/
│   ├── brands.ts
│   ├── generators.ts
│   ├── canonicalize.ts
│   └── prefixes.ts
├── refs/
│   ├── document-ref.ts
│   ├── resolver.ts
│   └── repair.ts
├── errors/
│   ├── codes.ts
│   ├── domain-error.ts
│   └── sanitize-error.ts
├── serialization/
│   ├── canonical-json.ts
│   ├── clone.ts
│   └── validators.ts
└── registry/
    ├── registry.ts
    ├── registry-entry.ts
    └── lifecycle.ts

```

> Esta árvore é orientação arquitetural, não ordem para implementar todos os arquivos no T0.

---

# 6. Próxima rodada

A próxima rodada deve fechar **Primary Authority, Command Bus, MutationCoordinator e protocolo multiplayer**, incluindo:

- eleição/resolução da autoridade;
- transporte player→GM;
- envelope exato de Command;
- autenticação do sender;
- permission validation;
- expectedRevision;
- dedupe e replay;
- lock keys e lock ordering;
- fresh reads;
- plan/build/validate;
- claim/prepare;
- commit;
- compensation;
- recovery;
- retries/timeouts;
- authority disconnect/failover;
- transaction records;
- public receipts;
- audit e Diagnostics.
````

---

# ANEXO 04 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_04_AUTHORITY_COMMANDS_511-890.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 04
## Primary Authority, Command Bus, MutationCoordinator e Multiplayer — Decisões 511–890

> **Status:** APROVADO.
>
> O usuário aprovou em bloco todas as opções marcadas como **RECOMENDADO** nas decisões 511–890.
>
> Este documento consolida a Rodada 04 como especificação autossuficiente. Se qualquer decisão for reaberta no futuro, a alteração deve ser registrada explicitamente; nada aqui deve ser mudado silenciosamente.

---

# 0. Objetivo da rodada

A Rodada 04 congela a arquitetura oficial de mutações autoritativas e multiplayer do Domain Manager.

A pipeline aprovada é:

```text
CLIENT
│
├─ UI / Action
├─ Command Factory
│  ├─ commandId
│  ├─ command type
│  ├─ expected revision quando aplicável
│  └─ payload declarativo
│
└─ CommandTransport
       │
       ▼
PRIMARY AUTHORITY
│
├─ autentica sender real
├─ valida contract/payload
├─ aplica rate limit defensivo
├─ verifica dedupe/fingerprint
├─ resolve handler
├─ valida permissions
├─ calcula lock keys
├─ entra na queue
├─ adquire ordered multi-key locks
├─ executa fresh reads
├─ verifica revisions
├─ constrói Plan
├─ valida Plan
│
├─ SIMPLE MUTATION
│  ├─ write
│  ├─ incrementa revision quando aplicável
│  └─ audit
│
└─ TRANSACTIONAL MUTATION
   ├─ durable claim
   ├─ prepare/recovery data
   ├─ committing
   ├─ checkpoints
   ├─ provider/internal writes
   ├─ commit
   │
   ├─ sucesso → Receipt
   │
   └─ falha
   │     ├─ reconcile
   │     ├─ compensate quando seguro
   │     └─ needs-recovery
   │
   └─ RecoveryService / Operations
```

Depois do commit:

```text
persisted truth
    ↓
public hooks pequenos com refs/revisions
    ↓
clients refetch sanitized contexts
```

---

# 1. Primary Authority — DEC-511–520

- Existe **uma Primary Authority global por mundo** em determinado momento.
- Outros GMs continuam usando a UI normalmente; authority é função técnica de execução, não restrição de UX.
- Mutações operacionais importantes de GM também passam pelo Command Bus.
- Updates puramente visuais ou Foundry-native simples podem usar caminho local quando explicitamente classificados.
- Cada action/handler declara seu `mutationMode`, em vez de a UI decidir informalmente.
- `DomainService` só usa `actor.update()` diretamente para operações explicitamente document-local.
- Primary Authority não é exclusiva de Economy; é infraestrutura compartilhada por hierarchy, projects, requests, ticks, relations etc.
- Reads normais não precisam round-trip para a authority; somente casos que exigem segredo ou leitura authoritative especial.
- Ser GM não substitui a validação de qual executor é a authority atual.
- Existe serviço explícito `PrimaryAuthorityService`.

Contrato conceitual:

```ts
interface PrimaryAuthorityService {
  getCurrent(): User | null;
  isCurrentUser(): boolean;
  resolve(): User | null;
  onChanged(callback: () => void): () => void;
}
```

---

# 2. Eleição da authority — DEC-521–530

- Pode haver GM preferencial configurado.
- Preferência vive em world setting por `userId`.
- Se preferido estiver offline, existe fallback automático.
- Fallback é determinístico, com ordenação explícita dos GMs ativos por User ID.
- Nunca depender de order incidental da collection.
- Todos os clientes precisam chegar à mesma escolha.
- Existe `authorityEpoch`.
- Epoch é persistido de forma leve.
- Mudança manual de primary GM incrementa epoch.
- Failover automático também incrementa epoch.

Regra:

```text
preferred GM online?
  yes → preferred
  no  → deterministic active-GM fallback
```

---

# 3. Lifecycle da authority — DEC-531–540

- Authority é resolvida quando o mundo está pronto (`ready`), não em `init`.
- Conexão/desconexão de GM dispara recálculo.
- Se o GM preferido volta, reassume automaticamente no modelo inicial.
- Troca de authority não “continua” uma call stack antiga em memória.
- Disconnect durante commit produz estado potencialmente incerto; nunca presumir que nada ocorreu.
- Nova authority executa startup recovery.
- Recovery bloqueia somente as entidades/lock keys afetadas, não o mundo inteiro.
- Diagnostics mostra Primary Authority, epoch e recoveries pendentes.
- Ausência de authority gera alerta para GM.
- Player precisa saber apenas disponibilidade da authority, não necessariamente seu nome.

---

# 4. Transporte / Socket — DEC-541–552

- Existe um canal/protocolo central para Commands.
- Transporte é abstraído atrás de `CommandTransport`.
- Socketlib pode ser implementação, mas business logic não importa socketlib diretamente.
- Client envia request/response diretamente à Primary Authority; não usa broadcast-first mutation.
- Broadcast pode existir para notificações pós-commit.
- Broadcast nunca é confirmação autoritativa de commit.
- Payloads de socket são pequenos.
- Client não envia Actor inteiro como state authoritative.
- Payload é JSON-safe.
- Commands possuem timeout.
- Timeout **não significa automaticamente falha**; significa outcome desconhecido até status/dedupe/reconciliation.

---

# 5. Command Envelope — DEC-553–564

Base aprovada:

```ts
interface DomainCommand<TPayload> {
  contractVersion: number;
  commandId: CommandId;
  type: string;
  expectedRevision?: number;
  targetRefs: readonly string[];
  payload: TPayload;
  issuedAtReal: number;
  authorityEpoch: number;
  reason?: string;
}
```

- `type` é namespaced.
- Handler é resolvido por registry, não switch gigante.
- `targetRefs` ajuda permission/diagnostics, mas não substitui lock keys.
- `issuedAtReal` é diagnóstico, não authority de ordering.
- Client worldTime é no máximo informativo; authority lê state atual quando necessário.
- Command carrega epoch conhecido.
- Epoch antigo não implica rejeição automática se o command continuar seguro e não processado.
- Payload não pode conter função/macro executável.
- `reason` humano pode existir, mas não substitui provenance/audit source.

---

# 6. Sender autenticado — DEC-565–572

- `payload.userId` nunca define executor.
- Sender vem do transport/socket real.
- Divergência entre claimed user e sender real é rejeitada/logada.
- Command público não precisa carregar `userId`.
- Internamente existe `AuthenticatedCommandContext`.
- Handler não pode sobrescrever sender.
- Commands gerados pela própria authority também recebem contexto autenticado.
- Tick/automation não “finge ser User”; usa source técnico apropriado.

Exemplo:

```ts
interface AuthenticatedCommandContext<T> {
  command: DomainCommand<T>;
  senderUserId: string | null;
  authorityUserId: string;
  authorityEpoch: number;
  receivedAtReal: number;
  source: OperationSource;
}
```

---

# 7. Permissions — DEC-573–582

- Permission validation pode ter duas fases:
  1. static permission;
  2. fresh-state permission.
- UI hiding nunca é segurança.
- Authority sempre valida.
- GM não bypassa regra de negócio silenciosamente.
- Overrides existem quando explicitamente permitidos.
- Override importante exige audit.
- Permission denial retorna código estruturado.
- Permission failure e validation failure são categorias distintas.
- Detalhes enviados ao player são sanitizados.

---

# 8. Expected Revision — DEC-583–592

- Commands relevantes podem carregar `expectedRevision`.
- Nem todo command precisa global revision.
- Form save usa revision do momento em que abriu/carregou.
- Revision mismatch bloqueia por default.
- Handler pode declarar operação append-safe/commutative que aceita stale revision.
- Essa policy pertence ao handler, não ao Command Bus genérico.
- Conflict retorna current revision quando seguro.
- Client deve refetch, não receber snapshot bruto completo automaticamente.
- Auto-merge complexo não entra no v1.
- UI pode oferecer refresh/reapply futuramente.

---

# 9. Dedupe / Replay — DEC-593–602

- Dedupe acontece antes da execução.
- Primeiro nível pode ser LRU em memória.
- Operações críticas consultam também storage durável.
- Handler declara se durable dedupe é exigido.
- Mesmo `commandId` + mesmo fingerprint retorna resultado anterior.
- Mesmo `commandId` + fingerprint diferente é rejeitado.
- Existe erro específico `DM_COMMAND_ID_REUSE_MISMATCH`.
- Dedupe pode armazenar receipt/result sanitizado suficiente; não precisa preservar objeto bruto eterno.
- Dedupe tem retention policy.
- Transactions unresolved nunca entram em GC normal.

---

# 10. Lock Keys — DEC-603–612

- Handler declara `getLockKeys(command)`.
- Keys são strings namespaced.
- Keys são canonicalizadas e deduplicadas.
- Locks são adquiridos em ordem determinística.
- Ordenação lexical canonical é válida.
- Economy pode usar account/provider locks específicos, não só Domain lock.
- Começar conservador; não granularidade extrema prematura.
- Lock set deve ser conhecido antes do stateful commit.
- Se provider target precisa ser resolvido para descobrir lock, isso é feito read-only antes da aquisição final.

Exemplos:

```text
domain:Actor.X
project:prj_X
resource-account:Actor.X:domain-manager:fuel
provider:item-piles:Actor.Y
```

---

# 11. Lock Manager — DEC-613–620

- Existe LockManager central.
- Locks vivem somente na Primary Authority no v1.
- Client não possui authority lock.
- Locks têm timeout/watchdog, mas nunca são liberados cegamente enquanto commit ainda executa.
- Ownership liga lock a command/transaction.
- Reentrant lock pode existir no mesmo transaction context.
- UI não implementa lock; recebe estados como busy/processing.

---

# 12. Fresh Reads — DEC-621–628

- Depois de adquirir locks, authority lê estado fresco.
- Fresh read acontece antes de buildPlan.
- Derived values do client nunca são authoritative.
- Client envia intenção/seleção, não preço/custo final.
- Authority recalcula costs/availability.
- Fresh reads podem consultar providers externos.
- Provider necessário indisponível → fail-closed.
- Plan pode registrar read set/revisions usados.

---

# 13. Plans — DEC-629–640

- Mutação complexa produz Plan antes de commit.
- Mutação simples não precisa Transaction/Plan pesado.
- Handler declara se usa Plan.
- Plan é imutável após validação.
- Plan não precisa ID próprio.
- Transactional Plan possui `writeSet`.
- Plan suporta warnings e blockers.
- Blocker impede commit salvo override explicitamente autorizado.
- Public preview é sanitizado.
- Plan bruto interno pode conter dados secretos/recovery data.
- Se locks continuam válidos, commit não precisa recalcular o Plan uma segunda vez.

---

# 14. Preview vs Commit — DEC-641–648

- UI pode pedir preview.
- Preview não segura locks por longo tempo.
- Preview não congela o mundo.
- Confirm gera fresh Plan novamente.
- Mudança material pode exigir nova confirmação.
- Materialidade é definida pelo handler/policy.
- Preview pode possuir fingerprint/hash.
- Preview não cria Transaction.

---

# 15. Quando usar TransactionRecord — DEC-649–654

- Nem toda mutation precisa TransactionRecord.
- Rename simples pode ser Command + audit.
- Economy transfer exige TransactionRecord.
- Project completion que altera Economy + Facility exige TransactionRecord.
- Reparent simples normalmente não precisa TransactionRecord.
- Handler declara `transactional: true|false`.

---

# 16. Transaction Lifecycle — DEC-655–660

Estados-base:

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

- `failed` significa que sabemos que nenhum efeito relevante ficou pendente.
- `needs-recovery` é estado distinto.
- `compensated` significa invariantes restauradas de forma aceitável; não necessariamente rollback temporal perfeito.
- Transições são validadas.
- Record atual pode atualizar state, enquanto audit/history preserva transições.

---

# 17. Claim / Prepare — DEC-661–668

- Operações externas arriscadas criam claim/prepare durável.
- Claim registra que a operação começou.
- Prepare guarda informação suficiente para recovery.
- Não precisa snapshot completo de Actors se refs/snapshots mínimos bastarem.
- Recovery snapshots são GM-only.
- Prepare deve persistir antes do primeiro irreversible write.
- Se Prepare não pode ser persistido, operação aborta.
- Operação interna realmente segura não precisa prepare pesado.

---

# 18. Commit Ordering — DEC-669–676

- Ordem de writes vem do handler/Plan.
- Não existe regra universal “external first” ou “internal first”.
- Provider pode exigir revalidation imediata.
- Checkpoints podem ser gravados em boundaries de risco.
- Não gravar checkpoint world-wide após toda micro-operação.
- Preferir batch APIs quando úteis, sem presumir atomicidade inexistente.
- Final persistence/committed acontece antes de montar Receipt.

---

# 19. Compensation — DEC-677–680

- Handler transactional declara compensation strategy quando aplicável.
- Compensation automática somente quando strategy é considerada segura.
- Falha de compensation → `needs-recovery`.
- Compensation produz audit próprio; nunca apaga o histórico original.

---

# 20. Recovery — DEC-681–696

- Existe `RecoveryService`.
- Recovery opera sobre TransactionRecord durável.
- Recovery é idempotente.
- Cada tentativa pode ter `recoveryAttemptId`.
- Recovery pode mover a transaction original por transitions válidas.
- Pode criar transaction auxiliar quando necessário.
- Original e auxiliar compartilham correlation.
- Auto-recovery só quando seguro.
- Casos incertos viram pendência de GM.
- Operations possui fila de recoveries.
- Recoveries pendentes bloqueiam lock keys afetadas.
- Não bloqueiam Domains independentes.
- GM pode marcar caso resolvido manualmente com reason/audit.
- Resolver não apaga TransactionRecord.
- Após recovery, invariantes são verificadas.
- Se invariantes falham, permanece `needs-recovery`.

---

# 21. Provider Failures — DEC-697–710

Providers declaram capabilities transacionais:

```ts
interface ProviderCapabilities {
  supportsPrepare: boolean;
  supportsCommit: boolean;
  supportsCompensation: boolean;
  supportsIdempotency: boolean;
  supportsReconciliation?: boolean;
}
```

- Provider sem compensation ainda pode participar, com risk-aware strategy.
- Adapter pode adicionar replay guard.
- Provider informa retry-safety.
- Timeout não prova que operação não executou.
- Outcome incerto usa `needs-recovery` com reason/substatus.
- Adapter pode oferecer reconciliation.
- Reconciliation vem antes de compensation quando outcome é desconhecido.
- Provider pode ser authoritative source.
- Provider authoritative vence cache; divergência gera reconciliation.
- UI pode mostrar last-known state stale quando seguro.
- Stale state não autoriza mutation normalmente.
- Provider health aparece em Diagnostics.

---

# 22. Timeout / Retry — DEC-711–723

- Client distingue timeout de failure.
- Existe status query por commandId.
- Estados de status podem incluir:
  `unknown`, `received`, `processing`, `completed`, `failed`, `needs-recovery`.
- Status endpoint é read-only.
- Transporte pode retry automaticamente com mesmo commandId.
- Retries são limitados.
- Usam backoff e jitter.
- Ao esgotar, UI mostra outcome desconhecido e permite status/manual retry.
- Nunca gerar novo commandId automaticamente enquanto outcome é incerto.
- Depois de falha comprovada sem side effects, uma nova tentativa deliberada pode gerar novo commandId.
- Timeout pode variar por handler dentro de limites.
- UI timeout e transaction timeout não precisam ser iguais.

---

# 23. Authority Failover During Commands — DEC-724–731

- Nova authority só retoma o que possui estado durável suficiente.
- Command simples perdido sem durable evidence vira outcome desconhecido conforme evidência.
- Commands simples devem minimizar janela validation→write.
- Prepared transaction é retomável via recovery.
- `committing` após failover vira `needs-recovery` até reconciliation.
- Nova authority reconstrói bloqueios lógicos de unresolved transactions.
- TransactionRecord guarda authority epoch original.
- Recovery pode terminar em epoch posterior, com audit.

---

# 24. Receipts — DEC-732–744

- Toda authoritative mutation concluída retorna Receipt.
- Receipt representa resultado; não é source of truth.
- Receipt é imutável.
- Inclui commandId.
- Inclui transactionId quando houver.
- Inclui correlationId quando houver.
- Inclui revisions resultantes quando relevante.
- Public Receipt não expõe internal write/recovery data.
- Pode existir receipt administrativo mais rico.
- Inclui warnings.
- Pode incluir human/localizable summary.
- Pode alimentar toast/UI.
- Entidades importantes ainda são refetched após commit.

---

# 25. Audit — DEC-745–758

- Audit é separado de console log.
- Commands mutáveis relevantes geram AuditEntry.
- Reads não são auditados normalmente, salvo acesso sensível.
- Audit não guarda payload completo por default; usa summary/redaction/fingerprint.
- Inclui command/transaction/correlation/causation quando houver.
- Inclui executor.
- Distingue `requestedBy` de `executedByAuthority`.
- Automation pode ter requestedBy null/system; não atribuir falsamente ao GM.
- AuditEntry pode ter severity/category.
- Categorias base: domain, hierarchy, economy, project, relation, request, time, system, recovery.
- Audit é append-oriented.
- Correção vira annotation/correction.
- Retention pode ser configurável futuramente.
- Audit não cresce indefinidamente dentro do Actor; usa store/repository separado.

---

# 26. Cancellation — DEC-759–765

- Command aguardando/planning pode ser cancelável.
- Commit já iniciado não é cancelado livremente; depois do boundary usa compensation/recovery.
- Cancellation possui result/receipt.
- Policy decide quem pode cancelar; GM pode ter capacidade administrativa.
- Cancellation request é autenticada.
- Preview não precisa backend cancellation porque não mantém mutation.

---

# 27. Batch Commands — DEC-766–772

- Contract pode ser definido antes da implementação.
- Distinguir independent batch de atomic group.
- Independent batch pode ter sucesso parcial.
- Atomic group exige transaction coordenada.
- Saga/atomic-group genérico não entra cedo; handlers cross-service específicos bastam inicialmente.
- Batch receipt contém resultado por item.
- Batch possui commandId próprio quando implementado.

---

# 28. No-op Detection — DEC-773–778

- Handlers detectam no-op.
- No-op não incrementa revision.
- Audit de no-op apenas quando sensível/útil.
- Receipt pode retornar `changed=false`.
- Economy +0 não cria LedgerEntry.
- Detectar no-op antes de transaction pesada quando possível.

---

# 29. Error Taxonomy — DEC-779–786

Categorias:

```text
validation
permission
conflict
not-found
busy
provider
timeout
integrity
recovery
internal
```

- Error informa `retryable` quando conhecido.
- Pode informar `userActionRequired`.
- Player recebe erro sanitizado + reference/correlation id para falhas internas.
- GM Diagnostics pode ver stack apropriada.
- Stack não precisa virar AuditEntry permanente.
- `DM_INTERNAL_ERROR` pode ter error reference ID.

---

# 30. Rate Limiting / Abuse — DEC-787–793

- Command Bus possui rate limiting defensivo.
- Limite por user.
- Command types podem ter limites distintos.
- GM não fica totalmente sem proteção contra loops.
- Excesso retorna erro específico.
- Não é sistema de ban/kick.
- Invalid-command spam aparece agregadamente em Diagnostics.

---

# 31. Command Queue — DEC-794–802

- Authority possui queue explícita.
- Queue não é serial global obrigatoriamente.
- Commands independentes podem paralelizar via lock sets.
- Começar conservador e ampliar com testes.
- Scheduler conhece lock keys.
- Command esperando lock pode ser cancelado.
- FIFO por default, com prioridade para recovery/system-critical.
- Player não escolhe priority.
- Priority vem da policy/source.
- Scheduler evita starvation.

---

# 32. CommandBus vs MutationCoordinator — DEC-803–807

Separação oficial:

```text
CommandBus
├─ transport boundary
├─ authentication
├─ runtime contract validation
├─ rate limit
├─ dedupe
├─ handler lookup
└─ public result

MutationCoordinator
├─ lock planning
├─ lock acquisition
├─ fresh reads
├─ Plan
├─ Transaction lifecycle
├─ commit
├─ compensation
└─ recovery integration
```

- Handler simples pode não usar MutationCoordinator.
- Handler transacional obrigatoriamente usa MutationCoordinator.
- Services comuns preferem use cases/command handlers, não coordinator arbitrário.
- Migration pode ter caminho administrativo próprio.

---

# 33. Hooks / Notifications — DEC-808–813

- Commit pode emitir hook/event público.
- Hook carrega refs/IDs/revisions, não objeto completo.
- Emitir só após persistence confirmed.
- Consumer failure não desfaz commit.
- Consumer errors são isolados/logados.
- Internal orchestration events e public hooks são buses/contracts separados.

---

# 34. Diagnostics — DEC-814–826

Painel GM próprio mostra:

- Primary Authority;
- authority epoch;
- queue;
- active locks;
- pending transactions/recoveries;
- provider health;
- registry conflicts;
- unknown IDs;
- broken refs.

Também:

- Player não abre Diagnostics completo.
- Diagnostics pode oferecer repair actions.
- Repair actions usam authority/audit.
- Futuramente pode exportar diagnostics report.

---

# 35. Startup Recovery — DEC-827–834

- Primary Authority faz startup scan.
- Scan procura Transactions não finais.
- Finais: `committed`, `compensated`, `failed`.
- `needs-recovery` não é final.
- Auto-recovery só para records marcados safe-auto-recovery.
- Pendências manuais aparecem em Operations.
- Locks conflitantes são bloqueados durante scan.
- Áreas independentes continuam operacionais.
- TransactionStore corrompido coloca áreas afetadas em safe mode com alerta crítico.

---

# 36. Transaction Retention — DEC-835–838

- Committed transactions não precisam ficar detalhadas para sempre.
- Retention/archive policy pode compactá-las.
- Audit summary pode sobreviver ao detalhe técnico.
- Unresolved transactions nunca são apagadas automaticamente.
- Recovery snapshots sensíveis podem ter retenção menor após resolução.

---

# 37. Security Boundaries — DEC-839–844

- Client pode informar command `type`, mas somente handlers `public-callable` podem ser invocados por socket.
- Existem internal-only handlers.
- Internal-only via socket é rejeitado mesmo se caller for GM.
- Runtime schema validation acontece antes do handler.
- Unknown fields seguem policy; Commands sensíveis preferem strict schema.
- Payload size possui limite defensivo.

---

# 38. Testes obrigatórios da Authority — DEC-845–858

Devem existir testes para:

- mesmo commandId simultâneo;
- mesmo commandId + payload diferente;
- dois GMs ativos;
- primary GM cair antes do commit;
- primary GM cair depois do primeiro write;
- provider aplicar write mas retornar timeout;
- compensation falhar;
- revision mudar entre preview e confirm;
- player falsificar userId;
- player tentar internal-only command;
- capability/provider desconhecido;
- lock order invertido;
- startup com transaction antiga em `committing`;
- recovery executada duas vezes.

---

# 39. Performance Tests — DEC-859–863

Testar:

- centenas de commands independentes;
- contention no mesmo Domain;
- Domains independentes em paralelo;
- milhares de dedupe records;
- recovery scan grande.

Objetivo: provar que locks não serializam o mundo inteiro.

---

# 40. T2 — Escopo de implementação imediato — DEC-864–886

Não implementar tudo só porque foi decidido.

T2 inclui obrigatoriamente:

- PrimaryAuthorityService;
- preferred GM + deterministic fallback;
- authority epoch;
- CommandTransport abstraction;
- CommandBus registry;
- AuthenticatedCommandContext;
- expectedRevision em mutations relevantes;
- in-memory dedupe;
- LockManager;
- multi-key locks básicos;
- Diagnostics básico;
- rate limiting simples;
- cancellation de commands aguardando queue/locks;
- multi-user test harness.

T2 deixa como shell/contract ou implementação just-in-time:

- durable dedupe amplo;
- full MutationCoordinator compensation;
- TransactionStore completo;
- RecoveryService completo;
- generic Preview engine;
- full AuditStore;
- batch commands.

Gate crítico:

> T2 não é aprovado enquanto mutation handlers importantes puderem bypassar a Authority acidentalmente.

---

# 41. Leis finais da Rodada 04 — DEC-887–890

## DEC-887
A pipeline descrita neste documento é a arquitetura oficial de mutations do Domain Manager.

## DEC-888
Operações muito simples podem usar versão reduzida da pipeline, mas nunca pulam authentication, permission ou revision quando aplicáveis.

## DEC-889
Provider externo não é mutado diretamente pela UI quando a operação faz parte do Domain Manager; passa por adapter/authority.

## DEC-890
Nenhum subsystem cria uma segunda authority independente.

Economy, Projects, Requests, Relations e Ticks especializam a infraestrutura, mas não reinventam autoridade, locks, dedupe, recovery ou transporte.

---

# 42. Invariantes consolidadas

1. Existe uma única autoridade técnica por vez.
2. GM não é sinônimo de executor autoritativo.
3. Client envia intenção; authority calcula realidade.
4. Timeout não é sinônimo de failure.
5. Retry não cria nova operação.
6. commandId identifica operação; fingerprint valida intenção.
7. Locks são multi-key, ordenados e centralizados na authority.
8. Fresh state é lido depois de locks.
9. Preview não congela o mundo.
10. TransactionRecord só existe onde há valor real.
11. `failed` e `needs-recovery` são estados diferentes.
12. Outcome incerto é reconciliado antes de compensar.
13. Compensation não apaga história.
14. Recovery é idempotente.
15. Unresolved transaction nunca é coletada automaticamente.
16. Receipt não substitui persisted truth.
17. Hooks notificam; consumers refetch.
18. Audit e console log são sistemas diferentes.
19. Cancellation após commit boundary vira compensation/recovery.
20. No-op não incrementa revision.
21. Rate limit protege também contra loops acidentais de GM.
22. Queue não precisa serializar operações independentes.
23. CommandBus e MutationCoordinator possuem responsabilidades distintas.
24. Internal-only command nunca vira public-callable só porque caller é GM.
25. A nova arquitetura deve ser provada sob failover realista em testes.
26. Projetar contracts agora não obriga implementar toda a complexidade agora.

---

# 43. Estrutura de código indicada

```text
scripts/
├── authority/
│   ├── primary-authority-service.ts
│   ├── authority-epoch.ts
│   └── authority-status.ts
├── commands/
│   ├── command-bus.ts
│   ├── command-registry.ts
│   ├── authenticated-command-context.ts
│   ├── command-transport.ts
│   ├── command-status.ts
│   ├── dedupe-store.ts
│   └── rate-limiter.ts
├── mutations/
│   ├── mutation-coordinator.ts
│   ├── plan.ts
│   ├── lock-manager.ts
│   ├── transaction-store.ts
│   ├── transaction-state.ts
│   ├── recovery-service.ts
│   └── compensation.ts
├── audit/
│   ├── audit-store.ts
│   ├── audit-entry.ts
│   └── categories.ts
├── providers/
│   ├── provider-capabilities.ts
│   └── provider-health.ts
└── diagnostics/
    ├── diagnostics-service.ts
    └── diagnostics-app.ts
```

> Esta árvore é arquitetural. Não é ordem para implementar todos os arquivos antes de o respectivo gate precisar deles.

---

# 44. Próxima rodada

A Rodada 05 deve especificar:

- People subsystem;
- Population / PopulationGroup;
- Notables;
- DomainRole;
- RoleDefinition;
- Occupants;
- OperationalGroup;
- OperationalGroupDefinition;
- membership / Actor refs;
- workforce;
- assignments;
- availability;
- capability grants vindos de Roles/Groups;
- aggregation;
- storage/repositories;
- permissions/visibility;
- UI;
- import/export;
- migrations;
- tests/performance.
````

---

# ANEXO 05 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_05_PEOPLE_891-1415.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 05
## People, Roles, Operational Groups, Workforce e Capability Grants — Decisões 891–1415

> **Status:** APROVADO / CONGELADO PARA CONTINUIDADE.
>
> O usuário aprovou em bloco **todas as opções marcadas como RECOMENDADO** nas perguntas 891–1415.
>
> Este arquivo foi gerado especificamente para preservar a continuidade antes de seguir o projeto em uma ramificação do chat. Nenhuma decisão deve ser alterada silenciosamente; futuras mudanças devem registrar `CONFLITO / DECISÃO` ou uma substituição explícita.

---

# 0. Resumo executivo

A Rodada 05 fecha o contrato conceitual e o escopo inicial do subsystem **People**, incluindo Population, PopulationGroups, Notables, Roles, OperationalGroups, Workforce, Assignments, CapabilityGrants, agregação hierárquica, visibility, storage, UI, migrations, testes e o gate T3.

Arquitetura resultante:

```text
PeopleService
│
├── Population
│   ├── manual
│   ├── sumGroups
│   ├── hybrid
│   └── aggregate summaries
│
├── PopulationGroup
│
├── Notable
│   ├── InlineNotable
│   └── ActorLinkedNotable
│
├── Roles
│   ├── RoleDefinition
│   ├── DomainRole
│   ├── GroupRole
│   └── occupancy / requirements
│
├── OperationalGroup
│   ├── Definition
│   ├── lifecycle
│   ├── membership mode
│   ├── known members
│   ├── internal roles
│   └── capability grants
│
├── Workforce
│   ├── WorkforceTypeRegistry
│   ├── contributions
│   ├── capacity
│   ├── reserved
│   ├── committed
│   ├── available [derived]
│   └── provenance
│
├── Assignments
│   ├── source
│   ├── target
│   ├── workforce type
│   ├── amount
│   └── lifecycle
│
├── CapabilityGrantProvider
├── AggregationProvider
├── PeopleRepository
├── OperationalGroupRepository
└── AssignmentRepository

```

---

# 1. Invariantes centrais

- People é capability opcional.
- Ativar capability não inventa conteúdo narrativo.
- Desativar capability não apaga dados.
- Population não é roster.
- PopulationGroup não é OperationalGroup.
- Notable pode existir sem Actor.
- Role é cargo, não pessoa e não Foundry permission.
- OperationalGroup é unidade funcional identificável, não simples subconjunto demográfico.
- Workforce é capacidade operacional derivada, não população.
- Assignment é relation operacional própria, não campo privado de Project.
- CapabilityGrant efetivo é derivado e preserva provenance.
- Agregação de parent é summary; não concede automaticamente acesso operacional aos children.
- Secrets são projetados antes de agregações que possam revelar informação.
- Storage de entidades potencialmente grandes/complexas fica atrás de repository.
- A mesma arquitetura deve servir uma base de 12 NPCs e um império multiplanetário sem obrigar a mesma granularidade.

---

# 2. Shapes conceituais aprovados

```ts
interface PopulationState {
  mode: "manual" | "sumGroups" | "hybrid";
  total: number | null;
  precision: "exact" | "estimated" | "unknown";
}

interface PopulationGroup {
  id: PopulationGroupId;
  name: string;
  count: number | null;
  includedInTotal: boolean;
  tags: string[];
  notes?: string;
}

type Notable =
  | {
      id: NotableId;
      mode: "inline";
      name: string;
      portrait?: string;
      description?: string;
      tags: string[];
      visibility?: VisibilityRef;
    }
  | {
      id: NotableId;
      mode: "actor";
      actorRef: DocumentRef;
      description?: string;
      tags: string[];
      visibility?: VisibilityRef;
    };

interface RoleOccupancyPolicy {
  min: number;
  max: number | null;
}

interface WorkforceContribution {
  workforceTypeId: string;
  amount: number;
}

interface Assignment {
  id: AssignmentId;
  sourceRef: TypedPeopleRef;
  targetRef: TypedAssignmentTargetRef;
  workforceTypeId: string;
  amount: number;
  status: "active" | "ended";
  startedAtWorld?: number | null;
  endsAtWorld?: number | null;
}

interface CapabilityGrant {
  capabilityId: string;
  source: CapabilityGrantSource;
}

interface EffectiveCapability {
  capabilityId: string;
  enabled: boolean;
  sources: readonly CapabilityGrant[];
  warnings?: readonly string[];
  degraded?: boolean;
}

```

---

# 3. Decisões 891–1415

## A. Filosofia do subsystem People — DEC-891–DEC-900

### DEC-0891

**Escolha aprovada:** `A`

**Decisão:** `people` é capability opcional; Domains sem gestão populacional não carregam o subsystem.

**Status:** `DECIDIDO`

### DEC-0892

**Escolha aprovada:** `A`

**Decisão:** Ativar `people` cria apenas shell/default mínimo; nunca inventa população, grupos ou cargos.

**Status:** `DECIDIDO`

### DEC-0893

**Escolha aprovada:** `A`

**Decisão:** Desativar `people` preserva todos os dados e apenas desliga o subsystem.

**Status:** `DECIDIDO`

### DEC-0894

**Escolha aprovada:** `A`

**Decisão:** People possui versionamento próprio quando persistir estruturas complexas, coordenado pelo schema global.

**Status:** `DECIDIDO`

### DEC-0895

**Escolha aprovada:** `A`

**Decisão:** Existe `PeopleService` explícito; regras não vivem na Sheet.

**Status:** `DECIDIDO`

### DEC-0896

**Escolha aprovada:** `B`

**Decisão:** Mutations relevantes não usam `domain.update(system.people...)` direto na UI; passam por Service/Commands.

**Status:** `DECIDIDO`

### DEC-0897

**Escolha aprovada:** `B`

**Decisão:** People não depende diretamente de Economy; integração cross-service usa Plans/Actions/Coordinator.

**Status:** `DECIDIDO`

### DEC-0898

**Escolha aprovada:** `A`

**Decisão:** People não depende estruturalmente de Projects; Projects podem consultar People, não o contrário.

**Status:** `DECIDIDO`

### DEC-0899

**Escolha aprovada:** `A`

**Decisão:** People funciona sem sistema RPG específico.

**Status:** `DECIDIDO`

### DEC-0900

**Escolha aprovada:** `A`

**Decisão:** O core não presume que toda pessoa seja Actor; população pode ser abstrata.

**Status:** `DECIDIDO`

---

## B. Shape geral de People — DEC-901–DEC-905

### DEC-0901

**Escolha aprovada:** `A`

**Decisão:** People separa `population`, `groups`, `notables`, `roles` e `operationalGroups` conceitualmente.

**Status:** `DECIDIDO`

### DEC-0902

**Escolha aprovada:** `B`

**Decisão:** OperationalGroups pertencem conceitualmente a People, mas storage/repository pode ser separado.

**Status:** `DECIDIDO`

### DEC-0903

**Escolha aprovada:** `A`

**Decisão:** PopulationGroup, Notable, Role e OperationalGroup possuem IDs internos próprios.

**Status:** `DECIDIDO`

### DEC-0904

**Escolha aprovada:** `A`

**Decisão:** Usar prefixos internos como `pop_`, `not_`, `role_`, `opg_`.

**Status:** `DECIDIDO`

### DEC-0905

**Escolha aprovada:** `A`

**Decisão:** IDs permanecem estáveis após rename.

**Status:** `DECIDIDO`

---

## C. Population — conceito global — DEC-906–DEC-912

### DEC-0906

**Escolha aprovada:** `B`

**Decisão:** Não confundir zero com desconhecido; população pode ser explicitamente desconhecida.

**Status:** `DECIDIDO`

### DEC-0907

**Escolha aprovada:** `A`

**Decisão:** Modelar população conhecida/desconhecida de forma semântica.

**Status:** `DECIDIDO`

### DEC-0908

**Escolha aprovada:** `A`

**Decisão:** Population total é integer.

**Status:** `DECIDIDO`

### DEC-0909

**Escolha aprovada:** `A`

**Decisão:** Population total nunca é negativo.

**Status:** `DECIDIDO`

### DEC-0910

**Escolha aprovada:** `B`

**Decisão:** Sem limite artificial além de `Number.isSafeInteger`.

**Status:** `DECIDIDO`

### DEC-0911

**Escolha aprovada:** `A`

**Decisão:** Escalas de trilhões são suportadas enquanto dentro de safe integer.

**Status:** `DECIDIDO`

### DEC-0912

**Escolha aprovada:** `B`

**Decisão:** Acima de safe integer ocorre validation error; nova contract version só se um dia houver necessidade real.

**Status:** `DECIDIDO`

---

## D. Population modes — DEC-913–DEC-924

### DEC-0913

**Escolha aprovada:** `A`

**Decisão:** `manual`: total é fornecido diretamente; groups são informação adicional.

**Status:** `DECIDIDO`

### DEC-0914

**Escolha aprovada:** `A`

**Decisão:** Em `manual`, groups não alteram total automaticamente.

**Status:** `DECIDIDO`

### DEC-0915

**Escolha aprovada:** `A`

**Decisão:** `sumGroups`: total é soma dos PopulationGroups contáveis.

**Status:** `DECIDIDO`

### DEC-0916

**Escolha aprovada:** `B`

**Decisão:** Em `sumGroups`, total é derivado e não source of truth persistida.

**Status:** `DECIDIDO`

### DEC-0917

**Escolha aprovada:** `A`

**Decisão:** `hybrid`: total manual existe e groups detalham subconjuntos.

**Status:** `DECIDIDO`

### DEC-0918

**Escolha aprovada:** `A`

**Decisão:** Em `hybrid`, groups são normalmente subconjuntos do total.

**Status:** `DECIDIDO`

### DEC-0919

**Escolha aprovada:** `A`

**Decisão:** Cada PopulationGroup tem `includedInTotal`.

**Status:** `DECIDIDO`

### DEC-0920

**Escolha aprovada:** `A`

**Decisão:** Em `sumGroups`, groups com `includedInTotal=false` não entram na soma.

**Status:** `DECIDIDO`

### DEC-0921

**Escolha aprovada:** `A`

**Decisão:** Groups informativos com `includedInTotal=false` são válidos.

**Status:** `DECIDIDO`

### DEC-0922

**Escolha aprovada:** `B`

**Decisão:** Em hybrid, groups superarem total gera warning, não bloqueio automático.

**Status:** `DECIDIDO`

### DEC-0923

**Escolha aprovada:** `A`

**Decisão:** PopulationGroups podem se sobrepor semanticamente.

**Status:** `DECIDIDO`

### DEC-0924

**Escolha aprovada:** `A`

**Decisão:** Tags/groups não implicam categorias demográficas mutuamente exclusivas.

**Status:** `DECIDIDO`

---

## E. Population status e precisão narrativa — DEC-925–DEC-931

### DEC-0925

**Escolha aprovada:** `A`

**Decisão:** Population pode ser estimativa.

**Status:** `DECIDIDO`

### DEC-0926

**Escolha aprovada:** `A`

**Decisão:** Population possui precisão semântica.

**Status:** `DECIDIDO`

### DEC-0927

**Escolha aprovada:** `B`

**Decisão:** Usar um único campo semântico para precisão/unknown, evitando `known` duplicado.

**Status:** `DECIDIDO`

### DEC-0928

**Escolha aprovada:** `B`

**Decisão:** V1 usa `exact | estimated | unknown`; não separar `approximate`.

**Status:** `DECIDIDO`

### DEC-0929

**Escolha aprovada:** `A`

**Decisão:** Shape inicial: `mode`, `total:number|null`, `precision:exact|estimated|unknown`.

**Status:** `DECIDIDO`

### DEC-0930

**Escolha aprovada:** `B`

**Decisão:** Não persistir `lastUpdatedAt`; audit/revision já cobre mutations.

**Status:** `DECIDIDO`

### DEC-0931

**Escolha aprovada:** `B`

**Decisão:** Fonte narrativa do censo/estimativa fica para notes/source futuro, não campo obrigatório v1.

**Status:** `DECIDIDO`

---

## F. PopulationGroup — DEC-932–DEC-947

### DEC-0932

**Escolha aprovada:** `A`

**Decisão:** Shape base: `id`, `name`, `count`, `includedInTotal`, `tags`.

**Status:** `DECIDIDO`

### DEC-0933

**Escolha aprovada:** `A`

**Decisão:** `name` é obrigatório.

**Status:** `DECIDIDO`

### DEC-0934

**Escolha aprovada:** `B`

**Decisão:** Nome não precisa ser único dentro do Domain; ID é identidade.

**Status:** `DECIDIDO`

### DEC-0935

**Escolha aprovada:** `A`

**Decisão:** `count` pode ser `number | null` para unknown.

**Status:** `DECIDIDO`

### DEC-0936

**Escolha aprovada:** `A`

**Decisão:** Group unknown pode ter `includedInTotal=true`; isso torna `sumGroups` indeterminado.

**Status:** `DECIDIDO`

### DEC-0937

**Escolha aprovada:** `B`

**Decisão:** Em `sumGroups`, qualquer included group unknown torna o total unknown.

**Status:** `DECIDIDO`

### DEC-0938

**Escolha aprovada:** `A`

**Decisão:** Em `hybrid`, group unknown não invalida o total manual.

**Status:** `DECIDIDO`

### DEC-0939

**Escolha aprovada:** `B`

**Decisão:** Count zero não é record operacional normal; remover/arquivar por mecanismo apropriado.

**Status:** `DECIDIDO`

### DEC-0940

**Escolha aprovada:** `B`

**Decisão:** Histórico de grupo extinto não é modelado por count=0; lifecycle/history só quando justificar.

**Status:** `DECIDIDO`

### DEC-0941

**Escolha aprovada:** `B`

**Decisão:** PopulationGroup tem `notes` curta opcional em plain text.

**Status:** `DECIDIDO`

### DEC-0942

**Escolha aprovada:** `A`

**Decisão:** Notes possui limite defensivo aproximado de até 2000 caracteres.

**Status:** `DECIDIDO`

### DEC-0943

**Escolha aprovada:** `B`

**Decisão:** Não adicionar `categoryId` no v1; tags bastam.

**Status:** `DECIDIDO`

### DEC-0944

**Escolha aprovada:** `A`

**Decisão:** Tags usam o sistema comum de tags.

**Status:** `DECIDIDO`

### DEC-0945

**Escolha aprovada:** `B`

**Decisão:** PopulationGroup não guarda roster de Actor refs.

**Status:** `DECIDIDO`

### DEC-0946

**Escolha aprovada:** `B`

**Decisão:** Liderança de PopulationGroup deve ser modelada via Role/OperationalGroup quando necessária.

**Status:** `DECIDIDO`

### DEC-0947

**Escolha aprovada:** `B`

**Decisão:** Sem `metadata` genérica em PopulationGroup.

**Status:** `DECIDIDO`

---

## G. Mutations de PopulationGroup — DEC-948–DEC-955

### DEC-0948

**Escolha aprovada:** `A`

**Decisão:** Criar group é mutation/Command autoritativo.

**Status:** `DECIDIDO`

### DEC-0949

**Escolha aprovada:** `A`

**Decisão:** Editar count incrementa Domain revision.

**Status:** `DECIDIDO`

### DEC-0950

**Escolha aprovada:** `A`

**Decisão:** Rename de group incrementa revision.

**Status:** `DECIDIDO`

### DEC-0951

**Escolha aprovada:** `B`

**Decisão:** Reordenação puramente visual não incrementa revision.

**Status:** `DECIDIDO`

### DEC-0952

**Escolha aprovada:** `A`

**Decisão:** Ordem de PopulationGroups não é semântica.

**Status:** `DECIDIDO`

### DEC-0953

**Escolha aprovada:** `B`

**Decisão:** Delete exige impact preview apenas quando há refs/assignments; caso simples usa confirmação simples.

**Status:** `DECIDIDO`

### DEC-0954

**Escolha aprovada:** `A`

**Decisão:** Delete cru é bloqueado se Project/Role/outro record referencia o group.

**Status:** `DECIDIDO`

### DEC-0955

**Escolha aprovada:** `B`

**Decisão:** Não introduzir lifecycle de PopulationGroup no v1 sem necessidade histórica real.

**Status:** `DECIDIDO`

---

## H. Notables — conceito — DEC-956–DEC-963

### DEC-0956

**Escolha aprovada:** `A`

**Decisão:** Notable representa pessoa individual relevante.

**Status:** `DECIDIDO`

### DEC-0957

**Escolha aprovada:** `A`

**Decisão:** Notable não precisa Actor.

**Status:** `DECIDIDO`

### DEC-0958

**Escolha aprovada:** `A`

**Decisão:** Inline Notable precisa nome.

**Status:** `DECIDIDO`

### DEC-0959

**Escolha aprovada:** `B`

**Decisão:** Linked Notable não duplica nome como authority; Actor.name é truth enquanto ref válida.

**Status:** `DECIDIDO`

### DEC-0960

**Escolha aprovada:** `A`

**Decisão:** Notable suporta modos `inline` e `actor`.

**Status:** `DECIDIDO`

### DEC-0961

**Escolha aprovada:** `A`

**Decisão:** Usar discriminated union para os dois modos.

**Status:** `DECIDIDO`

### DEC-0962

**Escolha aprovada:** `A`

**Decisão:** Permitir conversão inline → linked Actor.

**Status:** `DECIDIDO`

### DEC-0963

**Escolha aprovada:** `B`

**Decisão:** Actor removido não converte automaticamente para inline; broken ref permanece e UI oferece conversão explícita.

**Status:** `DECIDIDO`

---

## I. Notable fields — DEC-964–DEC-975

### DEC-0964

**Escolha aprovada:** `A`

**Decisão:** Notable possui ID interno próprio mesmo quando linked.

**Status:** `DECIDIDO`

### DEC-0965

**Escolha aprovada:** `A`

**Decisão:** Prefixo `not_`.

**Status:** `DECIDIDO`

### DEC-0966

**Escolha aprovada:** `A`

**Decisão:** Inline Notable pode ter portrait opcional.

**Status:** `DECIDIDO`

### DEC-0967

**Escolha aprovada:** `A`

**Decisão:** Linked Notable usa Actor.img normalmente.

**Status:** `DECIDIDO`

### DEC-0968

**Escolha aprovada:** `B`

**Decisão:** Sem portrait override para linked Notable no v1.

**Status:** `DECIDIDO`

### DEC-0969

**Escolha aprovada:** `A`

**Decisão:** Notable pode ter short description.

**Status:** `DECIDIDO`

### DEC-0970

**Escolha aprovada:** `B`

**Decisão:** Description é plain text curta, não rich text.

**Status:** `DECIDIDO`

### DEC-0971

**Escolha aprovada:** `A`

**Decisão:** Notable pode ter tags.

**Status:** `DECIDIDO`

### DEC-0972

**Escolha aprovada:** `B`

**Decisão:** Sem status universal no Notable.

**Status:** `DECIDIDO`

### DEC-0973

**Escolha aprovada:** `B`

**Decisão:** Não criar booleans universais como morto/ausente/prisioneiro.

**Status:** `DECIDIDO`

### DEC-0974

**Escolha aprovada:** `A`

**Decisão:** Mesmo Actor pode ser Notable em vários Domains, cada Domain com seu record contextual.

**Status:** `DECIDIDO`

### DEC-0975

**Escolha aprovada:** `A`

**Decisão:** Índice inverso Actor→Domains é derivado, nunca dual-write no Actor.

**Status:** `DECIDIDO`

---

## J. Notable permissions e visibilidade — DEC-976–DEC-980

### DEC-0976

**Escolha aprovada:** `A`

**Decisão:** Notable pode ser secreto mesmo em Domain público.

**Status:** `DECIDIDO`

### DEC-0977

**Escolha aprovada:** `A`

**Decisão:** Cada Notable pode ter visibility própria/policy.

**Status:** `DECIDIDO`

### DEC-0978

**Escolha aprovada:** `B`

**Decisão:** Viewer sem knowledge não recebe o Notable record; sanitização real.

**Status:** `DECIDIDO`

### DEC-0979

**Escolha aprovada:** `A`

**Decisão:** Placeholder de rumor/unknown só existe quando Knowledge projection deliberadamente o produz.

**Status:** `DECIDIDO`

### DEC-0980

**Escolha aprovada:** `B`

**Decisão:** Actor ownership não substitui automaticamente a visibility do Notable no Domain.

**Status:** `DECIDIDO`

---

## K. DomainRole — conceito — DEC-981–DEC-990

### DEC-0981

**Escolha aprovada:** `A`

**Decisão:** DomainRole representa cargo/posição; não a pessoa.

**Status:** `DECIDIDO`

### DEC-0982

**Escolha aprovada:** `A`

**Decisão:** Role existe mesmo vazio.

**Status:** `DECIDIDO`

### DEC-0983

**Escolha aprovada:** `A`

**Decisão:** Separar `RoleDefinition` de `DomainRole`.

**Status:** `DECIDIDO`

### DEC-0984

**Escolha aprovada:** `A`

**Decisão:** RoleDefinition é conteúdo reutilizável.

**Status:** `DECIDIDO`

### DEC-0985

**Escolha aprovada:** `A`

**Decisão:** GM pode criar RoleDefinition custom.

**Status:** `DECIDIDO`

### DEC-0986

**Escolha aprovada:** `A`

**Decisão:** RoleDefinition usa ID namespaced.

**Status:** `DECIDIDO`

### DEC-0987

**Escolha aprovada:** `A`

**Decisão:** RoleDefinition possui version.

**Status:** `DECIDIDO`

### DEC-0988

**Escolha aprovada:** `A`

**Decisão:** DomainRole possui ID runtime próprio.

**Status:** `DECIDIDO`

### DEC-0989

**Escolha aprovada:** `A`

**Decisão:** Prefixo `role_`.

**Status:** `DECIDIDO`

### DEC-0990

**Escolha aprovada:** `A`

**Decisão:** RoleDefinition fornece label default; instance pode renomear.

**Status:** `DECIDIDO`

---

## L. Role multiplicity — DEC-991–DEC-995

### DEC-0991

**Escolha aprovada:** `A`

**Decisão:** RoleDefinition define `occupancy.min` e `occupancy.max`.

**Status:** `DECIDIDO`

### DEC-0992

**Escolha aprovada:** `A`

**Decisão:** `max` pode ser null para ilimitado.

**Status:** `DECIDIDO`

### DEC-0993

**Escolha aprovada:** `B`

**Decisão:** `min>0` não invalida Domain; gera requirement/alert.

**Status:** `DECIDIDO`

### DEC-0994

**Escolha aprovada:** `A`

**Decisão:** Minimum não atendido produz requirement unsatisfied derivado.

**Status:** `DECIDIDO`

### DEC-0995

**Escolha aprovada:** `B`

**Decisão:** Occupants de Role ficam restritos a pessoas individuais inicialmente.

**Status:** `DECIDIDO`

---

## M. Role occupants — DEC-996–DEC-1000

### DEC-0996

**Escolha aprovada:** `A`

**Decisão:** Role occupant referencia preferencialmente `NotableId`, não Actor UUID direto.

**Status:** `DECIDIDO`

### DEC-0997

**Escolha aprovada:** `A`

**Decisão:** Inline Notable pode ocupar Role.

**Status:** `DECIDIDO`

### DEC-0998

**Escolha aprovada:** `A`

**Decisão:** Arrastar/adicionar Actor direto a Role cria ou reutiliza Notable.

**Status:** `DECIDIDO`

### DEC-0999

**Escolha aprovada:** `A`

**Decisão:** Se Actor já é Notable no Domain, reutilizar.

**Status:** `DECIDIDO`

### DEC-1000

**Escolha aprovada:** `A`

**Decisão:** Bloquear múltiplos Notable records apontando para o mesmo Actor dentro do mesmo Domain no v1.

**Status:** `DECIDIDO`

---

## N. Estado e funcionamento dos Roles — DEC-1001–DEC-1020

### DEC-1001

**Escolha aprovada:** `B`

**Decisão:** DomainRole não ganha lifecycle próprio no v1.

**Status:** `DECIDIDO`

### DEC-1002

**Escolha aprovada:** `B`

**Decisão:** Vacancy é derivada da occupancy, não status persistido.

**Status:** `DECIDIDO`

### DEC-1003

**Escolha aprovada:** `A`

**Decisão:** Filled também é derivado.

**Status:** `DECIDIDO`

### DEC-1004

**Escolha aprovada:** `B`

**Decisão:** Role abaixo do min gera requirement/alert, não invalida Domain.

**Status:** `DECIDIDO`

### DEC-1005

**Escolha aprovada:** `A`

**Decisão:** Role acima do max não pode ser salvo.

**Status:** `DECIDIDO`

### DEC-1006

**Escolha aprovada:** `B`

**Decisão:** Não criar boolean universal `acting`; metadata tipada só quando houver necessidade.

**Status:** `DECIDIDO`

### DEC-1007

**Escolha aprovada:** `B`

**Decisão:** Mandato/start date não entra no core inicial; audit registra assignment/removal.

**Status:** `DECIDIDO`

### DEC-1008

**Escolha aprovada:** `B`

**Decisão:** Histórico de ocupantes fica em audit/history, não array infinito no Role.

**Status:** `DECIDIDO`

### DEC-1009

**Escolha aprovada:** `A`

**Decisão:** Role pode ter notes curta.

**Status:** `DECIDIDO`

### DEC-1010

**Escolha aprovada:** `B`

**Decisão:** Notes de Role é plain text.

**Status:** `DECIDIDO`

### DEC-1011

**Escolha aprovada:** `A`

**Decisão:** Role pode ter tags.

**Status:** `DECIDIDO`

### DEC-1012

**Escolha aprovada:** `A`

**Decisão:** Tags usam sistema comum.

**Status:** `DECIDIDO`

### DEC-1013

**Escolha aprovada:** `A`

**Decisão:** Role pode ser secreto.

**Status:** `DECIDIDO`

### DEC-1014

**Escolha aprovada:** `A`

**Decisão:** Role secreto pode ter occupant visível; projections são independentes.

**Status:** `DECIDIDO`

### DEC-1015

**Escolha aprovada:** `A`

**Decisão:** Role público pode ter occupant secreto.

**Status:** `DECIDIDO`

### DEC-1016

**Escolha aprovada:** `A`

**Decisão:** Placeholder 'ocupante desconhecido' só se Knowledge projection permitir.

**Status:** `DECIDIDO`

### DEC-1017

**Escolha aprovada:** `A`

**Decisão:** RoleDefinition pode exigir capability prerequisite.

**Status:** `DECIDIDO`

### DEC-1018

**Escolha aprovada:** `B`

**Decisão:** Se prerequisite some, não apagar Role; marcar requirement unsatisfied/unavailable.

**Status:** `DECIDIDO`

### DEC-1019

**Escolha aprovada:** `A`

**Decisão:** RoleDefinition desconhecido após addon removido é preservado.

**Status:** `DECIDIDO`

### DEC-1020

**Escolha aprovada:** `A`

**Decisão:** UI pode futuramente converter Role desconhecido em custom definition via repair.

**Status:** `DECIDIDO`

---

## O. Roles e Capability Grants — DEC-1021–DEC-1035

### DEC-1021

**Escolha aprovada:** `A`

**Decisão:** RoleDefinition pode conceder capabilities.

**Status:** `DECIDIDO`

### DEC-1022

**Escolha aprovada:** `B`

**Decisão:** Definition decide se grant depende apenas da existência do Role ou de occupant/requirements.

**Status:** `DECIDIDO`

### DEC-1023

**Escolha aprovada:** `A`

**Decisão:** Modelar uma pequena grant policy (`exists/occupied/requirementsSatisfied`).

**Status:** `DECIDIDO`

### DEC-1024

**Escolha aprovada:** `A`

**Decisão:** RoleDefinition pode conceder várias capabilities.

**Status:** `DECIDIDO`

### DEC-1025

**Escolha aprovada:** `B`

**Decisão:** Capabilities vindas do occupant entram apenas via provider/system adapter/grant resolver registrado.

**Status:** `DECIDIDO`

### DEC-1026

**Escolha aprovada:** `A`

**Decisão:** System adapter pode gerar grants derivados a partir de dados do Actor.

**Status:** `DECIDIDO`

### DEC-1027

**Escolha aprovada:** `B`

**Decisão:** Grant de Role nunca é copiado para `definition.capabilities.enabled`; é effective derivado.

**Status:** `DECIDIDO`

### DEC-1028

**Escolha aprovada:** `A`

**Decisão:** Remover occupant remove grants derivados dependentes dele.

**Status:** `DECIDIDO`

### DEC-1029

**Escolha aprovada:** `B`

**Decisão:** Perder grant derivado não apaga automaticamente config preservada da capability.

**Status:** `DECIDIDO`

### DEC-1030

**Escolha aprovada:** `B`

**Decisão:** Se outra source ainda concede a capability, ela continua ativa.

**Status:** `DECIDIDO`

### DEC-1031

**Escolha aprovada:** `A`

**Decisão:** Effective capability lista todas as sources.

**Status:** `DECIDIDO`

### DEC-1032

**Escolha aprovada:** `A`

**Decisão:** Ordem das sources não altera semântica por default.

**Status:** `DECIDIDO`

### DEC-1033

**Escolha aprovada:** `A`

**Decisão:** Capability registry pode definir merge policy.

**Status:** `DECIDIDO`

### DEC-1034

**Escolha aprovada:** `B`

**Decisão:** Nunca usar merge genérico `Object.assign`; capability define resolver.

**Status:** `DECIDIDO`

### DEC-1035

**Escolha aprovada:** `A`

**Decisão:** Broken grant source aparece em Diagnostics.

**Status:** `DECIDIDO`

---

## P. OperationalGroup — conceito — DEC-1036–DEC-1060

### DEC-1036

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup é unidade funcional identificável, distinta de PopulationGroup.

**Status:** `DECIDIDO`

### DEC-1037

**Escolha aprovada:** `A`

**Decisão:** Pode representar equipes civis, conselhos, guardas, frotas etc.; não só militares.

**Status:** `DECIDIDO`

### DEC-1038

**Escolha aprovada:** `A`

**Decisão:** Pode representar máquinas/robôs/NHPs se o cenário os tratar como unidade operacional.

**Status:** `DECIDIDO`

### DEC-1039

**Escolha aprovada:** `B`

**Decisão:** Manter nome `OperationalGroup`.

**Status:** `DECIDIDO`

### DEC-1040

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup possui ID próprio.

**Status:** `DECIDIDO`

### DEC-1041

**Escolha aprovada:** `A`

**Decisão:** Prefixo `opg_`.

**Status:** `DECIDIDO`

### DEC-1042

**Escolha aprovada:** `A`

**Decisão:** Separar OperationalGroupDefinition de instance.

**Status:** `DECIDIDO`

### DEC-1043

**Escolha aprovada:** `A`

**Decisão:** Definitions vivem preferencialmente em Compendium/content packs.

**Status:** `DECIDIDO`

### DEC-1044

**Escolha aprovada:** `A`

**Decisão:** GM pode criar definition custom.

**Status:** `DECIDIDO`

### DEC-1045

**Escolha aprovada:** `A`

**Decisão:** Definition usa ID namespaced.

**Status:** `DECIDIDO`

### DEC-1046

**Escolha aprovada:** `A`

**Decisão:** Definition possui version.

**Status:** `DECIDIDO`

### DEC-1047

**Escolha aprovada:** `A`

**Decisão:** Instance pode customizar label.

**Status:** `DECIDIDO`

### DEC-1048

**Escolha aprovada:** `A`

**Decisão:** Instance pode ter description curta opcional.

**Status:** `DECIDIDO`

### DEC-1049

**Escolha aprovada:** `B`

**Decisão:** Description/notes inicialmente plain text, não rich text.

**Status:** `DECIDIDO`

### DEC-1050

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup possui tags.

**Status:** `DECIDIDO`

### DEC-1051

**Escolha aprovada:** `A`

**Decisão:** Tags usam sistema comum.

**Status:** `DECIDIDO`

### DEC-1052

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup pode ser secreto.

**Status:** `DECIDIDO`

### DEC-1053

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup possui lifecycle operacional mínimo.

**Status:** `DECIDIDO`

### DEC-1054

**Escolha aprovada:** `B`

**Decisão:** Não criar lifecycle enorme; Conditions/Assignments cobrem contexto.

**Status:** `DECIDIDO`

### DEC-1055

**Escolha aprovada:** `A`

**Decisão:** Lifecycle inicial: `active | inactive | disbanded`.

**Status:** `DECIDIDO`

### DEC-1056

**Escolha aprovada:** `A`

**Decisão:** Disbanded permanece resolvível/histórico.

**Status:** `DECIDIDO`

### DEC-1057

**Escolha aprovada:** `A`

**Decisão:** Disbanded não concede capabilities por default.

**Status:** `DECIDIDO`

### DEC-1058

**Escolha aprovada:** `A`

**Decisão:** Inactive grant depende de Definition/grant policy.

**Status:** `DECIDIDO`

### DEC-1059

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup pode ter `size` sem roster completo.

**Status:** `DECIDIDO`

### DEC-1060

**Escolha aprovada:** `A`

**Decisão:** Size é integer.

**Status:** `DECIDIDO`

---

## Q. OperationalGroup e Population — DEC-1061–DEC-1067

### DEC-1061

**Escolha aprovada:** `B`

**Decisão:** OperationalGroup não precisa pertencer à Population.

**Status:** `DECIDIDO`

### DEC-1062

**Escolha aprovada:** `A`

**Decisão:** Pode haver link opcional a PopulationGroup.

**Status:** `DECIDIDO`

### DEC-1063

**Escolha aprovada:** `B`

**Decisão:** Esse link é referência/subconjunto e nunca soma população automaticamente.

**Status:** `DECIDIDO`

### DEC-1064

**Escolha aprovada:** `B`

**Decisão:** OperationalGroup size não reduz PopulationGroup automaticamente.

**Status:** `DECIDIDO`

### DEC-1065

**Escolha aprovada:** `A`

**Decisão:** Population e OperationalGroups são visões semânticas diferentes da mesma população possível.

**Status:** `DECIDIDO`

### DEC-1066

**Escolha aprovada:** `B`

**Decisão:** Não adicionar `includedInPopulationTotal` ao OperationalGroup no v1.

**Status:** `DECIDIDO`

### DEC-1067

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup sem PopulationGroup source é válido.

**Status:** `DECIDIDO`

---

## R. Membership — DEC-1068–DEC-1080

### DEC-1068

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup pode possuir members concretos opcionalmente.

**Status:** `DECIDIDO`

### DEC-1069

**Escolha aprovada:** `A`

**Decisão:** Members concretos usam preferencialmente Notables.

**Status:** `DECIDIDO`

### DEC-1070

**Escolha aprovada:** `B`

**Decisão:** Não aceitar ActorRef direto no roster v1; criar/reutilizar Notable.

**Status:** `DECIDIDO`

### DEC-1071

**Escolha aprovada:** `B`

**Decisão:** Nem todo membro precisa ser listado.

**Status:** `DECIDIDO`

### DEC-1072

**Escolha aprovada:** `A`

**Decisão:** `size` e `members.length` podem divergir.

**Status:** `DECIDIDO`

### DEC-1073

**Escolha aprovada:** `B`

**Decisão:** Members list representa apenas indivíduos explicitamente rastreados.

**Status:** `DECIDIDO`

### DEC-1074

**Escolha aprovada:** `A`

**Decisão:** Adicionar `membershipMode: abstract | partial | explicit`.

**Status:** `DECIDIDO`

### DEC-1075

**Escolha aprovada:** `A`

**Decisão:** `abstract` = nenhum roster individual.

**Status:** `DECIDIDO`

### DEC-1076

**Escolha aprovada:** `A`

**Decisão:** `partial` = roster conhecido é subconjunto do size.

**Status:** `DECIDIDO`

### DEC-1077

**Escolha aprovada:** `A`

**Decisão:** `explicit` = roster representa todos os membros.

**Status:** `DECIDIDO`

### DEC-1078

**Escolha aprovada:** `A`

**Decisão:** Em explicit mode, size é derivado de members.

**Status:** `DECIDIDO`

### DEC-1079

**Escolha aprovada:** `A`

**Decisão:** Em partial/abstract, size é informado separadamente.

**Status:** `DECIDIDO`

### DEC-1080

**Escolha aprovada:** `A`

**Decisão:** Um Notable pode pertencer a vários OperationalGroups.

**Status:** `DECIDIDO`

---

## S. Leaders / internal roles do OperationalGroup — DEC-1081–DEC-1088

### DEC-1081

**Escolha aprovada:** `B`

**Decisão:** Não usar `leaderId` universal; liderança usa roles internos.

**Status:** `DECIDIDO`

### DEC-1082

**Escolha aprovada:** `A`

**Decisão:** Reutilizar RoleDefinition/Role engine para cargos internos de OperationalGroup.

**Status:** `DECIDIDO`

### DEC-1083

**Escolha aprovada:** `A`

**Decisão:** DomainRole e GroupRole compartilham um contract base.

**Status:** `DECIDIDO`

### DEC-1084

**Escolha aprovada:** `A`

**Decisão:** Role instance declara `scope: domain | operational-group`.

**Status:** `DECIDIDO`

### DEC-1085

**Escolha aprovada:** `A`

**Decisão:** RoleDefinition pode restringir scopes permitidos.

**Status:** `DECIDIDO`

### DEC-1086

**Escolha aprovada:** `A`

**Decisão:** Group role occupant usa member/Notable ID.

**Status:** `DECIDIDO`

### DEC-1087

**Escolha aprovada:** `A`

**Decisão:** Ocupante deve pertencer ao group por default.

**Status:** `DECIDIDO`

### DEC-1088

**Escolha aprovada:** `A`

**Decisão:** External commander é permitido somente quando Definition/policy autorizar.

**Status:** `DECIDIDO`

---

## T. OperationalGroup capabilities — DEC-1089–DEC-1094

### DEC-1089

**Escolha aprovada:** `A`

**Decisão:** OperationalGroupDefinition pode conceder capabilities ao Domain.

**Status:** `DECIDIDO`

### DEC-1090

**Escolha aprovada:** `A`

**Decisão:** Inactive normalmente deixa de conceder por default.

**Status:** `DECIDIDO`

### DEC-1091

**Escolha aprovada:** `A`

**Decisão:** Definition pode explicitamente manter grant enquanto inactive.

**Status:** `DECIDIDO`

### DEC-1092

**Escolha aprovada:** `A`

**Decisão:** Size pode afetar grant via registered resolver.

**Status:** `DECIDIDO`

### DEC-1093

**Escolha aprovada:** `A`

**Decisão:** Membership/roles também podem afetar grant via resolver.

**Status:** `DECIDIDO`

### DEC-1094

**Escolha aprovada:** `A`

**Decisão:** Effective grants continuam derivados.

**Status:** `DECIDIDO`

---

## U. Workforce — conceito — DEC-1095–DEC-1105

### DEC-1095

**Escolha aprovada:** `B`

**Decisão:** Workforce não é entidade própria; é valor derivado de People/Groups/Assignments.

**Status:** `DECIDIDO`

### DEC-1096

**Escolha aprovada:** `A`

**Decisão:** Não persistir `availableWorkforce` como truth independente.

**Status:** `DECIDIDO`

### DEC-1097

**Escolha aprovada:** `A`

**Decisão:** Workforce é dividido por tipo/especialidade.

**Status:** `DECIDIDO`

### DEC-1098

**Escolha aprovada:** `B`

**Decisão:** Workforce types usam registry namespaced extensível.

**Status:** `DECIDIDO`

### DEC-1099

**Escolha aprovada:** `A`

**Decisão:** Built-in inclui pelo menos `general`.

**Status:** `DECIDIDO`

### DEC-1100

**Escolha aprovada:** `A`

**Decisão:** Workforce type possui label/description no registry.

**Status:** `DECIDIDO`

### DEC-1101

**Escolha aprovada:** `A`

**Decisão:** PopulationGroup pode contribuir Workforce.

**Status:** `DECIDIDO`

### DEC-1102

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup pode contribuir Workforce.

**Status:** `DECIDIDO`

### DEC-1103

**Escolha aprovada:** `A`

**Decisão:** Notable pode contribuir quando resolver/policy considerar.

**Status:** `DECIDIDO`

### DEC-1104

**Escolha aprovada:** `A`

**Decisão:** Role occupant pode modificar Workforce via resolver/modifier registrado.

**Status:** `DECIDIDO`

### DEC-1105

**Escolha aprovada:** `A`

**Decisão:** Workforce calculation possui provenance detalhada.

**Status:** `DECIDIDO`

---

## V. Workforce contribution — DEC-1106–DEC-1115

### DEC-1106

**Escolha aprovada:** `B`

**Decisão:** Não guardar um único campo universal de workforce no PopulationGroup; usar contributions/config registradas.

**Status:** `DECIDIDO`

### DEC-1107

**Escolha aprovada:** `A`

**Decisão:** Usar `WorkforceContribution { workforceTypeId, amount }`.

**Status:** `DECIDIDO`

### DEC-1108

**Escolha aprovada:** `A`

**Decisão:** Amount é integer por default.

**Status:** `DECIDIDO`

### DEC-1109

**Escolha aprovada:** `A`

**Decisão:** Precision fracionária pode ser versionada futuramente; não usar float já.

**Status:** `DECIDIDO`

### DEC-1110

**Escolha aprovada:** `A`

**Decisão:** Contributions podem ser manuais.

**Status:** `DECIDIDO`

### DEC-1111

**Escolha aprovada:** `A`

**Decisão:** Definitions/templates podem fornecer default contributions.

**Status:** `DECIDIDO`

### DEC-1112

**Escolha aprovada:** `A`

**Decisão:** Instance pode override defaults.

**Status:** `DECIDIDO`

### DEC-1113

**Escolha aprovada:** `A`

**Decisão:** Override preserva provenance.

**Status:** `DECIDIDO`

### DEC-1114

**Escolha aprovada:** `A`

**Decisão:** Workforce calculado pode ser cacheado.

**Status:** `DECIDIDO`

### DEC-1115

**Escolha aprovada:** `A`

**Decisão:** Cache invalida quando groups/roles/assignments mudam.

**Status:** `DECIDIDO`

---

## W. Workforce available vs total / constraints — DEC-1116–DEC-1128

### DEC-1116

**Escolha aprovada:** `A`

**Decisão:** Distinguir `capacity`, `committed`, `reserved`, `available`.

**Status:** `DECIDIDO`

### DEC-1117

**Escolha aprovada:** `A`

**Decisão:** `capacity` = workforce atualmente utilizável, não população total.

**Status:** `DECIDIDO`

### DEC-1118

**Escolha aprovada:** `A`

**Decisão:** `committed` = assignments em execução.

**Status:** `DECIDIDO`

### DEC-1119

**Escolha aprovada:** `A`

**Decisão:** `reserved` = workforce prometido/preparado para uso futuro.

**Status:** `DECIDIDO`

### DEC-1120

**Escolha aprovada:** `A`

**Decisão:** `available = capacity - committed - reserved` é derivado.

**Status:** `DECIDIDO`

### DEC-1121

**Escolha aprovada:** `B`

**Decisão:** Workforce available não fica negativo normalmente; operação acima da capacidade falha.

**Status:** `DECIDIDO`

### DEC-1122

**Escolha aprovada:** `A`

**Decisão:** GM pode forçar overcommit com override explícito/audit quando policy permitir.

**Status:** `DECIDIDO`

### DEC-1123

**Escolha aprovada:** `A`

**Decisão:** Overcommit gera alert/estado derivado.

**Status:** `DECIDIDO`

### DEC-1124

**Escolha aprovada:** `A`

**Decisão:** Remover assignment libera Workforce automaticamente.

**Status:** `DECIDIDO`

### DEC-1125

**Escolha aprovada:** `A`

**Decisão:** Reservation expirada libera Workforce quando policy de expiration existir.

**Status:** `DECIDIDO`

### DEC-1126

**Escolha aprovada:** `A`

**Decisão:** Reservation persistida possui ID próprio.

**Status:** `DECIDIDO`

### DEC-1127

**Escolha aprovada:** `A`

**Decisão:** Reservation possui source/correlation.

**Status:** `DECIDIDO`

### DEC-1128

**Escolha aprovada:** `B`

**Decisão:** Reservation e Assignment são conceitos distintos.

**Status:** `DECIDIDO`

---

## X/Y. Assignments — DEC-1129–DEC-1150

### DEC-1129

**Escolha aprovada:** `A`

**Decisão:** Assignment é modelo explícito; Project não é dono dos People data.

**Status:** `DECIDIDO`

### DEC-1130

**Escolha aprovada:** `A`

**Decisão:** Base: sourceRef, targetRef, workforceTypeId, amount.

**Status:** `DECIDIDO`

### DEC-1131

**Escolha aprovada:** `A`

**Decisão:** Source pode ser PopulationGroup.

**Status:** `DECIDIDO`

### DEC-1132

**Escolha aprovada:** `A`

**Decisão:** Source pode ser OperationalGroup.

**Status:** `DECIDIDO`

### DEC-1133

**Escolha aprovada:** `A`

**Decisão:** Source pode ser Notable quando target aceita indivíduo.

**Status:** `DECIDIDO`

### DEC-1134

**Escolha aprovada:** `A`

**Decisão:** Target usa generic typed ref.

**Status:** `DECIDIDO`

### DEC-1135

**Escolha aprovada:** `A`

**Decisão:** Targets aceitos são registrados por subsystems.

**Status:** `DECIDIDO`

### DEC-1136

**Escolha aprovada:** `A`

**Decisão:** Assignment possui ID próprio.

**Status:** `DECIDIDO`

### DEC-1137

**Escolha aprovada:** `A`

**Decisão:** Prefixo `asg_`.

**Status:** `DECIDIDO`

### DEC-1138

**Escolha aprovada:** `B`

**Decisão:** Status mínimo de Assignment: `active | ended`.

**Status:** `DECIDIDO`

### DEC-1139

**Escolha aprovada:** `B`

**Decisão:** Assignments encerrados podem sair do active store e permanecer em history/audit.

**Status:** `DECIDIDO`

### DEC-1140

**Escolha aprovada:** `A`

**Decisão:** `startedAtWorld` é opcional.

**Status:** `DECIDIDO`

### DEC-1141

**Escolha aprovada:** `A`

**Decisão:** `endsAtWorld` é opcional.

**Status:** `DECIDIDO`

### DEC-1142

**Escolha aprovada:** `B`

**Decisão:** Assignment depende de worldTime, não de calendar externo.

**Status:** `DECIDIDO`

### DEC-1143

**Escolha aprovada:** `A`

**Decisão:** Assignment sem prazo é válido.

**Status:** `DECIDIDO`

### DEC-1144

**Escolha aprovada:** `A`

**Decisão:** Amount deve ser > 0.

**Status:** `DECIDIDO`

### DEC-1145

**Escolha aprovada:** `A`

**Decisão:** Assignment não ultrapassa contribution da source por default.

**Status:** `DECIDIDO`

### DEC-1146

**Escolha aprovada:** `B`

**Decisão:** Se contribution cai abaixo do assignment, manter assignment e gerar overcommit/integrity alert.

**Status:** `DECIDIDO`

### DEC-1147

**Escolha aprovada:** `B`

**Decisão:** Sem rebalance automático no v1.

**Status:** `DECIDIDO`

### DEC-1148

**Escolha aprovada:** `A`

**Decisão:** Assignment mutation usa Authority.

**Status:** `DECIDIDO`

### DEC-1149

**Escolha aprovada:** `A`

**Decisão:** Create assignment usa expected revision/fresh Workforce quando relevante.

**Status:** `DECIDIDO`

### DEC-1150

**Escolha aprovada:** `A`

**Decisão:** Vários assignments podem ser coordenados transacionalmente em operação cross-service.

**Status:** `DECIDIDO`

---

## Z. CapabilityGrant formal — DEC-1151–DEC-1165

### DEC-1151

**Escolha aprovada:** `A`

**Decisão:** Existe contract formal `CapabilityGrant`.

**Status:** `DECIDIDO`

### DEC-1152

**Escolha aprovada:** `A`

**Decisão:** Grant inclui `capabilityId` e `source`.

**Status:** `DECIDIDO`

### DEC-1153

**Escolha aprovada:** `A`

**Decisão:** `CapabilityGrantSource` é discriminated union.

**Status:** `DECIDIDO`

### DEC-1154

**Escolha aprovada:** `B`

**Decisão:** Grant derivado não precisa ID próprio; identidade pode ser capability+source.

**Status:** `DECIDIDO`

### DEC-1155

**Escolha aprovada:** `B`

**Decisão:** Effective grants são calculados, não persistidos normalmente.

**Status:** `DECIDIDO`

### DEC-1156

**Escolha aprovada:** `A`

**Decisão:** Pode existir source/grant manual persistido explicitamente.

**Status:** `DECIDIDO`

### DEC-1157

**Escolha aprovada:** `A`

**Decisão:** Effective capability retorna todas as sources.

**Status:** `DECIDIDO`

### DEC-1158

**Escolha aprovada:** `A`

**Decisão:** Criar contract `EffectiveCapability` com sources.

**Status:** `DECIDIDO`

### DEC-1159

**Escolha aprovada:** `A`

**Decisão:** Effective capability pode ter warnings.

**Status:** `DECIDIDO`

### DEC-1160

**Escolha aprovada:** `A`

**Decisão:** Effective capability pode ficar `degraded` de forma derivada.

**Status:** `DECIDIDO`

### DEC-1161

**Escolha aprovada:** `A`

**Decisão:** Perder uma source não desabilita capability se outra válida permanece.

**Status:** `DECIDIDO`

### DEC-1162

**Escolha aprovada:** `A`

**Decisão:** Sem sources válidas, capability fica disabled.

**Status:** `DECIDIDO`

### DEC-1163

**Escolha aprovada:** `A`

**Decisão:** Merge complexo preserva provenance por source.

**Status:** `DECIDIDO`

### DEC-1164

**Escolha aprovada:** `A`

**Decisão:** Merge resolver recebe todas as sources.

**Status:** `DECIDIDO`

### DEC-1165

**Escolha aprovada:** `A`

**Decisão:** Falha de merge produz degraded/invalid + Diagnostics, nunca escolha arbitrária.

**Status:** `DECIDIDO`

---

## AA. CapabilityResolver — DEC-1166–DEC-1175

### DEC-1166

**Escolha aprovada:** `A`

**Decisão:** Existe `CapabilityResolver` central.

**Status:** `DECIDIDO`

### DEC-1167

**Escolha aprovada:** `A`

**Decisão:** Resolver consulta registries/providers de grants, não switch gigante.

**Status:** `DECIDIDO`

### DEC-1168

**Escolha aprovada:** `A`

**Decisão:** People registra `CapabilityGrantProvider`.

**Status:** `DECIDIDO`

### DEC-1169

**Escolha aprovada:** `A`

**Decisão:** Grant provider tem ID namespaced.

**Status:** `DECIDIDO`

### DEC-1170

**Escolha aprovada:** `A`

**Decisão:** Addons podem registrar grant providers.

**Status:** `DECIDIDO`

### DEC-1171

**Escolha aprovada:** `A`

**Decisão:** Resolver pode cachear effective capabilities.

**Status:** `DECIDIDO`

### DEC-1172

**Escolha aprovada:** `A`

**Decisão:** Mudanças de source invalidam cache.

**Status:** `DECIDIDO`

### DEC-1173

**Escolha aprovada:** `A`

**Decisão:** Cache é descartável/reconstruível.

**Status:** `DECIDIDO`

### DEC-1174

**Escolha aprovada:** `A`

**Decisão:** Capability calculation é determinística.

**Status:** `DECIDIDO`

### DEC-1175

**Escolha aprovada:** `A`

**Decisão:** Providers executam em ordem estável.

**Status:** `DECIDIDO`

---

## AB. People aggregation entre Domains — DEC-1176–DEC-1190

### DEC-1176

**Escolha aprovada:** `A`

**Decisão:** Parent pode exibir população agregada dos children.

**Status:** `DECIDIDO`

### DEC-1177

**Escolha aprovada:** `B`

**Decisão:** Aggregate não é persistido no parent; é derivado.

**Status:** `DECIDIDO`

### DEC-1178

**Escolha aprovada:** `A`

**Decisão:** Aggregation é opcional por query/UI.

**Status:** `DECIDIDO`

### DEC-1179

**Escolha aprovada:** `A`

**Decisão:** Distinguir own, descendant e aggregate population.

**Status:** `DECIDIDO`

### DEC-1180

**Escolha aprovada:** `A`

**Decisão:** Sheet mostra população própria e agregado separadamente.

**Status:** `DECIDIDO`

### DEC-1181

**Escolha aprovada:** `B`

**Decisão:** Query escolhe children diretos ou descendants recursivos.

**Status:** `DECIDIDO`

### DEC-1182

**Escolha aprovada:** `A`

**Decisão:** Aggregation recursiva possui cycle guard defensivo.

**Status:** `DECIDIDO`

### DEC-1183

**Escolha aprovada:** `A`

**Decisão:** Child unknown torna aggregate incompleto; nunca tratar como zero.

**Status:** `DECIDIDO`

### DEC-1184

**Escolha aprovada:** `A`

**Decisão:** Aggregate retorna known total + unknown contributors + completeness.

**Status:** `DECIDIDO`

### DEC-1185

**Escolha aprovada:** `A`

**Decisão:** Child estimated marca aggregate como estimated.

**Status:** `DECIDIDO`

### DEC-1186

**Escolha aprovada:** `A`

**Decisão:** Workforce também pode ser resumido/agregado.

**Status:** `DECIDIDO`

### DEC-1187

**Escolha aprovada:** `B`

**Decisão:** Workforce do child não fica automaticamente operacionalmente disponível ao parent.

**Status:** `DECIDIDO`

### DEC-1188

**Escolha aprovada:** `A`

**Decisão:** Distinguir summary aggregation de operational availability.

**Status:** `DECIDIDO`

### DEC-1189

**Escolha aprovada:** `A`

**Decisão:** Parent pode ver capacidade total sem poder consumi-la.

**Status:** `DECIDIDO`

### DEC-1190

**Escolha aprovada:** `A`

**Decisão:** Uso operacional de child workforce exige Assignment/Agreement/policy explícita.

**Status:** `DECIDIDO`

---

## AC. AggregationService — DEC-1191–DEC-1198

### DEC-1191

**Escolha aprovada:** `A`

**Decisão:** Criar `AggregationService` compartilhado entre subsystems.

**Status:** `DECIDIDO`

### DEC-1192

**Escolha aprovada:** `A`

**Decisão:** People registra agregadores específicos.

**Status:** `DECIDIDO`

### DEC-1193

**Escolha aprovada:** `A`

**Decisão:** Agregadores podem declarar `sum|count|merge|custom` quando útil.

**Status:** `DECIDIDO`

### DEC-1194

**Escolha aprovada:** `A`

**Decisão:** Aggregate result inclui provenance.

**Status:** `DECIDIDO`

### DEC-1195

**Escolha aprovada:** `A`

**Decisão:** UI pode pedir breakdown por child.

**Status:** `DECIDIDO`

### DEC-1196

**Escolha aprovada:** `A`

**Decisão:** Aggregation pode usar cache.

**Status:** `DECIDIDO`

### DEC-1197

**Escolha aprovada:** `A`

**Decisão:** Mudança relevante em descendant invalida cache.

**Status:** `DECIDIDO`

### DEC-1198

**Escolha aprovada:** `A`

**Decisão:** Invalidation usa índice/dependency graph em memória; não dual-write em parents.

**Status:** `DECIDIDO`

---

## AD. Visibility de People — DEC-1199–DEC-1210

### DEC-1199

**Escolha aprovada:** `A`

**Decisão:** Population total pode ter visibility própria.

**Status:** `DECIDIDO`

### DEC-1200

**Escolha aprovada:** `A`

**Decisão:** PopulationGroup pode ter visibility própria.

**Status:** `DECIDIDO`

### DEC-1201

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup pode ter visibility própria.

**Status:** `DECIDIDO`

### DEC-1202

**Escolha aprovada:** `A`

**Decisão:** Role pode ter visibility própria.

**Status:** `DECIDIDO`

### DEC-1203

**Escolha aprovada:** `A`

**Decisão:** Assignment pode ser secreto.

**Status:** `DECIDIDO`

### DEC-1204

**Escolha aprovada:** `A`

**Decisão:** Workforce pode vazar sources secretas; projection precisa considerar isso.

**Status:** `DECIDIDO`

### DEC-1205

**Escolha aprovada:** `B`

**Decisão:** Player recebe Workforce calculada apenas sobre o que sua projection permite.

**Status:** `DECIDIDO`

### DEC-1206

**Escolha aprovada:** `A`

**Decisão:** Derived values sensíveis a segredo são viewer-aware.

**Status:** `DECIDIDO`

### DEC-1207

**Escolha aprovada:** `A`

**Decisão:** Separar `AdministrativePeopleContext` de `ViewerPeopleContext`.

**Status:** `DECIDIDO`

### DEC-1208

**Escolha aprovada:** `A`

**Decisão:** Viewer context pode retornar total diferente do administrativo.

**Status:** `DECIDIDO`

### DEC-1209

**Escolha aprovada:** `A`

**Decisão:** UI deixa claro quando valor é conhecido/visível e não verdade absoluta.

**Status:** `DECIDIDO`

### DEC-1210

**Escolha aprovada:** `A`

**Decisão:** Aggregation para player acontece sobre projections sanitizadas, nunca raw data.

**Status:** `DECIDIDO`

---

## AE. Knowledge integration — DEC-1211–DEC-1215

### DEC-1211

**Escolha aprovada:** `A`

**Decisão:** People usa interface/policy de projection; não importa internals do KnowledgeService.

**Status:** `DECIDIDO`

### DEC-1212

**Escolha aprovada:** `A`

**Decisão:** Visibility usa contract comum compartilhado.

**Status:** `DECIDIDO`

### DEC-1213

**Escolha aprovada:** `A`

**Decisão:** Boolean `hidden` é insuficiente como ontologia final.

**Status:** `DECIDIDO`

### DEC-1214

**Escolha aprovada:** `B`

**Decisão:** Não congelar toda taxonomia Knowledge agora; usar `VisibilityRef/Policy` placeholder até a rodada própria.

**Status:** `DECIDIDO`

### DEC-1215

**Escolha aprovada:** `A`

**Decisão:** People apenas carrega/referencia visibility policy; não implementa Knowledge completo agora.

**Status:** `DECIDIDO`

---

## AF. Storage de People — DEC-1216–DEC-1225

### DEC-1216

**Escolha aprovada:** `A`

**Decisão:** Population summary/config fica no Domain Actor.

**Status:** `DECIDIDO`

### DEC-1217

**Escolha aprovada:** `A`

**Decisão:** PopulationGroups ficam embedded no Domain inicialmente.

**Status:** `DECIDIDO`

### DEC-1218

**Escolha aprovada:** `A`

**Decisão:** Notables ficam embedded records no Domain.

**Status:** `DECIDIDO`

### DEC-1219

**Escolha aprovada:** `A`

**Decisão:** DomainRoles ficam embedded inicialmente.

**Status:** `DECIDIDO`

### DEC-1220

**Escolha aprovada:** `B`

**Decisão:** Assignments ficam atrás de repository abstraction; storage físico não é congelado.

**Status:** `DECIDIDO`

### DEC-1221

**Escolha aprovada:** `B`

**Decisão:** OperationalGroups ficam atrás de repository abstraction.

**Status:** `DECIDIDO`

### DEC-1222

**Escolha aprovada:** `A`

**Decisão:** Manter repository para OperationalGroup por potencial crescimento/lifecycle.

**Status:** `DECIDIDO`

### DEC-1223

**Escolha aprovada:** `A`

**Decisão:** UI não conhece storage físico de OperationalGroup.

**Status:** `DECIDIDO`

### DEC-1224

**Escolha aprovada:** `A`

**Decisão:** `PeopleRepository` encapsula small embedded records.

**Status:** `DECIDIDO`

### DEC-1225

**Escolha aprovada:** `A`

**Decisão:** Repository é usado mesmo com storage simples para facilitar migrations futuras.

**Status:** `DECIDIDO`

---

## AG. People schema no Domain — DEC-1226–DEC-1230

### DEC-1226

**Escolha aprovada:** `A`

**Decisão:** People schema agrupa `schemaVersion`, `population`, `populationGroups`, `notables`, `roles`.

**Status:** `DECIDIDO`

### DEC-1227

**Escolha aprovada:** `A`

**Decisão:** OperationalGroups/Assignments podem ser expostos apenas via repositories/contexts mesmo se embedded internamente.

**Status:** `DECIDIDO`

### DEC-1228

**Escolha aprovada:** `B`

**Decisão:** Global Domain revision basta inicialmente; sem People revision própria no v1.

**Status:** `DECIDIDO`

### DEC-1229

**Escolha aprovada:** `B`

**Decisão:** PopulationGroup não possui revision individual inicialmente.

**Status:** `DECIDIDO`

### DEC-1230

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup complexo pode ganhar revision própria futuramente.

**Status:** `DECIDIDO`

---

## AH. Referential integrity — DEC-1231–DEC-1238

### DEC-1231

**Escolha aprovada:** `A`

**Decisão:** Role occupant Notable inexistente é broken ref/integrity issue.

**Status:** `DECIDIDO`

### DEC-1232

**Escolha aprovada:** `A`

**Decisão:** Assignment source inexistente é broken ref/integrity issue.

**Status:** `DECIDIDO`

### DEC-1233

**Escolha aprovada:** `A`

**Decisão:** OperationalGroup apontando para PopulationGroup removido vira broken source link.

**Status:** `DECIDIDO`

### DEC-1234

**Escolha aprovada:** `A`

**Decisão:** Repair tools podem relinkar IDs locais.

**Status:** `DECIDIDO`

### DEC-1235

**Escolha aprovada:** `A`

**Decisão:** Local refs guardam lastKnownName quando repair/histórico se beneficiar.

**Status:** `DECIDIDO`

### DEC-1236

**Escolha aprovada:** `A`

**Decisão:** Delete de Notable ocupado em Role é bloqueado até desassign/relink.

**Status:** `DECIDIDO`

### DEC-1237

**Escolha aprovada:** `A`

**Decisão:** Delete de Notable member de OperationalGroup possui impact preview.

**Status:** `DECIDIDO`

### DEC-1238

**Escolha aprovada:** `A`

**Decisão:** Force delete só existe em repair/admin tool explícita e auditada.

**Status:** `DECIDIDO`

---

## AI. Mutations e Commands de People — DEC-1239–DEC-1246

### DEC-1239

**Escolha aprovada:** `A`

**Decisão:** People registra command types namespaced e semânticos.

**Status:** `DECIDIDO`

### DEC-1240

**Escolha aprovada:** `A`

**Decisão:** Evitar command genérico de patch arbitrário em `system.people`.

**Status:** `DECIDIDO`

### DEC-1241

**Escolha aprovada:** `A`

**Decisão:** `population.set` pode ser mutation simples.

**Status:** `DECIDIDO`

### DEC-1242

**Escolha aprovada:** `A`

**Decisão:** Role assignment simples pode ser mutation simples.

**Status:** `DECIDIDO`

### DEC-1243

**Escolha aprovada:** `A`

**Decisão:** Role assignment não precisa Transaction só porque effective capability derivada muda.

**Status:** `DECIDIDO`

### DEC-1244

**Escolha aprovada:** `A`

**Decisão:** Assignment People↔Project pode ser transacional quando cruza subsystems.

**Status:** `DECIDIDO`

### DEC-1245

**Escolha aprovada:** `A`

**Decisão:** Group creation normalmente não precisa Transaction.

**Status:** `DECIDIDO`

### DEC-1246

**Escolha aprovada:** `A`

**Decisão:** Import massivo usa batch/admin mutation especializada, não centenas de UI commands.

**Status:** `DECIDIDO`

---

## AJ. UI — People Overview — DEC-1247–DEC-1250

### DEC-1247

**Escolha aprovada:** `A`

**Decisão:** People UI segue Summary → Explanation → Detail → Action.

**Status:** `DECIDIDO`

### DEC-1248

**Escolha aprovada:** `A`

**Decisão:** Overview mostra Population, Notables, OperationalGroups, Available Workforce e Role requirements.

**Status:** `DECIDIDO`

### DEC-1249

**Escolha aprovada:** `A`

**Decisão:** Workforce mostra apenas tipos relevantes, não registries vazios.

**Status:** `DECIDIDO`

### DEC-1250

**Escolha aprovada:** `A`

**Decisão:** Requirements faltantes aparecem como alertas compactos.

**Status:** `DECIDIDO`

---

## AK. UI — Population — DEC-1251–DEC-1258

### DEC-1251

**Escolha aprovada:** `A`

**Decisão:** Population mode pode ser alterado na UI.

**Status:** `DECIDIDO`

### DEC-1252

**Escolha aprovada:** `A`

**Decisão:** Troca de mode com efeito no total mostra preview.

**Status:** `DECIDIDO`

### DEC-1253

**Escolha aprovada:** `B`

**Decisão:** Trocar mode não precisa apagar imediatamente valor manual anterior; source of truth do mode continua claro.

**Status:** `DECIDIDO`

### DEC-1254

**Escolha aprovada:** `A`

**Decisão:** UI explica `hybrid` de forma curta.

**Status:** `DECIDIDO`

### DEC-1255

**Escolha aprovada:** `A`

**Decisão:** PopulationGroups usam table/list compacta por default.

**Status:** `DECIDIDO`

### DEC-1256

**Escolha aprovada:** `A`

**Decisão:** Row mostra name, count, includedInTotal e tags principais.

**Status:** `DECIDIDO`

### DEC-1257

**Escolha aprovada:** `A`

**Decisão:** Edição detalhada abre popover/dialog.

**Status:** `DECIDIDO`

### DEC-1258

**Escolha aprovada:** `A`

**Decisão:** Criar group começa simples: nome + count + includedInTotal; detalhes opcionais.

**Status:** `DECIDIDO`

---

## AL. UI — Notables — DEC-1259–DEC-1265

### DEC-1259

**Escolha aprovada:** `A`

**Decisão:** Notables usam lista/cards compactos com retrato.

**Status:** `DECIDIDO`

### DEC-1260

**Escolha aprovada:** `A`

**Decisão:** Mostrar Roles do Notable de forma resumida.

**Status:** `DECIDIDO`

### DEC-1261

**Escolha aprovada:** `A`

**Decisão:** Drag Actor → Notables cria linked Notable.

**Status:** `DECIDIDO`

### DEC-1262

**Escolha aprovada:** `A`

**Decisão:** Drag Actor já existente evita duplicata.

**Status:** `DECIDIDO`

### DEC-1263

**Escolha aprovada:** `A`

**Decisão:** Criar inline Notable é rápido e não exige Actor.

**Status:** `DECIDIDO`

### DEC-1264

**Escolha aprovada:** `A`

**Decisão:** Pode existir 'Create Actor from Inline Notable' futuramente.

**Status:** `DECIDIDO`

### DEC-1265

**Escolha aprovada:** `A`

**Decisão:** Conversão preserva `NotableId`.

**Status:** `DECIDIDO`

---

## AM. UI — Roles — DEC-1266–DEC-1272

### DEC-1266

**Escolha aprovada:** `A`

**Decisão:** Roles mostram slots/occupants claramente.

**Status:** `DECIDIDO`

### DEC-1267

**Escolha aprovada:** `A`

**Decisão:** Vacancy é visualmente evidente.

**Status:** `DECIDIDO`

### DEC-1268

**Escolha aprovada:** `A`

**Decisão:** Sem animação agressiva/piscante permanente.

**Status:** `DECIDIDO`

### DEC-1269

**Escolha aprovada:** `A`

**Decisão:** Drag Notable sobre Role pode atribuir com validation.

**Status:** `DECIDIDO`

### DEC-1270

**Escolha aprovada:** `A`

**Decisão:** Drag Actor sobre Role pode criar/reutilizar Notable e atribuir.

**Status:** `DECIDIDO`

### DEC-1271

**Escolha aprovada:** `A`

**Decisão:** Role mostra capabilities concedidas em detalhe/tooltip.

**Status:** `DECIDIDO`

### DEC-1272

**Escolha aprovada:** `A`

**Decisão:** Role UI explica por que grant não está ativo.

**Status:** `DECIDIDO`

---

## AN. UI — Operational Groups — DEC-1273–DEC-1278

### DEC-1273

**Escolha aprovada:** `A`

**Decisão:** OperationalGroups têm workspace próprio dentro de People.

**Status:** `DECIDIDO`

### DEC-1274

**Escolha aprovada:** `A`

**Decisão:** Lista mostra name, definition/type, size, status, key capabilities e assignments.

**Status:** `DECIDIDO`

### DEC-1275

**Escolha aprovada:** `A`

**Decisão:** Detail abre drawer/subview.

**Status:** `DECIDIDO`

### DEC-1276

**Escolha aprovada:** `A`

**Decisão:** Abstract mode esconde roster detalhado inútil.

**Status:** `DECIDIDO`

### DEC-1277

**Escolha aprovada:** `A`

**Decisão:** Partial mode mostra relação known/total.

**Status:** `DECIDIDO`

### DEC-1278

**Escolha aprovada:** `A`

**Decisão:** Explicit mode mostra size derivado.

**Status:** `DECIDIDO`

---

## AO. UI — Workforce — DEC-1279–DEC-1283

### DEC-1279

**Escolha aprovada:** `A`

**Decisão:** Workforce é apresentado como capacidade operacional, não população.

**Status:** `DECIDIDO`

### DEC-1280

**Escolha aprovada:** `A`

**Decisão:** Mostrar Capacity, Committed, Reserved e Available.

**Status:** `DECIDIDO`

### DEC-1281

**Escolha aprovada:** `A`

**Decisão:** Breakdown/provenance é clicável.

**Status:** `DECIDIDO`

### DEC-1282

**Escolha aprovada:** `A`

**Decisão:** Overcommit/negative availability aparece como alerta.

**Status:** `DECIDIDO`

### DEC-1283

**Escolha aprovada:** `A`

**Decisão:** Evitar progress bars decorativas sem necessidade.

**Status:** `DECIDIDO`

---

## AP. UI — Assignments — DEC-1284–DEC-1287

### DEC-1284

**Escolha aprovada:** `A`

**Decisão:** Assignments ativos aparecem em source e target via contexts.

**Status:** `DECIDIDO`

### DEC-1285

**Escolha aprovada:** `A`

**Decisão:** Project UI consulta AssignmentRepository; não duplica People data.

**Status:** `DECIDIDO`

### DEC-1286

**Escolha aprovada:** `A`

**Decisão:** Creation preview mostra impacto na Workforce.

**Status:** `DECIDIDO`

### DEC-1287

**Escolha aprovada:** `A`

**Decisão:** Overcommit exige override explícito.

**Status:** `DECIDIDO`

---

## AQ. Import / Export People — DEC-1288–DEC-1298

### DEC-1288

**Escolha aprovada:** `A`

**Decisão:** Full Domain export inclui People.

**Status:** `DECIDIDO`

### DEC-1289

**Escolha aprovada:** `A`

**Decisão:** Domain Template não inclui população atual por default.

**Status:** `DECIDIDO`

### DEC-1290

**Escolha aprovada:** `A`

**Decisão:** Template pode incluir PopulationGroup presets.

**Status:** `DECIDIDO`

### DEC-1291

**Escolha aprovada:** `A`

**Decisão:** Template não inclui Notables concretos por default.

**Status:** `DECIDIDO`

### DEC-1292

**Escolha aprovada:** `A`

**Decisão:** Template pode incluir Roles.

**Status:** `DECIDIDO`

### DEC-1293

**Escolha aprovada:** `A`

**Decisão:** Template não inclui occupants por default.

**Status:** `DECIDIDO`

### DEC-1294

**Escolha aprovada:** `A`

**Decisão:** Template pode incluir OperationalGroupDefinitions/presets; instances apenas quando fizer sentido.

**Status:** `DECIDIDO`

### DEC-1295

**Escolha aprovada:** `A`

**Decisão:** Import remapeia Notable/Role/Group local IDs.

**Status:** `DECIDIDO`

### DEC-1296

**Escolha aprovada:** `A`

**Decisão:** Import reescreve occupants/assignments via remap table.

**Status:** `DECIDIDO`

### DEC-1297

**Escolha aprovada:** `A`

**Decisão:** Linked Actor externo ausente permanece unresolved e entra no report.

**Status:** `DECIDIDO`

### DEC-1298

**Escolha aprovada:** `A`

**Decisão:** Pode haver relink wizard futuramente.

**Status:** `DECIDIDO`

---

## AR. Migrations de People — DEC-1299–DEC-1305

### DEC-1299

**Escolha aprovada:** `A`

**Decisão:** People possui migration registry próprio coordenado pelo global.

**Status:** `DECIDIDO`

### DEC-1300

**Escolha aprovada:** `A`

**Decisão:** Cada migration relevante possui fixture de schema antigo.

**Status:** `DECIDIDO`

### DEC-1301

**Escolha aprovada:** `A`

**Decisão:** Migration pode transformar estrutura de Notable.

**Status:** `DECIDIDO`

### DEC-1302

**Escolha aprovada:** `A`

**Decisão:** Migration pode criar OperationalGroups a partir de legado.

**Status:** `DECIDIDO`

### DEC-1303

**Escolha aprovada:** `A`

**Decisão:** Preservar IDs locais quando possível.

**Status:** `DECIDIDO`

### DEC-1304

**Escolha aprovada:** `A`

**Decisão:** Quando ID muda, refs internas são remapeadas.

**Status:** `DECIDIDO`

### DEC-1305

**Escolha aprovada:** `A`

**Decisão:** Ref impossível de resolver é preservada como broken + Diagnostics.

**Status:** `DECIDIDO`

---

## AS. People diagnostics — DEC-1306–DEC-1314

### DEC-1306

**Escolha aprovada:** `A`

**Decisão:** Detectar Role occupant inexistente.

**Status:** `DECIDIDO`

### DEC-1307

**Escolha aprovada:** `A`

**Decisão:** Detectar Assignment source/target inexistente.

**Status:** `DECIDIDO`

### DEC-1308

**Escolha aprovada:** `A`

**Decisão:** Detectar Workforce overcommit.

**Status:** `DECIDIDO`

### DEC-1309

**Escolha aprovada:** `A`

**Decisão:** Detectar duplicate Notable→Actor no mesmo Domain.

**Status:** `DECIDIDO`

### DEC-1310

**Escolha aprovada:** `A`

**Decisão:** Detectar invalid Role occupancy.

**Status:** `DECIDIDO`

### DEC-1311

**Escolha aprovada:** `A`

**Decisão:** Detectar sumGroups indeterminado por count unknown.

**Status:** `DECIDIDO`

### DEC-1312

**Escolha aprovada:** `A`

**Decisão:** Detectar explicit membership mismatch.

**Status:** `DECIDIDO`

### DEC-1313

**Escolha aprovada:** `A`

**Decisão:** Detectar unknown Definitions.

**Status:** `DECIDIDO`

### DEC-1314

**Escolha aprovada:** `A`

**Decisão:** Repair tools resolvem sem exigir edição manual de JSON.

**Status:** `DECIDIDO`

---

## AT. Tests — Population — DEC-1315–DEC-1321

### DEC-1315

**Escolha aprovada:** `A`

**Decisão:** Testar manual population.

**Status:** `DECIDIDO`

### DEC-1316

**Escolha aprovada:** `A`

**Decisão:** Testar sumGroups.

**Status:** `DECIDIDO`

### DEC-1317

**Escolha aprovada:** `A`

**Decisão:** Testar included unknown tornando total unknown.

**Status:** `DECIDIDO`

### DEC-1318

**Escolha aprovada:** `A`

**Decisão:** Testar hybrid sem double-count automático.

**Status:** `DECIDIDO`

### DEC-1319

**Escolha aprovada:** `A`

**Decisão:** Testar groups sobrepostos.

**Status:** `DECIDIDO`

### DEC-1320

**Escolha aprovada:** `A`

**Decisão:** Testar total enorme ainda safe integer.

**Status:** `DECIDIDO`

### DEC-1321

**Escolha aprovada:** `A`

**Decisão:** Testar overflow de safe integer.

**Status:** `DECIDIDO`

---

## AU. Tests — Notables / Roles — DEC-1322–DEC-1332

### DEC-1322

**Escolha aprovada:** `A`

**Decisão:** Testar Inline Notable.

**Status:** `DECIDIDO`

### DEC-1323

**Escolha aprovada:** `A`

**Decisão:** Testar linked Actor Notable.

**Status:** `DECIDIDO`

### DEC-1324

**Escolha aprovada:** `A`

**Decisão:** Testar Actor apagado preservando broken ref.

**Status:** `DECIDIDO`

### DEC-1325

**Escolha aprovada:** `A`

**Decisão:** Testar inline→Actor preservando NotableId.

**Status:** `DECIDIDO`

### DEC-1326

**Escolha aprovada:** `A`

**Decisão:** Testar duplicate Actor Notable bloqueado.

**Status:** `DECIDIDO`

### DEC-1327

**Escolha aprovada:** `A`

**Decisão:** Testar Role vazio.

**Status:** `DECIDIDO`

### DEC-1328

**Escolha aprovada:** `A`

**Decisão:** Testar max occupancy.

**Status:** `DECIDIDO`

### DEC-1329

**Escolha aprovada:** `A`

**Decisão:** Testar requirement unsatisfied sem invalidar Domain.

**Status:** `DECIDIDO`

### DEC-1330

**Escolha aprovada:** `A`

**Decisão:** Testar Role grant de capability.

**Status:** `DECIDIDO`

### DEC-1331

**Escolha aprovada:** `A`

**Decisão:** Testar remoção do occupant removendo grant derivado.

**Status:** `DECIDIDO`

### DEC-1332

**Escolha aprovada:** `A`

**Decisão:** Testar outra source mantendo capability ativa.

**Status:** `DECIDIDO`

---

## AV. Tests — Operational Groups — DEC-1333–DEC-1338

### DEC-1333

**Escolha aprovada:** `A`

**Decisão:** Testar abstract group.

**Status:** `DECIDIDO`

### DEC-1334

**Escolha aprovada:** `A`

**Decisão:** Testar partial membership.

**Status:** `DECIDIDO`

### DEC-1335

**Escolha aprovada:** `A`

**Decisão:** Testar explicit membership e size derivado.

**Status:** `DECIDIDO`

### DEC-1336

**Escolha aprovada:** `A`

**Decisão:** Testar disbanded removendo grants.

**Status:** `DECIDIDO`

### DEC-1337

**Escolha aprovada:** `A`

**Decisão:** Testar link a PopulationGroup sem dupla contagem.

**Status:** `DECIDIDO`

### DEC-1338

**Escolha aprovada:** `A`

**Decisão:** Testar group role occupancy.

**Status:** `DECIDIDO`

---

## AW. Tests — Workforce / Assignments — DEC-1339–DEC-1346

### DEC-1339

**Escolha aprovada:** `A`

**Decisão:** Testar Workforce provenance.

**Status:** `DECIDIDO`

### DEC-1340

**Escolha aprovada:** `A`

**Decisão:** Testar `available = capacity - committed - reserved`.

**Status:** `DECIDIDO`

### DEC-1341

**Escolha aprovada:** `A`

**Decisão:** Testar overcommit bloqueado normalmente.

**Status:** `DECIDIDO`

### DEC-1342

**Escolha aprovada:** `A`

**Decisão:** Testar GM override auditado.

**Status:** `DECIDIDO`

### DEC-1343

**Escolha aprovada:** `A`

**Decisão:** Testar assignment removal liberando disponibilidade.

**Status:** `DECIDIDO`

### DEC-1344

**Escolha aprovada:** `A`

**Decisão:** Testar contribution cair abaixo do assignment sem apagar assignment.

**Status:** `DECIDIDO`

### DEC-1345

**Escolha aprovada:** `A`

**Decisão:** Testar reservation e assignment como conceitos distintos.

**Status:** `DECIDIDO`

### DEC-1346

**Escolha aprovada:** `A`

**Decisão:** Testar cross-service assignment transacional.

**Status:** `DECIDIDO`

---

## AX. Security tests — DEC-1347–DEC-1350

### DEC-1347

**Escolha aprovada:** `A`

**Decisão:** Player não recebe secret Notable.

**Status:** `DECIDIDO`

### DEC-1348

**Escolha aprovada:** `A`

**Decisão:** Player não recebe secret Role.

**Status:** `DECIDIDO`

### DEC-1349

**Escolha aprovada:** `A`

**Decisão:** Secret OperationalGroup não pode vazar via Workforce total.

**Status:** `DECIDIDO`

### DEC-1350

**Escolha aprovada:** `A`

**Decisão:** Parent aggregation não revela dados secretos de children.

**Status:** `DECIDIDO`

---

## AY. Performance tests — DEC-1351–DEC-1357

### DEC-1351

**Escolha aprovada:** `A`

**Decisão:** Benchmark real de base pequena com 12 NPCs.

**Status:** `DECIDIDO`

### DEC-1352

**Escolha aprovada:** `A`

**Decisão:** Benchmark extremo com milhares de PopulationGroups para detectar O(n²).

**Status:** `DECIDIDO`

### DEC-1353

**Escolha aprovada:** `A`

**Decisão:** Benchmark com centenas de OperationalGroups.

**Status:** `DECIDIDO`

### DEC-1354

**Escolha aprovada:** `A`

**Decisão:** Benchmark de hierarchy grande com aggregate population.

**Status:** `DECIDIDO`

### DEC-1355

**Escolha aprovada:** `A`

**Decisão:** Benchmark de capability resolution com centenas de grants.

**Status:** `DECIDIDO`

### DEC-1356

**Escolha aprovada:** `A`

**Decisão:** Benchmark de Workforce cache invalidation.

**Status:** `DECIDIDO`

### DEC-1357

**Escolha aprovada:** `A`

**Decisão:** Benchmark de player projection grande.

**Status:** `DECIDIDO`

---

## AZ. UI performance — DEC-1358–DEC-1362

### DEC-1358

**Escolha aprovada:** `A`

**Decisão:** Listas grandes usam paginação/virtualização quando necessário.

**Status:** `DECIDIDO`

### DEC-1359

**Escolha aprovada:** `B`

**Decisão:** Não virtualizar listas pequenas; aplicar apenas acima de thresholds práticos.

**Status:** `DECIDIDO`

### DEC-1360

**Escolha aprovada:** `A`

**Decisão:** Threshold é implementation detail, não contract persistido.

**Status:** `DECIDIDO`

### DEC-1361

**Escolha aprovada:** `A`

**Decisão:** Search/filter usa índice derivado, não manipulação pesada de DOM.

**Status:** `DECIDIDO`

### DEC-1362

**Escolha aprovada:** `A`

**Decisão:** Não recalcular aggregate de império inteiro a cada render; usar cache invalidável.

**Status:** `DECIDIDO`

---

## BA. People Public API — DEC-1363–DEC-1370

### DEC-1363

**Escolha aprovada:** `A`

**Decisão:** API expõe `getPeopleContext(domainUuid, viewer)`.

**Status:** `DECIDIDO`

### DEC-1364

**Escolha aprovada:** `A`

**Decisão:** API expõe `getPopulationSummary()`.

**Status:** `DECIDIDO`

### DEC-1365

**Escolha aprovada:** `A`

**Decisão:** API expõe `getEffectiveWorkforce()`.

**Status:** `DECIDIDO`

### DEC-1366

**Escolha aprovada:** `A`

**Decisão:** `listNotables()` retorna sanitized DTO.

**Status:** `DECIDIDO`

### DEC-1367

**Escolha aprovada:** `A`

**Decisão:** `listRoles()` retorna sanitized DTO.

**Status:** `DECIDIDO`

### DEC-1368

**Escolha aprovada:** `A`

**Decisão:** `listOperationalGroups()` retorna sanitized DTO.

**Status:** `DECIDIDO`

### DEC-1369

**Escolha aprovada:** `A`

**Decisão:** Mutations públicas usam Commands, nunca array mutation direta.

**Status:** `DECIDIDO`

### DEC-1370

**Escolha aprovada:** `A`

**Decisão:** Repositories low-level, se expostos, ficam em API explicitamente privilegiada e não no default.

**Status:** `DECIDIDO`

---

## BB. Content packs — DEC-1371–DEC-1376

### DEC-1371

**Escolha aprovada:** `A`

**Decisão:** People packs podem trazer RoleDefinitions.

**Status:** `DECIDIDO`

### DEC-1372

**Escolha aprovada:** `A`

**Decisão:** Podem trazer OperationalGroupDefinitions.

**Status:** `DECIDIDO`

### DEC-1373

**Escolha aprovada:** `A`

**Decisão:** Podem trazer WorkforceTypeDefinitions.

**Status:** `DECIDIDO`

### DEC-1374

**Escolha aprovada:** `A`

**Decisão:** Podem trazer Population templates/presets.

**Status:** `DECIDIDO`

### DEC-1375

**Escolha aprovada:** `A`

**Decisão:** Podem trazer Notable Actors como conteúdo opcional de cenário.

**Status:** `DECIDIDO`

### DEC-1376

**Escolha aprovada:** `A`

**Decisão:** Engine e content packs permanecem separados.

**Status:** `DECIDIDO`

---

## BC. Escopo T3 — People — DEC-1377–DEC-1395

### DEC-1377

**Escolha aprovada:** `A`

**Decisão:** T3 implementa manual/sumGroups/hybrid completos.

**Status:** `DECIDIDO`

### DEC-1378

**Escolha aprovada:** `A`

**Decisão:** T3 inclui PopulationGroups.

**Status:** `DECIDIDO`

### DEC-1379

**Escolha aprovada:** `A`

**Decisão:** T3 inclui Notables inline + Actor-linked.

**Status:** `DECIDIDO`

### DEC-1380

**Escolha aprovada:** `A`

**Decisão:** T3 inclui Roles.

**Status:** `DECIDIDO`

### DEC-1381

**Escolha aprovada:** `A`

**Decisão:** T3 inclui RoleDefinition registry/custom básico.

**Status:** `DECIDIDO`

### DEC-1382

**Escolha aprovada:** `A`

**Decisão:** T3 inclui CapabilityGrant resolver básico.

**Status:** `DECIDIDO`

### DEC-1383

**Escolha aprovada:** `A`

**Decisão:** T3 inclui OperationalGroups core funcional.

**Status:** `DECIDIDO`

### DEC-1384

**Escolha aprovada:** `A`

**Decisão:** T3 inclui membership modes.

**Status:** `DECIDIDO`

### DEC-1385

**Escolha aprovada:** `A`

**Decisão:** T3 inclui group roles básicos reutilizando Role engine.

**Status:** `DECIDIDO`

### DEC-1386

**Escolha aprovada:** `A`

**Decisão:** T3 inclui Workforce básica derivada.

**Status:** `DECIDIDO`

### DEC-1387

**Escolha aprovada:** `A`

**Decisão:** T3 inclui Workforce reservations em versão mínima; expiration avançada pode vir depois.

**Status:** `DECIDIDO`

### DEC-1388

**Escolha aprovada:** `A`

**Decisão:** T3 inclui Assignment model/repository básico.

**Status:** `DECIDIDO`

### DEC-1389

**Escolha aprovada:** `A`

**Decisão:** T3 inclui parent/child population aggregation básica.

**Status:** `DECIDIDO`

### DEC-1390

**Escolha aprovada:** `A`

**Decisão:** T3 integra shell/policy viewer-aware; Knowledge completo fica para rodada própria.

**Status:** `DECIDIDO`

### DEC-1391

**Escolha aprovada:** `A`

**Decisão:** T3 prioriza UI funcional/limpa; não polimento visual excessivo.

**Status:** `DECIDIDO`

### DEC-1392

**Escolha aprovada:** `A`

**Decisão:** T3 inclui drag/drop Actor→Notable.

**Status:** `DECIDIDO`

### DEC-1393

**Escolha aprovada:** `A`

**Decisão:** T3 inclui drag/drop Notable→Role.

**Status:** `DECIDIDO`

### DEC-1394

**Escolha aprovada:** `A`

**Decisão:** T3 inclui Diagnostics básico de People.

**Status:** `DECIDIDO`

### DEC-1395

**Escolha aprovada:** `A`

**Decisão:** T3 participa de Domain import/export; wizard avançado pode vir depois.

**Status:** `DECIDIDO`

---

## BD. Gate de aprovação T3 — DEC-1396–DEC-1400

### DEC-1396

**Escolha aprovada:** `A`

**Decisão:** Base pequena com 12 NPCs deve ser configurável rapidamente.

**Status:** `DECIDIDO`

### DEC-1397

**Escolha aprovada:** `A`

**Decisão:** Império grande não exige criar Actors para milhões de pessoas.

**Status:** `DECIDIDO`

### DEC-1398

**Escolha aprovada:** `A`

**Decisão:** Nenhuma UI obriga granularidade maior do que o GM deseja.

**Status:** `DECIDIDO`

### DEC-1399

**Escolha aprovada:** `A`

**Decisão:** Mesma arquitetura deve funcionar de 12 pessoas a múltiplos planetas.

**Status:** `DECIDIDO`

### DEC-1400

**Escolha aprovada:** `A`

**Decisão:** T3 só é aprovado quando People funciona tanto abstratamente quanto detalhadamente.

**Status:** `DECIDIDO`

---

## BE. Leis finais de People — DEC-1401–DEC-1415

### DEC-1401

**Escolha aprovada:** `APROVAR`

**Decisão:** Population não é roster.

**Status:** `DECIDIDO`

### DEC-1402

**Escolha aprovada:** `APROVAR`

**Decisão:** PopulationGroup não é OperationalGroup.

**Status:** `DECIDIDO`

### DEC-1403

**Escolha aprovada:** `APROVAR`

**Decisão:** Notable não é necessariamente Actor.

**Status:** `DECIDIDO`

### DEC-1404

**Escolha aprovada:** `APROVAR`

**Decisão:** Role não é pessoa.

**Status:** `DECIDIDO`

### DEC-1405

**Escolha aprovada:** `APROVAR`

**Decisão:** Role não é Foundry permission.

**Status:** `DECIDIDO`

### DEC-1406

**Escolha aprovada:** `APROVAR`

**Decisão:** Workforce não é população.

**Status:** `DECIDIDO`

### DEC-1407

**Escolha aprovada:** `APROVAR`

**Decisão:** Workforce available é derivada; nunca digitada como truth independente.

**Status:** `DECIDIDO`

### DEC-1408

**Escolha aprovada:** `APROVAR`

**Decisão:** Assignment não pertence ao Project; é relação operacional com contract próprio.

**Status:** `DECIDIDO`

### DEC-1409

**Escolha aprovada:** `APROVAR`

**Decisão:** Capability derivada nunca é copiada para base capability.

**Status:** `DECIDIDO`

### DEC-1410

**Escolha aprovada:** `APROVAR`

**Decisão:** Parent summary não implica direito operacional de consumir recursos/workforce dos filhos.

**Status:** `DECIDIDO`

### DEC-1411

**Escolha aprovada:** `APROVAR`

**Decisão:** Viewer projection é calculada antes da agregação quando segredo pode alterar o total.

**Status:** `DECIDIDO`

### DEC-1412

**Escolha aprovada:** `APROVAR`

**Decisão:** Storage físico fica atrás de repositories quando a entidade pode crescer ou mudar de lifecycle.

**Status:** `DECIDIDO`

### DEC-1413

**Escolha aprovada:** `APROVAR`

**Decisão:** People funciona sem sistema RPG específico.

**Status:** `DECIDIDO`

### DEC-1414

**Escolha aprovada:** `APROVAR`

**Decisão:** System adapters enriquecem People, mas não redefinem sua ontologia.

**Status:** `DECIDIDO`

### DEC-1415

**Escolha aprovada:** `APROVAR`

**Decisão:** Escala não exige granularidade: um império pode ser abstrato e uma base pequena totalmente detalhada.

**Status:** `DECIDIDO`

---

# 4. Escopo congelado do T3 — People

O gate T3 implementa, no mínimo:

- Population `manual`, `sumGroups` e `hybrid`;
- PopulationGroups;
- Notables inline e Actor-linked;
- RoleDefinitions e Roles;
- CapabilityGrantResolver básico;
- OperationalGroups core com membership modes;
- Group Roles básicos reutilizando a Role engine;
- Workforce derivada + contributions + provenance;
- Workforce reservations em versão mínima;
- Assignment model/repository básico;
- Aggregation parent/child de Population;
- integration shell de visibility/Knowledge;
- drag/drop Actor→Notable e Notable→Role;
- People Diagnostics básico;
- participação no Domain import/export;
- test harness e benchmarks de pequena base e grande escala.

Critério de aprovação T3:

> People deve funcionar bem tanto **abstratamente** quanto **detalhadamente**, sem obrigar o GM a criar mais granularidade do que deseja.

---

# 5. Continuidade para a próxima ramificação

A próxima rodada planejada é **Rodada 06 — Economy / Resources**.

Ela deve partir obrigatoriamente das decisões anteriores já congeladas, principalmente:

- ResourceDefinition global/reutilizável;
- ResourceAccount por Domain;
- integer minor units / safe integers;
- capacity opcional;
- negative balance por definition policy;
- overflow policy;
- Reservations desde o primeiro Economy release;
- toda alteração de saldo gera LedgerEntry;
- manual GM edit vira Adjustment entry;
- LedgerEntry é imutável; correções usam reversal/adjustment;
- transfer entre Domains é Transaction coordenada;
- provider externo autoritativo continua sendo source of truth;
- fail-closed quando provider necessário está indisponível;
- Authority/CommandBus/MutationCoordinator/Recovery da Rodada 04 são infraestrutura obrigatória;
- Workforce/Assignments da Rodada 05 não devem ser duplicados dentro de Economy.

---

# 6. Preservação

Este snapshot é uma fonte de continuidade. Se o projeto continuar em uma ramificação, a nova conversa deve tratar **DEC-891–DEC-1415 como decisões já aprovadas**, salvo reabertura explícita.
````

---

# ANEXO 06 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_06_ECONOMY_1416-2305.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 06
## Economy / Resources — Decisões 1416–2305

> **Status:** APROVADO / CONGELADO PARA CONTINUIDADE.
>
> O usuário aprovou em bloco **todas as opções marcadas como RECOMENDADO** nas decisões DEC-1416–DEC-2305.
>
> Este documento preserva a arquitetura econômica oficial do Domain Manager antes da Rodada 07. Nenhuma decisão deve ser alterada silenciosamente; revisões futuras devem registrar explicitamente qual DEC foi reaberta e qual decisão a substituiu.

---

# 0. Resumo executivo

A Rodada 06 define a Economy como um subsystem administrativo system-agnostic, independente de qualquer inventário físico ou moeda específica de sistema, mas capaz de integrar ambos através de providers/adapters.

Princípios centrais:

```text
Economy ≠ Inventory
Resource ≠ Item
ResourceDefinition ≠ ResourceAccount
Balance ≠ Available
Reservation ≠ Debit
Transaction ≠ LedgerEntry
Receipt ≠ Transaction
Preview ≠ Commit
```

Arquitetura consolidada:

```text
Economy
│
├── ResourceDefinitionRegistry
│   ├── built-ins
│   ├── addon definitions
│   └── world custom definitions
│
├── ResourceRepository
│
├── ResourceAccount
│   ├── Native
│   ├── Derived
│   └── Provider-backed
│
├── CapacityResolver
├── ThresholdService
├── ReservationStore
├── LedgerStore
│
├── EconomyService
│   ├── reserve
│   ├── consume
│   ├── release
│   ├── adjust
│   ├── transfer
│   ├── convert
│   ├── production
│   ├── income
│   ├── upkeep
│   ├── fees
│   ├── decay
│   └── reversal
│
├── EconomyPlanBuilder
├── ApprovalPolicyRegistry
│
├── ProviderRegistry
│   ├── ResourceProvider
│   ├── CurrencyProvider
│   └── InventoryProvider
│
├── EconomyAggregationProvider
│
├── Public Context / DTO
│
└── Shared Authority Infrastructure
    ├── PrimaryAuthorityService
    ├── CommandBus
    ├── Dedupe
    ├── LockManager
    ├── MutationCoordinator
    ├── TransactionStore
    ├── RecoveryService
    └── Audit
```

A mutação econômica oficial segue:

```text
Intent
  ↓
Primary Authority
  ↓
Authentication / Permission / Dedupe
  ↓
Locks
  ↓
Fresh Read
  ↓
EconomyPlan
  ├── reservation effects
  ├── ledger intents
  ├── provider operations
  ├── warnings
  └── blockers
  ↓
Transaction / Commit
  ↓
Ledger + Accounts + Providers
  ↓
Receipt
  ↓
Refetch sanitized context
```

---

# 1. DEC-1416–1600 — Resource foundation

## 1.1. Capability / Philosophy

- Economy/resources continuam opcionais por Domain.
- `resources` é a capability funcional principal; transaction/economy é infraestrutura desse subsystem.
- Inventário físico não é obrigatório.
- Moeda de sistema não é obrigatória.
- O core deve funcionar com zero adapters externos.
- Existe `EconomyService`.
- Economy não contém regras de Project, Agreement ou marketplace.
- Marketplace, merchant catalogue, stock market e exchange complexo ficam fora do core T4.

## 1.2. ResourceDefinition

`ResourceDefinition` responde apenas “o que é este recurso?”.

Regras aprovadas:

- ID técnico estável.
- IDs world custom usam namespace `world:`.
- Built-ins usam namespace completo.
- Rename não altera ID.
- Label obrigatório.
- Addons podem usar localization keys.
- World custom definitions podem usar label literal.
- Description opcional e curta.
- Icon opcional e não semântico.
- Category opcional para navegação.
- Categories são registráveis/namespaced.
- Category não controla business logic automaticamente.
- Tags usam o sistema comum.
- “Strategic resource” não vira boolean universal.

Shape conceitual:

```ts
interface ResourceDefinition {
  id: ResourceDefinitionId;
  version: number;

  label: string;
  description?: string;
  icon?: string;

  categoryId?: string | null;
  tags: readonly string[];

  precision: number;

  displayUnit?: {
    singular?: string;
    plural?: string;
    abbreviation?: string;
  };

  minimumMinor?: number | null;
  maximumMinor?: number | null;
  allowNegative: boolean;

  defaultCapacityPolicy:
    | "block"
    | "allow-with-warning"
    | "overflow"
    | "provider";

  lifecycle: "active" | "archived";
}
```

## 1.3. Display units

- Resources podem declarar unidade.
- Unidade é apresentação por default, não conversão automática.
- Singular/plural/abbreviation são opcionais.
- Resource sem unidade é válido.
- UI pode abreviar números enormes.
- Detail/tooltip deve poder mostrar valor exato.

## 1.4. Precision / minor units

Todos os valores econômicos persistidos usam **integer minor units**.

Exemplo:

```text
320.010,00
precision = 2
→ 32001000
```

Regras:

- `precision` pertence à ResourceDefinition.
- Default `0`.
- Faixa inicial `0..4`.
- Input localizado é convertido na boundary de UI/import.
- Storage nunca usa string localizada.
- Canonicalização ocorre antes do command fingerprint.
- Mudar precision após existir ledger exige migration/conversion explícita.
- Migration preserva valor econômico equivalente e gera provenance/audit.

## 1.5. Safe integers

- Core usa JS `number` inicialmente.
- Todos os economic amounts precisam satisfazer `Number.isSafeInteger`.
- Overflow = validation error.
- Nunca clamp silencioso.
- Nunca mudar para BigInt silenciosamente.
- Necessidade futura exige nova contract/schema version.

## 1.6. Minimum / Maximum / Negative

- ResourceDefinition pode definir minimum e maximum.
- `allowNegative=false` implica minimum default `0`.
- Com `allowNegative=true`, minimum pode ser null ou negativo.
- Definition maximum é limite semântico absoluto.
- Account capacity é capacidade local daquele Domain.
- Account nunca excede hard maximum da Definition.
- Tudo usa minor units.
- `allowNegative` default `false`.
- Dívida é permitida somente em Definitions que a autorizem.
- Account não override `allowNegative` individualmente no v1.
- Provider autoritativo pode declarar sua própria negative policy quando aplicável.

## 1.7. ResourceAccount

`ResourceAccount` responde “quanto desse recurso este Domain possui?”.

Chave lógica natural:

```text
domainUuid + resourceId
```

Native account:

```ts
interface NativeResourceAccount {
  mode: "native";
  domainUuid: DomainUuid;
  resourceId: ResourceDefinitionId;
  balanceMinor: number;
  baseCapacityMinor: number | null;
  visibility?: VisibilityRef;
}
```

Derived:

```ts
interface DerivedResourceAccount {
  mode: "derived";
  domainUuid: DomainUuid;
  resourceId: ResourceDefinitionId;
  resolverId: string;
  visibility?: VisibilityRef;
}
```

Provider-backed:

```ts
interface ProviderResourceAccount {
  mode: "provider";
  domainUuid: DomainUuid;
  resourceId: ResourceDefinitionId;
  providerId: string;
  providerRef: string;
  visibility?: VisibilityRef;
}
```

Regras:

- Um Domain possui no máximo uma native account por ResourceDefinition.
- Native balance pertence ao Domain Manager.
- Derived account não armazena balance autoritativo.
- Derived é read-only por default.
- Fórmula arbitrária via `eval` não entra no v1.
- Provider-backed mantém provider/source ref.
- External source of truth nunca é duplicada como native truth.
- Last-known external value pode ser cacheado apenas como stale/non-authoritative.
- Stale cache nunca autoriza debit.

## 1.8. Opening balance

- Criar account com saldo inicial não-zero cria LedgerEntry `opening-balance`.
- Saldo inicial zero não exige +0 entry.
- Template starting balance cria entry ao instanciar.
- Full snapshot import preserva ledger existente.
- Import sem history com balance cria opening/migration entry.
- Legacy migration usa source `migration`.

## 1.9. Capacity

- Account pode ter `capacityMinor`.
- `null` = unlimited/not applicable.
- `0` = capacidade zero.
- Capacity pode receber modifiers derivados de Facilities/capabilities.
- Effective capacity mantém provenance.
- Broken source não gera capacidade fantasma.

Policies:

```text
block
allow-with-warning
overflow
provider
```

- Default `block`.
- `block` rejeita.
- `allow-with-warning` preserva excedente.
- `overflow` exige policy explícita para o excedente.
- Waste gera LedgerEntry.
- Overflow pode gerar Event/Action.
- `provider` delega storage limit ao provider.

## 1.10. Balance mutation

Nunca:

```ts
account.balanceMinor += delta;
```

fora do EconomyService.

Toda native balance mutation gera LedgerEntry:

- opening;
- adjustment;
- transfer;
- production;
- income;
- upkeep;
- decay;
- migration;
- etc.

“Set balance to X” é apenas UI intent:

```text
current = 100
target = 130
→ authoritative adjustment +30
```

No-op não gera LedgerEntry.

Manual adjustment exige reason.

## 1.11. Visibility

Contexts distinguem:

```text
balance
reserved
available
capacity
```

- Viewer context pode diferir do GM.
- Secret account pode simplesmente não existir no DTO.
- Knowledge pode produzir “unknown”.
- Derived values sensíveis a segredo são calculados após sanitização/projection.
- Definition pode ser pública e account secreta.
- Definition, Account, LedgerEntry, Transaction e Reservation podem ter visibilidade própria.

## 1.12. Resource activation/lifecycle

- Definitions globais não criam accounts automaticamente em todos os Domains.
- Domain escolhe resources acompanhados.
- Remover resource com history arquiva linkage/account em vez de apagar history.
- ResourceDefinition lifecycle: `active | archived`.
- Archived continua resolvendo history.
- Archived não cria novas accounts por default.
- Restore é permitido.
- Hard delete exige dependency check.
- Force delete só em repair/admin tool explícita e auditada.

## 1.13. Registry

- Built-ins, addons e world custom definitions usam Registry central.
- Registry combina registered definitions + world repository.
- Definitions são exportáveis/importáveis.
- Duplicate ID é rejeitado.
- Collision pode remapear quando entidade é diferente.
- Semantic identity igual pode reutilizar após validation.
- Nunca deduplicar por label.

## 1.14. Thresholds

Threshold é parte formal da Economy.

- Defaults na Definition, config/override na Account.
- Métrica declarada.
- V1 começa com `balance` e `available`.
- Threshold possui ID (`thr_...`).
- Label opcional.
- Comparators:
  - below;
  - at-or-below;
  - above;
  - at-or-above.
- Hook dispara apenas em crossing.
- Recovery crossing também gera event.
- Pequeno checkpoint/state pode existir quando necessário.
- Threshold não muta Economy diretamente.
- Pode disparar DomainAction registrada pela Authority.
- Threshold secreto pode notificar apenas GM.

## 1.15. Resource groups / presentation

- Economy UI pode agrupar Resources.
- Groups são principalmente apresentação/filtro.
- Preferir categories/tags.
- Collapsed state é client preference.
- Sort visual não é semântico.
- Sort não incrementa Domain revision.

---

# 2. DEC-1601–1800 — Reservations, Ledger e Transactions

## 2.1. Reservation

Reservation significa:

> recurso ainda pertence ao Domain, mas já está comprometido.

Exemplo:

```text
balance = 500
reserved = 120
available = 380
```

Reservation:

- possui ID próprio `resv_...`;
- pertence a uma ResourceAccount;
- uma reservation = um resource/account;
- multi-resource operation usa várias reservations com correlation/transaction;
- provider-backed reservation só existe se provider/adapter puder garantir semântica compatível;
- derived read-only resource não recebe reservation diretamente.

Shape:

```ts
interface Reservation {
  id: ReservationId;

  domainUuid: DomainUuid;
  resourceId: ResourceDefinitionId;

  originalAmountMinor: number;
  remainingAmountMinor: number;

  source: OperationSource;
  sourceRef?: string;

  status:
    | "active"
    | "partially-consumed"
    | "consumed"
    | "released"
    | "expired";

  createdAtReal: number;
  createdAtWorld?: number | null;

  expiresAtWorld?: number | null;

  revision: number;
}
```

Regras:

- original e remaining são separados.
- remaining pode ser materializado mas deve ser revalidável pelo history.
- amount sempre > 0.
- zero = no-op.
- usa minor units da ResourceDefinition.
- final reservations continuam resolvíveis.
- apenas active/partially-consumed entram em `reserved`.

## 2.2. Reservation lifecycle

```text
active
partially-consumed
consumed
released
expired
```

- consumed/released/expired são finais.
- nenhum record final volta a active.
- nova necessidade = nova Reservation.

## 2.3. Reservation source

- SourceRef existe quando outro subsystem originou.
- SourceType técnico acompanha o ref.
- Manual GM reservation usa source manual + reason.
- Broken source não apaga Reservation.
- Diagnostics mostra orphan/broken source.
- GM pode release órfã de forma auditada.

## 2.4. Expiration

- Reservation pode expirar.
- Narrativa usa worldTime.
- Technical expiration real-time é policy separada.
- Não usar campo ambíguo sem dimensão.
- Time/Tick processor executa expiration/release.
- Rewind de worldTime não reativa reservation.

## 2.5. Reserve

- Valida `available`, não `balance`.
- Over-reservation é bloqueada por default.
- GM override só se policy permitir.
- Reserve não altera balance.
- Reserve não cria LedgerEntry.
- Cria ReservationEvent/history.

Eventos mínimos:

```text
created
partially-consumed
consumed
released
expired
adjusted
```

Append-only.

## 2.6. Consume

- Consume reduz balance e remaining reserved.
- Gera LedgerEntry negativa.
- Entry referencia reservationId.
- Partial consume é suportado.
- Nunca consome mais do que remaining implicitamente.
- Reserva + available extra exige Plan explícito.
- Full → `consumed`.
- Partial → `partially-consumed`.

## 2.7. Release

- Release devolve availability derivadamente.
- Não altera balance.
- Não cria LedgerEntry.
- Cria ReservationEvent.
- Partial release é suportado.

## 2.8. Reservation Commands

Commands semânticos:

```text
domain-manager:economy.reserve
domain-manager:economy.consume-reservation
domain-manager:economy.release-reservation
```

- passam pela Primary Authority;
- Project nunca edita Reservation diretamente;
- single-account reserve pode ser mutation simples;
- multi-resource atomic reserve pode usar TransactionRecord.

## 2.9. Ledger

Ledger responde:

> “Por que o saldo mudou?”

Regras:

- append-only;
- committed entries não são editadas/apagadas normalmente;
- correção cria nova entry;
- delta zero não é normal;
- Reservation history/audit cuida de eventos sem saldo.

LedgerEntry:

- ID `led_...`;
- Domain UUID;
- resourceId;
- canonical account key quando útil;
- `deltaMinor`;
- debit negativo;
- credit positivo;
- before/after não são truth obrigatória;
- Transaction/Receipt podem registrar snapshots auxiliares.

Kinds base namespaced:

```text
opening-balance
adjustment
transfer-debit
transfer-credit
consumption
production
income
upkeep
fee
waste
decay
conversion-debit
conversion-credit
reversal
migration
```

Addons podem registrar kinds via contract.

## 2.10. Ledger provenance

Entry pode carregar:

- transactionId;
- reservationId;
- sourceRef;
- sourceType;
- processor/provider/action origin;
- authenticated requester;
- authority execution context;
- real timestamp;
- worldTime;
- sequence.

Sequence existe para ordering rigoroso.

## 2.11. LedgerStore

- Ledger não fica como array eterno no Actor.
- Existe `LedgerStore`.
- API nasce paginável.
- Filtros mínimos:
  - domainUuid;
  - resourceId;
  - transactionId;
  - kind;
  - sourceRef/sourceType;
  - before/after;
  - cursor;
  - limit.
- Ordering determinístico.
- “Load all” não é API pública default.

## 2.12. Adjustment

Command semântico `resource.adjust`.

- gera LedgerEntry;
- manual adjustment exige reason;
- UI pode aceitar delta ou target balance;
- Authority recalcula delta usando fresh balance;
- stale preview é recalculado;
- limites só podem ser violados via override explícito permitido;
- override é auditado.

## 2.13. Reversal

- nunca apaga original;
- cria nova LedgerEntry oposta quando possível;
- usa `reversesEntryId`;
- Transaction reversal usa `reversesTransactionId`;
- operação complexa usa reversal/compensation Plan;
- revalida estado atual;
- não é time travel;
- double reversal é bloqueada;
- redo é nova operation explícita.

## 2.14. Transfer

Domain→Domain transfer é **uma única operação lógica**.

- source valida available;
- target valida capacity;
- Reservations existentes permanecem intocadas;
- amount > 0;
- transfer para mesmo account = no-op/rejeição;
- Resources diferentes = conversion, não transfer;
- gera duas LedgerEntries;
- ambas compartilham transactionId;
- kinds `transfer-debit` e `transfer-credit`;
- sempre usa TransactionRecord.

Locks:

- source + target lockados;
- deterministic lock ordering;
- começar conservador;
- multi-domain transfer é arquiteturalmente permitido;
- todos locks calculados antes do commit;
- distribution multi-target usa allocation e remainder policies determinísticas.

## 2.15. Conversion

- Resource A→B é Transaction.
- Debit e credit são explícitos.
- Rate usado é persistido/provenance.
- Rate usa fixed-point/integer contract.
- Core não implementa market exchange completo.
- Provider/policy pode fornecer rate.
- Dynamic rate é revalidado pela Authority.

## 2.16. Fees

- Taxas nunca desaparecem implicitamente.
- Fee que altera balance gera LedgerEntry.
- Fórmula/rate podem constar metadata.
- Fee pode ir para outro Domain.
- Fee pode ser sink/waste.
- Sink mantém source/description.

## 2.17. EconomyPlan

EconomyPlan especializa o Plan genérico da Rodada 04.

Pode conter:

```text
reads
account states
reservation effects
ledger intents
provider operations
warnings
blockers
write set
```

- preview usa `LedgerIntent`, nunca committed LedgerEntry.
- committed IDs/timestamps/sequence nascem no commit.
- possui read set e write set.
- provider operations podem existir internamente sem vazar secrets.
- Plan hash pode ser armazenado.
- Plan hash não substitui command fingerprint.

## 2.18. TransactionRecord econômico

Economy reutiliza o TransactionRecord compartilhado.

Metadata pode conter:

- namespaced type;
- commandId;
- fingerprint;
- participants;
- lockKeys;
- ledgerEntryIds;
- reservationIds;
- provider transaction refs;
- Plan hash.

State machine é a da Rodada 04.

## 2.19. Commit

- LedgerEntries só nascem durante commit.
- balance write sem ledger = integrity failure/recovery.
- coordenar ledger + balance o mais atomicamente possível.
- batch consistente é usado quando disponível, sem presumir ACID.
- Receipt failure pós-commit não desfaz Economy.
- Hook failure pós-commit não desfaz Economy.
- UI refetch após Receipt.

## 2.20. Project ↔ Economy boundary

```text
Project
→ decide o que precisa

Economy
→ garante reserva/consumo e registra mutação

MutationCoordinator
→ garante concorrência/transaction/recovery
```

- Project define custos.
- Economy não conhece regra de progresso.
- Project pode reservar antecipadamente.
- Pode consumir progressivamente.
- Cancelamento pode liberar remaining reservations.
- Completion consome conforme cost policy, não obrigatoriamente tudo.

---

# 3. DEC-1801–2000 — Approvals, Providers, Automação e UI

## 3.1. ApprovalPolicy

Policy formal:

```text
auto
threshold
always
gm-only
custom
```

- policy pertence à operação;
- Definition pode ter default;
- Domain/account pode override quando permitido;
- `auto` respeita permission;
- `always` exige aprovação;
- `gm-only` restringe quem pode iniciar;
- `threshold` usa métrica declarada;
- reference currency é opcional/futuro;
- Authority recalcula qualquer equivalência;
- Approval fica ligado ao command/transaction;
- requester ≠ approver;
- possui timestamp/audit;
- denial pode ter reason;
- approval pode expirar;
- approval antiga nunca substitui fresh revalidation.

Approval preview:

- GM aprova authoritative preview fresco;
- state change reconstrói Plan;
- mudança material pode invalidar aprovação;
- approval nunca segura lock por longa duração;
- pending approval só reserva resource se uma Reservation explícita tiver sido criada.

## 3.2. Provider architecture

Registry central.

Provider:

- namespaced `providerId`;
- `contractVersion`;
- capacidades explícitas;
- incompatível = rejeitado;
- pode ser parcialmente funcional;
- feature detection pela UI;
- read-only provider é válido.

Exemplos de capability:

```text
readInventory
transferItems
previewTransfer
compensateTransfer
readCurrency
mutateCurrency
```

## 3.3. Provider ownership

Data families:

```text
currency
physical-inventory
derived-resource
resource-storage
```

- nunca dois authoritative providers para mesma family/target;
- world setting escolhe explicitamente quando há múltiplos candidatos;
- load order nunca decide;
- escolha é por integration type;
- currency e inventory podem usar providers diferentes;
- remover provider não apaga account;
- account fica unavailable/stale, nunca converte para native silenciosamente.

## 3.4. ProviderHealth

Estados:

```text
healthy
degraded
unavailable
incompatible
```

- reason/code;
- change hook/event;
- unavailable bloqueia dependent writes;
- read pode mostrar stale last-known claramente marcado;
- health aparece em Diagnostics e Economy admin UI.

## 3.5. ResourceProvider

- Contract genérico existe.
- Pode fornecer derived balance.
- Mutation é opcional/capability-based.
- Read-only é válido.
- Direct write em read-only derived resource = structured error.

## 3.6. CurrencyProvider

- interface separada;
- core não conhece PF2e/D&D5e currency paths;
- native/manual currency provider existe;
- pode usar native ResourceAccounts;
- denominations são opcionais;
- core não converte system currencies magicamente;
- provider pode oferecer conversion preview;
- mutable provider deve suportar compensation/reconciliation quando possível.

## 3.7. InventoryProvider

- separado do EconomyService;
- adapter conhece system-specific item schema;
- sanitization fica no provider;
- pode list/count items;
- writeable provider pode plan/commit transfer;
- compensation somente se capability declarar;
- mutation result deve trazer recovery data suficiente.

## 3.8. External provider writes

- sempre dentro da Authority;
- participam de EconomyPlan;
- write set é registrado;
- provider pode declarar external lock keys;
- keys entram em deterministic multi-lock ordering;
- timeout só retry quando safe/idempotent ou após reconciliation;
- outcome incerto = needs-recovery;
- reconcile antes de compensate.

## 3.9. Mirror ledger

- external provider operation pode gerar mirror LedgerEntry;
- entry deixa claro que truth é externa;
- pode guardar providerTransactionRef;
- mirror ledger nunca recalcula external inventory autoritativo;
- divergência → provider vence + Diagnostics.

## 3.10. Scheduled income

- scheduler/time decide quando;
- Economy executa;
- TickProcessor produz EconomyCommands;
- todo income gera LedgerEntry;
- source processor ID é preservado;
- grandes jumps podem gerar aggregate entry;
- aggregate registra período/count/rate.

## 3.11. Upkeep

- não é campo universal da ResourceAccount;
- subsystem dono da obrigação declara custo;
- processor monta EconomyPlan;
- nunca raw balance decrement;
- falta de resource gera result/event conforme policy;
- Economy não decide consequência narrativa;
- upkeep pode consumir Reservation previamente criada.

## 3.12. Taxation

- não existe `taxRate` universal no ResourceAccount;
- taxation é processor/command especializado;
- pode transferir para outro Domain;
- exemptions/rules ficam fora do Economy core;
- Economy executa o Plan financeiro final.

## 3.13. Production

- toda produção passa por ledger;
- Facilities/Tick/etc. decidem o que produzir;
- ResourceAccount não possui universal `productionRate`;
- production respeita capacity;
- overflow/waste é explícito;
- multi-resource production pode ser uma Transaction;
- recipes podem consumir inputs e creditar outputs atomicamente.

## 3.14. Decay / Spoilage

- não hardcoded universal;
- pode vir de tags/config/processor;
- é negative LedgerEntry;
- pode ser tick-based;
- interaction com reservations depende de policy;
- nunca apagar reservation silenciosamente;
- shortages geram integrity/shortfall alert;
- decay mantém source processor.

## 3.15. Economy errors

Códigos estáveis:

```text
DM_ECON_INSUFFICIENT_AVAILABLE
DM_ECON_CAPACITY_EXCEEDED
DM_ECON_RESOURCE_NOT_FOUND
DM_ECON_ACCOUNT_NOT_FOUND
DM_ECON_PROVIDER_UNAVAILABLE
DM_ECON_PROVIDER_READ_ONLY
DM_ECON_RESERVATION_NOT_FOUND
DM_ECON_RESERVATION_EXHAUSTED
DM_ECON_APPROVAL_REQUIRED
DM_ECON_PRECISION_INVALID
```

- provider raw error só em GM Diagnostics/log;
- player recebe erro sanitizado.

## 3.16. Economy UI

Tab existe somente com capability ativa.

Overview compacto:

```text
Resource
Balance
Reserved
Available
Capacity
Status
```

- unlimited não aparece como zero;
- threshold status compacto;
- provider source/health visível;
- stale claramente identificado.

Resource detail:

- Definition info;
- balance/reserved/available/capacity;
- active Reservations;
- paged Ledger;
- capacity provenance;
- provider health.

Transfer dialog:

- source;
- target;
- resource;
- amount;
- before/after preview;
- warnings/blockers;
- novo commandId no confirm de nova operação;
- preview fingerprint pode detectar mudança material.

Adjustment dialog:

- GM-only default;
- delta ou target balance;
- reason obrigatório;
- before/after preview;
- explicit limit override.

Reservation UI:

- source;
- original/remaining;
- expiration;
- manual management pelo GM;
- manual release de active source exige confirmation/reason.

Operations:

- approvals;
- recoveries;
- provider failures;
- Transaction como linha lógica;
- expansão mostra phases e entries;
- player recebe versão sanitizada.

Search/filter:

- resource label/tag/category;
- ledger por resource/kind/source/time/transaction;
- transaction por status;
- reservations por status/source.

## 3.17. Import / Export

Full Domain export pode incluir:

- native accounts;
- active reservations;
- optional ledger history.

Template:

- não inclui live balances por default;
- pode definir starting balances;
- instantiation cria opening-balance;
- não inclui live reservations;
- não inclui ledger history;
- inclui custom ResourceDefinitions necessárias.

Provider-backed export:

- não copia external inventory por default;
- salva refs/config;
- missing provider → unresolved;
- last-known value é apenas informational snapshot;
- import report sinaliza provider ausente.

## 3.18. Migrations

Economy possui migration registry próprio coordenado pelo global.

Fixtures para:

- ResourceDefinition;
- ResourceAccount;
- Reservation;
- Ledger.

Regras:

- raw balance legado vira opening/migration entry;
- locale money string é parsed;
- precision migration é explícita;
- invalid provider ref é preservada unresolved.

## 3.19. Diagnostics

Detecta:

- account sem Definition;
- duplicate native account;
- unsafe balance;
- minimum/maximum violation;
- over-reservation inválida;
- reservation remaining/history mismatch;
- ledger/account mismatch;
- Transaction sem expected entries;
- provider unavailable/incompatible;
- dual provider ownership;
- stale unresolved transaction.

Repairs passam pela Authority.

## 3.20. Fundamental failure gates

Economy precisa testar:

```text
commit succeeded
response lost
same commandId retried
→ replay prior result
→ never debit twice
```

E crash artificial entre writes.

Economy só é considerada arquiteturalmente válida quando não produz:

- duplicate debit;
- mutable history;
- silent partial failure;
- dual source of truth.

---

# 4. DEC-2001–2305 — Aggregation, Public API, Scaling e T4

## 4.1. Economy aggregation

Parent pode mostrar summaries derivados dos descendants.

Distinguir:

```text
own
direct-children
recursive-descendants
aggregate
```

- own vem primeiro na Sheet;
- aggregate aparece separado;
- query escolhe profundidade;
- cycle guard defensivo;
- apenas canonical resource IDs iguais são somados;
- label igual não significa resource igual;
- conversion nunca é implícita;
- result preserva provenance por Domain.

## 4.2. Summary ≠ operational ownership

- Parent visualizar recurso não significa poder gastar.
- Aggregate é informativo.
- Transfer child→parent continua sendo operação econômica real.
- Agreement/policy pode autorizar cross-Domain operations.
- Hierarchy não implica economic ownership.
- Aggregate available pode ser mostrado, mas rotulado como summary.
- Reservations também podem ser agregadas como summary.

## 4.3. Secret aggregation

- player aggregation usa sanitized child contexts;
- secret child values não entram silenciosamente no public total;
- Knowledge pode indicar unknown contributors;
- aggregate DTO pode ter completeness/unknown/hidden contributor metadata;
- GM usa truth completa.

## 4.4. Provider-backed aggregation

- external accounts participam quando legíveis;
- unavailable pode contribuir apenas como stale/incomplete;
- provider provenance é preservada;
- aggregate nunca transforma external account em native.

## 4.5. Shared AggregationService

Economy registra `EconomyAggregationProvider` no AggregationService central.

- retorna DTO;
- pode cachear;
- balance/reservation/provider changes invalidam cache;
- cache nunca é truth.

## 4.6. Public Read API

```ts
api.economy.getContext(domainUuid, viewer?)
api.economy.getResource(domainUuid, resourceId)
api.economy.queryLedger(query)
api.economy.getTransaction(transactionId)
api.economy.getReservation(reservationId)
api.economy.queryReservations(query)
api.economy.getProviderHealth(providerId)
api.economy.getAggregateContext(domainUuid, options)
```

Nunca exigir acesso direto ao storage.

## 4.7. Public Write API

Writes usam Command API.

Helpers semânticos são permitidos se apenas constroem Commands válidos.

Third-party handlers:

- registered;
- namespaced;
- schemas declarados;
- permissions/policies;
- lock keys;
- nunca bypassam Authority.

## 4.8. Public contract versions

Versões independentes para:

- EconomyContext;
- Resource;
- Transaction;
- Provider;
- Reservation;
- Ledger DTO.

Storage e Public API podem evoluir separadamente.

## 4.9. Capability discovery

Consumers verificam features, não package versions.

Exemplos:

```text
resources.reservations
transactions.compensation
providers.inventory
providers.currency
resources.aggregation
```

## 4.10. Public DTOs

- readonly/cloned;
- sanitized antes de sair do service;
- player Plan sanitizado;
- player Receipt sanitizado;
- ledger query exclui GM-only info;
- player TransactionContext é menos detalhado que admin.

## 4.11. Optimistic UI

- pending delta pode existir visualmente;
- sempre marcado pending;
- nunca vira truth local;
- Receipt é seguido de refetch;
- multi-client notifications carregam IDs/revisions, não full snapshots.

## 4.12. Storage abstractions

- `ResourceRepository`;
- `ReservationStore`;
- `LedgerStore`;
- shared `TransactionStore`.

Backend físico é escondido.

Backend inicial pode ser simples.

## 4.13. Indexes / pagination

Ledger indexes:

```text
domain
resource
transaction
source
time
kind
```

Transaction indexes:

```text
commandId
status
participant
user
time
type
```

Reservation indexes:

```text
domain
resource
source
status
```

Tudo nasce paginável/indexável.

## 4.14. Future chunking/archive

Service API deve permitir:

- partitioning;
- active/archive stores;
- federated queries;
- audited checkpoints.

Compaction não entra no T4.

## 4.15. Schema versions / read-only safety

- Economy storage pode ter schemaVersion;
- Ledger e Reservation podem ter versões próprias;
- future unsupported schema bloqueia writes;
- safe reads podem funcionar em read-only mode.

## 4.16. Content packs

Podem trazer:

- ResourceDefinitions;
- ResourceCategoryDefinitions;
- Threshold presets;
- ApprovalPolicy presets;
- common resource templates.

Core não hardcoda Gold/Silver/Copper ou Lancer-specific economy.

System-specific definitions preferem companion adapters/content modules.

## 4.17. Domain templates

Templates podem recomendar:

- resources;
- capacities;
- thresholds;
- approval policies.

Nunca incluem:

- live transactions;
- live reservations;
- ledger history.

## 4.18. Basic Resources UX

Basic mode:

- usa a mesma engine;
- pode esconder reservations/history/providers quando irrelevantes;
- nunca pula ledger;
- nunca pula Authority.

## 4.19. Advanced Economy UX

Pode expor:

- Reservations;
- Thresholds;
- Transaction history;
- Provider health;
- Approval policies;
- Recovery status.

## 4.20. Setup target

Quick Create de resource pode pedir apenas:

```text
name
starting balance
optional capacity
```

e esconder advanced defaults.

Objetivo: base pequena configura alguns resources em minutos.

## 4.21. UI performance / accessibility

- legível sem animações pesadas;
- high contrast sem depender de imagens;
- virtualization apenas quando necessário;
- Ledger sempre paginado;
- virtualization threshold é implementation detail.

## 4.22. Bulk

- independent bulk pode ter partial success;
- atomic subgroup deve ser explícito;
- progress visual para jobs grandes;
- subgroups podem ter receipt/status.

## 4.23. Notifications

- não gerar centenas de toasts em ticks grandes;
- notifications podem ser agrupadas;
- Chat receipts opcionais por operation type;
- recipients são definidos por visibility/policy;
- secret amounts nunca aparecem em public receipt.

## 4.24. Security — values/providers/abuse

Rejeitar:

- NaN;
- Infinity;
- unsafe integer;
- policy-invalid amount sem override.

Provider result é runtime-validated.

Provider não injeta LedgerEntry bruta.

Secret metadata é sanitizada.

Economy usa o rate limiting compartilhado.

GM também possui loop guard.

## 4.25. Unit tests

Cobrir:

- precision 0/2;
- pt-BR parsing;
- en-US parsing;
- safe integer boundaries;
- minimum/negative;
- todas capacity policies;
- threshold crossing/recovery.

## 4.26. Reservation tests

Cobrir:

- reserve sem alterar balance;
- partial/full consume;
- partial release;
- expiration;
- concurrent consume;
- orphan reservation.

## 4.27. Ledger tests

Cobrir:

- opening balance;
- adjustment reason;
- immutable entries;
- reversal;
- double reversal guard;
- deterministic pagination.

## 4.28. Transaction/concurrency tests

Cobrir:

- transfer success;
- insufficient available;
- destination capacity failure;
- replay;
- fingerprint mismatch;
- simultaneous transfers;
- independent Domain parallelism;
- lock order inversion.

## 4.29. Provider tests

Fake providers devem cobrir:

- read-only;
- missing;
- incompatible;
- timeout-before-write;
- timeout-after-write;
- reconciliation;
- compensation success;
- compensation failure → needs-recovery.

## 4.30. Security tests

Cobrir:

- forged requester;
- direct balance update attempt;
- secret balance;
- secret notes;
- secret child aggregate leak;
- provider GM-only metadata leak.

## 4.31. Recovery tests

Cobrir:

- crash source debit → before target credit;
- uncertain outcome → needs-recovery;
- idempotent repeated recovery;
- old claimed;
- old committing;
- startup auto-recovery apenas para handlers explicitamente `safe-auto-recovery`.

## 4.32. Load/performance

Testar:

- muitas accounts;
- 10k+ LedgerEntries;
- pagination;
- transaction lookup;
- compound ledger filters;
- hundreds of resources;
- recursive aggregation;
- batch ticks;
- provider latency.

Local developer diagnostics mede:

- command latency;
- lock wait;
- provider time;
- ledger query duration.

Sem telemetria externa obrigatória.

## 4.33. Storage benchmark

Antes de 1.0, benchmarkar alternativas de Ledger backend.

Repository contract precisa permitir troca sem quebrar UI/API.

---

# 5. Gate T4 — implementação aprovada

T4 inclui:

## Foundation

- ResourceDefinition registry;
- world custom ResourceDefinitions;
- native ResourceAccounts;
- derived account contract;
- provider-backed account contract;
- minor-unit precision;
- capacity;
- thresholds;
- reservations;
- partial consume/release.

## Ledger / Transactions

- LedgerStore abstraction;
- paged ledger query;
- opening balance;
- manual adjustment;
- basic reversal;
- Domain→Domain transfer;
- EconomyPlan;
- shared TransactionRecord;
- basic compensation;
- needs-recovery flow.

## Providers

- Provider Registry shell;
- NativeResourceProvider;
- Native/Manual CurrencyProvider;
- fake providers for tests.

Não obrigatórios no T4:

- Item Piles adapter;
- PF2e adapter;
- D&D5e adapter;
- Lancer-specific provider.

## UI

- Economy tab;
- Quick Resource Create;
- Resource Detail;
- Transfer Dialog;
- Adjustment Dialog;
- Reservations View;
- Paged Ledger;
- Transaction History;
- Provider Status shell.

## Explicitamente postergado

- marketplace;
- merchant catalogue;
- stock market;
- complex exchange market;
- logistics network graph;
- ledger compaction;
- highly fine-grained locks;
- full analytics dashboard.

---

# 6. Critérios de aprovação T4

T4 só é aprovado quando provar que:

1. native balance nunca muda sem LedgerEntry;
2. reserved nunca é raw editable truth;
3. lost response não duplica debit;
4. transfer não termina silenciosamente half-applied;
5. partial failure fica registrada/recoverable;
6. provider externo nunca vira segunda source of truth;
7. player não bypassa Authority;
8. secrets não vazam em Context, Receipt ou Aggregation;
9. 10k+ LedgerEntries continuam consultáveis paginadamente;
10. base pequena continua simples de operar.

---

# 7. Leis finais da Rodada 06 — DEC-2281–2305

1. ResourceDefinition não é ResourceAccount.
2. Resource não é Item.
3. Economy não é Inventory.
4. Balance não é Available.
5. Reservation não é Debit.
6. Transaction não é LedgerEntry.
7. Receipt não é Transaction.
8. Client envia intenção, não verdade.
9. Fresh state é lido dentro dos locks relevantes.
10. Preview não é Commit.
11. Retry técnico mantém commandId.
12. Mesmo commandId com intenção diferente é conflito.
13. Partial failure nunca é escondida.
14. Compensation é explícita e auditável.
15. Ledger explica toda mudança de native balance.
16. Reversal não apaga history.
17. Provider ownership nunca é duplicado.
18. Integração crítica indisponível falha fechada para writes.
19. Settings são configuração, não banco econômico.
20. Player secrecy é aplicada antes da entrega dos dados.
21. Precision é canonical no storage.
22. Locale pertence à apresentação/input boundary.
23. Basic mode esconde complexidade; não cria engine paralela.
24. Parent aggregation não concede authority operacional sobre children.
25. Core funciona com zero adapters externos.

---

# 8. Continuidade para Rodada 07

A próxima rodada deve tratar Projects/Downtime/Facilities usando obrigatoriamente esta fundação.

As relações cross-service já congeladas são:

```text
Project
→ requirements / costs / progress policy

People
→ contributors / workforce / assignments

Economy
→ reservation / consumption / ledger / transaction

Time
→ worldTime / scheduling / ticks

MutationCoordinator
→ locks / transaction / compensation / recovery

CapabilityResolver
→ effective capabilities granted by facilities/roles/groups
```

Projetos não devem:

- editar balance diretamente;
- editar Workforce diretamente;
- assumir Actor como contributor obrigatório;
- guardar completion como simples checkbox;
- usar client state como authoritative;
- reimplementar transaction/recovery;
- transformar clocks em source of truth.

---

# 9. Snapshot de continuidade

**Rodada:** 06  
**Faixa:** DEC-1416–DEC-2305  
**Total:** 890 decisões  
**Status:** APROVADO  

Próxima decisão: **DEC-2306**  
Próxima rodada: **Rodada 07 — Projects / Downtime / Facilities**
````

---

# ANEXO 07 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_07_PROJECTS_DOWNTIME_FACILITIES_2306-3200.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 07
## Projects / Downtime / Facilities — Decisões 2306–3200

> **Status:** APROVADO / CONGELADO PARA CONTINUIDADE.
>
> O usuário aprovou em bloco **todas as opções marcadas como RECOMENDADO** nas decisões DEC-2306–DEC-3200.
>
> Este documento preserva a arquitetura oficial de **Projects / Downtime / Facilities** antes da Rodada 08. Nenhuma decisão deve ser alterada silenciosamente; revisões futuras devem registrar explicitamente qual DEC foi reaberta e qual decisão a substituiu.
>
> **Nota de reconstrução:** a faixa DEC-2306–2450 foi recuperada a partir do checkpoint consolidado e do contexto preservado da conversa. As faixas DEC-2451–3200 foram consolidadas diretamente das decisões aprovadas da Rodada 07.

---

# 0. Resumo executivo

A Rodada 07 define três subsistemas interoperáveis, mas independentes:

```text
Projects
→ processos persistentes de trabalho/progresso

Facilities
→ entidades persistentes que representam instalações, estruturas,
  módulos, capacidades, manutenção e operação

Downtime
→ atividades limitadas no tempo, individuais ou coletivas,
  que podem consumir capacidades e produzir outcomes
```

A separação arquitetural obrigatória é:

```text
Project ≠ Facility
Project ≠ Downtime
Facility ≠ Domain
Facility ≠ Resource
Downtime ≠ Project
Contributor ≠ Foundry User
Assignment ≠ Progress History
Reservation ≠ Debit
Resolver ≠ Mutation
Plan ≠ Commit
```

Arquitetura consolidada:

```text
                         DOMAIN
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
          PROJECTS     FACILITIES    DOWNTIME
              │            │            │
              └────────────┼────────────┘
                           │
                  Capability / Allocation
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
            People       Economy       Time
              │            │            │
              └────────────┼────────────┘
                           ▼
                        Command
                           ▼
                          Plan
                           ▼
                  MutationCoordinator
                           ▼
                 GM Authority Commit
                           ▼
                        Receipt
                           ▼
             Index / Read Model / UI
```

A mutação oficial segue:

```text
Intent
  ↓
Command
  ↓
Permission / Capability / Dedupe
  ↓
Plan / Preview
  ↓
Preconditions / Revisions / Conflicts
  ↓
MutationCoordinator
  ↓
Authoritative GM Commit
  ↓
Receipt
  ↓
Indexes / Read Models / Activity Feed / UI
```

Leis centrais congeladas:

1. **Resolver nunca muta.**
2. **Um subsystem nunca altera diretamente dados pertencentes a outro subsystem.**
3. **Mutations importantes passam por Command → Plan → validação autoritativa → Receipt.**
4. **Economy, People e Time são integrações por capability/provider, não dependências rígidas.**
5. **O cliente envia intenção; o GM autoritativo revalida permissions, revisions e fresh state.**
6. **Project progress usa unidades inteiras; percentual é derivado.**
7. **Completion não é checkbox.**
8. **Históricos importantes são append-oriented; correction/reversal não apaga história.**
9. **A complexidade arquitetural deve ficar escondida da UX comum.**
10. **O mesmo modelo deve funcionar tanto para uma pequena base quanto para um império.**

---

# 1. DEC-2306–2450 — Projects foundation

## 1.1. ProjectDefinition / ProjectInstance

A arquitetura oficial separa:

```text
ProjectDefinition
→ descreve o tipo/configuração de projeto

ProjectInstance
→ representa um projeto concreto em execução

ProjectEntry
→ registra alterações relevantes de progresso/histórico

ProjectAdvancePlan
→ descreve avanço proposto antes de commit

ProjectReceipt
→ registra o resultado efetivamente aplicado
```

Princípios aprovados:

- Projects são capability opcional.
- Projects não dependem rigidamente de Economy.
- Projects não dependem rigidamente de People.
- Projects não dependem rigidamente de Time.
- Projects não dependem de adapters externos para existir.
- Definition e Instance possuem identidades estáveis.
- Dados persistidos carregam version/schema/provenance suficientes para evolução.
- Runtime logic não é persistida como função JavaScript dentro das Definitions.
- Regras especializadas usam resolver/policy IDs e registries.
- Storage é acessado através de repository/service boundary, não diretamente pela UI.

## 1.2. Progress model

O progresso oficial usa **unidades inteiras**.

```text
workRequired  = integer
workCompleted = integer
percent       = derivado
```

Regras:

- Percentual não é a fonte de verdade.
- Frações intermediárias podem existir em resolver/carry controlado.
- Excesso de progresso não é silenciosamente destruído quando a policy precisar preservá-lo.
- Resolver define a estratégia de cálculo.
- Roll não é universal.
- Project pode existir sem qualquer check aleatório.
- Progress nunca deve depender de float persistido como fonte canônica.

## 1.3. Requirements / costs / rewards

Projects podem declarar:

- requirements;
- costs;
- progress policy;
- completion requirements;
- rewards/actions;
- contributors/workforce;
- facilities/capabilities necessárias.

Integrações:

```text
Project requirements/cost intent
    ↓
Economy
→ reservation / consumption / ledger / transaction

Project workforce intent
    ↓
People
→ contributors / groups / assignments / capacity

Project completion/reward
    ↓
Actions / Providers / Services
→ Facility / Economy / Mission / Knowledge / etc.
```

Project não deve:

- editar balance diretamente;
- editar Workforce diretamente;
- assumir Actor como contributor obrigatório;
- guardar completion como checkbox simples;
- usar client state como authoritative;
- reimplementar transaction/recovery;
- transformar clocks em source of truth.

## 1.4. Lifecycle

Lifecycle consolidado:

```text
draft
  ↓
planned
  ↓
approved
  ↓
active
  ├── blocked
  ├── paused
  ├── completed
  ├── failed
  └── cancelled
        ↓
      archived
```

Regras:

- Transitions são validadas.
- Estado não é alterado arbitrariamente pela UI.
- `completed` é resultado de uma transition coordenada.
- Completion pode produzir side effects.
- Reabrir estados terminais exige operação explícita/auditada.
- Histórico de transition deve ser preservável.

## 1.5. Start flow

O start oficial usa `ProjectStartPlan`.

```text
Project draft/planned
  ↓
ProjectStartPlan
  ├── requirements
  ├── reservations
  ├── costs
  ├── workforce
  ├── capability checks
  └── revisions
  ↓
MutationCoordinator
  ↓
initializing
  ↓
active
```

`initializing` é estado técnico interno necessário para evitar estados parcialmente iniciados.

## 1.6. Completion

Completion:

- não é checkbox;
- não é mutação direta;
- passa por plan/transaction;
- pode exigir requirements finais;
- pode gerar rewards/actions;
- pode criar Facility por operação coordenada;
- pode produzir receipts filhos;
- não deve esconder partial failure.

---

# 2. DEC-2451–2600 — ProgressResolver, ledger, workforce, requirements e Economy

## 2.1. ProgressResolver Registry

Progress é resolvido por registry extensível e namespaced.

Default:

```text
domain-manager:standard
```

Regras:

- Definition referencia resolver por ID.
- Resolver recebe contexto readonly.
- Resolver retorna `ProjectProgressResolution`.
- Resolver não modifica `ProjectInstance`.
- Resultado contém delta, reasons, warnings e metadata relevante.
- Delta final de progresso é inteiro.
- Progresso zero é válido.
- Progresso negativo depende de policy explícita.
- Resolvers acessam People/Economy/Time por capabilities/providers.
- Provider opcional ausente produz `unavailable`, não crash.
- Resolver ausente deixa projeto diagnosticável/bloqueado; projeto não é apagado.
- Addons podem registrar resolvers namespaced.
- Duplicatas são rejeitadas por padrão.
- Overrides exigem API explícita.
- RNG entra via `RandomProvider`, nunca `Math.random()` como contrato.
- Resultados aleatórios relevantes ficam auditáveis.
- Falha de resolver não pode causar mutation parcial.

## 2.2. ProjectEntry / progress ledger

Histórico de progresso é append-oriented.

`ProjectEntry` possui:

- ID estável;
- `unitsDelta`;
- `unitsBefore`;
- `unitsAfter`;
- `sourceKind`;
- `sourceRef`;
- usuário Foundry solicitante quando conhecido;
- ator/contributor lógico separado do usuário;
- world time quando disponível;
- real timestamp;
- `reasonCode`;
- note opcional;
- metadata limitada/namespaced.

Sources iniciais:

```text
manual
time
downtime
assignment
facility
command
integration
system
```

Regras:

- Entries não são normalmente editadas depois de criadas.
- Histórico não é apagado para “corrigir”.
- Valor atual pode manter snapshot/counter eficiente.
- Ledger continua auditável.
- Ferramenta de consistência pode verificar snapshot ↔ ledger.

## 2.3. Correction / reversal / rebuild

Correções usam novas entries.

```text
Original Entry
    ↓
Correction / Reversal Entry
```

Regras:

- Reversal referencia entry original.
- Double reversal acidental deve ser bloqueado.
- Reversal de Project não desfaz Economy automaticamente.
- Compensação cross-service exige operation coordenada.
- Completion não é revertida automaticamente só porque progress caiu.
- Reabrir Project concluído exige comando explícito.
- Rebuild segue preview → plan → commit.
- Divergência não é silenciosamente autocorrigida durante load.
- Dados inválidos de migration devem ser preservados/quarentenados quando possível.
- Hard-delete é ferramenta excepcional de manutenção.
- Correction/reversal gera Receipt.

## 2.4. Contributors / Workforce / Assignments

`Contributor` não é Foundry User.

`ProjectContributorRef` pode apontar para:

- Notable;
- People Group;
- referência externa;
- contributor narrativo/abstrato quando permitido.

`Assignment` é separado do contributor histórico.

Estados:

```text
planned
active
paused
ended
cancelled
```

Regras:

- Assignment representa compromisso/alocação atual ou planejada.
- Progress entry representa histórico.
- Um participant pode ter vários assignments se capacity permitir.
- Workforce pode ser abstrata.
- Workforce não precisa mapear 1:1 para pessoas.
- Quantidades persistidas são inteiras.
- Efficiencies/fractions usam racional/carry controlado quando necessário.
- Over-allocation é policy-driven; default bloqueia.
- Capacity é resolvida via provider/resolver.
- Mudança futura do contributor não altera avanço histórico.
- Cada resolução pode snapshotar facts relevantes usados no cálculo.

## 2.5. Requirements / blockers

Requirements usam registry extensível.

Structured result:

```text
satisfied
unsatisfied
unavailable
error
```

Categorias:

```text
start
advance
continuous
completion
```

Regras:

- Requirement fornece codes/reasons localizáveis.
- Requirement contínuo pode produzir blocker.
- `ProjectBlocker` é estruturado.
- Blockers e warnings são conceitos separados.
- Integração obrigatória ausente é `unavailable`, não “satisfied”.
- Requirements persistem dados + resolver ID, não código.
- Instance preserva contrato/snapshot conforme version policy.
- Diagnostics devem explicar por que o Project está bloqueado.

## 2.6. ProjectAdvancePlan

Toda tentativa relevante de avanço começa por plan.

Plan contém:

- ID;
- expected project revision;
- progresso proposto;
- requirements avaliados;
- contributors resolvidos;
- side effects pretendidos;
- warnings/blockers;
- preconditions.

Regras:

- Plan é serializável.
- Pode ser usado em preview/dry-run.
- Mudança de revision invalida/requer replan.
- Zero progress pode gerar plan.
- Batch usa `ProjectAdvanceBatchPlan`.
- Batch suporta atomic ou best-effort explicitamente.
- Commit retorna `ProjectReceipt`.
- Receipt registra efeitos realmente aplicados.

## 2.7. Projects ↔ Economy

Policies iniciais:

```text
upfront
reserved
progressive
onCompletion
custom
```

Regras:

- Reservation não é debit.
- Project pode reservar recursos no start.
- Reservation referencia ProjectInstance.
- Progressive cost usa units/policy determinística.
- Divisões inexatas usam carry/remainder determinístico.
- Recursos insuficientes bloqueiam antes da mutation.
- Economy + progress são coordenados pelo `MutationCoordinator`.
- Economy mantém receipt/ledger próprios.
- ProjectReceipt referencia receipts econômicos.
- Cancelamento usa `ProjectCancellationPolicy`.
- Refund é transação compensatória; histórico não é reescrito.

## 2.8. Projects ↔ Facilities

Regra central:

```text
Facility = entidade/estado persistente
Project  = processo de construção/modificação
```

- Construction normalmente usa Project.
- Repair relevante pode usar Project.
- Upgrade normalmente usa Project.
- Demolition/decommission pode usar Project.
- Facility pode existir sem ter sido construída por Project.
- Project pode apontar para planned facility target.
- Completion de construction/repair/upgrade é operação coordenada.
- Facility fornece facts/capabilities; não altera Project diretamente.

---

# 3. DEC-2601–2750 — Facilities

## 3.1. FacilityDefinition / FacilityInstance

Arquitetura:

```text
FacilityDefinition
       │
       ▼
FacilityInstance
```

Regras:

- Definition descreve tipo.
- Instance representa instalação concreta.
- IDs são estáveis.
- Nome/descrição default podem ser sobrescritos na Instance.
- Definition não persiste código executável.
- Instance preserva snapshot/version relevante.
- Facility pode existir sem Domain.
- `domainRef` e `locationRef` são separados.
- Localização física e administração podem divergir.
- Facility pode mudar de Domain por mutation auditada.
- Mobilidade depende da Definition/policy.
- Tags e categorias são extensíveis.
- Scale é abstrata; pode representar sala, prédio, complexo, estação, etc.
- Instance usa revision/optimistic concurrency.
- Mutations relevantes retornam FacilityReceipt.

## 3.2. Lifecycle / readiness

Lifecycle inicial:

```text
planned
underConstruction
inactive
operational
degraded
disabled
decommissioned
destroyed
```

Readiness é separado:

```text
ready
limited
blocked
unavailable
```

Regras:

- Lifecycle não é dropdown livre.
- Transitions usam `FacilityTransitionPolicy`.
- Histórico é preservado.
- `operational` não significa automaticamente “100% funcional”.
- `disabled` não implica necessariamente dano físico.
- Destroyed não apaga histórico/referências.
- GM override existe apenas como operação privilegiada/auditada.

## 3.3. Levels / upgrades

- Level é opcional.
- Quando usado, é inteiro.
- Máximo vem da Definition/policy.
- Upgrade normal usa Project.
- `FacilityLevelResolver` é extensível.
- Upgrades podem ser lineares ou ramificados.
- `FacilityUpgradeDefinition` possui ID estável.
- Upgrades podem ser mutuamente exclusivos.
- Removal/retrofit pode exigir Project.
- Dano operacional não remove estruturalmente upgrade por padrão.
- Módulos/upgrades podem existir sem level global.
- Mudança futura de Definition não recalcula silenciosamente instalações antigas.

## 3.4. Slots / modules / capacity

Facilities podem possuir:

- `FacilitySlotDefinition`;
- `FacilityModuleDefinition`;
- `FacilityModuleInstance`;
- capacity pools inteiros.

Exemplos de pools:

```text
energia
espaço
processamento
docas
leitos
oficinas
```

O core não transforma esses exemplos em enum rígido.

Regras:

- Slots possuem IDs estáveis.
- Slots podem restringir módulos por tags/requirements.
- Módulo não precisa ser outra Facility.
- Facility dentro de Facility é permitida quando semanticamente necessária.
- Módulos podem ocupar múltiplas capacity units.
- Módulos podem fornecer uma capacity e consumir outra.
- Ciclos inválidos são detectados.
- Queda de capacity por dano não apaga módulos; pode torná-los inativos/bloqueados.
- Resolver de capacity deve explicar o resultado.

## 3.5. Staffing

Facility pode declarar `FacilityStaffRequirement`.

Regras:

- People é acessado por capability/provider.
- Sem People subsystem, staffing abstrato continua possível.
- Requirements podem declarar quantidade e roles.
- Roles são extensíveis.
- Insufficient staffing pode reduzir output ou bloquear conforme policy.
- `StaffingResolver` produz breakdown.
- People permanece fonte de verdade sobre pessoas.
- Groups e Notables podem ocupar assignments/roles.
- Skills/traits entram como facts/modifiers, não por acesso direto a Actor internals.
- Transferência de staff pode ser coordenada quando capacity exclusiva estiver envolvida.

## 3.6. Maintenance

Maintenance é opcional por Definition.

Pode consumir:

- Economy resources;
- Time/schedule;
- requirements adicionais.

`FacilityMaintenancePlan` segue plan → commit.

Regras:

- Sem TimeProvider, maintenance pode ser manual.
- Falta de recurso usa policy: overdue/degradation/block/etc.
- `maintenanceDue` é condição operacional, não lifecycle.
- Overdue pode acumular em unidades/ticks.
- Atraso pode reduzir outputs gradualmente.
- Custos passados não são recalculados retroativamente.
- Facility pode ter múltiplos maintenance channels.
- Grandes manutenções podem virar Project.
- Rotina simples não precisa virar Project.
- Feature pode ser desligada em campanhas simples.
- Batch maintenance possui preview agregado.

## 3.7. Damage / conditions / repair

Facility não é obrigada a possuir HP universal.

Modelo padrão simples de integridade pode existir, mas é opcional.

`FacilityCondition` é genérica e namespaced.

Regras:

- Integrity usa inteiro quando utilizada.
- Damage e repair produzem histórico.
- Dano pode atingir capabilities/módulos específicos.
- Conditions podem ter severity/duração.
- Small repair pode ser ação direta conforme policy.
- Repair significativo normalmente usa Project.
- Destroyed pode ser reconstruída conforme Definition/policy.
- Módulos não são apagados automaticamente por dano.
- Damage model é extensível por resolver/provider.

## 3.8. Outputs / dependencies / Domain

`FacilityOutputDefinition` pode produzir:

- Economy outputs;
- facts;
- capabilities;
- modifiers;
- capacity;
- Knowledge;
- eventos declarativos.

Regras:

- Economy output passa por EconomyProvider.
- Outputs usam registry/policy.
- Facilities podem conceder capabilities ao Domain.
- Dependência por capabilities é preferida a dependência direta por Facility ID.
- Direct Facility dependency continua permitida quando necessária.
- Cycles devem ser detectados.
- Domain summary deriva dados via read models/indexes; não duplica fonte de verdade.

Regra final:

> Facility é entidade persistente independente; Projects constroem/modificam, People opera, Economy sustenta, Time agenda, Domain organiza e CapabilityResolver conecta os subsystems sem que um possua o outro.

---

# 4. DEC-2751–2900 — Downtime

## 4.1. DowntimeDefinition / DowntimeInstance

Downtime segue:

```text
DowntimeDefinition
        │
        ▼
DowntimeInstance
```

Pode ser:

```text
individual
group
domain
flexible
```

Regras:

- Domain é opcional.
- Pode usar `facilityRefs`.
- Pode usar `locationRef`.
- Instance possui ID/revision.
- Definition persiste dados, não funções.
- Tags/categories são extensíveis.
- Categorias default são conteúdo, não regras hard-coded.
- Duração default pode existir e ser sobrescrita conforme policy.
- Atividade pode consumir zero world time quando permitido.
- Instance preserva snapshot/version relevante.

## 4.2. Lifecycle

Estados:

```text
draft
planned
ready
inProgress
paused
blocked
completed
cancelled
failed
```

Regras:

- Draft não impacta Economy/Time/capacity.
- `ready` indica requirements satisfeitos.
- Blockers são estruturados.
- Pause preserva progresso.
- Cancel não apaga Instance.
- Failure terminal ou recuperável depende da policy.
- Completion não é revertida automaticamente.
- Reopen exige operação explícita/auditada.
- Players podem iniciar quando permissions/policy permitirem.
- Atividades sensíveis podem exigir aprovação GM.

## 4.3. Participants

`DowntimeParticipantRef` pode referenciar:

- Notable;
- People Group;
- Actor/integration ref;
- participant abstrato/narrativo.

Roles são extensíveis, por exemplo:

```text
owner
participant
assistant
supervisor
```

Regras:

- Min/max participants podem existir.
- Availability/capacity é resolvida por provider.
- Participant pode estar em vários Downtimes se capacity permitir.
- Participation pode consumir capacity/time individual.
- Participants podem fornecer facts/modifiers.
- Mudanças durante atividade são auditadas.
- Alteração futura não reescreve resultados históricos.
- Resolution pode snapshotar participantes/facts usados.

## 4.4. Duration / Time / stages

Downtime usa `TimeProvider` opcional.

- Sem provider, avanço manual continua possível.
- Core não conhece calendário específico.
- Duração pode usar ticks/unidades abstratas.
- Pode ser instantânea.
- Pode ser indefinida até condição externa.
- World time e real timestamps podem ser registrados.
- Auto-resolution depende de automation policy.
- `DowntimeStageDefinition` permite milestones/stages.
- Grandes time jumps podem ser agregados quando matematicamente equivalentes.
- RNG impede agregação ingênua.
- Duplicidade de eventos temporais é protegida por idempotency/checkpoints.

## 4.5. Requirements / costs / Facility usage

Downtime reutiliza structured requirements.

Pode exigir:

- capability de Facility;
- Facility específica;
- People availability;
- Economy resources;
- rights/capabilities externos.

Regras:

- Facility degraded pode satisfazer parcialmente conforme resolver.
- Downtime pode reservar capacity de Facility.
- Reservations podem ter janela temporal.
- Conflitos de capacity são resolvidos antes do commit.
- Cost policies podem incluir:

```text
upfront
reserved
periodic
perStage
onCompletion
```

- Reservation não é debit.
- Falta de resource pode block/pause conforme policy.
- Cancelamento usa cancellation/refund policy.
- Start usa `DowntimeStartPlan`.
- Plan inclui revisions das entidades envolvidas.

## 4.6. Checks / RNG

Check não é obrigatório.

`DowntimeCheckResolver` é system-agnostic.

Regras:

- Core não depende de LANCER.
- Game systems podem registrar resolvers.
- Outcomes não são limitados a boolean.
- IDs de outcome são extensíveis.
- Raw roll/formula/inputs podem ser auditados.
- RNG passa por `RandomProvider`.
- Chat roll pode ser vinculado por adapter.
- GM pode selecionar resultado narrativo quando policy permitir.
- Resolver pode retornar `awaitingInput`.
- Checks podem existir por stage.
- Modifiers registram origem.
- Secrets podem contribuir sem revelar detalhes.
- Resolver failure não causa partial mutation.

## 4.7. Outcomes / consequences

`DowntimeOutcomeDefinition` é declarativa.

Pode:

- conceder Economy resource;
- avançar/criar Project por API;
- alterar Facility por API;
- aplicar FacilityCondition;
- afetar People via provider/action;
- gerar Knowledge/Secret;
- criar Request/Mission;
- produzir narrativa sem mutation.

Regras:

- Consequence negativa usa o mesmo modelo de outcome.
- Visibility pode separar public/GM-only.
- Cross-service side effects usam `MutationCoordinator`.
- Receipt registra effects e child receipts.
- Future effects entram pelo Scheduler/Time.
- Unlocks devem preferir facts/capabilities.

## 4.8. Downtime ↔ Projects

Downtime e Project são diferentes.

```text
Downtime
→ atividade limitada no tempo

Project
→ processo persistente de progresso
```

Downtime pode contribuir para Project pela API normal:

```text
Downtime outcome
   ↓
ProjectAdvancePlan
   ↓
Project commit
```

Regras:

- Uma Downtime pode contribuir para vários Projects.
- Project pode depender de facts/outcomes de Downtime.
- Downtime pode representar administração do Domain.
- Batch usa `DowntimeBatchPlan`.
- GM possui visão agregada para resolver período.
- Preview mostra conflitos antes do commit.
- UI do player mostra somente atividades disponíveis/permitidas.
- Fluxo simples usa progressive disclosure.

Fluxo do player:

```text
Escolher atividade
→ participantes
→ local/Facility
→ duração/opções
→ preview
→ solicitar/iniciar
```

Fluxo GM:

```text
Review
→ blockers/conflitos
→ ajustes
→ approve/start
→ resolve período
→ receipts/outcomes
```

Regra final:

> Downtime orquestra uma atividade limitada no tempo usando capabilities de outros subsystems; não possui People, Economy, Projects, Facilities nem Time e nunca contorna suas APIs públicas.

---

# 5. DEC-2901–3050 — Integração, authority, multiplayer e recovery

## 5.1. Service boundaries

Regra:

```text
Resolvers leem
Plans descrevem
Coordinator aplica
Services possuem os dados
```

- Apenas o service proprietário altera a entidade.
- Integrações usam APIs públicas.
- Project não cria Facility diretamente.
- Facility não avança Project diretamente.
- Downtime não altera Facility/Project/Economy diretamente.
- Fluxos compostos usam `DomainOperationPlan`.
- Plan composto agrega plans especializados.
- Receipts filhos são preservados.
- Side effects são explícitos.
- Resolver não chama mutation API.

## 5.2. Commands / Plans / Receipts

Commands:

- possuem `commandId`;
- `kind` namespaced;
- registram usuário solicitante;
- distinguem usuário de entidade narrativa;
- podem carregar `expectedRevision`;
- UI e API usam o mesmo pipeline.

Plan:

- não é mutation;
- oferece preview;
- possui preconditions serializáveis;
- possui mutations declarativas;
- evita callbacks ocultos como contrato persistido.

Receipt status:

```text
committed
rejected
failed
partial
noop
```

Receipt registra:

- revisions before/after;
- warnings;
- effects aplicados;
- child receipts;
- dados suficientes para auditoria.

## 5.3. Allocation / reservations / conflicts

Resources compartilhados podem incluir:

- workforce;
- Facility capacity;
- outros capacity providers.

`AllocationResolver` é compartilhável/extensível.

Reservation:

- é explícita;
- possui source/owner;
- pode ter janela temporal;
- pode ser parcial;
- é liberada de forma coordenada;
- pode expirar conforme policy;
- não continua ativa após conclusão.

Conflitos:

- são detectados antes do commit;
- podem reportar todas as causas;
- GM override exige operação explícita/auditada;
- over-allocation deliberada só existe por policy.

## 5.4. Scheduler

Existe Scheduler central de orquestração sobre `TimeProvider`.

`ScheduledOperation`:

- possui ID estável;
- pode apontar para Project/Facility/Downtime;
- gera Command/Plan;
- não muta diretamente.

Time preview pode mostrar:

- maintenance;
- project progress;
- Downtime resolution;
- releases/expirations;
- completions/outcomes.

Ordem default:

```text
preconditions
→ releases / expirations
→ maintenance / costs
→ progress
→ completion
→ outcomes
→ scheduled follow-ups
```

A ordem é determinística e idempotente.

## 5.5. Authority / multiplayer

Autoridade final:

```text
Primary active GM
```

Regras:

- Player envia intenção/Command.
- Player não envia documento já mutado.
- GM revalida permissions.
- GM revalida preconditions.
- GM usa fresh authoritative state.
- Preview local é apenas UX.
- Ownership Foundry não é a única permission layer.
- Domain roles/capabilities/policies também contam.
- Domain controllers podem permanecer OBSERVER no Journal.
- Esconder botão não substitui validação server-side.
- Permission denied retorna reason code.
- Ações não autorizadas podem virar Request quando configurado.
- Sem GM autoritativo, client não assume autoridade silenciosamente.

Socket authority mantém o padrão socketlib já adotado pelo módulo.

## 5.6. Idempotency / recovery

- Todo Command mutável possui idempotency key.
- `commandId` é default.
- Retry não duplica mutation.
- Receipt existente pode ser retornado novamente.
- Partial failure nunca é escondida.
- `RecoveryPlan` representa recuperação complexa.
- Compensation é explícita.
- Auto-recovery só ocorre quando segura/determinística.
- Inconsistência é sinalizada ao GM.
- Reload deve poder reconhecer operações já committed.
- Audit index referencia receipts sem criar mega-ledger duplicado.
- Provider failure degrada capability em vez de derrubar todo módulo.
- Exception inesperada interrompe novas mutations dentro do operation scope até estado seguro.

## 5.7. Read models / indexes

Read models oficiais:

```text
ProjectReadModel
FacilityReadModel
DowntimeReadModel
DomainOperationsReadModel
```

Regras:

- Não são fonte de verdade.
- Podem agregar múltiplos subsystems.
- Indexam por Domain/location/state/participant/resource/source.
- São rebuildable a partir dos documentos persistidos.
- Cache nunca autoriza mutation sem fresh validation.
- Invalidations seguem mutations/receipts.
- Visibility filtering ocorre antes da entrega ao client.
- Overview deve funcionar em escala grande.

## 5.8. UI operacional

Domain possui visão operacional integrada, mas telas especializadas continuam existindo.

Princípio:

```text
Summary → Explanation → Detail → Action
```

UI prioriza:

- exceções;
- blockers;
- conflicts;
- completions;
- decisões pendentes.

Regras:

- status não depende somente de cor;
- blockers são inspecionáveis;
- common actions exigem poucos cliques;
- wizards aparecem quando complexidade justificar;
- advanced options ficam escondidas por default;
- preview mostra mudanças relevantes, não dump JSON;
- GM possui painel **Resolver período**;
- painel chama services/plans existentes e não implementa segunda engine.

## 5.9. Activity / explainability

- Nem toda mutation gera toast.
- Routine events podem ir ao activity log.
- Existe Activity Feed por Domain.
- Feed referencia receipts.
- Visibility é respeitada.
- GM pode abrir diagnostics detalhado.
- Player deve entender blockers sem receber secrets.
- Technical reason code é separado de texto de UI.
- Secrets podem produzir reason sanitizado.
- Histórico pode mostrar before/after.
- Filtros por subsystem/tipo/período.
- Explicabilidade é requisito funcional.

## 5.10. Integration invariants

Testes obrigatórios incluem:

- resolvers não mutam;
- Project não edita Economy/Facility/People;
- Downtime não edita Project/Facility/Economy;
- Facility não possui People/Economy/Projects;
- duplicate Command;
- revision conflict;
- failure durante operation composta;
- absence de Economy/People/Time provider;
- provider desaparecendo;
- multiplayer concurrent commands;
- large time jump idempotency;
- allocation conflicts;
- index/read model rebuild;
- escala pequena e grande.

Invariante:

> Nenhum subsystem contorna authority, permissions, revisions ou APIs públicas; toda operação composta permanece auditável, explicável, idempotente e recuperável.

---

# 6. DEC-3051–3200 — Templates, customização, migrations, performance e aceite

## 6.1. Templates / presets

Templates são diferentes de Definitions.

```text
Definition
→ regra/tipo

Template
→ configuração reutilizável baseada em Definition
```

Templates:

- possuem ID estável;
- podem ser custom do GM;
- podem predefinir participants/cost/duration/location;
- não alteram instances antigas quando editados;
- podem ser duplicados;
- podem ter tags/categories;
- podem ser GM-only;
- podem ser marcados como recomendados para player;
- são conteúdo/defaults, não hard-code;
- nunca executam mutation diretamente.

## 6.2. Quick create

Projects, Facilities e Downtimes comuns devem poder ser criados sem expor toda a arquitetura.

Regras:

- poucos campos essenciais inicialmente;
- advanced settings expansíveis;
- defaults herdados;
- presets disponíveis;
- “do zero” disponível ao GM;
- player vê somente tipos expostos;
- search/filter;
- drafts não impactam subsystems;
- drafts podem ser salvos.

Meta:

> operação comum deve caber em aproximadamente 1–2 telas e poucos cliques.

## 6.3. World custom content

GM pode criar pela UI:

- `ProjectDefinition`;
- `FacilityDefinition`;
- `DowntimeDefinition`.

Regras:

- casos comuns não exigem JSON;
- modo avançado pode expor JSON/schema;
- JSON sempre passa por schema validation;
- erros são específicos;
- registered resolvers externos podem ser selecionados;
- resolver ausente vira missing dependency diagnosticável;
- custom tags/requirements são permitidos;
- conteúdo tem schemaVersion;
- alteração de Definition usada por instances gera warning;
- existe validação antes de publish/use.

## 6.4. Import / export

Definitions/templates podem ser exportados em JSON versionado.

Pack:

- pode conter múltiplos itens;
- possui manifest;
- declara versão mínima;
- declara dependencies;
- import mostra preview;
- ID conflicts oferecem skip/replace/duplicate-as-new quando seguro;
- replace exige confirmação;
- versões antigas podem passar por migration;
- versão futura incompatível é rejeitada claramente;
- instances podem ser exportadas para backup;
- mode de compartilhamento pode omitir secrets;
- import nunca contorna validation/migrations.

## 6.5. Migrations

Projects/Facilities/Downtimes possuem `schemaVersion`.

Regras:

- Definitions podem ter versionamento distinto das Instances.
- Migration preferencialmente incremental.
- Migrator é idempotente.
- Mudanças destrutivas exigem preview/backup quando pertinente.
- Migration relevante não deve ocorrer silenciosamente.
- Unknown data não é apagado arbitrariamente.
- Non-migratable data deve ser quarantined quando possível.
- Relatório lista success/warnings/failures.
- Indexes/read models podem ser rebuild após migration.
- Historical receipts podem exigir migration de leitura.
- Mudança incompatível de default Definition exige migration explícita.
- Existe ferramenta de verificação pós-update.

## 6.6. External API

Core expõe API pública versionada.

Extensões podem registrar:

- Definitions;
- resolvers;
- requirements;
- outputs;
- cost providers;
- UI extension points controlados.

Regras:

- não podem substituir arbitrariamente core service por default;
- hooks públicos usam payload estável;
- observational hooks não mutam;
- external mutations passam por Commands/Services;
- optional dependency missing não quebra boot;
- integração incompatível é isolada/diagnosticada;
- capability discovery é pública;
- preview/read APIs permitem consulta antes de tentar mutation;
- internals não são API implícita.

## 6.7. Performance / scale

Escala obrigatória:

```text
small base
≈ 12 NPCs

medium domain
→ dezenas/centenas de entidades

large empire
→ grande volume de territories/people/projects/facilities/operations
```

Regras:

- overview evita scan global por render;
- indexes em memória para consultas frequentes;
- index update incremental;
- rebuild global como fallback;
- large lists usam pagination/virtualization;
- history/activity feed usam lazy load;
- aggregates caros podem usar cache derivado;
- cache possui dependencies/version invalidation;
- resolver evita provider calls repetidas no mesmo operation context;
- batch pode usar chamadas agrupadas;
- UI atualiza seletivamente;
- performance nunca justifica violar invariantes.

## 6.8. UX small base ↔ empire

Base pequena:

- cards;
- contexto narrativo;
- poucas ações;
- detalhes progressivos.

Império:

- filters;
- grouping;
- tables/lists;
- bulk actions;
- saved filters;
- virtualização.

Regras:

- mesma arquitetura atende ambos.
- UI pode adaptar densidade automaticamente.
- usuário pode alternar visualizações.
- Territory/Location hierarchy permanece navegável.
- saved filters podem ser pessoais/compartilhados.
- bulk action usa Command/Plan.
- bulk preview informa quantidade afetada.
- dangerous bulk action exige confirmação.
- usuário comum nunca precisa conhecer revision/idempotency.
- GM avançado pode abrir diagnostics.
- overview continua útil mesmo com capabilities desativadas.

Meta:

> Uso simples continua simples; profundidade aparece somente quando necessária.

## 6.9. Graceful degradation / diagnostics

Sem Economy:

- costless Projects funcionam;
- Facilities sem economic maintenance funcionam;
- costless Downtime funciona.

Sem Time:

- operações temporais podem ser manuais.

Sem People:

- abstract workforce continua possível.

Diagnostics central deve detectar/listar:

- providers disponíveis;
- providers ausentes;
- registries/resolvers;
- duplicate IDs;
- broken refs;
- orphan reservations;
- inconsistent lifecycle states;
- missing capabilities;
- migration issues.

Repair tool sempre usa preview.

Bug-report diagnostic export omite dados sensíveis por default.

## 6.10. Acceptance criteria

Rodada 07 só é considerada implementada quando for possível validar:

### Projects

- criar;
- iniciar;
- avançar;
- bloquear;
- pausar;
- concluir;
- cancelar;
- reservar/consumir recursos;
- compensar custos;
- auditar ledger;
- detectar workforce conflict.

### Facilities

- criar planned Facility;
- construir via Project;
- tornar operational;
- degradar/danificar;
- falhar maintenance;
- reparar;
- fornecer capability/output sem acoplamento rígido.

### Downtime

- individual;
- coletivo;
- People opcional;
- Facility usage;
- Economy opcional;
- Time opcional;
- contribuir para Project por API pública.

### Shared infrastructure

- time preview;
- idempotent processing;
- multiplayer player→GM;
- no duplicate commit after reload;
- graceful missing integrations;
- small-base UX;
- empire-scale UX.

Decisão final da Rodada 07:

> **Projects, Facilities e Downtime formam um conjunto modular e interoperável, mas continuam subsystems independentes, orientados a Commands → Plans → authority → Receipts, com integrações opcionais, dados auditáveis, UX progressiva e escala de uma pequena base a um império.**

---

# 7. Modelos conceituais consolidados

## 7.1. Project

```ts
interface ProjectDefinition {
  id: string;
  version: number;
  label: string;
  description?: string;
  tags: readonly string[];

  progressResolverId: string;

  requirements: readonly unknown[];
  costs: readonly unknown[];
  rewards: readonly unknown[];
}

interface ProjectInstance {
  id: string;
  definitionId: string;
  schemaVersion: number;
  revision: number;

  lifecycle:
    | "draft"
    | "planned"
    | "approved"
    | "active"
    | "blocked"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled"
    | "archived";

  workRequired: number;
  workCompleted: number;

  entries: readonly ProjectEntry[];
}
```

## 7.2. Facility

```ts
interface FacilityInstance {
  id: string;
  definitionId: string;
  schemaVersion: number;
  revision: number;

  domainRef?: string | null;
  locationRef?: string | null;

  lifecycle:
    | "planned"
    | "underConstruction"
    | "inactive"
    | "operational"
    | "degraded"
    | "disabled"
    | "decommissioned"
    | "destroyed";

  level?: number | null;

  modules: readonly unknown[];
  conditions: readonly unknown[];
}
```

## 7.3. Downtime

```ts
interface DowntimeInstance {
  id: string;
  definitionId: string;
  schemaVersion: number;
  revision: number;

  domainRef?: string | null;
  facilityRefs: readonly string[];
  locationRef?: string | null;

  lifecycle:
    | "draft"
    | "planned"
    | "ready"
    | "inProgress"
    | "paused"
    | "blocked"
    | "completed"
    | "cancelled"
    | "failed";

  participants: readonly unknown[];
}
```

## 7.4. Shared operation

```ts
interface DomainOperationPlan {
  id: string;
  commandId: string;

  preconditions: readonly unknown[];
  childPlans: readonly unknown[];
  warnings: readonly unknown[];
  blockers: readonly unknown[];
}

interface OperationReceipt {
  id: string;
  commandId: string;

  status:
    | "committed"
    | "rejected"
    | "failed"
    | "partial"
    | "noop";

  childReceipts: readonly unknown[];
}
```

> Os shapes acima são conceituais e preservam as decisões da rodada; nomes/campos finais podem ser refinados durante implementação desde que os invariantes não sejam violados.

---

# 8. Invariantes oficiais da Rodada 07

1. Project não é Facility.
2. Downtime não é Project.
3. Facility não é Domain.
4. Facility não é Resource.
5. Contributor não é Foundry User.
6. Assignment não é histórico de progresso.
7. Definition não contém runtime code persistido.
8. IDs persistidos são estáveis.
9. Revision é usada para optimistic concurrency.
10. Progress canônico usa inteiros.
11. Percentual é derivado.
12. Resolver nunca muta.
13. Resolver usa capability/provider boundary.
14. Resolver ausente produz diagnóstico recuperável.
15. History relevante é append-oriented.
16. Correction/reversal não apaga história.
17. Reversal cross-service usa compensation explícita.
18. Completion não é checkbox.
19. Start não é mutation direta sem plan.
20. Reservation não é debit.
21. Economy permanece fonte de verdade econômica.
22. People permanece fonte de verdade de pessoas/workforce.
23. TimeProvider permanece fonte temporal.
24. Scheduler orquestra; não vira relógio paralelo.
25. Facility lifecycle é separado de readiness.
26. Damage não implica ownership change.
27. Project completion não edita Facility internals diretamente.
28. Facility não avança Project diretamente.
29. Downtime não edita Project/Facility/Economy diretamente.
30. Side effects são declarados em plans.
31. Client envia intenção.
32. GM autoritativo revalida permission e fresh state.
33. UI permission não substitui server validation.
34. Command possui idempotency.
35. Retry não duplica mutation.
36. Partial failure nunca é escondida.
37. Recovery/compensation é auditável.
38. Read model não é fonte de verdade.
39. Cache não autoriza write.
40. Visibility filtering acontece antes da entrega ao client.
41. Missing optional integration degrada capability sem crash geral.
42. Basic mode esconde complexidade, mas não cria engine paralela.
43. Bulk operation usa o mesmo Command/Plan pipeline.
44. Performance não autoriza violar invariantes.
45. O mesmo core atende pequena base e império.

---

# 9. Continuidade para Rodada 08

A próxima rodada é:

# RODADA 08 — Relations / Reputation / Agreements / Territory

Faixa inicial:

```text
DEC-3201
```

A Rodada 08 deve reutilizar obrigatoriamente a infraestrutura congelada nesta rodada:

```text
Command
Plan
Receipt
MutationCoordinator
Primary GM Authority
CapabilityResolver
AllocationResolver
Scheduler
Idempotency
Revision checking
Read Models
Indexes
Visibility sanitization
Graceful degradation
```

Relações futuras com Projects/Facilities/Downtime:

```text
Agreement
→ pode exigir Project / Mission / payment / territorial rights

Relation / Reputation
→ podem reagir a outcomes via explicit operations

Territory
→ pode fornecer location / access / build rights

Facility
→ continua entity independente localizada em Territory

Downtime
→ pode consumir rights/capabilities sem possuir Territory

Project
→ pode exigir territorial capability/right sem editar Territory
```

Nenhuma futura rodada deve transformar Relations, Territory ou Agreements em justificativa para bypass das regras de authority e mutation da Rodada 07.

---

# 10. Snapshot de continuidade

**Rodada:** 07  
**Tema:** Projects / Downtime / Facilities  
**Faixa:** DEC-2306–DEC-3200  
**Total:** 895 decisões  
**Status:** APROVADO / CONGELADO  

Partes:

```text
Parte 1 — DEC-2306–2450
Projects foundation

Parte 2 — DEC-2451–2600
ProgressResolver / ledger / workforce / requirements /
Economy / Project↔Facility

Parte 3 — DEC-2601–2750
Facilities

Parte 4 — DEC-2751–2900
Downtime

Parte 5 — DEC-2901–3050
Integration / authority / multiplayer / recovery /
read models / operational UI

Parte 6 — DEC-3051–3200
Templates / custom content / import-export / migrations /
API / performance / UX / diagnostics / acceptance
```

Próxima decisão:

```text
DEC-3201
```

Próxima rodada:

```text
Rodada 08 — Relations / Reputation / Agreements / Territory
```

---

# 11. Status final

```text
RODADA 07
DEC-2306–3200
895 DECISÕES
APROVADO
CONGELADO
READY FOR IMPLEMENTATION / CONTINUIDADE
```
````

---

# ANEXO 08 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_08_RELATIONS_REPUTATION_AGREEMENTS_TERRITORY_3201-4100.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 08
## Relations / Reputation / Agreements / Territory — Decisões 3201–4100

> **Status:** APROVADO / CONGELADO PARA CONTINUIDADE.
>
> O usuário aprovou em bloco todas as opções marcadas como **RECOMENDADO** nas decisões DEC-3201–DEC-4100.
>
> Este documento preserva a arquitetura oficial de Relations / Reputation / Agreements / Territory antes da Rodada 09. Nenhuma decisão deve ser alterada silenciosamente; revisões futuras devem registrar explicitamente qual DEC foi reaberta e qual decisão a substituiu.

---

# 0. Resumo executivo

A Rodada 08 separa quatro conceitos centrais:

```text
Relation
→ vínculo entre parties

Reputation
→ percepção de um subject por uma audience

Agreement
→ compromissos, direitos, obrigações e terms

Territory
→ espaço/hierarquia no qual claims, presence, influence e rights podem existir
```

Esses conceitos podem se influenciar, mas permanecem fontes de verdade independentes.

Princípios centrais:

```text
Relation ≠ Reputation
Relation ≠ Agreement
Territory ≠ Ownership
Ownership ≠ Administration
Administration ≠ Control
Presence ≠ Influence
Claim ≠ Recognition
Agreement ≠ Relation
Dispute ≠ War simulation
Crisis ≠ automatic threshold event
```

Arquitetura consolidada:

```text
                    DOMAIN
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
    RELATIONS     AGREEMENTS     TERRITORY
        │             │             │
        └──────┬──────┘             │
               ▼                    ▼
          REPUTATION          CLAIMS / RIGHTS
               │                    │
               └──────────┬─────────┘
                          ▼
                  CapabilityResolver
                          │
                          ▼
                     Command / Plan
                          │
                          ▼
                  MutationCoordinator
                          │
                          ▼
                    GM Authority
                          │
                          ▼
                       Receipt
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
         Timeline      Read Models     UI
```

Mutations diplomáticas e territoriais reutilizam a infraestrutura já congelada na Rodada 07:

```text
Intent
→ Command
→ Permission / Revision / Fresh State
→ Plan / Preview
→ Primary GM Authority
→ MutationCoordinator
→ Receipt
→ Read Models / Indexes / UI
```

---

# 1. DEC-3201–3350 — Relations, Reputation, Agreements e Territory foundation

## 1.1. Relations

`RelationDefinition` descreve tipos; `RelationInstance` representa relações concretas.

Regras principais:

- IDs estáveis e namespaced.
- Relation pode existir fora de um Domain específico.
- Parties não são restritas a Domain.
- Parties podem ser Domain, People Group, Notable, Actor/integration ref ou entidade narrativa.
- Relações podem ser bilaterais ou multi-party.
- Relações podem ser simétricas ou assimétricas.
- Roles de party são extensíveis.
- Relações podem possuir escopo territorial, econômico ou contextual.
- Relações possuem lifecycle explícito.
- Histórico não é apagado após encerramento.
- Relation não é fonte de verdade de Reputation.

## 1.2. Axes / stance / modifiers

Relations podem ter múltiplos axes, por exemplo:

```text
trust
fear
respect
influence
dependence
resentment
```

O core não fixa esses axes.

Regras:

- axis values persistidos usam inteiros;
- range é definido por axis/definition;
- stance qualitativa é opcional;
- stance pode ser derivada ou manual por policy;
- derived stance nunca substitui axes subjacentes;
- modifiers temporários são separados do valor base;
- modifiers podem ter source, duration e visibility;
- read models podem exibir stance + axes conforme permission.

## 1.3. Reputation

`ReputationRecord` separa:

```text
subjectRef
audienceRef
tracks
```

Regras:

- Reputation pode existir sem RelationInstance.
- Audience pode ser concreta ou abstrata.
- Reputation pode possuir múltiplos tracks.
- Tracks são extensíveis e namespaced.
- Score é inteiro.
- Range é por track.
- Alterações usam entries append-oriented.
- Correction/reversal é compensatório.
- Decay é opcional e policy-driven.
- Reputation pode ser secreta.
- Player pode ver band/apresentação sanitizada sem score real.
- Aggregate reputation é read model, não nova fonte de verdade.

## 1.4. Agreements

`AgreementDefinition` e `AgreementInstance` são entidades próprias.

Lifecycle base:

```text
draft
proposed
pendingApproval
active
suspended
breached
expired
terminated
```

Regras:

- Agreements podem existir sem RelationInstance.
- Agreements podem ter 2+ parties.
- Parties possuem roles.
- Terms são estruturados, mas texto narrativo livre também é permitido.
- Term pode criar obligation/right/capability.
- Term econômico usa EconomyProvider.
- Term territorial pode conceder access/rights sem alterar ownership.
- Breach não encerra Agreement automaticamente.
- Capabilities derivadas cessam quando source deixa de ser efetivo.
- Agreement não edita Relation/Reputation/Territory diretamente.

## 1.5. Territory / claims

Territory é independente de Relations.

Separações obrigatórias:

```text
ownership
administration
control
presence
influence
access / rights
```

`TerritoryClaim` registra vínculos estruturados.

Claim types podem incluir:

```text
ownership
administration
occupation
access
influence
tradeRights
```

O core não impõe esses exemplos como enum fechado.

Claims:

- podem competir;
- podem ser contestados;
- não obrigam o sistema a escolher um vencedor;
- podem possuir strength;
- podem ser herdáveis por policy;
- podem ser secretos;
- podem coexistir com rights e presence independentes.

---

# 2. DEC-3351–3500 — Histórico relacional, incidents, obligations e negociação

## 2.1. RelationEvent / Incident

`RelationEvent` é append-oriented.

Registra:

- ID;
- kind;
- parties;
- source refs;
- world time / real timestamp;
- summary;
- effects;
- visibility.

Correções usam correction/reversal; eventos históricos não são reescritos silenciosamente.

`RelationIncident` pode ser positivo, negativo, neutro ou ambíguo.

Incidents podem:

- afetar axes;
- afetar Reputation via operação composta;
- sinalizar possível breach;
- carregar attribution contestada;
- ter impact temporário via modifier;
- usar stacking policy;
- permanecer na história após expirarem seus efeitos.

## 2.2. Reputation dinâmica

`ReputationEntry` registra:

```text
delta
before
after
source
time
track
```

Decay:

- é opcional;
- pode variar por audience/track;
- pode convergir para baseline;
- pode ser processado por Scheduler/TimeProvider;
- pode ser manual sem TimeProvider;
- gera entries auditáveis;
- pode ser agregado visualmente sem apagar histórico.

## 2.3. Derived Relation state

`RelationStateResolver` pode considerar:

- axes;
- modifiers;
- Agreements;
- Reputation;
- Territory disputes;
- hidden facts permitidos.

Result inclui reasons estruturados.

Player recebe reasons sanitizados conforme visibility.

## 2.4. AgreementObligation

Obligations possuem:

- ID;
- obligated party;
- beneficiary quando aplicável;
- lifecycle;
- due conditions;
- evidence.

Lifecycle:

```text
pending
due
satisfied
waived
breached
expired
cancelled
```

Obligation pode exigir:

- payment;
- resource delivery;
- Project completion;
- Mission outcome;
- territorial behavior/right.

Evidence pode apontar para:

- Economy receipt;
- Project receipt;
- Mission outcome;
- manual GM evidence.

## 2.5. Compliance / breach

`ComplianceResolver` avalia obligations individualmente e produz estado agregado.

Regras:

- breach pode ser parcial;
- alleged breach é distinto de confirmed breach;
- breach pode ser contestado;
- grace periods são suportados;
- consequences são declarativas;
- consequences podem afetar Relation/Reputation/Rights por operations públicas;
- breach não apaga Agreement.

## 2.6. Proposal / amendments / renewal

`AgreementProposal` é separado de Agreement ativo.

Proposal:

- possui revision própria;
- pode ter rounds;
- preserva snapshots;
- suporta accept/reject/counter;
- pode expirar;
- pode ser secreto.

Agreement ativo muda substancialmente por `AgreementAmendment`.

Amendments:

- são auditáveis;
- preservam before/after ou patch;
- podem exigir reapproval.

Renewal/expiry:

- podem ser manuais ou automáticos por policy;
- auto-renewal gera event/receipt;
- expiry desativa capabilities derivadas;
- Agreements expirados continuam consultáveis;
- Agreement pode supersede outro.

---

# 3. DEC-3501–3650 — Territory, hierarchy, presence e control

## 3.1. Territory model

Territory reutiliza a hierarquia existente:

```text
locatedInUuid
administrativeParentUuid
```

Regras:

- Location e Territory não criam duas árvores concorrentes.
- Territory pode ser raiz.
- Ciclos são bloqueados.
- Escala é abstrata.
- Physical parent e administrative parent podem divergir.
- Territory possui revision.
- Metadata geográfica é opcional.

## 3.2. Ownership / administration / control

São conceitos independentes.

Exemplo válido:

```text
Owner: Domain A
Administrator: Domain B
Controller: Domain C
```

Todos podem ser representados por claims, não por um único campo `owner`.

## 3.3. ClaimRecognition

Recognition é contextual.

Pode registrar:

```text
positive
negative
unknown / no position
```

Recognition identifica recognizing party/audience.

Não existe “legitimidade universal” calculada automaticamente pelo módulo.

## 3.4. Presence / Influence

`TerritoryPresence` é separado de claim.

Presence pode ser:

- militar;
- econômica;
- civil;
- administrativa;
- qualquer tipo extensível.

Influence:

- é separada de presence;
- pode existir sem presença física;
- pode possuir múltiplos axes;
- pode decair;
- pode receber modifiers;
- pode ser derivada de Facilities/Agreements/Presence por resolver.

## 3.5. TerritoryLink

Links representam adjacência/conexão.

Podem ser:

```text
border
route
gate
lane
portal
corridor
```

Regras:

- podem ser unidirecionais;
- possuem status operacional;
- podem ter cost/capacity;
- podem depender de Agreements/Facilities;
- route computation completa não é requisito obrigatório do core;
- links secretos são suportados.

## 3.6. Territory rights

Rights são independentes de ownership.

Tipos possíveis:

```text
entry
trade
transit
build
extract
dock
settle
```

São extensíveis.

Rights podem vir de:

- Agreement;
- owner/admin policy;
- explicit grant.

Rights podem:

- ter beneficiary;
- ter duration;
- ter conditions;
- ser herdáveis;
- ser revogáveis conforme source/policy.

Effective rights são resolvidos, não copiados para Territory como verdade paralela.

## 3.7. Transfer / lease / concession

Ownership transfer usa `TerritoryTransferPlan`.

Regras:

- transfer preserva histórico;
- claims antigos são encerrados/superseded, não apagados;
- lease/concession não altera ownership;
- administration delegada pode vir de Agreement;
- occupation/control não implica ownership;
- batch transfer é suportado;
- transfer usa operação coordenada.

## 3.8. Inheritance

Inheritance é policy-driven e calculada.

Pode afetar:

- claims;
- rights;
- administration.

Não deve duplicar copies em todos os children.

Reparenting:

- é auditado;
- valida ciclos;
- mostra preview de impacts;
- recalcula estado herdado.

## 3.9. Integration with Facilities / People / Economy

- Facility usa `locationRef`.
- Construction pode exigir territorial `build` right.
- Territory ownership transfer não transfere Facility ownership automaticamente.
- Facilities podem pertencer a parties diferentes do território.
- Population aggregation é derivada.
- Economy pode associar flows a Territory.
- Occupation/control pode bloquear access sem alterar Facility ownership.
- Integrações permanecem via capabilities/providers.

---

# 4. DEC-3651–3800 — Disputes, conflict records, crises, sanctions e occupation

## 4.1. TerritoryDispute

`TerritoryDispute` é entidade persistente.

Lifecycle:

```text
latent
active
escalated
frozen
settled
abandoned
superseded
```

Dispute pode envolver:

- vários Territories;
- várias parties;
- vários claims;
- ownership;
- border;
- access;
- administration;
- resources;
- influence.

O sistema não decide automaticamente qual claim é legítimo.

## 4.2. Recognition

Recognition continua contextual por audience/party.

O sistema registra:

> quem reconhece o quê

e não:

> qual claim é “objetivamente legítimo”.

## 4.3. Influence pressure

Influence pode gerar pressão operacional sem mudar control.

Effective influence pode combinar:

- base;
- modifiers;
- presence;
- Agreements;
- Facilities;
- Reputation via policy.

Political/economic/etc. axes podem divergir.

## 4.4. War / conflict records

Domain Manager não simula guerra taticamente.

`ConflictRecord` / `WarRecord` é administrativo/narrativo.

Pode registrar:

- parties;
- status;
- fronts/theaters;
- Missions;
- TerritoryDisputes;
- external outcomes.

Não calcula batalhas automaticamente.

Resultados militares vêm de:

- GM;
- Mission;
- outro sistema;
- explicit outcome.

## 4.5. Crises

Crises não nascem automaticamente por threshold por default.

`CrisisRecord` é opcional.

Default:

```text
GM-triggered only
```

Métricas podem sugerir uma crise, mas suggestion não cria estado.

Crisis pode criar Mission/Request/modifier via API pública.

## 4.6. Sanctions

Sanctions são structured effects/policies.

Podem representar:

- trade restriction;
- embargo;
- access restriction;
- asset freeze;
- outras categorias extensíveis.

Podem ter:

- issuer;
- target;
- Territory scope;
- resource scope;
- duration.

Economy/Territory aplicam efeitos via capabilities/policies.

Sanction não possui ledger próprio.

## 4.7. Border incidents

Border incidents reutilizam `RelationIncident` + Territory refs.

Podem ser:

```text
trespass
blockade
skirmish
inspection
closure
violation
```

Não alteram control automaticamente.

Escalation é policy/GM-driven, não universal.

## 4.8. Occupation / transition

Occupation altera effective control/presence, não ownership automaticamente.

Pode possuir lifecycle:

```text
established
contested
stable
withdrawing
ended
```

Pacification não é simulador automático; pode ser Project/Mission.

Withdrawal não inventa automaticamente novo controller.

## 4.9. Secrets / intelligence

Claims, Presence, Influence, routes e Agreements podem ser secrets.

Discovery altera Knowledge/visibility, não a source-of-truth territorial.

Diferentes audiences podem possuir subsets diferentes de informação.

Rumor/false information pertence ao Knowledge subsystem, não ao Territory source-of-truth.

---

# 5. DEC-3801–3950 — UI, authority, read models, migrations e diagnostics

## 5.1. Diplomacy Overview

Existe overview unificado para:

- Relations;
- Reputation;
- Agreements;
- Territory.

Não substitui detail screens.

Padrão:

```text
Summary → Explanation → Detail → Action
```

Overview prioriza:

- recent changes;
- expiring Agreements;
- breaches;
- disputes;
- pending proposals;
- crises;
- actions requiring GM attention.

Small campaign pode usar cards; large campaign usa list/table/filtering.

## 5.2. Reputation UI

Reputation UI:

- mostra tracks;
- usa bands quando visibility esconder números;
- permite GM breakdown;
- mostra base/modifiers/decay;
- suporta history/filtering;
- manual adjustment exige reason e Plan/Receipt;
- aggregate é read model.

## 5.3. Agreement UI

Dashboard separa:

```text
draft
proposal
active
breached
expired
```

Agreement detail mostra:

- terms;
- obligations;
- due dates;
- compliance;
- evidence;
- amendments;
- proposal rounds.

Counter-proposal usa revision/round e diff.

## 5.4. Territory dashboard

Mostra separadamente:

- ownership;
- administration;
- control;
- presence;
- influence;
- claims;
- recognition;
- rights;
- disputes;
- facilities;
- people/population aggregates.

Timeline distingue fact de claim/rumor.

## 5.5. Player proposals

Players controladores podem propor:

- Agreements;
- Relation changes;
- claims;
- recognition requests.

Proposal entra em diplomatic inbox do GM.

Payload é estruturado e revalidado no approval.

GM pode:

```text
approve
reject
edit-before-approve
```

Edit preserva diferença em relação ao original.

## 5.6. Authority / concurrency

Mutations reutilizam Primary GM Authority + socketlib.

Entities usam revisions.

Revision conflict:

- nunca sobrescreve silenciosamente;
- retorna structured error;
- UI pode refresh/retry;
- safe replan pode existir.

Agreement multi-party acceptance e Territory batch transfer são concurrency-safe.

## 5.7. Read models / indexes

Read models:

```text
RelationReadModel
ReputationReadModel
AgreementReadModel
TerritoryReadModel
DiplomacyOverviewReadModel
```

Indexes podem ser por:

- party;
- Territory;
- Agreement status/expiry;
- dispute;
- claim type.

Cache é derivado/rebuildable e visibility-aware no authority side.

## 5.8. Import/export / migrations

Custom content exportável:

- RelationDefinitions;
- ReputationTrackDefinitions;
- AgreementDefinitions;
- TerritoryDefinitions/taxonomies;
- custom axes;
- claim types;
- term types;
- incident/sanction categories.

Packs reutilizam manifest/version system.

Migrations:

- preservam historical events;
- preservam amendments/evidence;
- preservam contested claims;
- nunca transformam ambiguity em certainty;
- podem converter legacy owner → ownership claim;
- legacy reputation score → default track com provenance;
- ambiguity gera warning/manual review.

## 5.9. Diagnostics

Detecta:

- broken Relation refs;
- orphan Agreement obligations;
- invalid Territory claims;
- recognitions para claim inexistente;
- derived rights de Agreement expirado;
- visibility leakage;
- inconsistent status.

Repair usa preview.

---

# 6. DEC-3951–4100 — Templates, bulk operations, feeds, performance e acceptance

## 6.1. Diplomatic templates / presets

Existem templates reutilizáveis para:

- Relation;
- Agreement;
- Reputation setup;
- Territory rights/claim presets.

Template não é Definition.

Templates:

- têm ID estável;
- podem ser world custom;
- podem ser privados do GM;
- podem predefinir parties/terms/axes/rights sem executar mutation;
- podem ser duplicados/versionados;
- não alteram instances já criadas;
- podem ser importados/exportados.

## 6.2. Quick creation

Fluxos simples existem para:

```text
Criar relação
Criar acordo
Registrar claim
Conceder right
Criar dispute
Registrar incident
```

Regras:

- campos avançados ficam ocultos inicialmente;
- validation ocorre antes de commit;
- preview continua disponível;
- player vê apenas ações permitidas;
- draft não produz effects;
- GM pode usar advanced editor.

## 6.3. Bulk diplomacy

Bulk operations são permitidas para escala grande, mas sempre pelo pipeline normal.

Podem incluir:

- tag/update relations;
- renew/expire selected Agreements quando policy permitir;
- apply/remove selected sanctions;
- update recognition;
- reassign administration;
- territorial actions.

Regras:

- preview obrigatório;
- count/targets claros;
- dangerous changes exigem confirmação;
- batch pode ser atomic ou best-effort por policy;
- each child mutation preserva receipt;
- bulk não é bypass de permissions/revisions.

## 6.4. Notifications / Activity Feed

Notificações priorizam:

- expiring Agreement;
- obligation due;
- breach;
- dispute escalation;
- proposal awaiting review;
- territorial control change;
- sanction;
- crisis requiring attention.

Routine entries ficam no Activity Feed.

Feeds podem existir:

- por Domain;
- por Relation;
- por Agreement;
- por Territory.

Feed é read model e referencia receipts/events existentes.

## 6.5. Advisory layer

Advisories podem sugerir:

- Agreement próximo do vencimento;
- unresolved obligation;
- repeated incidents;
- contested territory;
- missing recognition;
- access conflict;
- dependency/missing provider.

Advisory não cria mutation nem crise automaticamente.

GM pode desativar categorias de advisory.

## 6.6. Domain overview integration

Domain Overview pode mostrar resumo diplomático:

- relation stance counts;
- active Agreements;
- due obligations;
- disputes;
- contested Territories;
- pending proposals;
- sanctions/crises known to audience.

Esses valores são derivados de read models, não copiados para Domain.

## 6.7. Integration with Rodada 09 domains

Rodada 09 pode usar a infraestrutura aqui criada:

```text
Request
→ pode propor Agreement / claim / recognition / diplomatic action

Mission
→ pode produzir Incident / evidence / reputation change / territorial outcome

Knowledge / Secret
→ controla o que cada audience conhece sobre Relations,
  Agreements, claims, incidents e presence
```

Nenhum desses subsystems futuros deve alterar diretamente as fontes de verdade diplomáticas.

## 6.8. Performance extrema

Requisitos:

- index incremental;
- lazy-load timeline;
- virtualized large lists;
- derived state caching;
- batched provider reads;
- selective UI refresh;
- no global scans per render;
- no full graph recompute quando uma única relation muda;
- rebuild tools continuam disponíveis.

Benchmarks devem cobrir:

```text
small base
medium polity
large empire / multi-system campaign
```

## 6.9. Acceptance criteria

A Rodada 08 é aceita quando:

### Relations
- criar relation;
- multiple parties;
- axes/modifiers;
- derived stance;
- history;
- incident;
- secret visibility.

### Reputation
- tracks;
- audience-specific records;
- entries;
- decay;
- bands;
- secret/public views.

### Agreements
- proposal;
- counter;
- acceptance;
- active terms;
- obligations;
- evidence;
- breach;
- amendment;
- renewal;
- expiry.

### Territory
- hierarchy;
- ownership/admin/control separation;
- claims;
- recognition;
- presence;
- influence;
- rights;
- links;
- transfer;
- occupation;
- dispute.

### Shared infrastructure
- multiplayer authority;
- revisions;
- idempotency;
- read models;
- indexes;
- migrations;
- secret sanitization;
- performance at small and large scale.

## 6.10. Final architectural decision

Rodada 08 congela:

> Relations, Reputation, Agreements e Territory são subsystems independentes conectados por references, capabilities e operations auditáveis. O módulo registra vínculos, percepções, compromissos, claims, rights e contextos; não inventa legitimidade, não resolve guerras automaticamente e não transforma tensão em crise sem regra explicitamente habilitada ou decisão do GM.

---

# 7. Leis finais da Rodada 08

1. Relation não é Reputation.
2. Relation não é Agreement.
3. Reputation é audience-specific.
4. Agreement é entidade persistente própria.
5. Territory não é ownership.
6. Ownership não é administration.
7. Administration não é control.
8. Presence não é influence.
9. Claim não é recognition.
10. Multiple conflicting claims podem coexistir.
11. O core não escolhe claim “legítimo”.
12. Recognition é contextual por audience/party.
13. Stance derivada não substitui axes.
14. Modifiers temporários não reescrevem base.
15. History relevante é append-oriented.
16. Incident não exige culpa conhecida.
17. Reputation decay é policy-driven.
18. Agreement obligation é estruturada.
19. Breach pode ser parcial/contestado.
20. Alleged breach não é confirmed breach.
21. Agreement termination não é consequência automática de breach.
22. Amendment preserva history.
23. Agreement expiry remove derived capabilities/rights.
24. Territory hierarchy não duplica árvore paralela de Locations.
25. Claims herdados são calculados por policy.
26. Rights não são copiados do Agreement como fonte paralela.
27. Transfer não apaga claims antigos.
28. Lease/concession não muda ownership.
29. Occupation/control não muda ownership automaticamente.
30. War é registro/contexto, não simulador tático.
31. Crisis é GM-triggered por default.
32. Advisory não cria Crisis.
33. Sanction não possui ledger próprio.
34. Border incident não muda control automaticamente.
35. Secret discovery altera Knowledge/visibility, não source-of-truth.
36. Different audiences podem receber read models diferentes.
37. Client não recebe GM secrets para esconder com CSS.
38. Player proposal não é mutation.
39. Approval sempre revalida fresh state.
40. Diplomacy reutiliza Primary GM Authority.
41. Revision conflicts nunca sobrescrevem silenciosamente.
42. Read models não são source-of-truth.
43. Cache é rebuildable.
44. Bulk operations não bypassam permissions.
45. O mesmo core atende pequena base e império.

---

# 8. Continuidade para Rodada 09

Próxima rodada:

```text
Rodada 09 — Requests / Missions / Knowledge / Secrets
```

Próxima decisão:

```text
DEC-4101
```

A Rodada 09 deve reutilizar obrigatoriamente:

- Primary GM Authority;
- Command / Plan / Receipt;
- Revision checking;
- MutationCoordinator;
- CapabilityResolver;
- visibility sanitization;
- read models;
- indexes;
- idempotency;
- append-oriented history;
- provider boundaries.

Integrações já congeladas:

```text
Request
→ pode propor ação sem executá-la

Mission
→ pode fornecer outcomes/evidence

Knowledge
→ representa o que uma audience sabe

Secret
→ controla visibility / discoverability

Relation/Reputation/Agreement/Territory
→ continuam sendo suas próprias fontes de verdade
```

---

# 9. Snapshot de continuidade

**Rodada:** 08  
**Tema:** Relations / Reputation / Agreements / Territory  
**Faixa:** DEC-3201–DEC-4100  
**Total:** 900 decisões  
**Status:** APROVADO / CONGELADO

Partes:

```text
Parte 1 — DEC-3201–3350
Relations / Reputation / Agreements / Territory foundation

Parte 2 — DEC-3351–3500
History / incidents / obligations / negotiation

Parte 3 — DEC-3501–3650
Territory / claims / presence / influence / rights

Parte 4 — DEC-3651–3800
Disputes / recognition / conflicts / crises / sanctions / occupation

Parte 5 — DEC-3801–3950
UI / authority / read models / migrations / diagnostics

Parte 6 — DEC-3951–4100
Templates / quick create / bulk / feeds / performance / acceptance
```

Próxima decisão:

```text
DEC-4101
```

---

# 10. Status final

```text
RODADA 08
DEC-3201–4100
900 DECISÕES
APROVADO
CONGELADO
READY FOR CONTINUIDADE / IMPLEMENTAÇÃO
```
````

---

# ANEXO 09 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_09_REQUESTS_MISSIONS_KNOWLEDGE_SECRETS_4101-5000.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 09
## Requests / Missions / Knowledge / Secrets — Decisões 4101–5000

> **Status:** APROVADO / CONGELADO PARA CONTINUIDADE.
>
> O usuário aprovou em bloco todas as opções marcadas como **RECOMENDADO** nas decisões DEC-4101–DEC-5000.
>
> Este documento consolida a arquitetura oficial da Rodada 09. Nenhuma decisão deve ser alterada silenciosamente; revisões futuras devem registrar explicitamente qual DEC foi reaberta e qual decisão a substituiu.

---

# 0. Resumo executivo

A Rodada 09 separa quatro conceitos:

```text
Request
→ intenção submetida para review/approval

Mission
→ trabalho narrativo/operacional com participants, objectives, stages e outcome

Knowledge
→ o que uma audience sabe/acredita

Secret
→ o que possui visibility/discoverability restrita
```

Leis principais:

```text
Request ≠ Mutation
Request ≠ Mission
Mission ≠ Project
Knowledge ≠ World Truth
Knowledge ≠ Secret
Secret ≠ Knowledge
Rumor ≠ Truth
Visibility ≠ Foundry Ownership
Discovery ≠ Publicização global
Notification ≠ Source of Truth
Read Model ≠ Source of Truth
```

Arquitetura consolidada:

```text
Player / Domain
      │
      ▼
   Request
      │
      ▼
GM Review / Decision
      │
      ├──────────► outros Commands
      │
      ▼
   Mission
      │
 ┌────┼───────────────┐
 ▼    ▼               ▼
Objectives          Stages
 │                    │
 └──────────┬─────────┘
            ▼
       Resolution Plan
            │
            ▼
      MutationCoordinator
            │
     ┌──────┼──────────────┐
     ▼      ▼              ▼
 Projects Economy       Diplomacy/Territory
     │
     ▼
 Knowledge / Secret
     │
     ▼
 Audience-aware Projection
     │
     ▼
 Client UI
```

---

# 1. DEC-4101–4250 — Requests / Missions / Knowledge / Secrets foundation

## Requests

- Request é entidade persistente.
- Definition → Instance é suportado.
- Request representa intenção, não mutation.
- Payload original permanece preservado após submit.
- Lifecycle: draft, submitted, underReview, approved, rejected, withdrawn, fulfilled, expired, cancelled.
- `approved` e `fulfilled` são estados distintos.
- RequestDecision registra quem decidiu, quando e por quê.
- Handling usa registry extensível.
- Handler cria Commands/Plans; não muta diretamente.
- Fulfillment é idempotente.
- Request preserva refs dos resultados/receipts criados.

## Missions

- Mission é entidade independente, não subtype de Request.
- Request pode criar Mission de forma idempotente.
- Mission pode existir sem Request.
- Lifecycle: draft, available, accepted, active, blocked, resolved, failed, cancelled, expired, archived.
- Objectives são estruturados e possuem IDs estáveis.
- Objectives podem ser públicos ou secretos.
- Participant e audience são conceitos distintos.
- Outcome é estruturado.
- Outcome pode produzir side effects somente via APIs públicas.

## Knowledge

- Knowledge é subsystem próprio.
- Knowledge representa o que uma audience sabe/acredita, não world truth.
- KnowledgeRecord possui subject + audience.
- Audience pode ser user, participant, Group, Domain ou abstrata.
- Confidence/provenance/staleness são suportados.

## Secrets

- Secret é separado de Knowledge.
- Secret representa restrição/discoverability.
- Secret pode proteger entidade inteira, campo, claim, term, objective ou fact.
- Discovery cria/atualiza Knowledge; não duplica a entidade pública.
- Secrecy é audience-relative.

---

# 2. DEC-4251–4400 — Truth, belief, rumors, provenance, discovery e projection

## Truth vs belief

- Source-of-truth permanece no subsystem original.
- Knowledge pode estar correto, incorreto, parcial ou contraditório.
- knowledgeKind é extensível: fact, rumor, theory, testimony, interpretation, warning etc.
- Multiple records concorrentes sobre o mesmo subject são permitidos.
- Contradições não são apagadas automaticamente.

## Confidence

- Confidence é opcional e inteira.
- Bands qualitativas são suportadas.
- Confidence pode mudar com evidence.
- Decay/staleness podem afetar confidence por policy.
- Source reliability pode influenciar por resolver.

## Provenance / evidence

- Provenance é estruturada.
- Multiple sources são permitidas.
- Source lineage pode ser preservada.
- Evidence é distinto de provenance.
- Source e evidence podem ser secrets.

## Rumors / misinformation

- Rumor pode ser verdadeiro ou falso.
- Spread não é automático por default.
- Sharing cria Knowledge para nova audience.
- Misinformation nunca altera source-of-truth.
- Rumors podem mudar ao longo de transmission mantendo lineage.

## Staleness

- observedAt / validAt / expiresAt são suportados.
- stale ≠ false.
- Historical knowledge é preservado.
- TimeProvider é opcional.

## Partial disclosure / redaction

- Disclosure pode ser hidden, hinted, partial, full.
- Field-level projection é suportada.
- Redaction ocorre authority-side.
- Client nunca recebe full secret para esconder com CSS.
- Revogar access não apaga conhecimento já adquirido por default.

## Discovery / sharing

- Discovery é operação explícita e auditável.
- Discovery pode revelar apenas parte do Secret.
- Sharing respeita disclosure possuído.
- Sharing pode ser bloqueado/approval-gated.
- Leaks podem gerar incidents/compliance effects por explicit mappings.

---

# 3. DEC-4401–4550 — Mission assignment, stages, deadlines e outcomes

## Assignment

- MissionAssignment é separado de Participant.
- Roles são extensíveis.
- Assignment possui lifecycle.
- Foundry ownership não é assignment.
- Capacity/availability podem ser consultadas por provider.
- Reservation compartilhada pode ser usada.

## Stages

- Mission pode possuir stages opcionais.
- Stage possui ID estável.
- Stages podem conter objectives, requirements, blockers e outcomes.
- Branching é data-driven.
- Missions sem stages permanecem válidas.

## Deadlines

- Deadline global e por stage são suportadas.
- TimeProvider é opcional.
- Deadline vencida não falha automaticamente, salvo policy.
- Grace period e advisories são suportados.

## Objectives

- Objective pode depender de outro objective.
- Cycles são bloqueados.
- Objective pode possuir progress inteiro.
- Objective complexo pode referenciar Project real.
- Knowledge, Agreement, Territory e other evidence podem satisfazer objectives.
- Auto-satisfaction é idempotente quando habilitada.

## Resolution

- Resolution usa MissionResolutionPlan.
- Plan contém outcome, evidence, side effects, revisions e preconditions.
- External resolver nunca commita diretamente.
- MissionReceipt preserva child receipts.

## Rewards / consequences

Podem afetar, via APIs públicas:

- Economy;
- Reputation;
- Relations;
- Agreements;
- Territory;
- Knowledge;
- Secrets;
- Projects;
- Facilities;
- follow-up Requests/Missions.

## Branching / recurring

- Branching por outcome/objectives/evidence é suportado.
- Follow-up Mission guarda sourceMissionRef.
- Follow-ups são idempotentes.
- Recurring Mission cria nova Instance.
- Histórico é preservado.

---

# 4. DEC-4551–4700 — Multiplayer workflow, inbox, delegation e Mission Board

## Request Inbox

- Inbox unificada do GM.
- Filtros por status, Domain, requester, kind.
- Priority e urgency são distintas.
- Saved filters.
- Virtualização/paginação para grande escala.
- Original intent permanece intact.

## Triage

- underReview.
- internal notes/tags.
- public responses.
- clarification thread append-only.
- defer.
- duplicate merge por linkage, sem apagar originais.
- bulk triage somente via Command/Plan.

## Delegation

- Review pode ser delegado.
- Reviewer ≠ authority.
- Multiple reviewers suportados.
- Recommendations são distintas de authoritative decision.
- Approval quorum é opcional/configurável.

## Request → Mission

- Usa RequestToMissionPlan.
- Preview da Mission derivada.
- GM pode ajustar antes do commit.
- Original Request permanece intact.
- Conversão é idempotente.
- Request pode produzir uma ou várias Missions conforme handler.

## Mission Board

- Board audience-aware.
- Available / Accepted / Active / Completed.
- Boards por Domain ou globais.
- Search/filter/saved views.
- Large board virtualizado.
- Board é read model.

## Acceptance

- MissionAcceptPlan.
- Revalida availability, capacity e requirements.
- First-come, GM approval e competitive claim são policies diferentes.
- Acceptance não implica necessariamente start.
- Release/abandonment é auditado.

## Visibility

- Public, Domain-only, selected audiences e fully secret são suportados.
- Field-level visibility.
- Acceptance não concede automaticamente todos os secrets.
- Completing stages pode revelar Knowledge explicitamente.

## Notifications

- Request submit/decision/clarification.
- Mission assignment/deadline/stage/resolution.
- Notifications são sanitizadas e deduplicadas.
- Notifications não são source-of-truth.

## Authority

- socketlib → Primary GM Authority.
- schema/permission/ref validation.
- commandId/idempotency.
- expectedRevision.
- cached availability nunca decide mutation.

---

# 5. DEC-4701–4850 — Knowledge operational layer

## Index / search

Indexes por:

- audience;
- subject;
- kind;
- source;
- state.

Search:

- audience-aware;
- full-text;
- filterable;
- sanitized before delivery.

## Knowledge Graph

- É read model opcional.
- Nunca source-of-truth.
- Usa subgraphs focados.
- Nodes/edges secretos não são enviados.
- Deve ter fallback leve/lista.
- Nenhuma biblioteca pesada é obrigatória.

## Knowledge Browser

- GM e player views.
- Lists/tables/cards.
- Grouping por subject/audience/source/kind.
- Confidence/provenance/contradictions/staleness.
- Bookmarks pessoais não alteram KnowledgeRecord.
- Large browser usa lazy load.

## Sharing

- Ação estruturada.
- Preview do disclosure.
- Source disclosure controlável.
- Pode exigir GM approval.
- Sharing bloqueado pode virar Request.
- Batch sharing usa Plan e idempotency.

## Investigation

- Não cria subsystem isolado.
- Usa Mission + Knowledge/Secret.
- Objectives podem buscar Secrets ou Knowledge requirements.
- Outcomes podem revelar truth, partial info, rumor ou misinformation.
- InvestigationResolver é system-agnostic e read-only.

## Discovery queue

- Pode reutilizar inbox infrastructure.
- GM pode confirmar/ajustar disclosure/confidence.
- Duplicate discovery é deduplicada.
- Full-known discovery pode ser noop.
- Queue nunca entrega full secret a clients não autorizados.

## Projection Service

Existe `Disclosure/ProjectionService`.

Responsável por:

- audience context;
- source entity;
- Secret/Knowledge policies;
- field-level redaction;
- nested data projection;
- safe placeholders;
- ID/count/sort/search leakage prevention;
- notification/export sanitization.

Regra:
> APIs oficiais nunca entregam dados secretos para que o client “esconda”.

## Authority / import/export / diagnostics

- Knowledge/Secret mutations são autoritativas.
- Revisions/idempotency.
- Import/export versionados.
- Backup GM completo exige opção explícita.
- Migration preserva provenance/contradictions.
- Legacy visibility pode migrar para disclosure policy.
- Thousands de records devem ser suportados.
- Diagnostics detectam broken refs, cycles, invalid policies e leakage risks.

---

# 6. DEC-4851–5000 — Finalização da Rodada 09

## Templates / presets

Templates são permitidos para:

- Request;
- Mission;
- Knowledge setup;
- Secret/disclosure policy.

Template ≠ Definition.

Templates:

- possuem ID estável;
- podem ser world custom;
- podem ser privados do GM;
- podem ser duplicados/versionados;
- não alteram instances existentes;
- não executam mutations.

## Quick create

Fluxos simples devem existir para:

- Request;
- Mission;
- KnowledgeRecord;
- Secret;
- disclosure/reveal.

Advanced fields ficam recolhidos por default.

Drafts não produzem side effects.

## Unified Operations UI

Domain Operations pode agregar:

- pending Requests;
- Missions requiring action;
- pending discoveries;
- secrets/revelations relevantes;
- advisories;
- recent outcomes.

O overview é read model e não nova fonte de verdade.

## Domain integration

Domain pode mostrar:

- pending requests;
- active missions;
- available missions;
- recent outcomes;
- known knowledge highlights;
- unresolved secret-related advisories.

Counts são derivados.

## Activity / notifications

Existe Activity Feed unificado com references para receipts/events.

Rotina não deve gerar toast excessivo.

Critical events são destacados.

## Retention / archive

Requests/Missions/Knowledge history pode ser arquivado/compactado visualmente.

Arquivamento:

- não altera meaning;
- não apaga provenance;
- não apaga receipts essenciais;
- preserva rebuildability/auditability.

Hard delete é excepcional.

## Graceful degradation

Sem Time:
- deadlines/cooldowns manuais.

Sem People:
- participants/assignments abstratos continuam.

Sem Economy:
- Missions/Requests sem custos funcionam.

Sem Knowledge:
- Missions comuns ainda funcionam.

Sem Secret:
- public-only campaigns continuam funcionais.

Missing provider gera `unavailable`/diagnostic, não crash global.

## Final import/export / migration

- Packs podem incluir Definitions/Templates/Policies.
- World state pode ser exportado para backup.
- Share export sanitiza Secrets.
- Migrations são incrementais/idempotentes.
- Ambiguity nunca é convertida silenciosamente em certainty.
- Broken refs podem ser quarantined/manual review.

## Performance benchmarks

Benchmarks obrigatórios:

```text
small base
medium domain
large empire / multi-system
thousands of KnowledgeRecords
hundreds of Missions/Requests
```

Requisitos:

- incremental indexes;
- lazy timelines;
- virtualized lists;
- selective recompute;
- audience-aware cache;
- no global scans por render;
- no full knowledge graph materialization por default.

## Acceptance criteria

### Requests
- submit;
- review;
- clarification;
- delegation;
- approve/reject/withdraw;
- idempotent fulfillment;
- Request→Mission.

### Missions
- assignment;
- stages;
- objectives;
- deadlines;
- evidence;
- branching;
- resolution;
- rewards/consequences;
- follow-ups;
- archive.

### Knowledge
- audience-specific records;
- confidence;
- provenance;
- rumor/misinformation;
- contradiction;
- stale/superseded;
- sharing;
- search;
- browser;
- graph leve.

### Secrets
- entity/field secrecy;
- audience-relative disclosure;
- partial reveal;
- discovery;
- redaction;
- no client leakage.

### Shared
- Primary GM Authority;
- socketlib;
- revision conflicts;
- idempotency;
- read models;
- indexes;
- graceful degradation;
- migration;
- small/large scale UX.

---

# 7. Leis finais da Rodada 09

1. Request é intenção, não mutation.
2. Request aprovado não é necessariamente fulfilled.
3. Request original não é reescrito após submit.
4. Mission não é Request.
5. Mission não é Project.
6. Mission não é motor de combate.
7. Participant não é audience.
8. Assignment não é Foundry ownership.
9. Mission outcome nunca escreve em outro subsystem diretamente.
10. Knowledge não é world truth.
11. Secret não é Knowledge.
12. Rumor pode ser verdadeiro ou falso.
13. Misinformation nunca altera source-of-truth.
14. Contradictions podem coexistir.
15. Stale não significa false.
16. Provenance é preservada.
17. Discovery é audience-relative.
18. Revogar acesso não apaga conhecimento adquirido por default.
19. Partial disclosure é suportada.
20. Redaction é authority-side.
21. Client nunca recebe full secret para esconder localmente.
22. Search, sorting, counts e exports também respeitam projection.
23. Notification não é source-of-truth.
24. Mission Board não é source-of-truth.
25. Knowledge Graph não é source-of-truth.
26. Read Models não são source-of-truth.
27. Bulk workflows usam Command/Plan.
28. Request→Mission é idempotente.
29. Mission follow-up é idempotente.
30. Duplicate discovery é deduplicada.
31. Resolver nunca muta.
32. Handler nunca bypassa service APIs.
33. Missing integration degrada capability, não derruba módulo.
34. Audience awareness é aplicada antes da entrega ao client.
35. Primary GM Authority continua única.
36. socketlib continua transporte, não authority.
37. Revisions protegem concurrent writes.
38. commandId protege retries.
39. Archive não reescreve história.
40. Hard-delete é excepcional.
41. Basic UX não cria engine paralela.
42. Small base e empire usam o mesmo core.
43. Thousands de KnowledgeRecords devem ser suportados.
44. Performance não justifica leakage ou bypass.
45. Requests/Missions/Knowledge/Secrets permanecem independentes.

---

# 8. Snapshot de continuidade

**Rodada:** 09  
**Tema:** Requests / Missions / Knowledge / Secrets  
**Faixa:** DEC-4101–DEC-5000  
**Total:** 900 decisões  
**Status:** APROVADO / CONGELADO  

Partes:

```text
Parte 1 — DEC-4101–4250
Requests / Missions / Knowledge / Secrets foundation

Parte 2 — DEC-4251–4400
Truth / belief / rumors / provenance / discovery / projection

Parte 3 — DEC-4401–4550
Mission assignment / stages / deadlines / outcomes

Parte 4 — DEC-4551–4700
Multiplayer workflow / inbox / delegation / Mission Board

Parte 5 — DEC-4701–4850
Knowledge operational layer / graph / search / redaction

Parte 6 — DEC-4851–5000
Templates / unified UI / retention / graceful degradation /
performance / acceptance criteria
```

Próxima decisão:

```text
DEC-5001
```

---

# 9. Status final

```text
RODADA 09
DEC-4101–5000
900 DECISÕES
APROVADO
CONGELADO
READY FOR CONTINUIDADE / IMPLEMENTAÇÃO
```
````

---

# ANEXO 10 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_10_TIME_TICKS_EVENTS_CONDITIONS_ACTIONS_5001-5900.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 10
## Time / Ticks / Events / Conditions / Actions — DEC-5001–5900

> **Status:** APROVADO / CONGELADO PARA CONTINUIDADE.
>
> O usuário aprovou em bloco todas as opções marcadas como **RECOMENDADO** nas decisões DEC-5001–DEC-5900.
>
> Este documento consolida a arquitetura oficial da Rodada 10. Revisões futuras devem reabrir explicitamente as decisões afetadas; nada deve ser alterado silenciosamente.

---

# 0. Resumo executivo

A Rodada 10 estabelece uma camada temporal transversal, sem transferir ownership dos dados para Time/Scheduler.

Separação central:

- **TimeProvider** fornece tempo canônico/contexto.
- **CalendarAdapter** apenas traduz/apresenta calendários.
- **Scheduler** sabe quando uma operação deve ser tentada.
- **ScheduledOperation** representa trabalho futuro persistente.
- **TimeEvent** registra ocorrências.
- **Condition** representa estado temporário/declarativo.
- **Action** representa uma intenção disponível que gera Commands.
- **TriggerRule** reage a Events de forma controlada.
- **AutomationPolicy** limita autonomia.
- **Resolve Period** orquestra child plans entre subsistemas sem possuir seus estados.

Pipeline:

```text
Clock / TimeProvider
        |
        v
Scheduler / Resolve Period
        |
        v
Scheduled Operations
        |
        v
Commands -> Plans -> Primary GM Authority
        |
        v
MutationCoordinator
        |
        v
Owning Services
        |
        v
Receipts / Events / Conditions / Follow-ups
```

Leis principais:

1. Time não é source-of-truth dos outros subsistemas.
2. Scheduler decide quando tentar; owning service decide o que pode acontecer.
3. Resolver nunca muta.
4. Event não implica mutation.
5. Trigger nunca bypassa Command/Plan/Authority.
6. Safe-auto exige opt-in.
7. Conditions não alteram permanentemente valores-base.
8. Actions são fachada declarativa sobre Commands.
9. Catch-up, retries e large jumps são determinísticos e idempotentes.
10. Rollback temporal não reescreve história silenciosamente.
11. Resolve Period é orquestração, não novo domínio de dados.
12. Calendar formatting não contamina timestamps canônicos.
13. Client não recebe eventos/operações secretas sem autorização.
14. Performance nunca justifica bypass de authority/audit/visibility.

---

# 1. DEC-5001–5150 — Fundação temporal

- TimeProvider abstrato e opcional.
- Adapter padrão para Foundry world time.
- Inteiros/unidade canônica para tempo persistido.
- Real timestamp e world time separados.
- CalendarAdapter desacoplado do core.
- AdvanceTimeCommand / AdvanceTimePlan.
- Preview para grandes saltos.
- Scheduler central compartilhado.
- ScheduledOperation persistente, versionada e idempotente.
- TimeEvent separado de ScheduledOperation.
- Condition genérica/extensível.
- ActionDefinition como fachada para Commands.
- Recurrence/expiry integradas ao Scheduler.
- Large jumps usam aggregation quando semanticamente segura.

---

# 2. DEC-5151–5300 — Scheduler avançado e recovery

- Dependencies hard/soft.
- Ordenação determinística.
- Locks compartilhados.
- Retry policy estruturada.
- Catch-up de operações perdidas/offline.
- Batch IDs e checkpoints.
- atomic / stopOnBlocker / bestEffort.
- Partial failure explícito.
- Compensation apenas quando declarada/segura.
- Rollback de clock separado de rollback de estado.
- External clock changes geram reconciliation.
- RNG via RandomProvider.
- Technical retry não rerolla por default.
- Diagnostics para cycles, orphan operations, retries e divergence.

---

# 3. DEC-5301–5450 — Conditions e Actions

- ConditionDefinition -> ConditionInstance.
- Lifecycle leve.
- Duration/start/end.
- Stacking policies.
- Mutual exclusion.
- Severity/magnitude/modifiers.
- Immunity/resistance/susceptibility por capabilities/policies.
- ConditionApplicationPlan.
- Derived/propagated Conditions com loop protection.
- ActionDefinition registrável.
- Availability derivada.
- Contextual actions.
- Target rules.
- Costs/cooldowns.
- Bulk actions.
- Conditions/Actions permanecem leves, não viram rules engine universal.

---

# 4. DEC-5451–5600 — Events e automation

- Taxonomy extensível de Events.
- correlationId / causationId.
- EventSubscription.
- TriggerRule.
- AutomationPolicy: manual / advisory / review / safeAuto.
- Delayed reactions viram ScheduledOperations.
- Cascades preservam lineage.
- Depth/event-count/descendant limits.
- Loop detector.
- Rate limits, debounce e coalescing sem destruir audit.
- External hooks read-only; mutations usam Commands.
- Activity Feed referencia Events/Receipts.
- Safe defaults conservadores.

---

# 5. DEC-5601–5750 — Integração temporal e Resolve Period

ResolvePeriodPlan agrega child plans de:

- Economy;
- Projects;
- Facilities;
- Downtime;
- People allocations;
- Agreements;
- Relations/Reputation;
- Territory/Rights;
- Missions;
- Knowledge/Secrets;
- Reservations.

Ordering cross-system:

1. expirations / releases;
2. costs / maintenance;
3. progress;
4. completions;
5. outcomes / follow-ups.

Revalidation ocorre entre fases quando necessário.

Cada subsystem continua dono de seus dados e produz seu próprio receipt.

---

# 6. DEC-5751–5900 — Finalização da Rodada 10

## Calendar adapters

- Calendários são adapters/plugins de apresentação/conversão.
- Timestamps canônicos não mudam ao trocar calendário.
- Custom calendars podem definir eras, meses, semanas e labels sem alterar semântica temporal.
- CalendarAdapter ausente degrada apenas a apresentação amigável.

## Time controls

- GM possui controles seguros de avanço.
- Presets de avanço são configuráveis.
- Quick advance e advanced preview usam a mesma engine.
- Grandes avanços podem exigir preview obrigatório.
- External clock changes continuam sujeitos a reconciliation.

## Unified Timeline

- Timeline combina Events, ScheduledOperations, deadlines e advisories via read models.
- Audience-aware.
- Future/past/current buckets.
- Filtros por Domain/subsystem/kind/severity.
- Timeline não é source-of-truth.
- Large timelines usam paginação/lazy loading.

## Templates/policies temporais

- Recurrence, maintenance, expiry e automation policies podem ter presets/templates.
- Template não é runtime operation.
- Alterar template não altera instâncias já existentes.
- Policies/imports permanecem versionados.

## Archive/retention

- Completed operations/events podem ser arquivados visualmente.
- Archive preserva IDs, receipts, lineage, causation e rebuildability.
- Hard delete é excepcional.
- Compaction nunca altera significado histórico.

## Import/export/migrations

- Time/Scheduler/Condition/Action definitions e policies são exportáveis.
- Runtime state pode ser incluído em backup completo.
- Import valida handler/provider/target refs.
- Broken refs podem ser quarantined.
- Migrations são incrementais e idempotentes.
- Nunca reinterpretam datas antigas silenciosamente ao trocar calendário/provider.

## Performance/stress

Benchmarks obrigatórios:

- pequena base;
- domínio médio;
- império/múltiplos sistemas;
- milhares de ScheduledOperations;
- milhares de Events;
- grandes saltos de tempo;
- server offline + catch-up;
- recurrent operations;
- cascades/automation safety.

Requisitos:

- indexes incrementais;
- selective invalidation;
- lazy timeline;
- bounded event chains;
- aggregation segura;
- zero microtick loops desnecessários;
- rebuild/recovery testáveis.

## Graceful degradation

- Sem CalendarAdapter: tempo canônico ainda funciona.
- Sem Scheduler avançado: ações podem ser processadas manualmente.
- Sem TimeProvider: operações temporais passam a manual mode quando possível.
- Missing handler/provider gera blocked/unavailable + diagnostic.
- Falha de addon não derruba core.

## Acceptance criteria

Devem passar:

- advance time;
- preview;
- scheduler/retry/catch-up;
- checkpoints;
- crash/reload;
- partial failure/recovery;
- recurring operations;
- condition stacking/expiry;
- action availability/cooldown;
- trigger/automation safety;
- loop protection;
- external clock reconciliation;
- Resolve Period multi-system;
- visibility/secret sanitization;
- performance em pequena e grande escala.

---

# 7. Leis finais da Rodada 10

1. Time fornece contexto, não ownership.
2. Calendar é apresentação/conversão, não source-of-truth.
3. Scheduler agenda tentativas, não business decisions.
4. ScheduledOperation não contém função JS arbitrária persistida.
5. Event registra ocorrência; não implica mutation.
6. Subscription observa; não muta.
7. Trigger propõe resposta; não bypassa authority.
8. SafeAuto é opt-in.
9. Automation pode ser pausada globalmente.
10. Delayed reaction usa Scheduler persistente.
11. Cascades possuem lineage.
12. Event chains possuem limites.
13. Loop protection falha fechado para novas auto-mutations.
14. Rate limiting não apaga audit trail.
15. Resolver nunca muta.
16. Retry técnico não duplica effects.
17. Retry com revision conflict exige replan.
18. Checkpoints impedem replay de children já committed.
19. Partial failure é explícito.
20. Compensation não apaga o receipt original.
21. Rollback de clock não desfaz state automaticamente.
22. Rollback nunca reescreve história silenciosamente.
23. External clock changes exigem reconciliation.
24. Large jumps evitam microticks quando aggregation é segura.
25. RNG passa por RandomProvider.
26. Condition é temporária/declarativa.
27. Condition não altera valor-base permanentemente.
28. Stacking é policy-driven.
29. Action availability é derivada.
30. Action gera Command.
31. Target eligibility é revalidada no commit.
32. Cooldown é temporal state estruturado.
33. Bulk actions usam Plans.
34. Resolve Period é orquestração.
35. Owning services continuam donos dos dados.
36. Economy continua dona do ledger.
37. Project continua dono do progresso.
38. Facility continua dona de maintenance state.
39. Agreement continua dono das obligations.
40. Mission continua dona de deadlines/lifecycle.
41. Knowledge continua dono de knowledge state.
42. Territory continua dono de claims/rights.
43. UI Timeline não é source-of-truth.
44. Archive não apaga lineage.
45. Performance nunca bypassa authority, visibility ou audit.

---

# 8. Snapshot de continuidade

**Rodada:** 10  
**Tema:** Time / Ticks / Events / Conditions / Actions  
**Faixa:** DEC-5001–DEC-5900  
**Total:** 900 decisões  
**Status:** APROVADO / CONGELADO

Partes:

```text
Parte 1 — DEC-5001–5150
Fundação temporal / Scheduler / ScheduledOperation

Parte 2 — DEC-5151–5300
Scheduler avançado / catch-up / retry / recovery

Parte 3 — DEC-5301–5450
Conditions / Actions / cooldowns

Parte 4 — DEC-5451–5600
Events / triggers / automation

Parte 5 — DEC-5601–5750
Cross-system temporal integration / Resolve Period

Parte 6 — DEC-5751–5900
Calendar adapters / Timeline / retention / migrations /
performance / acceptance
```

Próxima decisão:

```text
DEC-5901
```

---

# 9. Status final

```text
RODADA 10
DEC-5001–5900
900 DECISÕES
APROVADO
CONGELADO
READY FOR RODADA 11
```
````

---

# ANEXO 11 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_11_UI_UX_EXPLORER_OPERATIONS_5901-6800.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 11
## UI / UX / Explorer / Operations — DEC-5901–6800

> **Status:** APROVADO / CONGELADO PARA CONTINUIDADE.
>
> O usuário aprovou em bloco todas as opções marcadas como **RECOMENDADO** nas decisões DEC-5901–DEC-6800.
>
> Este documento consolida a arquitetura oficial de UI/UX da Rodada 11. A pesquisa prévia
> `DOMAIN_MANAGER_UI_UX_REFERENCE_CATALOG_PRE_RODADA_11.md` serviu como referência,
> mas somente as decisões desta rodada são normativas.

---

# 0. Regra central

A UI do Domain Manager é um **design system próprio, leve e orientado a operações**.

Arquitetura:

```text
FOUNDATIONS
  ↓
TOKENS
  ↓
PRIMITIVES
  ↓
COMPOUND PATTERNS
  ↓
DOMAIN PATTERNS
  ↓
SCREENS / WORKSPACES
```

UX central:

```text
SUMMARY
  ↓
EXPLANATION
  ↓
DETAIL
  ↓
ACTION
```

Princípios:

- identidade militar-tech sem sacrificar legibilidade;
- CSS nativo e baixo custo visual;
- mesma engine para base pequena e império;
- progressive disclosure;
- preserve context;
- audience-aware;
- UI nunca vira source-of-truth;
- mutations continuam Command → Plan → Authority → Receipt;
- interfaces pesadas são opcionais/lazy;
- accessibility e performance são requisitos de base.

---

# 1. DEC-5901–6050 — Foundations / Tokens / App Shell

Decisões centrais:

- design system próprio;
- nenhuma cópia integral de Open Props/ReUI/etc.;
- primitive → semantic → component tokens;
- namespace `--dm-*`;
- dark-first;
- semantic colors;
- typography compartilhada;
- spacing scale;
- density `compact/default/comfortable`;
- surfaces canvas/workspace/panel/raised/overlay;
- sombras controladas;
- corner cuts e scanner/glitch somente como acento;
- motion vocabulary: feedback/continuity/attention/progress;
- reduced motion obrigatório;
- loading/empty/no-results/error/permission/conflict/partial são estados de primeira classe;
- global shell pequeno;
- global navigation separada de Domain navigation;
- responsividade considera a janela Foundry;
- CSS native-first;
- lazy rendering para views caras;
- component contracts documentados;
- overflow/clipping/alinhamento inconsistente contam como bugs reais.

---

# 2. DEC-6051–6200 — Domain Explorer / Navigation / Inspectors

- Domain Explorer é a superfície contextual principal.
- Não duplica hierarchy truth.
- Physical e administrative hierarchy são distintas.
- Lazy tree por branch.
- Global nav ≠ Domain-local nav.
- Breadcrumbs representam ancestry atual.
- `DMPageHeader` comum.
- `DMTree` comum e keyboard-accessible.
- Tabs servem sibling views, não navegação global.
- Split View oficial.
- `DMInspector` / `DMInspectorDrawer` oficial.
- Contextual actions vêm do Action Registry quando possível.
- Abertura de detalhe deve preservar filtros, scroll e seleção.
- Recently visited e pinned Domains são preferências pessoais.
- Players recebem apenas estrutura sanitizada.
- Preserve Context vira princípio formal.

---

# 3. DEC-6201–6350 — Collections / DataGrid / Search / Bulk

- `DMCollection` como contract conceitual.
- Data source separado da view.
- Table/List/Cards/Tree/Board/Gantt escolhidos por tarefa.
- `DMDataGrid` oficial.
- Column definitions declarativas.
- Search local distinto de search global.
- filtros simples visíveis, avançados em surface própria.
- sorting determinístico.
- grouping opcional.
- Saved Views pessoais.
- single selection ≠ bulk selection.
- `BulkActionBar`.
- target set explícito para bulk plans.
- paginação como estratégia simples para escala;
- virtualization apenas quando necessária;
- compact density para grandes datasets;
- cards para poucos itens/overview;
- empty ≠ no-results;
- inline editing apenas para fields simples/seguros;
- export respeita projection;
- contracts incluem keyboard/accessibility.

---

# 4. DEC-6351–6500 — Operations / Overview / Action Queue

- Operations Workspace global.
- É read model, não source-of-truth.
- Prioriza “o que exige atenção agora”.
- Pode operar globalmente, por Domain ou conjunto de Domains.
- Domain Overview responde:
  1. estado atual;
  2. o que mudou;
  3. o que exige ação;
  4. o que vem a seguir.
- Metric cards limitados e acionáveis.
- `Needs Attention` formal.
- `Action Queue` distinta de Activity Feed.
- approvals/reviews/blockers/recovery entram na queue.
- Alert/Warning/Blocker/Advisory são distintos.
- Toast = feedback transitório.
- Activity Feed = histórico legível, não audit log completo.
- Upcoming resume deadlines/events relevantes.
- Drill-down leva ao subsystem proprietário com filtro/contexto.
- personalização de widgets é pessoal.
- layouts “Small Base” e “Empire” são presets, não engines diferentes.
- aggregated read models evitam scans globais.

---

# 5. DEC-6501–6650 — Forms / Wizards / Preview / Destructive Safety

- Form coleta intenção; não grava source-of-truth.
- Quick Create para tarefas simples.
- Advanced Create para complexidade real.
- Wizard apenas quando há sequência/dependência.
- Client validation para feedback; authority revalida.
- errors/warnings/advisories distintos.
- dirty state.
- drafts locais/persistentes quando adequado.
- autosave apenas para casos seguros.
- `DMChangePreview` baseado no Plan.
- before/after e impact summary.
- Dialog/Drawer/Page escolhidos por complexidade/context preservation.
- nested overlays evitados.
- destructive safety por tiers.
- type-to-confirm para irreversíveis.
- confirmation fatigue evitada.
- processing state + idempotency.
- revision conflict possui UX própria.
- partial success explica child results.
- Quick e Advanced Create terminam no mesmo backend autoritativo.

---

# 6. DEC-6651–6800 — Advanced Views / Search / Accessibility / Performance / Acceptance

## 6.1 Timeline

- `DMTimeline` como pattern comum.
- passado/presente/futuro claros.
- aggregation por período quando necessário.
- Activity Feed e Timeline continuam distintos.
- Timeline usa read models e visibility sanitizada.
- compact mode para alta densidade.
- grandes ranges são paginados/lazy.

## 6.2 Schedule / Calendar

- Schedule é view operacional de compromissos/operações.
- Calendar não é source-of-truth temporal.
- day/week/list podem existir.
- drag/reschedule somente quando Command/Plan suportarem.
- operações secretas nunca aparecem por inferência.
- Schedule pode abrir inspector/context action.

## 6.3 Gantt

- Gantt é view avançada e opcional.
- lazy-loaded.
- nunca é requisito para operar Projects.
- table/list continuam fallback.
- drag/resize gera Command/Plan.
- dependencies são read from source data, não criadas visualmente sem mutation oficial.
- large datasets exigem windowing/level-of-detail.

## 6.4 Kanban

- Kanban é alternativa para lifecycle/stage.
- não substitui DataGrid em escala.
- drag between columns gera Command/Plan.
- invalid move é bloqueado/explicado.
- filters/query são compartilhados com a collection.

## 6.5 Graph / Flow

- graph é opcional.
- usado para Relations, Knowledge, dependencies etc.
- depth/node caps.
- no mandatory heavy graph library.
- fallback list/tree/table obrigatório.
- secret nodes/edges filtrados authority-side.
- graph nunca é source-of-truth.

## 6.6 Global Search

- Search global indexa apenas dados permitidos.
- resultados agrupáveis por entity kind.
- fuzzy/prefix/exact policies configuráveis.
- recent items e context hints.
- keyboard-first.
- navigation preserva Domain/section/entity context.
- search snippets não podem vazar secrets.

## 6.7 Command Palette

- Ctrl/Cmd+K como power tool.
- busca pages/entities/actions.
- actions respeitam Action Registry e availability.
- destructive actions nunca executam instantaneamente apenas pela palette.
- recent/frequent ranking é local/preference.
- palette não substitui navegação principal.

## 6.8 Keyboard shortcuts

- contracts compartilhados.
- shortcuts discoverable.
- conflicts detectáveis.
- remapping pessoal opcional.
- destructive shortcut não bypassa confirmation.
- focus contexts impedem trigger em inputs quando inadequado.

## 6.9 Personalization

- density;
- hidden/reordered widgets;
- saved views;
- recent/pinned;
- preferred view;
- widths;
- shortcuts.

Tudo pessoal por default; nunca source-of-truth do Domain.

## 6.10 Responsive/adaptive final

- breakpoint por Application size.
- wide: multi-pane.
- medium: fewer simultaneous panes.
- narrow: drawer/sheet/full-page fallback.
- data remains accessible even if columns collapse.
- no essential hover-only interaction.

## 6.11 Accessibility final

- keyboard path completo;
- focus management;
- ARIA/semantic HTML;
- labels;
- contrast;
- reduced motion;
- zoom/text scaling;
- no color-only meaning;
- status announcements;
- modals/menus/tree/grid behaviors documentados.

## 6.12 Performance budgets

- CSS-first.
- no mandatory React/Tailwind/ReUI stack.
- large collections paginated/virtualized.
- Gantt/graph/charts lazy.
- no full history render.
- DOM budgets per workspace.
- avoid expensive blur/filter/shadow over hundreds of rows.
- animation budgets.
- benchmark base pequena, domínio médio e império.

## 6.13 Diagnostics

- overflow;
- clipped dialogs;
- broken actions;
- missing labels;
- missing providers;
- duplicate keys;
- invalid deep links;
- inaccessible shortcuts;
- secret leakage through counts/search/sort;
- render-cost warnings;
- broken hierarchy refs.

## 6.14 Visual regression

- screenshot baselines for key surfaces.
- multiple densities.
- multiple widths.
- empty/loading/error/no-results.
- GM/player projections.
- long names.
- high counts.
- reduced motion.
- regression review becomes acceptance gate.

## 6.15 Acceptance

A Rodada 11 só é considerada implementada quando:

- base com 12 NPCs é operável rapidamente;
- império grande usa a mesma engine;
- user never loses context unnecessarily;
- collections scale;
- Operations surfaces meaningful attention;
- forms preserve inputs on error;
- destructive workflows are proportional;
- advanced visualizations have fallbacks;
- keyboard/accessibility paths work;
- no secret leakage occurs through UI metadata;
- UI remains responsive on weak hardware;
- no unexplained overflow/misalignment;
- all major mutations expose Plan/Receipt behavior consistently.

---

# 7. Leis finais da Rodada 11

1. UI não é source-of-truth.
2. Dashboard não é source-of-truth.
3. Explorer não é hierarchy truth.
4. Timeline não é temporal truth.
5. Graph não é relationship truth.
6. Forms não mutam diretamente.
7. Contextual actions não bypassam Commands.
8. Quick Create e Advanced Create usam a mesma authority path.
9. Design tokens governam aparência.
10. Screens não inventam foundations locais.
11. Progressive disclosure é obrigatório.
12. Preserve Context é princípio formal.
13. Global nav e Domain nav são distintas.
14. Search global e local são distintos.
15. Tables são default para comparação em escala.
16. Cards não são default para milhares de registros.
17. Kanban é alternativa de workflow.
18. Gantt é view avançada.
19. Graph é view opcional.
20. Advanced views possuem fallback leve.
21. Empty e No Results são estados diferentes.
22. Permission denied e missing capability são diferentes.
23. Error não apaga input do usuário.
24. Revision conflict recebe UX própria.
25. Preview vem do Plan.
26. Diff não revela secrets.
27. Bulk targets são explícitos.
28. destructive friction é proporcional ao impacto.
29. type-to-confirm é reservado para casos extremos.
30. Toast não substitui estado persistente.
31. Action Queue ≠ Activity Feed.
32. Activity Feed ≠ audit log técnico.
33. Needs Attention mostra sinal acionável, não ruído.
34. Metrics servem decisão.
35. Drill-down leva ao source real.
36. Personalização é pessoal por default.
37. Density não muda semantics.
38. Responsive layout não muda domain rules.
39. Client nunca recebe secret data para “esconder em CSS”.
40. Keyboard behavior faz parte do contract.
41. Reduced motion é obrigatório.
42. No essential action depends on hover.
43. Performance faz parte do design.
44. Weak hardware é target válido.
45. Consistência, acessibilidade, contexto e performance prevalecem sobre ornamentação.

---

# 8. Snapshot de continuidade

**Rodada:** 11  
**Tema:** UI / UX / Explorer / Operations  
**Faixa:** DEC-5901–DEC-6800  
**Total:** 900 decisões  
**Status:** APROVADO / CONGELADO

Partes:

```text
Parte 1 — DEC-5901–6050
Foundations / Tokens / Density / Motion / App Shell

Parte 2 — DEC-6051–6200
Domain Explorer / Navigation / Inspector / Split Views

Parte 3 — DEC-6201–6350
Collections / DataGrid / Search / Filters / Bulk

Parte 4 — DEC-6351–6500
Operations / Overview / Needs Attention / Activity

Parte 5 — DEC-6501–6650
Forms / Quick Create / Wizards / Preview / Safety

Parte 6 — DEC-6651–6800
Advanced Views / Global Search / Accessibility /
Performance / Diagnostics / Acceptance
```

Próxima decisão:

```text
DEC-6801
```

Próxima rodada:

```text
RODADA 12
Storage / Migrations / Tests / Performance / Release Plan
```

---

# 9. Status final

```text
RODADA 11
DEC-5901–6800
900 DECISÕES
APROVADO
CONGELADO
READY FOR RODADA 12
```
````

---

# ANEXO 12 — `DOMAIN_MANAGER_DECISION_REGISTER_RODADA_12_STORAGE_MIGRATIONS_TESTS_PERFORMANCE_RELEASE_6801-7700.md`

> **Arquivo histórico original preservado integralmente.** Em conflito, aplicar a precedência definida no início deste Master.

````markdown
# DOMAIN MANAGER — DECISION REGISTER OFICIAL — RODADA 12
## Storage / Migrations / Tests / Performance / Release Plan — DEC-6801–7700

> **Status:** APROVADO / CONGELADO PARA CONTINUIDADE.
>
> O usuário aprovou em bloco todas as opções marcadas como **RECOMENDADO** nas decisões DEC-6801–DEC-7700.
>
> Este documento consolida a arquitetura oficial da Rodada 12, encerrando a fase arquitetural principal do Domain Manager.

---

# 0. Regra central

A Rodada 12 define como o Domain Manager preserva dados, evolui schemas, testa invariants, mede performance, empacota releases e transforma toda a arquitetura anterior em builds reais.

Princípios:

- JournalEntry/flags permanecem canonical storage.
- Repositories isolam acesso a persistência.
- Índices/caches/read models são derivados e reconstruíveis.
- Migrations são incrementais, idempotentes, planejáveis e recuperáveis.
- Quarantine existe para dados ambíguos/corruptos.
- Testes protegem invariants e contracts.
- Multiplayer/concurrency/fault injection são first-class.
- Performance é medida, não presumida.
- Release artifact deve ser reproduzível e testado.
- Implementation gates substituem desenvolvimento “tudo ao mesmo tempo”.
- Stable só existe após readiness objetiva.

---

# 1. DEC-6801–6950 — Storage foundation

- JournalEntry + flags como storage oficial.
- Repository abstraction.
- Services não acessam flags diretamente.
- expectedRevision em writes relevantes.
- DTO/schema validation.
- embedded data somente quando lifecycle pertence ao parent.
- logical IDs estáveis.
- in-memory indexes rebuildable.
- selective caches.
- audience-aware caches.
- schemaVersion global e por entidade quando necessário.
- canonical serialization.
- backups/snapshots.
- StorageIntegrityChecker.
- safe mode.
- boot phases.
- cold/warm rebuild tests.

Regra:
> Canonical data pode reconstruir index/cache/read model; nunca o contrário.

---

# 2. DEC-6951–7100 — Migrations / compatibility / import-export

- MigrationManager central.
- incremental migrations.
- migration IDs estáveis.
- preconditions/postconditions.
- MigrationPlan.
- backup obrigatório para mudanças destrutivas.
- Quarantine.
- rollback/recovery explícitos.
- compatibility matrix.
- required/optional dependency distinction.
- import/export versionado.
- reference remapping.
- ID collision policy.
- provenance.
- compatibility readers temporários.
- deprecated fields não são escritos novamente.
- fixtures antigas reais.
- migration diagnostics.

Regra:
> Ambiguity nunca é resolvida por palpite.

---

# 3. DEC-7101–7250 — Test architecture

Camadas:

```text
UNIT
INTEGRATION
E2E
MANUAL EXPLORATORY
```

Coberturas críticas:

- Resolvers;
- Validators;
- Economy math;
- Project progress;
- Scheduler ordering;
- Projection/Secrets;
- Repository/Migration;
- Command→Plan→Commit→Receipt;
- Multiplayer;
- Primary GM Authority;
- concurrency;
- socket duplication/out-of-order;
- fault injection;
- property-based/fuzz;
- deterministic RNG;
- fixtures small/medium/empire/legacy/corrupt;
- performance benchmarks.

Coverage percentual não é gate único; invariants críticos possuem gates próprios.

---

# 4. DEC-7251–7400 — Performance architecture

- performance budgets por categoria.
- profiling antes de optimization.
- instrumentation local.
- memory budgets.
- DOM/render budgets.
- query/index budgets.
- compact socket payloads.
- batching/chunking/checkpoints.
- lazy loading.
- optional workers para cálculo derivado pesado.
- diagnostics locais.
- no external telemetry by default.
- long-session memory tests.
- weak hardware acceptance target.

Regra:
> Medir → identificar gargalo → alterar → benchmark → verificar correctness → manter/reverter.

---

# 5. DEC-7401–7550 — Release engineering

Canais:

```text
dev → alpha → beta → rc → stable
```

- semantic versioning.
- schemaVersion ≠ moduleVersion.
- reproducible builds.
- package validation.
- CI gates.
- manifest compatibility.
- changelog.
- migration notes.
- backup warnings.
- alpha/beta/RC expectations.
- rollback/recovery planning.
- diagnostic report.
- supportability.
- ZIP final é o artefato realmente testado.
- installation/upgrade smoke tests.

Stable exige:
- sem blocker de data loss;
- migration crítica testada;
- compatibility suportada realmente testada;
- recovery path;
- diagnostics;
- release notes;
- package verificado.

---

# 6. DEC-7551–7700 — Implementation Gates / Definition of Done / Rollout

## Implementation strategy

O desenvolvimento passa a ser incremental por gates.

Nenhum gate seguinte deve esconder regressões do gate anterior.

Cada gate deve possuir:

- objetivo;
- scope;
- dependencies;
- acceptance tests;
- migration impact;
- performance check;
- diagnostics;
- rollback/recovery note;
- Definition of Done.

## Proposed implementation gates

### G0 — Skeleton / Infrastructure

- module boot;
- version metadata;
- logging;
- diagnostics shell;
- repository interfaces;
- registry infrastructure;
- test harness;
- CI/build/package basics.

### G1 — Canonical Storage / Domain

- Domain schema;
- repositories;
- IDs/revisions;
- indexes;
- hierarchy refs;
- integrity checks;
- minimal Domain CRUD through Commands/Plans.

### G2 — Authority / Commands / MutationCoordinator

- Primary GM Authority;
- socket transport;
- command IDs;
- expectedRevision;
- locks;
- plans;
- receipts;
- idempotency.

### G3 — People

- groups/notables;
- allocations;
- capability integration;
- projection;
- UI collection/inspector.

### G4 — Economy

- resources;
- ledger;
- reservations;
- precision;
- flows;
- Economy UI.

### G5 — Projects / Facilities / Downtime

- project lifecycle;
- work/carry/progress;
- facilities;
- maintenance;
- downtime;
- child plans.

### G6 — Relations / Territory / Agreements / Reputation

- relation records;
- reputation;
- agreements;
- claims/access/influence;
- capability integration.

### G7 — Requests / Missions / Knowledge / Secrets

- Request submission/GM decision;
- Mission lifecycle;
- Knowledge;
- Secrets;
- ProjectionService.

### G8 — Time / Scheduler / Conditions / Actions

- TimeProvider;
- Scheduler;
- ScheduledOperation;
- Conditions;
- Actions;
- Events;
- triggers;
- automation;
- Resolve Period.

### G9 — UI System / Explorer / Operations

- tokens;
- primitives;
- app shell;
- Domain Explorer;
- DataGrid;
- inspectors;
- Operations;
- forms/previews;
- global search;
- timeline/schedule;
- advanced views optional.

### G10 — Migration / Import-Export / Recovery

- migration manager;
- quarantine;
- snapshots;
- import/export;
- restore/rebuild.

### G11 — Hardening / Performance / Multiplayer

- race tests;
- fault injection;
- benchmarks;
- memory;
- socket traffic;
- accessibility;
- visual regression.

### G12 — Beta / RC / Stable

- package validation;
- migration rehearsal;
- clean install;
- upgrade path;
- release notes;
- known issues;
- stable acceptance.

## Definition of Done

Uma feature só está “Done” quando:

- contract/schema existe;
- happy path funciona;
- invalid path existe;
- authority está correta;
- projection/secret behavior está correta;
- receipts/audit estão corretos;
- tests apropriados existem;
- diagnostics existem;
- migration impact está resolvido;
- performance foi considerada;
- UI states relevantes existem;
- docs foram atualizadas.

## Feature flags

- features incompletas podem ficar atrás de dev/experimental flags;
- flags não devem criar dois canonical schemas;
- experimental feature não pode alterar invariants do stable core;
- flags possuem lifecycle e remoção planejada.

## Rollout

- primeiro infraestrutura;
- depois vertical slices;
- depois integração cross-system;
- depois UI completa;
- depois hardening;
- somente então stable.

---

# 7. Leis finais da Rodada 12

1. Canonical storage é simples e recuperável.
2. UI não acessa storage diretamente.
3. Resolver não acessa storage para mutar.
4. Repositories não escondem business workflows.
5. Indices são rebuildable.
6. Caches são discardable.
7. Cache GM nunca é reutilizado para player.
8. schemaVersion é explícito.
9. Migration é incremental.
10. Migration é idempotente.
11. Ambiguity não vira palpite.
12. Quarantine preserva evidência.
13. Backup crítico é validado antes de migration destrutiva.
14. Import/export é versionado.
15. Reference remapping é explícito.
16. Tests protegem invariants.
17. Multiplayer é first-class.
18. Concurrency é testada.
19. Fault injection é obrigatória nos fluxos críticos.
20. Randomized tests guardam seed.
21. Benchmarks possuem contexto.
22. Performance não bypassa correctness.
23. Performance não bypassa authority.
24. Performance não bypassa audit.
25. Performance não bypassa accessibility.
26. Weak hardware é target válido.
27. Release artifact é reproduzível.
28. Stable não é “ZIP que parece funcionar”.
29. Stable exige migration rehearsal.
30. Stable exige support diagnostics.
31. Feature incompleta não entra no core estável sem isolamento.
32. Implementation gates possuem DoD objetivo.
33. Gate posterior não mascara regressão anterior.
34. Cada vertical slice termina utilizável/testável.
35. Feature flags não duplicam canonical truth.
36. Recovery path faz parte da feature crítica.
37. Documentation faz parte do Done.
38. Diagnostics fazem parte do Done.
39. Tests fazem parte do Done.
40. Architecture decisions permanecem rastreáveis.
41. O módulo cresce por contracts, não por patches ad hoc.
42. Release readiness é medida.
43. Data preservation prevalece sobre convenience.
44. System integrity prevalece sobre feature velocity.
45. A fase de implementação começa somente com arquitetura consolidada.

---

# 8. Snapshot de continuidade

**Rodada:** 12  
**Tema:** Storage / Migrations / Tests / Performance / Release Plan  
**Faixa:** DEC-6801–DEC-7700  
**Total:** 900 decisões  
**Status:** APROVADO / CONGELADO

Partes:

```text
Parte 1 — DEC-6801–6950
Storage / Repository / Index / Cache / Schema / Integrity

Parte 2 — DEC-6951–7100
Migrations / Compatibility / Import-Export / Quarantine

Parte 3 — DEC-7101–7250
Tests / Multiplayer / Concurrency / Fault Injection

Parte 4 — DEC-7251–7400
Performance / Profiling / Memory / DOM / Socket

Parte 5 — DEC-7401–7550
Release Engineering / CI / Packaging / Compatibility

Parte 6 — DEC-7551–7700
Implementation Gates / DoD / Rollout / Final Architecture
```

Próximo estágio:

```text
MASTER SPECIFICATION
+
IMPLEMENTATION GATES
+
BUILD EXECUTION
```

---

# 9. Status final

```text
RODADA 12
DEC-6801–7700
900 DECISÕES
APROVADO
CONGELADO

ARQUITETURA PRINCIPAL
RODADAS 01–12
CONCLUÍDA

NEXT:
MASTER SPECIFICATION
→ IMPLEMENTATION PLAN
→ BUILD GATES
```
````
