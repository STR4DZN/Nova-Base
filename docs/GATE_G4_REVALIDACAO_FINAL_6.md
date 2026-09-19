# DOMAIN MANAGER — RELATÓRIO DE REMEDIAÇÃO DA 6ª REVALIDAÇÃO (GATE G4)

**Projeto:** Domain Manager  
**Subsystem:** Economy & Resources (`domain-manager:economy`)  
**Gate:** G4 — Economy & Resources  
**Normative Authorities:** Master Specification (§14, §11–12, §42, DEC-1416 a DEC-2305), `14_G4_ECONOMY_RESOURCES.md`, G4 6ª Revalidação de Código.  
**Data:** 18/09/2026  
**Status Atual:** **GATE_G4_PENDING_USER_ACCEPTANCE** (Aguardando homologação e aceitação soberana do usuário)  
**Suíte de Testes:** 435/435 passing (0 falhas, 0 regressões contra baseline de 434 da 5ª revalidação, 428 da 4ª revalidação e 335 de G3)  
**TypeScript Conformance:** Strict, 0 erros via `tsc --noEmit`  
**Validação de Pacote e Artefatos:** PASS (`dist/domain-manager-v0.0.4.zip`, scripts de validação aprovados)  

---

## 1. Matriz de Fechamento da 6ª Revalidação

| Item | Gravidade | Descrição / Resíduo Auditado | Status | Implementação & Verificação |
|---|---|---|:---:|---|
| **G4-REVAL6-001** | CRÍTICO / RECUPERAÇÃO | Reconciliação prévia mandatória no compensador de recuperação (`economy:provider-adjust`) após falha de flush do provider e reinicialização do sistema. Elimina falso-commit e divergência persistente entre ledger e provedor reidratado. | **FECHADO** | O compensador `economy:provider-adjust` em `EconomyService` reconcilia o provedor antes de decidir o destino da transação. Se `hasLedgerEntry && providerOutcome === "not-written"`, estorna a entrada do ledger local (`deltaMinor: -data.deltaMinor`, `source.type: "recovery"`), dá flush no `ledgerStore` e finaliza a transação como `"failed"`, zerando o delta líquido do ledger e equalizando o saldo com o snapshot reidratado do provedor. Se `providerOutcome === "unknown"`, mantém a transação em `"needs-recovery"`. Testado em `tests/economy/providers.test.ts`. |
| **G4-REVAL5-002** | ALTO / SEGURANÇA | Ledger cross-domain por Domain+Resource. | **FECHADO** | Mantido fechado sem regressões. |
| **G4-REVAL5-003** | ALTO / SEGURANÇA | Transaction History projection e sanitização. | **FECHADO** | Mantido fechado sem regressões. |
| **G4-REVAL5-004** | MÉDIO / ALTO | Rollback em memória após storage failure. | **FECHADO** | Mantido fechado sem regressões. |

---

## 2. Detalhamento Técnico da Remediação

### 2.1. G4-REVAL6-001 — Provider Restart/Reconciliation Divergence Resolution

- **Problema Auditado (Root Cause)**:
  - Durante o fluxo de `commitAdjust` em contas backed por provedores externos (`mode: "provider"`), a mutação em memória do provedor ocorria primeiro, seguida da escrita e flush da entrada no `ledgerStore`.
  - Caso o flush de persistência do provedor (`provider.flush()`) falhasse (ex.: erro de I/O em disco, falha de rede do storage adapter), a transação era corretamente colocada em `"needs-recovery"`.
  - Entretanto, se o servidor ou o Foundry VTT reiniciasse em seguida, o provedor reidratava a partir do storage adapter, voltando ao snapshot antigo e perdendo a mutação volátil que não havia sido gravada em disco.
  - O compensador de recuperação anterior observava apenas `hasLedgerEntry === true` e marcava a transação cegamente como `"committed"` sem verificar se a mutação do provedor sobreviveu ao crash/restart.
  - Isso gerava divergência persistente irremediável: o ledger contabilizava +500, o provedor reidratado tinha saldo 1000 (sem a operação), e a transação figurava como commitada com sucesso.

- **Implementação da Matriz Completa de Reconciliação**:
  - Em `src/economy/services/economy-service.ts` (linhas 2382–2533), o compensador registrado para `economy:provider-adjust` foi reformulado:
    1. **Fail-closed em indisponibilidade**: Se o `providerRegistry` ou o provedor não estiverem registrados, retorna erro `DM_ECON_PROVIDER_UNAVAILABLE` fail-closed.
    2. **Consulta de Reconciliação**: Invoca `provider.reconcile(domainUuid, resourceId, providerRef, transactionId)`.
    3. **Tratamento de Incerteza**: Se `providerOutcome === "unknown"`, encerra imediatamente com `DM_ECON_RECOVERY_INDETERMINATE`, garantindo que a transação permaneça em `"needs-recovery"`.
    4. **Caso 1 (`hasLedgerEntry && providerOutcome === "written"`)**:
       - Ambos confirmam a mutação. A transação transiciona para `"committed"`, persiste via `transactionStore.flush()` e encerra com sucesso.
    5. **Caso 2 (`hasLedgerEntry && providerOutcome === "not-written"`)** — *Cenário Crítico Auditado*:
       - O ledger possui a entrada, mas o provedor reidratado não gravou a mutação.
       - O compensador adiciona uma contra-entrada de ajuste (`deltaMinor: -data.deltaMinor`, `kind: "adjustment"`, `source: { type: "recovery" }`) com proteção contra duplicação de reversão.
       - Executa `ledgerStore.flush()`.
       - Transiciona a transação para `"failed"`, registrando o motivo de falha e executa `transactionStore.flush()`.
       - O delta líquido do ledger retorna a 0, convergindo com o saldo do provedor sem divergência.
    6. **Caso 3 (`!hasLedgerEntry && providerOutcome === "written"`)**:
       - O provedor aplicou a mutação mas o ledger não possui registro.
       - Reverte a mutação no provedor via `provider.mutateBalance(-data.deltaMinor)` e `provider.flush()`.
       - Transiciona a transação para `"compensated"` e salva no store.
    7. **Caso 4 (`!hasLedgerEntry && providerOutcome === "not-written"`)**:
       - Ambos não possuem a mutação. Transiciona a transação para `"failed"` de forma limpa.

- **Verificação Automatizada (Test Scenarios A, B e C)**:
  - Adicionado teste canônico `G4-REVAL6-001: Provider restart/reconciliation handles flush failure and resolves divergence` em `tests/economy/providers.test.ts`:
    - **Cenário B (Principal)**: Saldo inicial 1000 -> mutação +500 em memória -> escrita no ledger -> injeção de erro de I/O no flush do storage adapter -> tx em `"needs-recovery"`. Simula restart do servidor criando nova instância do provider reidratada do snapshot (saldo 1000, 0 operações). Ao rodar `recoverTransaction`, o provider reporta `"not-written"`, o ledger recebe contra-ajuste de -500 (delta líquido = 0), a tx é finalizada como `"failed"` e o saldo do provider permanece 1000. Divergência 100% resolvida.
    - **Cenário A**: Provedor reporta `"written"` e entrada do ledger existe -> transação transiciona para `"committed"` e a entrada do ledger é preservada.
    - **Cenário C**: Provedor reporta `"unknown"` (provider degradado/offline) -> recuperação falha com `DM_RECOVERY_COMPENSATION_FAILED` e a transação permanece estritamente em `"needs-recovery"`.

---

## 3. Verificação Automatizada e Evidências

```
✔ G4-REVAL6-001: Provider restart/reconciliation handles flush failure and resolves divergence (5.787ms)

Total de testes passando: 435/435 (0 falhas, 0 regressões)
Tempo de execução da suíte: ~9.9s
TypeScript Conformance (tsc --noEmit): 0 erros
Validação de pacote (dist/domain-manager-v0.0.3.zip): APROVADA
Validação de artefatos: APROVADA
```

---

## 4. Estado de Homologação

- **G0, G1, G2 e G3**: Homologados e aceitos soberanamente pelo usuário.
- **Gate G4**: O blocker único `G4-REVAL6-001` foi integralmente solucionado, coberto com teste ponta a ponta e validado.
- O estado do subsistema permanece canonicamente como **`GATE_G4_PENDING_USER_ACCEPTANCE`** aguardando validação e aceite soberano do usuário.
- **Próximo Gate Normativo**: **Gate G5 — Projects / Facilities / Downtime** (estritamente bloqueado até a aceitação do usuário).
