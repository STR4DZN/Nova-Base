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
| Testes unitários e integração (`node tests/run-tests.mjs`) | PASS — 383/383 (0 falhas) |
| Relatório de Aceitação | Gerado (`docs/GATE_G4_ACCEPTANCE_REPORT.md`) |
| Regressões G0/G1/G2/G3 | 0 (todos os 335 testes anteriores preservados e passando) |
| Testes novos Gate G4 | 48 testes dedicados (G4.1 a G4.10) |
| Build do pacote (`node build.mjs`) | PASS (`dist/main.js` gerado) |
| Empacotamento (`node scripts/package.mjs`) | PASS (`dist/domain-manager-v0.0.3.zip` gerado) |
| Validação de pacote (`node scripts/validate-package.mjs`) | PASS |
| Validação de artefato (`node scripts/validate-artifact.mjs`) | PASS |

## Próxima ação canônica

- **Aguardar Aceitação Soberana do Usuário para Gate G4 (Economy & Resources)**: Conforme regra mandatória, o Gate G4 (Economy & Resources) permanecerá em `GATE_G4_PENDING_USER_ACCEPTANCE` até que o usuário teste e declare formalmente sua aceitação.
- Após a aceitação e homologação pelo usuário, o Gate G5 (Governance & Decisions) será liberado.

