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
| Testes unitários e integração (`node tests/run-tests.mjs`) | PASS — 398/398 (0 falhas) |
| Relatório de Aceitação | Gerado (`docs/GATE_G4_ACCEPTANCE_REPORT.md`) |
| Regressões G0/G1/G2/G3 | 0 (todos os 335 testes anteriores preservados e passando) |
| Testes novos Gate G4 | 63 testes dedicados (G4.1 a G4.10 + 6 suítes de auditoria e hardening) |
| Remediação de Auditoria G4-AUD-001 a G4-AUD-012 | PASS — 100% remediado e verificado |
| Build do pacote (`node build.mjs`) | PASS (`dist/main.js` gerado) |
| Empacotamento (`node scripts/package.mjs`) | PASS (`dist/domain-manager-v0.0.3.zip` gerado) |
| Validação de pacote (`node scripts/validate-package.mjs`) | PASS |
| Validação de artefato (`node scripts/validate-artifact.mjs`) | PASS |

## Remediação de Auditoria Estrutural (G4-AUD-001 — G4-AUD-012)

1. **G4-AUD-001 (Persistência de Ledger e Reservas)**: Implementados adapters de persistência em memória e JournalEntry com rehidratação automática em boot.
2. **G4-AUD-002 (Recuperação e Atomicidade em Falhas de Múltiplos Passos)**: Transações com rollback automático do domínio de origem caso o destino falhe no passo 2; conservação estrita de massa.
3. **G4-AUD-003 (Integridade Cross-Domain em Reservas e Estornos)**: Rejeição com `DM_ECON_RESERVATION_DOMAIN_MISMATCH` ao tentar consumir/liberar reservas de outro domínio.
4. **G4-AUD-004 (Bypass de Runtime Público)**: Exposição isolada através de `PublicEconomyApi` com DTOs imutáveis; mutadores diretos e stores mutáveis removidos da API pública.
5. **G4-AUD-005 (Falta do DomainControllerProvider canônico nos Comandos Economy)**: Provedor canônico de controller injetado por padrão no registro de comandos.
6. **G4-AUD-006 (Contas Provider-Backed / Derivadas e Semântica Fail-Closed)**: `ManualCurrencyProvider`, `NativeResourceProvider` e fail-closed para saldos cacheados desatualizados (`DM_ECON_PROVIDER_STALE_CACHE`).
7. **G4-AUD-007 (Projeção e Visibilidade Secreta de Contas e Transações)**: Projeção de dados econômicos com sanitização estrita para não-GMs.
8. **G4-AUD-008 (UI sem Suporte a Decimais e Ações Incompletas)**: Adicionado `parseResourceAmount` com precisão decimal, modal de criação de conta e renderização de reservas.
9. **G4-AUD-009 (Paginação do Ledger e Ordenação Cronológica Reversa)**: `queryPaged` com suporte a cursores e limites, e ordenação descendente padrão.
10. **G4-AUD-010 (Suporte a Limiares, Recursos Customizados e Rollup Multi-Domínio)**: `ThresholdService`, `CustomResourceDefinitionStore`, agregação multi-domínio com `hiddenContributors` e no-op em ajustes com delta zero.
11. **G4-AUD-011 (Encerramento Seguro de Contas / Soft-Close)**: Encerramento de contas bloqueado se houver reservas ativas ou saldo remanescente sem esvaziamento.
12. **G4-AUD-012 (Concorrência e Locks Lexicais)**: Ordenação determinística de chaves no `LockManager`, eliminando deadlocks em concorrência circular.

## Próxima ação canônica

- **Aguardar Aceitação Soberana do Usuário para Gate G4 (Economy & Resources)**: Conforme regra mandatória, o Gate G4 (Economy & Resources) permanecerá em `GATE_G4_PENDING_USER_ACCEPTANCE` até que o usuário teste e declare formalmente sua aceitação.
- Após a aceitação e homologação pelo usuário, o Gate G5 (Projects / Facilities / Downtime) será liberado.


