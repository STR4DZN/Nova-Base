# HISTÓRICO — NÃO É ESTADO ATUAL / NÃO EXECUTAR COMO PRÓXIMA AÇÃO
# DOMAIN MANAGER — REGISTRO HISTÓRICO DE MICROTAREFAS DO GATE G2

> [!NOTE]
> Este arquivo contém o registro histórico de execução das microtarefas que construíram o Gate G2.
> Para o estado atual do projeto, consulte [`docs/BUILD_STATE.md`](file:///c:/Users/fusio/Documents/Antigravity/Nova-Base/docs/BUILD_STATE.md).

---

## G2.MT00 — Microtarefa de fundação G2 concluída

- composition root criado em `src/bootstrap/domain-manager-runtime.ts`;
- `src/main.ts` compõe os serviços G1 apenas em `ready`;
- nenhum write ocorre durante composição;
- nenhum transport, CommandBus, mutation ou Authority foi antecipado;
- suíte ampliada: 71/71 PASS;
- `tsc --noEmit`: PASS;
- `dist/main.js` permanece o bundle anterior porque o build oficial esbuild não está disponível neste ambiente.

Relatório: `docs/G2_MT00_COMPOSITION_ROOT_REPORT.md`.

---

## G2.1a — Deterministic Primary Authority election core

Status: `VALIDATED_SOURCE`

Implementado:
- `src/authority/primary-authority-election.ts` define a projeção mínima de usuário usada pela eleição;
- preferred GM ativo vence;
- preferred offline/não-GM cai para fallback;
- fallback considera apenas GMs ativos e ordena explicitamente por `userId`;
- ordem incidental de collection não influencia o resultado;
- ausência de GM elegível retorna `null`;
- IDs vazios são ignorados defensivamente;
- eleição retorna somente `userId`, não objeto de collection, para evitar dependência de identidade/ordem de instância.

Evidência histórica:
- `npm run typecheck`: PASS;
- suíte completa via transpile TypeScript + `node --test`: PASS — 80/80;
- testes novos da eleição: 9/9 PASS;
- `npm run validate:package`: PASS.

Relatório: `docs/G2_MT01_AUTHORITY_ELECTION_REPORT.md`.

---

## G2.1b — Authority epoch + stateful status service

Status: `VALIDATED_SOURCE`

Implementado:
- `src/authority/primary-authority-service.ts` mantém o estado efetivo da Primary Authority sem importar Foundry APIs;
- `getCurrent()`, `isCurrentUser()`, `resolve()` e `onChanged()` seguem o contrato conceitual do Master;
- `getStatus()` expõe `authorityUserId`, `authorityEpoch` e disponibilidade para diagnostics internos;
- o primeiro resolve de uma instância não inicializada estabelece baseline sem fabricar um epoch novo;
- mudanças efetivas posteriores incrementam o epoch exatamente uma vez;
- reordenação da collection, preferred inválido e outros inputs sem mudança efetiva não geram churn;
- refinado em G2.1c: ausência temporária de GM não inventa novo executor/epoch; somente troca real entre executores incrementa o epoch;
- estado inicial pode ser reidratado por adapter futuro;
- overflow de epoch falha de forma atômica antes de alterar authority;
- callbacks podem ser removidos por unsubscribe idempotente.

Evidência histórica:
- `npm run typecheck`: PASS;
- suíte completa via transpile TypeScript + `node --test`: PASS — 94/94;
- testes novos do stateful service: 14/14 PASS.

Relatório: `docs/G2_MT02_AUTHORITY_STATE_REPORT.md`.

---

## G2.1c — Foundry authority adapter + lifecycle + lightweight persistence

Status: `VALIDATED_SOURCE`

Implementado:
- `src/authority/foundry-primary-authority-adapter.ts` liga o core de Authority a `game.users`, `game.user` e `game.settings` por boundary injetável/testável;
- preferred GM vive em world setting oculto `preferredAuthorityUserId`;
- estado técnico `{authorityUserId, authorityEpoch, initialized}` é persistido atomicamente em um único world setting JSON `primaryAuthorityState`;
- settings são registrados em `init`;
- runtime/authority são compostos e resolvidos em `ready`;
- `userConnected` dispara reconciliação de conexão/desconexão;
- apenas o cliente da authority recém-eleita persiste mudanças de state, evitando corrida de writes entre clientes;
- state sync remoto é monotônico e rejeita conflito de identidade no mesmo epoch;
- ausência temporária de GMs retém a última identidade técnica e não cria epoch impossível de persistir;
- retorno do mesmo GM preserva epoch; troca para outro GM incrementa exatamente uma vez;
- `DomainManagerRuntime` agora possui boundary explícita `authority` sem introduzir CommandBus/socket/mutation.

Relatório: `docs/G2_MT03_FOUNDRY_AUTHORITY_ADAPTER_REPORT.md`.

---

## G2.2a — CommandTransport contract + Authenticated Sender Boundary

Status: `VALIDATED_SOURCE`

Implementado:
- `src/commands/command-envelope.ts` define o contrato puro de `DomainCommand`, `CommandId` branded (`cmd_${string}`), validação de envelope fail-closed (`validateCommandEnvelope`), integridade recursiva JSON-safe e estrutura declarativa de `expectedRevision`/`expectedRevisions`;
- `src/commands/command-transport.ts` define a abstração pura `CommandTransport`, `TransportReceipt` com status (`delivered`, `acknowledged`, `executed`, `rejected`, `timed_out`), `TransportInboundContext` e handlers de recebimento;
- `src/commands/authenticated-command-context.ts` define `AuthenticatedCommandContext` e a fábrica de fronteira de segurança `createAuthenticatedCommandContext`;
- `senderUserId` é extraído exclusivamente do transporte e nunca do payload;
- Testes adversariais provam que tentativas de spoofing no payload (`userId`, `claimedUserId`, `senderUserId`, `senderId`, `user.id`) são detectadas e rejeitadas como `DM_SECURITY_SENDER_SPOOFED`;
- Comandos técnicos da autoridade local funcionam com remetente nulo e `OperationSource` apropriado (`tick`, etc.);
- Todos os contratos são estritamente isolados de APIs do Foundry VTT e bibliotecas de socket (socketlib).

Relatório: `docs/G2_MT04_COMMAND_TRANSPORT_AUTHENTICATED_SENDER_REPORT.md`.

---

## G2.2b — Transport adapter / socket boundary abstraction

Status: `VALIDATED_SOURCE`

Implementado:
- `src/commands/in-memory-command-transport.ts` implementa `InMemoryCommandTransport` e `InMemoryTransportHub` para testes unitários, loopback direto de autoridade e simulação determinística de redes multi-cliente com latência, queda de pacotes e desconexão;
- `src/commands/foundry-command-transport-adapter.ts` conecta o core abstrato de transporte às fronteiras de socket e usuário do Foundry VTT;
- Loopback direto de autoridade: quando o cliente local é a autoridade primária, a execução ocorre diretamente no handler local sem custo de serialização de rede.

---

## G2.3 — CommandBus & CommandRegistry (public vs internal handlers)

Status: `VALIDATED_SOURCE`

Implementado:
- `src/commands/command-registry.ts` implementa `CommandRegistry` com suporte a identificadores namespaced (`<namespace>:<action>`), visibilidade explícita (`public` vs `internal`), detecção de colisão (`DM_COMMAND_REGISTRY_COLLISION`) e congelamento imutável (`DM_COMMAND_REGISTRY_FROZEN`);
- `src/commands/command-bus.ts` implementa o pipeline central de despacho de comandos na Primary Authority conforme Master §11.2, §11.4 e DEC-541–572;
- Validação runtime de envelope fail-closed antes da resolução de handlers;
- Estabelecimento seguro de contexto autenticado (`AuthenticatedCommandContext`) com detecção adversarial de spoofing de remetente no payload (`DM_SECURITY_SENDER_SPOOFED`);
- Fronteira estrita de segurança: comandos marcados como `internal` são terminantemente rejeitados (`DM_SECURITY_INTERNAL_ONLY_COMMAND`) quando invocados via transporte remoto/socket, mesmo que o remetente seja GM;
- Execução local técnica via `executeLocal` para automações de sistema, ticks e migrações;
- Formatação de recibo canônico `TransportReceipt` com status estruturados (`executed`, `rejected`) e isolamento de exceções inesperadas de handlers (`DM_COMMAND_EXECUTION_FAILED`).

---

## G2.4 — Validation / Permission / Rate Limiting pipeline

Status: `VALIDATED_SOURCE`

Implementado:
- `src/commands/rate-limiter.ts` implementa `RateLimiter` com janelas deslizantes configuráveis por usuário e por tipo de comando, prevenindo flood, abusos acidentais e loops infinitos de automações (Master §11.2, DEC-787–793);
- `src/commands/command-registry.ts` estendido com tipagem e suporte para `schemaValidator` e `permissionValidator` por handler;
- `src/commands/command-bus.ts` integra a esteira de validação em ordem estrita.

---

## G2.5 — In-memory Dedupe Store & Command Status Tracking

Status: `VALIDATED_SOURCE`

Implementado:
- `src/commands/command-dedupe-store.ts` implementa serialização canônica (`canonicalJsonStringify`), cálculo determinístico de fingerprint de intenção de comando (`computeCommandFingerprint`) e `CommandDedupeStore` em memória com controle LRU e retenção TTL (Master §11.2, §11.3, DEC-593–602);
- Idempotência de replay: reenvio de mesmo `commandId` com mesma intenção retorna recibo anterior em cache sem reexecutar o handler;
- Detecção adversarial e de conflito: mesmo `commandId` reutilizado com payload ou intenção divergente é rejeitado com erro específico `DM_COMMAND_ID_REUSE_MISMATCH` (categoria `conflict`);
- Coordenação de concorrência: requisições simultâneas em trânsito para o mesmo `commandId` compartilham a execução em andamento (`inFlightPromise`).

---

## G2.6 — LockManager with ordered multi-key acquisition & cancellation

Status: `VALIDATED_SOURCE`

Implementado:
- `src/mutations/lock-manager.ts` implementa `LockManager` com aquisição de locks multi-chave ordenados determinísticamente via ordenação lexical canônica (`canonicalizeLockKeys`), eliminando deadlocks clássicos AB-BA (Master §11.5, DEC-603–620);
- Execução paralela: lock sets independentes operam de forma concorrente;
- Reentrância segura: mesmo `ownerId` pode adquirir chaves reentrantes de operações aninhadas sem deadlock;
- Timeout watchdog: requisições aguardando locks expiram com `DM_LOCK_TIMEOUT` sem deixar locks corrompidos;
- Cancelamento de fila: suporte a cancelamento via `AbortSignal` (`DM_COMMAND_CANCELLED`).

---

## G2.7 — Plan & Receipt contracts (preview vs confirm separation)

Status: `VALIDATED_SOURCE`

Implementado:
- `src/mutations/plans/plan-contract.ts` implementa `MutationPlan`, cálculo de fingerprint, detecção de bloqueios (`isExecutable`), sanitização pública (`sanitizePlanForPublic`) e detecção de drift material (`isPlanMateriallyChanged`);
- `src/mutations/receipt-contract.ts` implementa `MutationReceipt` imutável, status canônicos, detecção de no-op e sanitização de recibos.

---

## G2.8 — MutationCoordinator no escopo G2 (fresh read após locks + revision check)

Status: `VALIDATED_SOURCE`

Implementado:
- `src/mutations/mutation-coordinator.ts` conecta planejamento, aquisição de locks, fresh reads estritamente após locks, validação de `expectedRevision` e `expectedRevisions`, validação de bloqueios de plano e commit atômico;
- Garantia de fresh read após locks;
- Rejeição de stale revision com `DM_REVISION_CONFLICT`;
- Bloqueio com `DM_PLAN_BLOCKED`;
- Liberação garantida de locks em todos os fluxos (`finally`).

---

## G2.9 — Transaction / Recovery shell

Status: `VALIDATED_SOURCE`

Implementado:
- `src/mutations/transaction-record.ts` implementa o ciclo normativo estrito: `planned -> claimed -> prepared -> committing -> committed`, com ramificações controladas;
- `src/mutations/transaction-store.ts` implementa armazenamento indexado em memória e listagem de pendências;
- `src/mutations/recovery-service.ts` implementa `scanOnStartup` promovendo transações incompletas para `needs-recovery` com isolamento de locks e `recoverTransaction` idempotente.

---

## G2.10 — Multiplayer harness, failover acceptance & final G2 verification

Status: `VALIDATED_SOURCE`

Implementado:
- `tests/multiplayer/multiplayer-harness.test.ts` conecta múltiplos nós com papéis de GM preferido, fallback e players;
- Verificação de failover, in-flight dedupe, anti-spoofing, isolamento de chaves e benchmarks de escala.
