# DOMAIN MANAGER — BUILD STATE

## Identidade

- Module version: `0.0.3`
- Gate de código atual: `G4 — Economy & Resources (IMPLEMENTAÇÃO COMPLETA — PENDENTE ACEITAÇÃO DO USUÁRIO)`
- Estado local: `GATE_G4_PENDING_USER_ACCEPTANCE`
- Estado externo: `GATE_G4_PENDING_USER_ACCEPTANCE (Aguardando homologação e aceitação soberana do usuário)`
- Schema Domain: `1`
- Data de conclusão da implementação do Gate G4: `2026-09-18`

## Estado canônico

- **Gate G0**: Concluído e verificado.
- **Gate G1**: Concluído e verificado (Domain schema, validators, JournalEntry adapter, repository, index incremental, cycle prevention).
- **Gate G2**: Concluído, auditado, homologado e aceito em ambiente real Foundry VTT v13.351 + Socketlib.
- **Gate G3**: Concluído, auditado, homologado e aceito soberanamente pelo usuário (`GATE_G3_HOMOLOGATED_AND_ACCEPTED`).
- **Gate G4**: Implementação completa de todos os 10 microbuilds (G4.1 a G4.10) de acordo com o Master Specification (§14, §11–12, §42, DEC-1416–2305) e `Documentos/GATES/14_G4_ECONOMY_RESOURCES.md`.
  - **G4.1 (ResourceDefinition & Precision)**: Registro de definições de recursos (`ResourceDefinitionRegistry`), validação de precisão decimal (0..4), tags, metadados e recursos canônicos padrão (`domain-manager:treasury`, `domain-manager:supplies`, `domain-manager:materials`).
  - **G4.2 (ResourceAccount Modes & Domain Integration)**: Modos `native`, `derived`, `provider-backed`, armazenamento acoplado à capacidade `domain-manager:economy` (`DomainEconomyData`), visibilidade pública e secreta com sanitização em projeção.
  - **G4.3 (Minor-Unit Math & Safe Integers)**: Representação canônica exclusivamente em inteiros seguros (`Number.isSafeInteger`), conversão e arredondamento exato com eliminação de float drift binário, formatação localizada e parser robusto.
  - **G4.4 (Ledger Append-Only & Reversals)**: Livro-razão estritamente append-only (`LedgerStore`), sequência estritamente crescente, mutações de saldo auditáveis, compensação por reversão (`reversesEntryId`) com proteção contra dupla reversão (`DM_ECON_REVERSAL_ALREADY_EXISTS`) e proibição de estornos em cascata.
  - **G4.5 (Reservations & Availability Lifecycle)**: Separação canônica entre saldo e disponibilidade (`available = balance - reserved`), ciclo de vida de reservas (`active`, `partially-consumed`, `consumed`, `released`, `expired`), consumo parcial/total com geração de ledger entry atrelado a `reservationId`.
  - **G4.6 (Capacity Resolver & Thresholds)**: Cálculo de capacidade efetiva (`resolveEffectiveCapacity`) sem persistência de valores derivados, avaliação de limites e alertas de ocupação (`over-capacity`, `near-capacity`, `low-reserve`).
  - **G4.7 (EconomyService, EconomyPlan & Commands)**: Serviço orquestrador `EconomyService` desacoplando `Preview` (`EconomyPlan`) de `Commit`, comandos transacionais seguros registrados no `CommandRegistry` (`economy:adjust`, `economy:transfer`, `economy:convert`, `economy:reserve`, `economy:consume-reservation`, `economy:release-reservation`, `economy:create-account`, `economy:close-account`, `economy:reversal`).
  - **G4.8 (Provider Shell & Fault Tolerance)**: Registro e contrato de provedores externos (`InventoryProvider`, `SystemEconomyProvider`), fail-closed para provedores offline ou não-responsivos, proibição de débito em saldos cacheados desatualizados.
  - **G4.9 (Economy UI, Presentation & Projection)**: `buildEconomyViewModel` com sanitização estrita de contas e transações secretas para não-GMs, `renderEconomySubsystemHtml` com templates semânticos e proteção contra XSS, e `EconomyApplication` compatível com ApplicationV2 no Foundry VTT v13.
  - **G4.10 (Hardening, Concurrency Tests & Runtime Integration)**: Testes de estresse concorrente comprovando ausência de deadlocks em transferências cruzadas cíclicas através de ordenação canônica de locks lexicais no `LockManager`, conservação estrita de massa (`sum(balances) = invariant`), proteção contra over-reservation concorrente e composição vertical completa no runtime (`DomainManagerRuntime.economy`).

## Evidência local Gate G4

| Verificação | Resultado |
|---|---|
| TypeScript strict (`tsc --noEmit`) | PASS (0 erros) |
| Testes unitários e integração (`node tests/run-tests.mjs`) | PASS — 434/434 (0 falhas) |
| Relatório de Aceitação | Gerado (`docs/GATE_G4_ACCEPTANCE_REPORT.md` e `docs/GATE_G4_REVALIDACAO_FINAL_5.md`) |
| Regressões G0/G1/G2/G3 | 0 (todos os 335 testes anteriores preservados e passando) |
| Testes novos Gate G4 | 99 testes dedicados (G4.1 a G4.10 + suítes de auditoria, isolamento, hardening, matriz de recuperação e revalidações 3/4/5) |
| Remediação de Auditoria G4-AUD-001 a G4-AUD-012 | PASS — 100% remediado, endurecido e verificado |
| Remediação da Revalidação G4-REVAL3-001 a G4-REVAL3-007 | PASS — 100% remediado, endurecido e verificado |
| Remediação da Revalidação G4-REVAL4-001 a G4-REVAL4-004 | PASS — 100% remediado, endurecido e verificado |
| Remediação da Revalidação G4-REVAL5-001 a G4-REVAL5-004 | PASS — 100% remediado, endurecido e verificado |
| Build do pacote (`node build.mjs`) | PASS (`dist/main.js` gerado) |
| Empacotamento (`node scripts/package.mjs`) | PASS (`dist/domain-manager-v0.0.3.zip` gerado) |
| Validação de pacote (`node scripts/validate-package.mjs`) | PASS |
| Validação de artefato (`node scripts/validate-artifact.mjs`) | PASS |

## Remediação da Revalidação Final (5ª Rodada) — G4-REVAL5-001 a G4-REVAL5-004

1. **G4-REVAL5-001 (ALTO / RECUPERAÇÃO — Durabilidade de Histórico de Operações, Outcome Explícito & Fail-Closed em Débito)**:
   - `#operations` persistido e reidratado em `ManualCurrencySnapshot`, assegurando que `reconcile()` funcione após reinicialização do sistema.
   - `EconomyService.commitAdjust` interpreta explicitamente `outcome: "unknown"` (transiciona transação para `"needs-recovery"`, flushes, retorna `DM_ECON_PROVIDER_TIMEOUT`) e `outcome: "failed-before-write"` (termina em `"failed"` sem recuperação, flushes, retorna `DM_ECON_PROVIDER_MUTATION_FAILED`).
   - `commitAdjust` em débito (`deltaMinor < 0`) falha imediatamente em modo fechado com `DM_ECON_PROVIDER_UNAVAILABLE` caso `readBalance()` falhe, nunca ignorando a verificação de saldo.
   - Suíte de testes: `tests/economy/providers.test.ts`.

2. **G4-REVAL5-002 (ALTO / SEGURANÇA — Isolamento Multi-Domínio com Chaves Qualificadas no Ledger)**:
   - `LedgerStore.queryPaged` recebe `allowedDomainResourceKeys`, aplicando filtragem qualificada por domínio (`${entry.domainUuid}:${entry.resourceId}`) antes de computar `totalCount`, `hasMore`, `hasPrev` e cursores.
   - Domínios com o mesmo `resourceId` não vazam contagem ou existência de entradas para não-GMs.
   - Suíte de testes: `tests/economy/ledger-pagination.test.ts`.

3. **G4-REVAL5-003 (ALTO / SEGURANÇA — Projeção Segura de Transações e Sanitização Cross-Domain)**:
   - Transações envolvendo recursos estritamente secretos/invisíveis são omitidas de `listTransactions` para não-GMs e rejeitadas com `DM_SECURITY_PERMISSION_DENIED` em `getTransaction`.
   - Transferências cross-domain expõem apenas `lockKeys` referentes aos domínios acessíveis pelo usuário requisitante; chaves de outros domínios e do sistema interno são removidas.
   - `failureReason` interno é mascarado para `"Transaction failed"` para visualizadores não-GM.
   - `EconomyPresenter.buildEconomyViewModel` aplica as mesmas regras de filtragem e sanitização.
   - Suíte de testes: `tests/economy/public-api-isolation.test.ts`.

4. **G4-REVAL5-004 (MÉDIO / ALTO — Rollback de Estado em Memória em Falhas de Storage)**:
   - `ThresholdService`: adicionado `rollbackThreshold(id, previous)`; `economy:set-threshold` executa rollback restaurando a definição anterior (ou deletando nova) se o `flush()` falhar, retornando `DM_DOMAIN_STORAGE_ERROR`.
   - `CustomResourceDefinitionStore`: `save()` restaura o mapa de `#definitions` prévio caso `#persist()` lance exceção.
   - `economy:register-custom-resource`: persiste no store primeiro e rejeita antes de modificar o `ResourceDefinitionRegistry` global em caso de erro de I/O.
   - Suíte de testes: `tests/economy/thresholds-and-rollup.test.ts`.

## Remediação da Revalidação Final (4ª Rodada) — G4-REVAL4-001 a G4-REVAL4-004

1. **G4-REVAL4-001 (ALTO — Provider Mutation Outcome, Pre-Compensation Reconciliation & Fail-Closed Stale Cache)**:
   - Expandido contrato de provedores de recursos (`ResourceProvider`) com `ProviderMutationOutcome` (`"written"`, `"not-written"`, `"unknown"`), `operationRef`, `lastMutatedAt` e método opcional `reconcileOperation(operationRef)`.
   - `ManualCurrencyProvider` atualizado com armazenamento durável de histórico de operações e reconciliação idempotente.
   - Em caso de timeout/falha de rede externa durante mutação de provedor, a transação é marcada como `"needs-recovery"` sem gerar mutação errônea ou inconsistência no ledger local.
   - O compensador de recuperação executa pré-reconciliação: se o provedor certificar que a mutação `"not-written"`, a transação é finalizada como `"failed"` sem emitir estorno reverso espúrio; se confirmar `"written"`, aplica compensação segura.
   - Checagem rigorosa de expiração de cache (DEC-16806): se o saldo cacheado tiver idade superior ao TTL configurado, a operação falha em modo fechado com `DM_ECON_PROVIDER_STALE_CACHE`.
   - Suíte de testes dedicada: `tests/economy/providers.test.ts`.

2. **G4-REVAL4-002 (ALTO/SEGURANÇA — Eliminação de Bypass Mutável em PublicEconomyApi & Propagação de Erro de Storage em ThresholdService)**:
   - Eliminados métodos mutáveis diretos (`registerThreshold`, `thresholds`) da fachada `PublicEconomyApi`, garantindo que toda alteração de limiar passe pelo pipeline canônico autenticado (`setThreshold` despacha comando `economy:set-threshold` via `CommandBus`).
   - `ThresholdService.flush()` propaga rejeições de persistência assíncronas do storage adapter subjacente.
   - Handler `economy:set-threshold` captura falhas de persistência no flush e retorna estruturado `DM_DOMAIN_STORAGE_ERROR`.
   - Suíte de testes dedicada: `tests/economy/thresholds-and-rollup.test.ts` e `tests/economy/public-api-isolation.test.ts`.

3. **G4-REVAL4-003 (ALTO — Paginação do Ledger com Consciência de Visibilidade e Proteção contra Vazamento de Metadados)**:
   - `LedgerStore.queryPaged` atualizado para receber parâmetro `allowedResourceIds`.
   - Filtro de visibilidade é aplicado antes do cálculo de `totalCount`, `hasMore`, `hasPrev` e cursores de paginação (`cursor`, `nextCursor`, `prevCursor`), prevenindo vazamento de existência ou volume de transações de recursos secretos para jogadores sem permissão.
   - Fachada `PublicEconomyApi.queryLedger` computa o conjunto exato de IDs visíveis ao requisitante antes de delegar ao store.
   - Suíte de testes dedicada: `tests/economy/ledger-pagination.test.ts`.

4. **G4-REVAL4-004 (MÉDIO/ALTO — Superfícies T4: Quick Resource Create, Histórico de Transações, Provider Health Status Shell e Agregação de Contas Derivadas Incompletas)**:
   - **Quick Resource Create**: Handler `economy:register-custom-resource` verifica duplicidade em `ResourceDefinitionRegistry` e `CustomResourceDefinitionStore`, rejeitando colisões com `DM_ECON_RESOURCE_ALREADY_EXISTS`. Na UI, o controller `dispatchQuickResourceCreateAndAccount` sanitiza os dados contra valores `undefined` garantindo payloads estritamente JSON-safe.
   - **Histórico de Transações**: Implementados `getTransaction` e `listTransactions` em `PublicEconomyApi` com verificação de posse do documento de domínio (permissão mínima `LIMITED` / nível >= 1 para não-GMs, retornando `DM_SECURITY_PERMISSION_DENIED` se não autorizado) e sanitização em `TransactionRecordDto`.
   - **Provider Status Shell**: Visualização e verificação de integridade de provedores (`healthy`, `degraded`, `unavailable`, `incompatible`) com `lastCheckedAt` e renderização de badges na UI (`renderProviderStatusSection`).
   - **Agregação de Contas Derivadas**: Contas no modo `"derived"` cujos domínios de origem não puderem ser resolvidos marcam `stats.isComplete = false`, incrementam `unknownContributorCount` e registram o UUID em `unknownContributors`.
   - Suítes de testes: `tests/economy/thresholds-and-rollup.test.ts`, `tests/economy/public-api-isolation.test.ts`, `tests/economy/economy-ui.test.ts`.

## Remediação da Revalidação Final (3ª Rodada) — G4-REVAL3-001 a G4-REVAL3-007

1. **G4-REVAL3-001 (CRÍTICO — Matriz de Reconciliação de Recuperação de Transferências e Testes de Queda em 6 Pontos)**:
   - Implementada matriz de reconciliação exata no compensador de recuperação de `economy:transfer` e `economy:convert` em `EconomyService`: reconcilia contas `srcAccount` e `tgtAccount` e entradas do ledger para determinar o progresso exato antes da falha.
   - Aplica compensação cirúrgica: se nenhum débito ocorreu, marca `failed`; se o débito ocorreu mas o crédito não, estorna o débito sem criar entradas fantasmas; se débito e crédito ocorreram antes do commit do record, finaliza para `committed`.
   - Suporte a transição de estado `compensating -> committed` no `TransactionRecord`.
   - Suíte de testes `tests/economy/fault-recovery.test.ts` cobrindo os 6 pontos discretos de falha/queda (`tx_crash_point_1` a `tx_crash_point_6`), comprovando conservação estrita de massa, ausência de duplicidade ou entradas órfãs no ledger, e idempotência estrita.
2. **G4-REVAL3-002 (ALTO/SEGURANÇA — Proveniência de `authorityEpoch` Autenticado)**:
   - Handlers de comandos econômicos em `src/economy/commands/economy-commands.ts` obtêm `authorityEpoch` estritamente de `ctx.authorityEpoch` (autenticado pelo `CommandBus`), prevenindo falsificação de epoch via payload.
   - Verificado adversariamente em `tests/economy/economy-transactions.test.ts`.
3. **G4-REVAL3-003 (ALTO — Fila de Persistência Serializada em Stores)**:
   - Implementada cadeia `#persistQueue: Promise<void> = Promise.resolve();` em `LedgerStore`, `ReservationStore` e `TransactionStore`.
   - Gravações concorrentes são serializadas em FIFO rigoroso, eliminando race conditions onde snapshots intermediários mais lentos poderiam sobrescrever snapshots posteriores.
   - Verificado com testes de persistência com atrasos invertidos em `tests/economy/storage-persistence.test.ts`.
4. **G4-REVAL3-004 (ALTO — Transações e Compensação para Provedores / Persistência de ManualCurrency)**:
   - Criado `ManualCurrencyStorageAdapter` (`InMemoryManualCurrencyStorageAdapter`, `FoundryJournalManualCurrencyStorageAdapter`) com rehidratação automática no boot do runtime (`runtime.initialize()`).
   - Operações `commitAdjust` para contas de provedor (`mode === "provider"`) agora participam do fluxo transacional com `TransactionRecord` durável (`claimed -> prepared -> committing -> committed`), registrando compensador `"economy:provider-adjust"` que desfaz a mutação em caso de falha posterior.
5. **G4-REVAL3-005 (ALTO/SEGURANÇA — Projeção Canônica na UI com Clearance e Mascaramento de Razão)**:
   - `buildEconomyViewModel` utiliza `EconomyProjectionService.isAccountVisible(acc, viewer)` verificando permissões públicas, secretas e com restrição de clearance via `viewer.allowedRestrictedRefs`.
   - Razões (`reason`) de reservas e entradas do ledger são omitidas para usuários não-GM (`viewer.isGm ? reason : undefined`).
   - Teste de segurança dedicado em `tests/economy/economy-ui.test.ts`.
6. **G4-REVAL3-006 (ALTO — Pipeline Único de Ações na UI ApplicationV2)**:
   - Removidos listeners manuais redundantes de clique em `[data-action]` no `EconomyApplication`, preservando a delegação nativa `DEFAULT_OPTIONS.actions` do Foundry v13 como único pipeline de despacho.
   - Teste automatizado confirma exatamente 1 disparo por clique.
7. **G4-REVAL3-007 (MÉDIO/ALTO — Comandos Canônicos, Auto-Avaliação de Limiares e Metadados de Agregação)**:
   - Criado `ThresholdStorageAdapter` (`InMemoryThresholdStorageAdapter`, `FoundryJournalThresholdStorageAdapter`) com rehidratação no boot e fila serializada em `ThresholdService`.
   - Auto-avaliação de limiares (`#evaluateThresholds`) integrada a todas as mutações no `EconomyService` (`commitAdjust`, `commitTransfer`, `commitConvert`, `reserve`, `consumeReservation`, `reverseLedgerEntry`).
   - Comandos canônicos registrados no `CommandRegistry`: `economy:set-threshold` e `economy:register-custom-resource` (GM-only), além de suporte a `reason` em `economy:release-reservation`.
   - `EconomyAggregationProvider` rastreia integridade (`isComplete: boolean`) e lista explicitamente `unknownContributors` caso domínios ou provedores falhem.

## Remediação de Auditoria Estrutural e Hardening (G4-AUD-001 — G4-AUD-012)

1. **G4-AUD-001 (Persistência Durável de Ledger, Reservas e Transações)**: `FoundryJournalLedgerStorageAdapter`, `FoundryJournalReservationStorageAdapter` e `FoundryJournalTransactionStorageAdapter` conectados por padrão no runtime de produção; rehidratação assíncrona mandatória em `runtime.initialize()` antes do boot de `module.api`; métodos `flush()` aguardados em todas as operações críticas com propagação de erros de persistência.
2. **G4-AUD-002 (Recuperação e Atomicidade em Falhas de Múltiplos Passos)**: Transações com compensador de recuperação registrado (`EconomyService.#registerRecoveryCompensators`); `RecoveryService.recoverAll(currentEpoch)` executado automaticamente no startup para reconciliar transações pendentes de sessões anteriores; atomicidade estrita em transferências com rollback seguro de saldo de origem caso o destino falhe no passo 2; conservação estrita de massa (`sum(balances) = invariant`).
3. **G4-AUD-003 (Integridade Cross-Domain em Reservas e Estornos)**: Rejeição com `DM_ECON_RESERVATION_DOMAIN_MISMATCH` ao tentar consumir ou liberar reservas de outro domínio; restauração atômica do estado prévio da reserva (`rollbackConsume`) sem mutações indevidas de saldo.
4. **G4-AUD-004 (Isolamento do Runtime Público e Proteção contra Bypass)**: `PublicModuleApi` exposto em `module.api` contendo apenas fachadas seguras (`PublicEconomyApi`, `PublicPeopleApi`, read-only `domains`, `diagnostics`); `commitTransfer`, `commitConvert`, `commitAdjust` e stores mutáveis completamente removidos do escopo público.
5. **G4-AUD-005 (Injeção Canônica do DomainControllerProvider)**: `DomainControllerProvider` canônico injetado no runtime padrão e propagado a todos os comandos econômicos.
6. **G4-AUD-006 (Contas Provider-Backed / Derivadas e Semântica Fail-Closed)**: `ManualCurrencyProvider` integrado com `ResourceProvider` contract (`readBalance`, `mutateBalance`, `applyDelta`), com fail-closed para saldos cacheados desatualizados (`DM_ECON_PROVIDER_STALE_CACHE`) e badges visuais de status na UI.
7. **G4-AUD-007 (Projeção e Visibilidade Secreta de Contas e Transações)**: Projeção de dados econômicos com sanitização estrita para não-GMs; `PublicEconomyApi.getReservation` falha em modo fechado com `DM_SECURITY_PERMISSION_DENIED` para contas não visíveis; `hiddenContributors` oculta identificadores de domínios secretos para não-GMs.
8. **G4-AUD-008 (Limiares com Edge Detection e UI Completa)**: `ThresholdService` com rastreamento de bordas de subida/descida (`#crossedStates`, `evaluateCrossings`), prevenindo tempestades de alertas; interface gráfica enriquecida com modal de detalhes de recurso (`openResourceDetail`), pré-visualização de impacto antes/depois (`#dm-transfer-preview`, `#dm-adjust-preview`) e ações de liberação de reservas (`releaseReservation`).
9. **G4-AUD-009 (Paginação do Ledger e Escala)**: Paginação por cursor e limites (`queryPaged`) e ordenação descendente padrão; testado em escala com 10.000+ transações em menos de 100ms; controles de navegação paginada (Previous/Next) na UI.
10. **G4-AUD-010 (Suporte a Limiares, Recursos Customizados e Rollup Multi-Domínio)**: `CustomResourceDefinitionStore` com persistência durável em JournalEntry, agregação multi-domínio com controle de privacidade e no-op em ajustes com delta zero.
11. **G4-AUD-011 (Matriz de Testes de Falha, Segurança Cross-Domain, Reinício e Recuperação Idempotente)**: Testes rigorosos cobrindo injeção de falhas no passo 2 de transferências, sobrevivência do TransactionStore a reinicializações com reload via adapter, recuperação automática idempotente (RecoveryService.recoverAll) e rollback de consumo de reservas parciais e totais (tests/economy/fault-recovery.test.ts).
12. **G4-AUD-012 (Designação Canônica do Próximo Gate)**: Designação estrita e inequívoca do próximo gate como **Gate G5 — Projects / Facilities / Downtime**, mantendo o estado `GATE_G4_PENDING_USER_ACCEPTANCE` até aceitação soberana do usuário.

## Próxima ação canônica

- **Aguardar Aceitação Soberana do Usuário para Gate G4 (Economy & Resources)**: Conforme regra mandatória, o Gate G4 (Economy & Resources) permanecerá em `GATE_G4_PENDING_USER_ACCEPTANCE` até que o usuário teste e declare formalmente sua aceitação.
- Após a aceitação e homologação pelo usuário, o Gate G5 (Projects / Facilities / Downtime) será liberado.


