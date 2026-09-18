# DOMAIN MANAGER — RELATÓRIO DE REMEDIAÇÃO DA 4ª REVALIDAÇÃO (GATE G4)

**Projeto:** Domain Manager  
**Subsystem:** Economy & Resources (`domain-manager:economy`)  
**Gate:** G4 — Economy & Resources  
**Normative Authorities:** Master Specification (§14, §11–12, §42, DEC-1416 a DEC-2305), `14_G4_ECONOMY_RESOURCES.md`, G4 4ª Revalidação de Código.  
**Data:** 18/09/2026  
**Status Atual:** **GATE_G4_PENDING_USER_ACCEPTANCE** (Aguardando homologação e aceitação soberana do usuário)  
**Suíte de Testes:** 428/428 passing (0 falhas, 0 regressões contra baseline de 416 da 3ª revalidação e 335 de G3)  
**TypeScript Conformance:** Strict, 0 erros via `tsc --noEmit`  
**Validação de Pacote e Artefatos:** PASS (`dist/domain-manager-v0.0.3.zip`, scripts de validação aprovados)  

---

## 1. Matriz de Fechamento da 4ª Revalidação

| Item | Gravidade | Descrição / Resíduo Auditado | Status | Implementação & Verificação |
|---|---|---|:---:|---|
| **G4-REVAL4-001** | ALTO | Provider write outcome unknown/timeout, stale debit check (DEC-16806), pré-reconciliação antes de compensação, durabilidade de operações | **FECHADO** | `ProviderMutationOutcome` (`written`, `not-written`, `unknown`), detecção de timeout, compensador com pré-reconciliação (`reconcileOperation`), fail-closed para cache expirado (`DM_ECON_PROVIDER_STALE_CACHE`). `tests/economy/providers.test.ts` |
| **G4-REVAL4-002** | ALTO / SEGURANÇA | Eliminação de bypass mutável de limiares em `PublicEconomyApi`, e propagação de falha de storage em `ThresholdService.flush()` -> `DM_DOMAIN_STORAGE_ERROR` | **FECHADO** | Removidos `registerThreshold` e `thresholds` de `PublicEconomyApi`; adicionado `setThreshold` via `CommandBus`; `ThresholdService.flush()` propaga rejeição e `economy:set-threshold` retorna `DM_DOMAIN_STORAGE_ERROR`. `tests/economy/thresholds-and-rollup.test.ts` e `tests/economy/public-api-isolation.test.ts` |
| **G4-REVAL4-003** | ALTO | Paginação pública do ledger ciente de visibilidade (`totalCount`, `hasMore`, `hasPrev` e cursores não vazam recursos secretos para não-GMs) | **FECHADO** | `LedgerStore.queryPaged` aceita `allowedResourceIds` e pré-filtra antes do cálculo de paginação e cursores; `PublicEconomyApi.queryLedger` calcula IDs visíveis ao requisitante. `tests/economy/ledger-pagination.test.ts` |
| **G4-REVAL4-004** | MÉDIO / ALTO | Superfícies T4: Quick Resource Create, Histórico de Transações, Provider Health Status Shell, Agregação de contas derivadas incompletas | **FECHADO** | Quick Resource Create rejeita duplicatas com `DM_ECON_RESOURCE_ALREADY_EXISTS` e payload JSON-safe; `PublicEconomyApi.getTransaction`/`listTransactions` com checagem de permissão (nível >= 1); UI renderiza badges de status de provedores; contas derivadas inalcançáveis marcam `isComplete = false` e listam em `unknownContributors`. `tests/economy/economy-ui.test.ts` e suítes correlatas |

---

## 2. Detalhamento Técnico das Remediações

### 2.1. G4-REVAL4-001 — Provider Mutation Outcome, Pre-Compensation Reconciliation & Fail-Closed Stale Cache
- **Contrato de Provedor Expandido**: `src/economy/providers/provider-types.ts` agora define `ProviderMutationOutcome = "written" | "not-written" | "unknown"`, com `ProviderMutationResult` reportando `outcome`, `operationRef`, `mutatedBalanceMinor` e `lastMutatedAt`. Opcionalmente provedores expõem `reconcileOperation(operationRef)`.
- **Tratamento de Timeout e Incerteza**: Em `src/economy/services/economy-service.ts`, caso a mutação no provedor falhe com erro de rede ou timeout (`outcome === "unknown"`), a transação é transicionada imediatamente para `"needs-recovery"`, sem atualizar o ledger local com dados fictícios.
- **Pré-Reconciliação Cirúrgica antes da Compensação**: O compensador registrado para mutações de provedores invoca `provider.reconcileOperation(ref)`. Se o provedor atestar que a mutação `"not-written"`, o compensador finaliza a transação para `"failed"` sem emitir um débito/crédito reverso desnecessário; se o provedor atestar `"written"`, executa a reversão compensatória segura.
- **Checagem de Cache Desatualizado (DEC-16806)**: Na verificação pré-mutação, se o saldo em cache do provedor possuir idade superior ao TTL (`maxCacheAgeMs`), a operação falha em modo fechado com `DM_ECON_PROVIDER_STALE_CACHE`.
- **Durabilidade no ManualCurrencyProvider**: Implementado armazenamento durável das operações efetuadas no `ManualCurrencyProvider`, permitindo reconciliação exata mesmo após reinicialização.

### 2.2. G4-REVAL4-002 — Eliminação de Bypass de Limiares & Propagação de Erro de Storage
- **Fechamento do Bypass**: Em `src/economy/services/public-economy-api.ts`, foram removidos os métodos e propriedades de acesso direto mutável aos limiares (`registerThreshold`, `thresholds`). Para registrar ou atualizar limiares, a API pública fornece `setThreshold(domainUuid, threshold)`, que constrói e despacha o comando autenticado `economy:set-threshold` via `CommandBus`.
- **Propagação de Erros Assíncronos no Flush**: Em `src/economy/thresholds/threshold-service.ts`, o método `flush()` aguarda a fila interna `#persistQueue` e propaga qualquer erro ocorrido no `ThresholdStorageAdapter`.
- **Tratamento no Command Handler**: O handler `economy:set-threshold` em `src/economy/commands/economy-commands.ts` executa `await thresholdService.flush()` e, em caso de rejeição, captura a exceção e retorna estruturado `DM_DOMAIN_STORAGE_ERROR`.

### 2.3. G4-REVAL4-003 — Paginação do Ledger com Consciência de Visibilidade
- **Filtragem Prévia à Paginação**: Em `src/economy/ledger/ledger-store.ts`, `queryPaged(filter)` foi parametrizado com `allowedResourceIds?: readonly string[] | ReadonlySet<string>`.
- **Proteção contra Vazamento de Metadados**: A filtragem por recursos permitidos é executada **antes** do cômputo de `totalCount`, `hasMore`, `hasPrev` e da geração de cursores (`cursor`, `nextCursor`, `prevCursor`). Usuários sem permissão de visualização sobre recursos secretos ou restritos recebem metadados de paginação calculados exclusivamente com base nos recursos que têm direito de auditar.
- **Delegação na Fachada Pública**: Em `src/economy/services/public-economy-api.ts`, `queryLedger` avalia o viewer atual, consulta os recursos visíveis daquele domínio e passa o conjunto `allowedResourceIds` para o `LedgerStore`.

### 2.4. G4-REVAL4-004 — Superfícies T4 (Quick Create, Transações, Health Status Shell, Contas Derivadas)
- **Quick Resource Create**:
  - `economy:register-custom-resource` verifica se o ID já existe no `ResourceDefinitionRegistry` ou no `CustomResourceDefinitionStore`, rejeitando colisões com `DM_ECON_RESOURCE_ALREADY_EXISTS`.
  - Na camada de aplicação UI (`src/ui/domain-patterns/economy/economy-app.ts`), a função controladora `dispatchQuickResourceCreateAndAccount` sanitiza todos os campos contra valores `undefined`, assegurando payloads estritamente JSON-safe.
- **Histórico de Transações na API Pública**:
  - Implementados `getTransaction(transactionId)` e `listTransactions(domainUuid)` em `PublicEconomyApi`.
  - Controle de Acesso: Usuários não-GM necessitam ter ownership mínima de nível 1 (`LIMITED`) no documento de domínio associado; caso contrário, a consulta é terminada com `DM_SECURITY_PERMISSION_DENIED`.
  - Dados retornados são sanitizados na forma de `TransactionRecordDto`.
- **Provider Status Shell na UI**:
  - `EconomySubsystemViewModel` agora inclui `providerStatuses: readonly ProviderStatusViewModel[]`.
  - `buildEconomyViewModel` compõe o status real (`healthy`, `degraded`, `unavailable`, `incompatible`), classes de badge (`badge--healthy`, `badge--degraded`, etc.) e timestamp de checagem.
  - `renderProviderStatusSection` renderiza os badges de monitoramento diretamente no cabeçalho do subsistema econômico.
- **Agregação de Contas Derivadas Incompletas**:
  - Em `src/economy/aggregation/economy-aggregation-provider.ts`, contas no modo `"derived"` com domínios de origem inalcançáveis marcam `stats.isComplete = false`, incrementam `unknownContributorCount` e incluem o UUID do domínio em `unknownContributors`.

---

## 3. Matriz de Testes Automatizados

Execução global via `node tests/run-tests.mjs`:
```
ℹ tests 428
ℹ suites 0
ℹ pass 428
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

- **Baseline G3 (homologado)**: 335 testes passando
- **Gate G4 (3ª Revalidação)**: 416 testes passando
- **Gate G4 (4ª Revalidação - Final)**: 428 testes passando (+12 testes dedicados às remediações G4-REVAL4-001 a G4-REVAL4-004)
- **Regressões em G0–G3**: 0 regressões detectadas.

---

## 4. Governança e Transição de Gate

- **Estado Atual**: `GATE_G4_PENDING_USER_ACCEPTANCE`.
- **Aprovação de Gates Anteriores**: G0, G1, G2 e G3 permanecem formalmente homologados e inalterados.
- **Próximo Gate**: **Gate G5 — Projects / Facilities / Downtime**.
- **Regra Soberana**: Nenhuma alteração de código referente ao Gate G5 será iniciada até a homologação e aceitação explícita do usuário para o Gate G4.
