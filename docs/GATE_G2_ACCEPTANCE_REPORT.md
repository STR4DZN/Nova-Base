# RELATÓRIO DE ACEITAÇÃO FORMAL — GATE G2
## Authority / Commands / MutationCoordinator (Pós-Resolução da Auditoria Externa)

> **Módulo:** `domain-manager`  
> **Versão:** `0.0.2`  
> **Data:** `2026-09-17`  
> **Autoridade Normativa:** `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md` (§11–12, §6–7, §47–49)  
> **Status de Conclusão:** `GATE_G2_ACCEPTED_AND_HOMOLOGATED` (233/233 testes verdes / 0 falhas / 0 regressões / In-World Foundry v13.351 + Socketlib PASS)

---

## 1. Sumário Executivo

O **Gate G2 — Authority / Commands / MutationCoordinator** foi implementado na íntegra através de 10 microtarefas normativas sequenciais (`G2.1a → G2.10`), submetido a auditoria de segurança inicial, e posteriormente submetido à auditoria externa e revalidações pós-correção detalhadas nos documentos `G2_EXTERNAL_AUDIT_ERRORS_FOR_ANTIGRAVITY.md`, `G2_REVALIDACAO_POS_CORRECOES_RESTANTES.md` e `G2_REVALIDACAO_FINAL_CICLO_2.md` contendo 28 apontamentos originais (`G2-AUD-001` a `G2-AUD-028`), 7 itens de refino do Ciclo 2, e a remoção definitiva do fallback por socket nativo não-autenticado.

Todos os apontamentos foram rigorosamente analisados, corrigidos, verificados via testes direcionados e adversariais (incluindo `tests/commands/revalidation-adversarial.test.ts`, `tests/commands/socketlib-upstream-real.test.ts`, `tests/commands/foundry-command-transport-socketlib-only.test.ts` e `tests/docs/build-state-validator.test.ts`), e comprovados no bundle de produção (`dist/main.js`). A suíte de testes agora totaliza **233 testes automatizados**, todos aprovados sem exceção.

Conforme a arquitetura normativa do Master Specification (§11–12, §47–49) e o playbook do Gate G2:
- O G2.9 implementa o **Transaction/Recovery shell** (estados de transação, isolamento de chaves afetadas via lock, transição determinística para `needs-recovery` com outcome `unknown`), sem fingir persistência distribuída durável entre reinicializações arbitrárias antes de G10/G11.
- Nenhum código ou escopo pertencente ao Gate G3 (Domain Lifecycle & State Machine) foi antecipado.

---

## 2. Resolução dos 28 Apontamentos da Auditoria Externa e Revalidação (G2-AUD-001 a G2-AUD-028)

| Item | Área | Severidade | Resolução Implementada | Evidência de Teste |
|---|---|---|---|---|
| **G2-AUD-001** | Production Wiring | BLOCKER | Wires `CommandBus`, `MutationCoordinator`, `LockManager`, `RecoveryService`, `CommandQueue`, `FoundryCommandTransportAdapter`, e `G2DiagnosticsProvider` no `DomainManagerRuntime` e `main.ts`. Reachable no bundle `dist/main.js`. | `tests/core/main-bootstrap.test.ts`, `node --check dist/main.js` |
| **G2-AUD-002** | Transport Security | BLOCKER | Extração de remetente autenticado a partir do contexto seguro do transporte (Socketlib / metadata de socket). Falha closed com `DM_AUTH_UNAUTHENTICATED` se não verificado; rejeita com `DM_SECURITY_SENDER_SPOOFED` se player-1 declarar player-2 ou alegar autoridade; rejeita com `DM_SECURITY_SENDER_UNKNOWN` se usuário for inexistente ou desconectado. | `tests/commands/revalidation-adversarial.test.ts` |
| **G2-AUD-003** | Transport Security | HIGH | Proteção contra respostas forjadas. Requisições pendentes só aceitam respostas autenticadas vindas estritamente da Primary Authority ativa com matching epoch (`#handleResponsePacket` valida remetente contra `authorityUserId`). Respostas forjadas broadcast por outros clientes são descartadas. | `tests/commands/revalidation-adversarial.test.ts` |
| **G2-AUD-004** | Transport Topology | HIGH | RPC dirigido via Socketlib (`executeAsUser` para `authorityUserId`) substituindo broadcast-first de mutations. Declara `socketlib` como dependência obrigatória em `module.json` (`relationships.requires`). Clientes secundários não recebem o payload de mutation. | `tests/commands/revalidation-adversarial.test.ts` |
| **G2-AUD-005** | Authority Guard | BLOCKER | `executeLocal()` e `dispatchInbound()` rejeitam com `DM_AUTHORITY_NOT_LOCAL` se o cliente corrente não for a autoridade resolvida (`isCurrentUser()`). | `tests/commands/command-bus.test.ts` |
| **G2-AUD-006** | Provenance | MEDIUM | `executeLocal()` preserva e propaga a proveniência real (`operationSource`: user, tick, project, event, migration, system) sem substituição cega por `system`. | `tests/commands/command-bus.test.ts` |
| **G2-AUD-007** | Transactional Enforcement | BLOCKER | `CommandRegistry.register` com `transactional: true` exige obrigatoriamente `mutationDefinition` ou wrapper `createTransactionalHandler`. `CommandBus` direciona estritamente via `MutationCoordinator`. | `tests/commands/registry.test.ts`, `tests/commands/command-bus.test.ts` |
| **G2-AUD-008** | Storage Boundary | HIGH | `runtime.domains` exposto fisicamente como uma facade congelada (`Object.freeze({ read, load, query, checkIntegrity, getIndex })`), com índice também read-only. Mutadores (`create`, `save`, `update`, `archive`, `restore`, `reparent`, `rebuildIndex`) não existem no objeto em runtime. | `tests/core/runtime-composition.test.ts` |
| **G2-AUD-009** | Consistency | HIGH | Ausência de revisão em `freshState` quando `expectedRevision` é declarado falha closed com `DM_REVISION_CONFLICT`. | `tests/mutations/mutation-coordinator-adversarial.test.ts` |
| **G2-AUD-010** | Consistency | HIGH | Entidade declarada em `expectedRevisions` ausente em `freshState.entityRevisions` falha closed com `DM_REVISION_CONFLICT`. | `tests/mutations/mutation-coordinator-adversarial.test.ts` |
| **G2-AUD-011** | Recovery | BLOCKER | Transação não-resolvida sem compensador disponível permanece em `needs-recovery` com `DM_RECOVERY_COMPENSATION_UNAVAILABLE`; nunca transiciona para `compensated`. | `tests/mutations/transaction-and-recovery.test.ts` |
| **G2-AUD-012** | Recovery / Commit | BLOCKER | Introduzido `CommitOutcome` (`committed`, `failed-known-safe`, `unknown`). Erro com outcome `unknown` retém compensação automática para não corromper estado e retorna `DM_RECOVERY_UNKNOWN_OUTCOME`. | `tests/mutations/mutation-coordinator-adversarial.test.ts` |
| **G2-AUD-013** | Recovery Scope | HIGH | Escopo de persistência e recuperação devidamente documentado: G2.9 implementa o Transaction/Recovery shell (estados formais, trava de chaves afetadas, varredura no startup da autoridade); a persistência distribuída e recuperação distribuída em rede entre sessões pertence ao Gate G10/G11. | `docs/GATE_G2_ACCEPTANCE_REPORT.md`, `docs/BUILD_STATE.md` |
| **G2-AUD-014** | Observability | MEDIUM | Consulta remota de status autoritativo via `CommandTransport.getStatus(commandId)` e `CommandBus.queryCommandStatus(commandId)` lendo do dedupe store, fila e transação. Reenvio pós-timeout com mesmo `commandId` retorna recibo sem duplicar escritas. | `tests/commands/revalidation-adversarial.test.ts` |
| **G2-AUD-015** | Concurrency / Queue | HIGH | `CommandQueue` transformado em scheduler real com controle de concorrência (`acquirePermit`/`releasePermit`), fila estrita FIFO, prioridade derivada internamente por política do sistema (imune a controle do cliente), e cancelamento em fila que acorda imediatamente o próximo waiter sem executar o handler. | `tests/commands/revalidation-adversarial.test.ts` |
| **G2-AUD-016** | Lock Liveness | HIGH | `LockManager.removeFromQueues` desobstrui imediatamente o próximo waiter quando o primeiro aborta ou expira por timeout, garantindo vivacidade sem requisições externas. | `tests/mutations/lock-manager.test.ts` |
| **G2-AUD-017** | Immutability | HIGH | `deepCloneAndFreeze` clona e congela profundamente `writeSet` (payloads) e `customData`. Suporte a operação `"restore"` no tipo `PlanOperationType`. | `tests/mutations/plan-and-receipt.test.ts` |
| **G2-AUD-018** | Security Sanitization | HIGH | Boundary único de sanitização de saída pública em `CommandBus.dispatchInbound` e no adapter de transporte remoto via `sanitizeTransportReceiptForPublic`. Sanitiza profundamente `result` e `error.details` redigindo `token`, `secret`, `password`, `apiKey`, `credential`, `authorization`. | `tests/commands/revalidation-adversarial.test.ts` |
| **G2-AUD-019** | JSON Safety | HIGH | `checkPayloadJsonSafe` rejeita defensivamente propriedades `undefined` em qualquer profundidade. | `tests/commands/envelope-and-receipt-adversarial.test.ts` |
| **G2-AUD-020** | Payload Budgets | MEDIUM/HIGH | Limites defensivos estritos em envelopes: 64KB de tamanho serializado, profundidade máxima 16, 500 chaves de objeto e 1000 itens de array. | `tests/commands/envelope-and-receipt-adversarial.test.ts` |
| **G2-AUD-021** | Dedupe Fingerprint | MEDIUM/HIGH | Fingerprint canônico inclui `targetRefs` ordenados lexicograficamente na assinatura de intenção. | `tests/commands/command-dedupe-store.test.ts` |
| **G2-AUD-022** | Checkpoint Gate | HIGH | `scripts/validate-g2-full.mjs` valida integridade do pacote ZIP, reachability no bundle `dist/main.js`, manifesto v13.351, typecheck e execução de todos os testes. | `scripts/validate-g2-full.mjs` |
| **G2-AUD-023** | Truth in Reporting | HIGH | Relatório de aceitação e build state atualizados com rigor factual absoluto, detalhando as correções da revalidação e a delimitação correta do shell de transação/recovery. | `docs/GATE_G2_ACCEPTANCE_REPORT.md`, `docs/BUILD_STATE.md` |
| **G2-AUD-024** | Composite Diagnostics | HIGH | Criado `G2DiagnosticsProvider`, gerando snapshot composto de autoridade, epoch, locks ativos, fila, dedupe, recuperação, abuso e transporte. | `tests/diagnostics/diagnostics-snapshot.test.ts` |
| **G2-AUD-025** | Revision Falsiness | LOW/MEDIUM | Comparações de revisão em `MutationCoordinator` usam testes explícitos `!== undefined && !== null`, impedindo que revisão 0 seja tratada como falsy. | `tests/mutations/mutation-coordinator.test.ts` |
| **G2-AUD-026** | Transport Cleanup | MEDIUM | `attachTransport` no `CommandBus` utiliza rastreamento independente em `Set`, garantindo que desmontar um transporte não afete outros listeners. | `tests/commands/command-bus.test.ts` |
| **G2-AUD-027** | Correlation Collision | MEDIUM | `FoundryCommandTransportAdapter` rejeita chamadas concorrentes com mesmo `correlationId` com `DM_TRANSPORT_CORRELATION_COLLISION`. | `tests/commands/foundry-command-transport-adapter.test.ts` |
| **G2-AUD-028** | Spam Hardening | MEDIUM | Rate limiting pré-validação (`checkPreValidationLimit`) por remetente autenticado bloqueia spam de envelopes inválidos/comandos desconhecidos antes de qualquer processamento caro e registra incidentes de abuso nos diagnósticos (`G2DiagnosticsProvider`). | `tests/commands/revalidation-adversarial.test.ts` |

---

## 2.1. Ciclo 2 de Revalidação Final (G2-AUD-002, G2-AUD-015, Scheduler, Concorrência e Metadados)

| Item Ciclo 2 | Área | Severidade | Resolução Implementada | Evidência de Teste |
|---|---|---|---|---|
| **C2-AUD-002** | Socketlib Real Sender Auth | BLOCKER | Removido `transportSession` passado pelo chamador em `executeAsUser`. O adapter registra handlers com `function(this: SocketlibContext, ...)` e extrai remetente estritamente de `this.socketdata.userId`. Validação comprovada contra o código real do upstream `socketlib.js` (v1.1.3+) e script de smoke test para Foundry v13.351. Chamadas sem contexto ou com spoofing falham closed. | `tests/commands/socketlib-upstream-real.test.ts`, `tests/commands/revalidation-adversarial.test.ts` |
| **C2-AUD-015a** | CommandQueue State Accounting | HIGH | Corrigido erro onde `releasePermit` marcava todas as execuções como `failed`. `CommandBus` agora chama `markFinished(commandId, isSuccess)` explicitamente antes de liberar o permit, contabilizando `completedCount` e `failedCount` com precisão. | `tests/commands/revalidation-adversarial.test.ts` |
| **C2-AUD-015b** | Eliminação de Phantom Queued Entries | HIGH | `commandQueue.enqueue` movido para logo antes de `acquirePermit` (Passo 11 do CommandBus). Rejeições de schema, permissionamento ou dedupe conflict não deixam entradas "fantasmas" em estado `queued`. | `tests/commands/revalidation-adversarial.test.ts` |
| **C2-CONCURRENCY** | Concorrência Global para 10 Players | HIGH | `CommandQueue` ajustado com `DEFAULT_COMMAND_QUEUE_CONCURRENCY = 10` (em vez de 1). Comandos de até 10 jogadores em domínios independentes executam em paralelo real (`maxActive > 1`), enquanto `LockManager` serializa conflitos no mesmo domínio. Testado adversariamente sob alta carga: cancelamentos e timeouts de lock não retêm nem travam permits ou locks (`permitsHeld === 0`, `activeLocks === 0`). | `tests/commands/revalidation-adversarial.test.ts` |
| **C2-HANDOFF** | Sincronização do ANTIGRAVITY_HANDOFF.md | HIGH | `ANTIGRAVITY_HANDOFF.md` totalmente reescrito: estabelece G0, G1 e G2 concluídos, define Gate G3 como o próximo gate, e remove referências a microtarefas preliminares e contagens de teste obsoletas. | `tests/commands/revalidation-adversarial.test.ts` |
| **C2-MODULE** | Metadados Socketlib Foundry v13 | MEDIUM | `module.json` atualizado com compatibilidade para Socketlib `minimum: 1.1.3` e `verified: 1.1.4` (suportando Foundry v13.351+ e v14), além de confirmar `socket: true` no manifesto. | `scripts/validate-package.mjs`, `scripts/validate-g2-full.mjs` |
| **C2-RECOVERY** | Delimitação Honesta de Persistência | HIGH | Documentação formal e honesta de que G2 implementa o shell transacional em memória e o escaneamento de isolamento no startup, enquanto recuperação distribuída durável entre reinicializações pertence a G10/G11. | `docs/GATE_G2_ACCEPTANCE_REPORT.md`, `docs/BUILD_STATE.md` |

---

## 2.2. Resolução do Blocker de Transporte e Limpeza de Documentação

| Item | Área | Severidade | Resolução Implementada | Evidência de Teste |
|---|---|---|---|---|
| **TRANSPORT-BLOCKER** | Transport Security | BLOCKER | **Eliminação completa do fallback via socket nativo (`game.socket`) para mutations e status queries.** O `FoundryCommandTransportAdapter` removeu todos os métodos e handlers de envio/recebimento de comandos via socket broadcast nativo (`#sendRemoteSocket`, `#sendStatusQuerySocket`, `#handleSocketPacket`, etc.). Remote clients sem Socketlib disponível falham closed imediatamente com `DM_TRANSPORT_UNAVAILABLE`. O canal de socket nativo (`module.domain-manager`) não registra listeners de comando (`DM_CMD_*`), ignorando silenciosamente qualquer tentativa de bypass. | `tests/commands/foundry-command-transport-socketlib-only.test.ts` (Testes A, B, C, D) |
| **DOCS-CLEANUP** | Document Governance | MEDIUM | **Canonicalização de `docs/BUILD_STATE.md` e arquivamento de microtarefas.** `docs/BUILD_STATE.md` foi convertido em um snapshot limpo sem baselines obsoletos parciais ou seções conflitantes. O histórico das microtarefas `G2.1a → G2.10` foi preservado em `docs/history/G2_BUILD_HISTORY.md`. Um validador automatizado garante a integridade contínua do documento. | `tests/docs/build-state-validator.test.ts` |

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
| `npm run test:unit` | Execução completa da suíte de 233 testes (Node test runner + esbuild) | **0** |
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
A homologação in-world no Foundry VTT v13.351 com Socketlib 1.1.4 foi executada com 100% de aprovação em todos os checks normativos (`scripts/foundry-v13-socketlib-smoke-test.js`), confirmando:
- Contrato canônico v1 (`contractVersion: 1`, `cmd_<UUID>`);
- Pipeline real do CommandBus e MutationCoordinator executando sem falhas (`domain:restore` retornando `DM_DOMAIN_NOT_FOUND` de forma limpa e sem efeitos colaterais);
- Chamadas não-autenticadas falhando closed com `DM_AUTH_UNAUTHENTICATED`;
- Tentativas de spoofing de remetente ou de autoridade primária rejeitadas com `DM_SECURITY_SENDER_SPOOFED`;
- Extração autoritativa de remetente exclusivamente via `this.socketdata.userId`.

Com a aceitação e homologação externa do Gate G2 plenamente concluída, o **Gate G3 (Domain Lifecycle & State Machine / People)** está formalmente autorizado para planejamento e início.


