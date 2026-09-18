# DOMAIN MANAGER — RELATÓRIO DE REMEDIAÇÃO DA 5ª REVALIDAÇÃO (GATE G4)

**Projeto:** Domain Manager  
**Subsystem:** Economy & Resources (`domain-manager:economy`)  
**Gate:** G4 — Economy & Resources  
**Normative Authorities:** Master Specification (§14, §11–12, §42, DEC-1416 a DEC-2305), `14_G4_ECONOMY_RESOURCES.md`, G4 5ª Revalidação de Código.  
**Data:** 18/09/2026  
**Status Atual:** **GATE_G4_PENDING_USER_ACCEPTANCE** (Aguardando homologação e aceitação soberana do usuário)  
**Suíte de Testes:** 434/434 passing (0 falhas, 0 regressões contra baseline de 428 da 4ª revalidação e 335 de G3)  
**TypeScript Conformance:** Strict, 0 erros via `tsc --noEmit`  
**Validação de Pacote e Artefatos:** PASS (`dist/domain-manager-v0.0.3.zip`, scripts de validação aprovados)  

---

## 1. Matriz de Fechamento da 5ª Revalidação

| Item | Gravidade | Descrição / Resíduo Auditado | Status | Implementação & Verificação |
|---|---|---|:---:|---|
| **G4-REVAL5-001** | ALTO / RECUPERAÇÃO | Durabilidade do histórico de operações em `ManualCurrencyProvider` após reinicialização; interpretação explícita de `mutRes.value.outcome` (`unknown` -> `needs-recovery`, `failed-before-write` -> `failed`); fail-closed em débito quando `readBalance()` falhar. | **FECHADO** | `#operations` incluído em `ManualCurrencySnapshot` e reidratado em `rehydrate()`; `EconomyService.commitAdjust` trata explicitamente `outcome: "unknown"` (transiciona para `needs-recovery` e retorna `DM_ECON_PROVIDER_TIMEOUT`) e `outcome: "failed-before-write"` (termina em `failed` e retorna `DM_ECON_PROVIDER_MUTATION_FAILED`); `commitAdjust` em débito falha imediatamente com `DM_ECON_PROVIDER_UNAVAILABLE` caso `readBalance()` retorne erro. `tests/economy/providers.test.ts`. |
| **G4-REVAL5-002** | ALTO / SEGURANÇA | Isolamento estrito de ledger multi-domínio por chave qualificada por domínio (`domainUuid:resourceId`), impedindo vazamento de `totalCount`, `hasMore` ou entradas entre domínios que compartilham o mesmo ID de recurso. | **FECHADO** | `LedgerStore.queryPaged` suporta `allowedDomainResourceKeys`; filtragem antes do cômputo de `totalCount`, `hasMore`, `hasPrev` e cursores; `PublicEconomyApi.queryLedger` qualifica chaves permitidas por domínio visível (`${domainUuid}:${resourceId}`). `tests/economy/ledger-pagination.test.ts`. |
| **G4-REVAL5-003** | ALTO / SEGURANÇA | Projeção de transações na API Pública e UI com sanitização de recursos secretos, ocultação de lock keys de outros domínios não autorizados e mascaramento de detalhes internos de falha (`failureReason`). | **FECHADO** | `#projectTransaction` em `PublicEconomyApi` e `buildEconomyViewModel` em `EconomyPresenter`: transações de recursos secretos são omitidas em `listTransactions` e rejeitadas com `DM_SECURITY_PERMISSION_DENIED` em `getTransaction` para não-GMs; transferências cross-domain expõem apenas as `lockKeys` do domínio autorizado; `failureReason` é mascarado para `"Transaction failed"` para não-GMs. `tests/economy/public-api-isolation.test.ts`. |
| **G4-REVAL5-004** | MÉDIO / ALTO | Rollback de estado em memória diante de falhas de storage em `ThresholdService`, `CustomResourceDefinitionStore` e comando `economy:register-custom-resource`. | **FECHADO** | `ThresholdService.rollbackThreshold(id, previous)` chamado em caso de falha de flush no comando `economy:set-threshold`; `CustomResourceDefinitionStore.save()` restaura o estado anterior se persistência falhar; `economy:register-custom-resource` salva no store primeiro com try/catch e apenas registra em `ResourceDefinitionRegistry` após persistência bem-sucedida. `tests/economy/thresholds-and-rollup.test.ts`. |

---

## 2. Detalhamento Técnico das Remediações

### 2.1. G4-REVAL5-001 — Provider Durability across Restart, Explicit Mutation Outcome & Fail-Closed Debit
- **Durabilidade de `#operations`**:
  - Em `src/economy/storage/manual-currency-storage-adapter.ts`, `ManualCurrencySnapshot` foi expandido com `operations?: Readonly<Record<string, { deltaMinor: number; timestamp: number }>>`.
  - Em `src/economy/providers/manual-currency-provider.ts`, `#schedulePersist()` serializa `#operations` no snapshot; e `rehydrate()` reidrata as operações salvas no mapa interno.
  - Isso garante que chamadas a `reconcile(operationRef)` após reinicialização do Foundry ou reload da página identifiquem operações efetuadas com sucesso retornando `{ outcome: "written" }`, evitando reversões compensatórias errôneas ou perda de estado.
- **Interpretação Explícita de `outcome`**:
  - Em `src/economy/services/economy-service.ts`:
    - Se `mutRes.value.outcome === "unknown"`: a transação é transicionada para `"needs-recovery"`, persistida via `flush()`, e a chamada retorna `DM_ECON_PROVIDER_TIMEOUT`.
    - Se `mutRes.value.outcome === "failed-before-write"`: a transação é transicionada para `"failed"` diretamente (sem necessidade de recuperação posterior), persistida via `flush()`, e a chamada retorna `DM_ECON_PROVIDER_MUTATION_FAILED`.
- **Fail-Closed em Débitos**:
  - Em `commitAdjust`, quando `deltaMinor < 0`, a consulta de saldo atual via `readBalance()` é obrigatória. Se `readBalance()` falhar (retornar `err`), o sistema não ignora a checagem de saldo: encerra imediatamente com `DM_ECON_PROVIDER_UNAVAILABLE`, sem invocar `mutateBalance`.

### 2.2. G4-REVAL5-002 — Isolamento de Ledger Multi-Domínio com Chaves Qualificadas
- **Resíduo Auditado**: Domínios diferentes podiam possuir contas com o mesmo `resourceId` (ex.: `domain-manager:treasury`). Uma filtragem por ID de recurso isolado (`allowedResourceIds`) permitia que uma consulta global ou por recurso vazasse contagens ou entradas de um Domínio B (onde a tesouraria é secreta) caso o jogador tivesse acesso à tesouraria do Domínio A.
- **Implementação**:
  - `LedgerFilter` em `src/economy/ledger/ledger-store.ts` foi expandido com `allowedDomainResourceKeys?: readonly string[] | ReadonlySet<string>`.
  - `queryPaged()` filtra os registros validando `${entry.domainUuid}:${entry.resourceId}` contra o conjunto permitido **antes** de calcular `totalCount`, `hasMore`, `hasPrev` e gerar cursores de navegação.
  - `PublicEconomyApi.queryLedger()` monta o conjunto de chaves qualificadas (`visibleDomainResourceKeys`) para todos os domínios acessíveis pelo usuário requisitante e repassa a `allowedDomainResourceKeys`.

### 2.3. G4-REVAL5-003 — Projeção Segura de Transações (Recursos Secretos, Locks Cross-Domain e Mascaramento de Erro)
- **Ocultação de Recursos Secretos**:
  - Em `PublicEconomyApi.#projectTransaction` e `buildEconomyViewModel` (`EconomyPresenter`), as transações são inspecionadas quanto aos recursos envolvidos (`resourceId`, `fromResourceId`, `toResourceId`). Se todos os recursos envolvidos forem secretos/invisíveis para o viewer não-GM, a transação é totalmente excluída de `listTransactions` e do view model.
  - Se um usuário não-GM tentar chamar diretamente `getTransaction(txId)` para uma transação de recurso secreto, a API rejeita com `DM_SECURITY_PERMISSION_DENIED`.
- **Sanitização de Lock Keys Cross-Domain**:
  - Em transferências entre Domínio A (onde o jogador tem acesso) e Domínio B (onde o jogador não tem acesso), as `lockKeys` retornadas na projeção (`toTransactionDto`) mantêm apenas as chaves referentes aos domínios acessíveis pelo requisitante. Chaves do domínio remoto e locks internos do sistema são omitidos.
- **Mascaramento de Erros Internos**:
  - `failureReason` detalhado (que pode conter detalhes de deadlock, erros de I/O de infraestrutura ou stacks internas) é substituído pelo genérico `"Transaction failed"` para não-GMs, sendo preservado na íntegra apenas para o GM.

### 2.4. G4-REVAL5-004 — Rollback de Estado em Memória em Falhas de Storage
- **`ThresholdService`**:
  - Adicionado método `rollbackThreshold(id: string, previous?: ThresholdDefinition): void` em `ThresholdService`.
  - No handler `economy:set-threshold` (`src/economy/commands/economy-commands.ts`), o limiar é registrado e o `flush()` assíncrono é executado. Se o storage falhar e o flush rejeitar, o handler captura a exceção, executa `rollbackThreshold(id, previous)` (restaurando a definição anterior em caso de atualização ou deletando em caso de novo registro) e retorna `DM_DOMAIN_STORAGE_ERROR`.
- **`CustomResourceDefinitionStore`**:
  - Em `CustomResourceDefinitionStore.save()`, antes de aplicar a mutação em `#definitions`, o estado prévio é armazenado. Se a persistência assíncrona falhar, o mapa em memória é revertido imediatamente para o estado anterior.
- **`economy:register-custom-resource`**:
  - O handler executa primeiro o `customResourceStore.save(def)`. Se a gravação no store falhar, a requisição é rejeitada com `DM_DOMAIN_STORAGE_ERROR` antes que o `ResourceDefinitionRegistry` global seja modificado. Adicionado também `ResourceDefinitionRegistry.unregister(id)` como garantia de limpeza caso necessário.

---

## 3. Verificação Automatizada e Evidências

```
✔ G4-REVAL5-001: ManualCurrencyProvider persists operations history across restart for restart-safe reconcile()
✔ G4-REVAL5-001: EconomyService handles mutateBalance outcome 'unknown' and 'failed-before-write' correctly
✔ G4-REVAL5-001: commitAdjust debit fails closed when readBalance fails
✔ G4-REVAL5-002: LedgerStore.queryPaged enforces domain-qualified allowedDomainResourceKeys preventing cross-domain leaks
✔ G4-REVAL5-003: PublicEconomyApi and EconomyPresenter sanitize transactions for non-GM viewers (secret resources, cross-domain locks, failure reasons)
✔ G4-REVAL5-004: In-memory state rolls back on storage failure for thresholds and custom resources

Total de testes passando: 434/434 (0 falhas, 0 regressões)
Tempo de execução da suíte: ~7.5s
Validação de pacote (dist/domain-manager-v0.0.3.zip): APROVADA
Validação de artefatos: APROVADA
```

---

## 4. Estado de Homologação

- **G0, G1, G2 e G3**: Homologados e aceitos soberanamente pelo usuário.
- **Gate G4**: Todos os 4 resíduos da 5ª revalidação foram integralmente implementados, testados e verificados. O estado do subsistema permanece canonicamente como **`GATE_G4_PENDING_USER_ACCEPTANCE`** aguardando validação e aceite soberano do usuário.
- **Próximo Gate Normativo**: **Gate G5 — Projects / Facilities / Downtime** (estritamente bloqueado até a aceitação do usuário).
