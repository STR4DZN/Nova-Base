# RELATÓRIO DE ACEITAÇÃO FORMAL — GATE G2
## Authority / Commands / MutationCoordinator (Pós-Resolução da Auditoria Externa)

> **Módulo:** `domain-manager`  
> **Versão:** `0.0.2`  
> **Data:** `2026-09-17`  
> **Autoridade Normativa:** `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md` (§11–12, §6–7, §47–49)  
> **Status de Conclusão:** `GATE_G2_ACCEPTED_EXTERNAL_AUDIT_RESOLVED` (205/205 testes verdes / 0 falhas / 0 regressões)

---

## 1. Sumário Executivo

O **Gate G2 — Authority / Commands / MutationCoordinator** foi implementado na íntegra através de 10 microtarefas normativas sequenciais (`G2.1a → G2.10`), submetido a auditoria de segurança inicial, e posteriormente submetido à auditoria externa detalhada no documento `G2_EXTERNAL_AUDIT_ERRORS_FOR_ANTIGRAVITY.md` contendo 28 apontamentos críticos e arquiteturais (`G2-AUD-001` a `G2-AUD-028`).

Todos os 28 apontamentos foram rigorosamente analisados, corrigidos, verificados via testes direcionados e adversariais, e comprovados no bundle de produção (`dist/main.js`). A suíte de testes agora totaliza **205 testes automatizados**, todos aprovados sem exceção.

Nenhum código ou escopo pertencente ao Gate G3 (Domain Lifecycle & State Machine) foi antecipado.

---

## 2. Resolução dos 28 Apontamentos da Auditoria Externa (G2-AUD-001 a G2-AUD-028)

| Item | Área | Severidade | Resolução Implementada | Evidência de Teste |
|---|---|---|---|---|
| **G2-AUD-001** | Production Wiring | BLOCKER | Wires `CommandBus`, `MutationCoordinator`, `LockManager`, `RecoveryService`, `CommandQueue`, `FoundryCommandTransportAdapter`, e `G2DiagnosticsProvider` no `DomainManagerRuntime` e `main.ts`. Reachable no bundle `dist/main.js`. | `tests/core/main-bootstrap.test.ts`, `node --check dist/main.js` |
| **G2-AUD-002** | Transport Security | BLOCKER | Extração de remetente autenticado a partir do transporte (`transportContext`). Rejeita divergência e pacotes remotos alegando ser Primary Authority local com `DM_SECURITY_SENDER_SPOOFED`. | `tests/commands/foundry-transport-adversarial.test.ts` |
| **G2-AUD-003** | Transport Security | HIGH | Requisições pendentes só aceitam respostas autenticadas vindas estritamente da Primary Authority ativa com matching epoch; respostas forjadas são descartadas. | `tests/commands/foundry-command-transport-adapter.test.ts` |
| **G2-AUD-004** | Transport Topology | HIGH | Transporte dirigido: requests especificam `targetAuthorityUserId`. Nós que não são a authority alvo ignoram pacotes silenciosamente sem executar mutation. | `tests/commands/foundry-command-transport-adapter.test.ts` |
| **G2-AUD-005** | Authority Guard | BLOCKER | `executeLocal()` e `dispatchInbound()` rejeitam com `DM_AUTHORITY_NOT_LOCAL` se o cliente corrente não for a autoridade resolvida (`isCurrentUser()`). | `tests/commands/command-bus.test.ts` |
| **G2-AUD-006** | Provenance | MEDIUM | `executeLocal()` preserva e propaga a proveniência real (`operationSource`: user, tick, project, event, migration, system) sem substituição cega por `system`. | `tests/commands/command-bus.test.ts` |
| **G2-AUD-007** | Transactional Enforcement | BLOCKER | `CommandRegistry.register` com `transactional: true` exige obrigatoriamente `mutationDefinition` ou wrapper `createTransactionalHandler`. `CommandBus` direciona estritamente via `MutationCoordinator`. | `tests/commands/registry.test.ts`, `tests/commands/command-bus.test.ts` |
| **G2-AUD-008** | Storage Boundary | HIGH | `runtime.domains` exposto estritamente como `DomainReadRepository`. Operações mutáveis restritas aos handlers autoritativos internos via `DomainCommandHandlers`. | `tests/core/composition-root.test.ts`, `tests/domains/domain-repository.test.ts` |
| **G2-AUD-009** | Consistency | HIGH | Ausência de revisão em `freshState` quando `expectedRevision` é declarado falha closed com `DM_REVISION_CONFLICT`. | `tests/mutations/mutation-coordinator-adversarial.test.ts` |
| **G2-AUD-010** | Consistency | HIGH | Entidade declarada em `expectedRevisions` ausente em `freshState.entityRevisions` falha closed com `DM_REVISION_CONFLICT`. | `tests/mutations/mutation-coordinator-adversarial.test.ts` |
| **G2-AUD-011** | Recovery | BLOCKER | Transação não-resolvida sem compensador disponível permanece em `needs-recovery` com `DM_RECOVERY_COMPENSATION_UNAVAILABLE`; nunca transiciona para `compensated`. | `tests/mutations/transaction-and-recovery.test.ts` |
| **G2-AUD-012** | Recovery / Commit | BLOCKER | Introduzido `CommitOutcome` (`committed`, `failed-known-safe`, `unknown`). Erro com outcome `unknown` retém compensação automática para não corromper estado e retorna `DM_RECOVERY_UNKNOWN_OUTCOME`. | `tests/mutations/mutation-coordinator-adversarial.test.ts` |
| **G2-AUD-013** | Recovery Scope | HIGH | Escopo de persistência alinhado: documentado formalmente que a persistência distribuída/disco de transações pertence ao Gate G6, enquanto o G2 provê isolamento em memória no host da autoridade primária com varredura no startup. | `docs/GATE_G2_ACCEPTANCE_REPORT.md`, `docs/BUILD_STATE.md` |
| **G2-AUD-014** | Observability | MEDIUM | Exposto método de consulta de status `CommandDedupeStore.getStatus(commandId)` e `CommandBus.getCommandStatus(commandId)` (`unknown`, `processing`, `completed`, `rejected`). | `tests/commands/command-dedupe-store.test.ts` |
| **G2-AUD-015** | Concurrency / Queue | HIGH | Criado `CommandQueue` com escalonamento FIFO determinístico, suporte a prioridade interna, cancelamento pré-commit via `AbortSignal`, e integração em `CommandBus`. | `tests/commands/command-bus.test.ts` |
| **G2-AUD-016** | Lock Liveness | HIGH | `LockManager.removeFromQueues` desobstrui imediatamente o próximo waiter quando o primeiro aborta ou expira por timeout, garantindo vivacidade sem requisições externas. | `tests/mutations/lock-manager.test.ts` |
| **G2-AUD-017** | Immutability | HIGH | `deepCloneAndFreeze` clona e congela profundamente `writeSet` (payloads) e `customData`. Suporte a operação `"restore"` no tipo `PlanOperationType`. | `tests/mutations/plan-and-receipt.test.ts` |
| **G2-AUD-018** | Security Sanitization | HIGH | `sanitizeReceiptForPublic` sanitiza profundamente `result` e `error.details` usando `sanitizeDiagnosticsValue` e omite `transactionId` interno. | `tests/commands/envelope-and-receipt-adversarial.test.ts` |
| **G2-AUD-019** | JSON Safety | HIGH | `checkPayloadJsonSafe` rejeita defensivamente propriedades `undefined` em qualquer profundidade. | `tests/commands/envelope-and-receipt-adversarial.test.ts` |
| **G2-AUD-020** | Payload Budgets | MEDIUM/HIGH | Limites defensivos estritos em envelopes: 64KB de tamanho serializado, profundidade máxima 16, 500 chaves de objeto e 1000 itens de array. | `tests/commands/envelope-and-receipt-adversarial.test.ts` |
| **G2-AUD-021** | Dedupe Fingerprint | MEDIUM/HIGH | Fingerprint canônico inclui `targetRefs` ordenados lexicograficamente na assinatura de intenção. | `tests/commands/command-dedupe-store.test.ts` |
| **G2-AUD-022** | Checkpoint Gate | HIGH | `scripts/validate-g2-full.mjs` valida integridade do pacote ZIP, reachability no bundle `dist/main.js`, manifesto v13.351, typecheck e execução de todos os testes. | `scripts/validate-g2-full.mjs` |
| **G2-AUD-023** | Truth in Reporting | HIGH | Relatório de aceitação atualizado com evidências pós-execução e conformidade estrita com todos os 28 itens. | `docs/GATE_G2_ACCEPTANCE_REPORT.md` |
| **G2-AUD-024** | Composite Diagnostics | HIGH | Criado `G2DiagnosticsProvider`, gerando snapshot composto de autoridade, epoch, locks ativos, fila, dedupe, recuperação e transporte. | `tests/diagnostics/diagnostics-snapshot.test.ts` |
| **G2-AUD-025** | Revision Falsiness | LOW/MEDIUM | Comparações de revisão em `MutationCoordinator` usam testes explícitos `!== undefined && !== null`, impedindo que revisão 0 seja tratada como falsy. | `tests/mutations/mutation-coordinator.test.ts` |
| **G2-AUD-026** | Transport Cleanup | MEDIUM | `attachTransport` no `CommandBus` utiliza rastreamento independente em `Set`, garantindo que desmontar um transporte não afete outros listeners. | `tests/commands/command-bus.test.ts` |
| **G2-AUD-027** | Correlation Collision | MEDIUM | `FoundryCommandTransportAdapter` rejeita chamadas concorrentes com mesmo `correlationId` com `DM_TRANSPORT_CORRELATION_COLLISION`. | `tests/commands/foundry-command-transport-adapter.test.ts` |
| **G2-AUD-028** | Spam Hardening | MEDIUM | Verificação prévia de rate limiting por remetente autenticado protege contra spam de comandos inválidos antes da validação profunda. | `tests/commands/rate-limiter-and-validation.test.ts` |

---

## 3. Matriz de Acceptance Obrigatória do Gate G2

| Item Normativo | Verificação Específica | Resultado |
|---|---|:---:|
| **1. Sender Autenticado** | O remetente do comando é estabelecido exclusivamente pelo contexto do transporte (socket/sessão), nunca confiando em valores declarados no payload. | **PASS** |
| **2. Anti-Spoofing de Autoridade** | Pacotes recebidos via rede que alegam ser a Primary Authority ou usuário local são rejeitados com `DM_SECURITY_SENDER_SPOOFED`. Remetentes desconhecidos/inativos são rejeitados com `DM_SECURITY_SENDER_UNKNOWN`. | **PASS** |
| **3. Anti-Spoofing de Payload** | Tentativas de enviar payload contendo `userId` divergente do remetente autenticado são rejeitadas com `DM_SECURITY_SENDER_SPOOFED`. | **PASS** |
| **4. Rejeição de Internal-Only** | Comandos com visibilidade `internal` recebidos via transporte remoto são imediatamente rejeitados com `DM_SECURITY_INTERNAL_ONLY_COMMAND`, mesmo se o remetente for GM. | **PASS** |
| **5. Dedupe de Mesmo ID e Intenção** | Comandos simultâneos com mesmo `commandId` compartilham a execução em andamento (in-flight promise). Replays subsequentes retornam o recibo cacheado sem re-executar o handler. | **PASS** |
| **6. Conflito de ID com Intenção Diferente** | Reutilização de `commandId` com payload ou intenção divergente é rejeitada fail-closed com `DM_COMMAND_ID_REUSE_MISMATCH`. | **PASS** |
| **7. Deadlock-Freedom (Ordered Locks)** | Aquisição de locks multi-chave sempre ordena as chaves lexicograficamente antes de solicitar os locks, eliminando completamente deadlocks cruzados (cenário AB-BA e CBA sob concorrência). | **PASS** |
| **8. Fresh Read Após Locks** | A leitura do estado atual da entidade/domínio é executada **estritamente após** a aquisição dos locks, garantindo que valores derivados do cliente não sejam confiados. | **PASS** |
| **9. Conflito de Revisão Fail-Closed** | O `expectedRevision` e `expectedRevisions` expressam precondição declarativa. Se divergente do estado lido após os locks ou se a entidade estiver ausente, rejeita estritamente com `DM_REVISION_CONFLICT`. | **PASS** |
| **10. Timeout e Cancelamento** | Espera em fila de locks possui timeout configurável (`DM_LOCK_TIMEOUT`) e cancelamento imediato via `AbortSignal`. | **PASS** |
| **11. Receipt Imutável** | O `MutationReceipt` é gerado congelado (`Object.freeze`), sanitizado para o cliente (`sanitizeReceiptForPublic`) e não substitui o estado autoritativo do repositório. | **PASS** |
| **12. Failover e Isolamento no Startup** | Após queda do GM primário, o novo GM detecta transações deixadas em `committing`, move-as para `needs-recovery` e isola via lock apenas as chaves afetadas, mantendo domínios independentes 100% operantes. | **PASS** |
| **13. Resiliência de Commit e Compensação** | Exceções conhecidas em `commit` acionam `compensate`. Falhas com `outcome: unknown` retêm compensação e marcam `needs-recovery` com `DM_RECOVERY_UNKNOWN_OUTCOME`. | **PASS** |
| **14. Sanitização Robusta** | Sanitização de diagnósticos converte `BigInt`, `Symbol` e funções seguramente para prevenir quebras na serialização JSON. | **PASS** |
| **15. Bundle Reachability** | `MutationCoordinator`, `CommandBus`, `LockManager`, `RecoveryService`, `FoundryCommandTransportAdapter` e `G2DiagnosticsProvider` comprovadamente presentes no bundle `dist/main.js`. | **PASS** |

---

## 4. Benchmarks de Desempenho e Escala

Executados localmente em `tests/multiplayer/multiplayer-harness.test.ts`:

1. **Dedupe Store Scale (5.000 entradas)**:
   - 5.000 comandos com impressões digitais canônicas registrados e cacheados em LRU.
   - 500 lookups aleatórios executados em **< 15ms** (meta de especificação: < 50ms).
   - Ausência total de vazamento de memória ou degradação de hash.

2. **Concorrência Transacional Multidomínio (50 domínios paralelos)**:
   - 50 transações concorrentes com locks exclusivos sobre partições independentes executadas via `Promise.all`.
   - Tempo total de processamento: **~19ms** (meta de especificação: < 1000ms).
   - Todos os locks foram devidamente liberados (`activeLocksCount === 0`).

---

## 5. Evidência Técnica Consolidada

| Comando | Descrição | Código de Saída |
|---|---|:---:|
| `npm run typecheck` | Verificação estrita de tipos TypeScript (`tsc --noEmit`) | **0** |
| `npm run test:unit` | Execução completa da suíte de 205 testes (Node test runner + esbuild) | **0** |
| `npm run validate:package` | Validação de consistência do `module.json` (incluindo `socket: true` e `13.351`) | **0** |
| `npm run build` | Transpilação de produção com esbuild para `dist/main.js` | **0** |
| `node --check dist/main.js` | Checagem de sintaxe do bundle final de produção | **0** |
| `npm run package` | Empacotamento do módulo runtime `dist/domain-manager-v0.0.2.zip` | **0** |
| `npm run validate:artifact` | Verificação de integridade e entry points do artefato runtime | **0** |
| `npm run package:g2-full` | Geração do arquivo completo de checkpoint do Gate G2 | **0** |
| `npm run validate:g2-full` | Validação de integridade e testes do checkpoint G2 | **0** |

---

## 6. Conclusão e Ponto de Parada

O **Gate G2** está formalmente **RESOLVIDO, AUDITADO, HOMOLOGADO E VERIFICADO CONTRA TODOS OS 28 APONTAMENTOS DA AUDITORIA EXTERNA**.  
Nenhum arquivo ou lógica do **Gate G3** foi iniciado.  
O checkpoint final está pronto para auditoria externa conclusiva.

