# DOMAIN MANAGER — BUILD STATE

## Identidade

- Module version: `0.0.2`
- Gate de código atual: `G2 — Authority / Commands / MutationCoordinator (COMPLETO, AUDITADO E RESOLVIDO)`
- Estado local: `GATE_G2_ACCEPTED_EXTERNAL_AUDIT_RESOLVED`
- Estado externo: `READY_FOR_EXTERNAL_AUDIT_AND_FOUNDRY_SMOKE`
- Schema Domain: `1`
- Data da auditoria / fechamento: `2026-09-17`

## Estado canônico

G0, G1 e G2 possuem implementação local 100% verificada, auditada e verde (228/228 testes aprovados). A auditoria externa e as revalidações pós-correções detalhadas em `G2_EXTERNAL_AUDIT_ERRORS_FOR_ANTIGRAVITY.md`, `G2_REVALIDACAO_POS_CORRECOES_RESTANTES.md` e `G2_REVALIDACAO_FINAL_CICLO_2.md` (28 apontamentos G2-AUD-001 a G2-AUD-028, mais os refinamentos do Ciclo 2: autenticação estrita de remetente Socketlib via `this.socketdata.userId` validada contra código upstream de Socketlib e script de smoke test para Foundry v13.351, contabilização exata de status da CommandQueue, eliminação de phantom queued entries, concorrência real para 10 players sem vazamento de permits/locks sob cancelamento/timeout, handoff sincronizado, compatibilidade Socketlib 1.1.3/1.1.4 com socket: true e delimitação de recuperação em memória vs G10/G11) foram plenamente resolvidas e comprovadas via testes unitários, adversariais e reachability no bundle de produção (`dist/main.js`). O smoke real de instalação/boot no Foundry VTT v13.351+ em world ativo continua sendo a condição externa de homologação antes de produção. O escopo do Gate G2 está rigorosamente concluído, sem antecipação de código do Gate G3.

## G1 implementado

- schema/validators canônicos de Domain;
- JournalEntry name como única verdade do nome;
- codec em `flags.domain-manager`;
- production boundary `FoundryDomainDocumentStore` para `game.journal`/`JournalEntry.create`;
- DomainRepository create/read/query/save/update/archive/restore/reparent;
- revision otimista e no-op;
- hierarchy por UUID Foundry completo e cycle prevention;
- capability shell/effective resolution;
- índice rebuildable + incremental, incluindo UUID;
- integrity checker read-only;
- migration seed v1;
- runtime package + full checkpoint scripts.

## Correções da auditoria de G1

1. parent refs migrados de local ID para full Foundry UUID;
2. save/update agora não conseguem burlar cycle/reparent validation;
3. query usa índice após lazy rebuild inicial;
4. deep validator não lança por payload malformado;
5. canonicalização de aliases/tags/technical IDs aplicada na persistence boundary;
6. índice passa a armazenar UUID canonical;
7. production Foundry store criado;
8. ordinary JournalEntries sem Domain flag são ignorados;
9. closeout documental consolidado;
10. full-checkpoint validator fortalecido.

Detalhes completos: `docs/G1_AUDIT_FIX_REPORT.md`.

## Evidência local Gate G2 (Pós-Resolução da Auditoria Externa e Revalidação)

| Verificação | Resultado |
|---|---|
| TypeScript strict (`npm.cmd run typecheck`) | PASS |
| Testes unitários e integração (`node tests/run-tests.mjs`) | PASS — 228/228 (0 falhas) |
| Manifest/package validation (`node scripts/validate-package.mjs`) | PASS |
| Runtime ZIP generation (`node scripts/package.mjs`) | PASS |
| Runtime artifact validation (`node scripts/validate-artifact.mjs`) | PASS |
| Full Gate G2 checkpoint generation (`node scripts/package-checkpoint.mjs`) | PASS |
| Full Gate G2 checkpoint validation (`node scripts/validate-g2-full.mjs`) | PASS |
| `node --check dist/main.js` | PASS |

A suíte completa foi executada com o runner nativo e esbuild bundle no ambiente local Node.js v24.20.0 / Windows; 100% dos testes e verificações passaram.

## Pendência externa

1. instalar o runtime ZIP no Foundry VTT v13.351+;
2. ativar em world vazio;
3. confirmar logs `init` e `ready`;
4. confirmar ausência de erro crítico no console;
5. registrar a evidência de smoke.

## Microtarefa de fundação G2 concluída

- composition root criado em `src/bootstrap/domain-manager-runtime.ts`;
- `src/main.ts` compõe os serviços G1 apenas em `ready`;
- nenhum write ocorre durante composição;
- nenhum transport, CommandBus, mutation ou Authority foi antecipado;
- suíte ampliada: 71/71 PASS;
- `tsc --noEmit`: PASS;
- `dist/main.js` permanece o bundle anterior porque o build oficial esbuild não está disponível neste ambiente.

Relatório: `docs/G2_MT00_COMPOSITION_ROOT_REPORT.md`.

## Próxima ação

Implementar `G2.1 — Primary Authority election/status` em microtarefas pequenas, mantendo transport/socket, CommandBus, dedupe e locks fora do escopo até seus microbuilds donos.

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

Evidência:
- `npm run typecheck`: PASS;
- suíte completa via transpile TypeScript + `node --test`: PASS — 80/80;
- testes novos da eleição: 9/9 PASS;
- `npm run validate:package`: PASS;
- `npm run test:unit`: não executável neste ambiente por ausência local de `esbuild`; nenhum resultado nativo foi inventado.

Não implementado nesta microtarefa:
- persistence de preferred GM;
- authority epoch;
- callbacks/status stateful;
- Foundry settings/users adapter;
- lifecycle `ready`/conexão/desconexão;
- transport/socket, CommandBus, dedupe, locks ou mutations.

Relatório: `docs/G2_MT01_AUTHORITY_ELECTION_REPORT.md`.

## Próxima ação G2

Implementar `G2.1b — Authority epoch + stateful status service`, consumindo a eleição pura desta microtarefa. A próxima parte não deve ainda importar socketlib, CommandBus ou MutationCoordinator.


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

Evidência:
- `npm run typecheck`: PASS;
- suíte completa via transpile TypeScript + `node --test`: PASS — 94/94;
- testes novos do stateful service: 14/14 PASS;
- `npm run validate:package`: PASS;
- `npm run test:unit`: ainda não executável neste ambiente por ausência local de `esbuild`; nenhum resultado nativo foi inventado.

Não implementado nesta microtarefa:
- world settings para preferred GM/epoch;
- adapter de `game.users`/`game.user`;
- listeners de conexão/desconexão e lifecycle Foundry;
- socket/transport;
- CommandBus, dedupe, locks, mutations ou recovery.

Relatório: `docs/G2_MT02_AUTHORITY_STATE_REPORT.md`.

## Próxima ação G2

G2.1c concluída e validada. Próxima ação: iniciar `G2.2a — CommandTransport contract + authenticated sender boundary`, sem socketlib concreto ainda.


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

Correção arquitetural descoberta nesta microtarefa:
- a semântica anterior de G2.1b incrementava epoch ao entrar/sair de um período sem GM. Isso podia gerar drift local em players porque nenhum GM estava presente para persistir o epoch intermediário. G2.1c corrige o modelo: `authorityUserId` guarda o último executor eleito enquanto indisponível; `available` deriva do snapshot atual de users; epoch só avança quando o executor real muda.

Evidência:
- `npm run typecheck`: PASS;
- testes Authority direcionados via transpile TypeScript + `node --test`: PASS — 37/37;
- suíte completa via transpile TypeScript + `node --test`: PASS — 108/108;
- `npm run validate:package`: PASS;
- `npm run test:unit`: não executável neste ambiente por ausência local de `esbuild`; nenhum resultado nativo foi inventado.

Não implementado nesta microtarefa:
- CommandTransport/socket/socketlib;
- AuthenticatedCommandContext;
- CommandBus/registry;
- dedupe/rate limit;
- locks;
- MutationCoordinator/Plan/Receipt/recovery.

Relatório: `docs/G2_MT03_FOUNDRY_AUTHORITY_ADAPTER_REPORT.md`.

## Próxima ação G2

G2.1c concluída e validada. Próxima ação: iniciar `G2.2a — CommandTransport contract + authenticated sender boundary`, sem socketlib concreto ainda.


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

Evidência:
- `npm run typecheck`: PASS;
- `npm run test:unit`: PASS — 132/132 (24 novos testes direcionados e adversariais para G2.2a);
- `npm run validate:package`: PASS;
- `npm run build`: PASS;
- `node --check dist/main.js`: PASS;
- `npm run package` e `npm run validate:artifact`: PASS.

Não implementado nesta microtarefa:
- Escolha definitiva de socketlib vs native socket;
- Implementação de adapter concreto de transporte Foundry;
- CommandBus e command registry;
- Dedupe store e rate limiter;
- LockManager e MutationCoordinator;
- TransactionStore e recovery.

Relatório: `docs/G2_MT04_COMMAND_TRANSPORT_AUTHENTICATED_SENDER_REPORT.md`.

## Próxima ação G2

G2.2b implementada e validada. Próxima ação: `G2.3 — CommandBus & CommandRegistry (public vs internal handlers)`.


## G2.2b — Transport adapter / socket boundary abstraction

Status: `VALIDATED_SOURCE`

Implementado:
- `src/commands/in-memory-command-transport.ts` implementa `InMemoryCommandTransport` e `InMemoryTransportHub` para testes unitários, loopback direto de autoridade e simulação determinística de redes multi-cliente com latência, queda de pacotes e desconexão;
- `src/commands/foundry-command-transport-adapter.ts` implementa `FoundryCommandTransportAdapter` sobre o canal `"module.domain-manager"`, conectando o core abstrato de transporte às fronteiras reais de socket e usuário do Foundry VTT;
- Loopback direto de autoridade: quando o cliente local é a autoridade primária, a execução ocorre diretamente no handler local sem custo de serialização de rede;
- Roteamento remoto de cliente para autoridade primária via mensagens de socket estruturadas com correlação (`DM_CMD_REQUEST` / `DM_CMD_RESPONSE`);
- Falha fechada estruturada (`DM_AUTHORITY_UNAVAILABLE`) quando nenhuma autoridade está disponível;
- Tratamento de timeout configurável (`DM_TRANSPORT_TIMEOUT`) e aborto de conexões pendentes na destruição (`DM_TRANSPORT_ABORTED`);
- Rejeição de remetente não autenticado (`DM_AUTH_UNAUTHENTICATED`).

Evidência:
- `npm run typecheck`: PASS;
- `npm run test:unit`: PASS — 142/142 (10 novos testes para G2.2b);
- `npm run validate:package`: PASS;
- `npm run build`: PASS;
- `node --check dist/main.js`: PASS.

Não implementado nesta microtarefa:
- CommandBus e command registry;
- Dedupe store e rate limiter;
- LockManager e MutationCoordinator;
- TransactionStore e recovery.

## G2.3 — CommandBus & CommandRegistry (public vs internal handlers)

Status: `VALIDATED_SOURCE`

Implementado:
- `src/commands/command-registry.ts` implementa `CommandRegistry` com suporte a identificadores namespaced (`<namespace>:<action>`), visibilidade explícita (`public` vs `internal`), detecção de colisão (`DM_COMMAND_REGISTRY_COLLISION`) e congelamento imutável (`DM_COMMAND_REGISTRY_FROZEN`);
- `src/commands/command-bus.ts` implementa o pipeline central de despacho de comandos na Primary Authority conforme Master §11.2, §11.4 e DEC-541–572;
- Validação runtime de envelope fail-closed antes da resolução de handlers;
- Estabelecimento seguro de contexto autenticado (`AuthenticatedCommandContext`) com detecção adversarial de spoofing de remetente no payload (`DM_SECURITY_SENDER_SPOOFED`);
- **Fronteira estrita de segurança**: comandos marcados como `internal` são terminantemente rejeitados (`DM_SECURITY_INTERNAL_ONLY_COMMAND`) quando invocados via transporte remoto/socket, mesmo que o remetente seja GM;
- Execução local técnica via `executeLocal` para automações de sistema, ticks e migrações;
- Formatação de recibo canônico `TransportReceipt` com status estruturados (`executed`, `rejected`) e isolamento de exceções inesperadas de handlers (`DM_COMMAND_EXECUTION_FAILED`).

Evidência:
- `npm run typecheck`: PASS;
- `npm run test:unit`: PASS — 150/150 (8 novos testes para G2.3, incluindo testes adversariais);
- `npm run validate:package`: PASS;
- `npm run build`: PASS;
- `node --check dist/main.js`: PASS.

Não implementado nesta microtarefa:
- Runtime command payload schema validation e rate limiter (G2.4);
- Dedupe store e command status tracking (G2.5);
- LockManager e ordered multi-key locks (G2.6);
- MutationCoordinator e TransactionStore (G2.7–G2.9).

## G2.4 — Validation / Permission / Rate Limiting pipeline

Status: `VALIDATED_SOURCE`

Implementado:
- `src/commands/rate-limiter.ts` implementa `RateLimiter` com janelas deslizantes configuráveis por usuário e por tipo de comando, prevenindo flood, abusos acidentais e loops infinitos de automações (Master §11.2, DEC-787–793);
- `src/commands/command-registry.ts` estendido com tipagem e suporte para `schemaValidator` e `permissionValidator` por handler;
- `src/commands/command-bus.ts` integra a esteira de validação em ordem estrita:
  1. Validação de envelope;
  2. Status da autoridade;
  3. Contexto autenticado;
  4. Lookup no registry;
  5. Boundary de visibilidade pública vs interna;
  6. Rate limiting defensivo (`DM_RATE_LIMIT_EXCEEDED`, categoria `busy`);
  7. Validação runtime de schema do payload (`schemaValidator`), retornando categoria `validation` e abortando antes de checagens de permissão ou handler;
  8. Validação de permissões em runtime (`permissionValidator`), retornando categoria `permission` (`DM_PERMISSION_DENIED`) e abortando antes do handler;
  9. Execução isolada do handler.

Evidência:
- `npm run typecheck`: PASS;
- `npm run test:unit`: PASS — 154/154 (4 novos testes para G2.4);
- `npm run validate:package`: PASS;
- `npm run build`: PASS;
- `node --check dist/main.js`: PASS.

Não implementado nesta microtarefa:
- Dedupe store em memória e tracking de command status (G2.5);
- LockManager com locks multi-chave ordenados (G2.6);
- MutationCoordinator e TransactionStore (G2.7–G2.9).

## G2.5 — In-memory Dedupe Store & Command Status Tracking

Status: `VALIDATED_SOURCE`

Implementado:
- `src/commands/command-dedupe-store.ts` implementa serialização canônica (`canonicalJsonStringify`), cálculo determinístico de fingerprint de intenção de comando (`computeCommandFingerprint`) e `CommandDedupeStore` em memória com controle LRU e retenção TTL (Master §11.2, §11.3, DEC-593–602);
- Idempotência de replay: reenvio de mesmo `commandId` com mesma intenção retorna recibo anterior em cache sem reexecutar o handler;
- Detecção adversarial e de conflito: mesmo `commandId` reutilizado com payload ou intenção divergente é rejeitado com erro específico `DM_COMMAND_ID_REUSE_MISMATCH` (categoria `conflict`);
- Coordenação de concorrência: requisições simultâneas em trânsito para o mesmo `commandId` compartilham a execução em andamento (`inFlightPromise`), executando o handler exatamente uma vez e resolvendo todas as chamadas com o mesmo recibo;
- `src/commands/command-bus.ts` integra dedupe antes da execução do handler e armazena atomicamente o recibo final no store.

Evidência:
- `npm run typecheck`: PASS;
- `npm run test:unit`: PASS — 159/159 (5 novos testes para G2.5, incluindo concorrência simultânea e rejeição de fingerprint divergente);
- `npm run validate:package`: PASS;
- `npm run build`: PASS;
- `node --check dist/main.js`: PASS.

Não implementado nesta microtarefa:
- LockManager com locks multi-chave ordenados (G2.6);
- Plan e Receipt contracts (G2.7);
- MutationCoordinator e TransactionStore (G2.8–G2.9).

## G2.6 — LockManager with ordered multi-key acquisition & cancellation

Status: `VALIDATED_SOURCE`

Implementado:
- `src/mutations/lock-manager.ts` implementa `LockManager` com aquisição de locks multi-chave ordenados determinísticamente via ordenação lexical canônica (`canonicalizeLockKeys`), eliminando deadlocks clássicos AB-BA (Master §11.5, DEC-603–620);
- Execução paralela: lock sets independentes (ex: domínios distintos) adquirem imediatamente e operam de forma concorrente sem serializar o mundo inteiro;
- Reentrância segura: o mesmo contexto de execução (`ownerId`) pode adquirir chaves reentrantes de operações aninhadas sem travar a si mesmo;
- Timeout watchdog defensivo: comandos enfileirados aguardando locks expiram com `DM_LOCK_TIMEOUT` (categoria `busy`) sem deixar o lock em estado inconsistente;
- Cancelamento de fila: suporte a cancelamento de requisições aguardando locks na fila via `AbortSignal` (`DM_COMMAND_CANCELLED`, DEC-759–765);
- Diagnósticos completos de locks ativos, profundidade de reentrância e tamanho de filas de espera (`getDiagnostics()`).

Evidência:
- `npm run typecheck`: PASS;
- `npm run test:unit`: PASS — 166/166 (7 novos testes para G2.6, cobrindo ordenação invertida, paralelismo de domínios independentes, reentrância, timeout e cancelamento via AbortSignal);
- `npm run validate:package`: PASS;
- `npm run build`: PASS;
- `node --check dist/main.js`: PASS.

Não implementado nesta microtarefa:
- Plan e Receipt contracts (G2.7);
- MutationCoordinator e TransactionStore (G2.8–G2.9).

## G2.7 — Plan & Receipt contracts (preview vs confirm separation)

Status: `VALIDATED_SOURCE`

Implementado:
- `src/mutations/plans/plan-contract.ts` implementa o contrato normativo `MutationPlan` (Master §11.6, DEC-627–634), incluindo cálculo determinístico de fingerprint, detecção de bloqueios (`isExecutable`), sanitização segura para visualização pública/player (`sanitizePlanForPublic`) e detecção de drift material entre preview e confirmação (`isPlanMateriallyChanged`, DEC-641–648);
- `src/mutations/receipt-contract.ts` implementa `MutationReceipt` imutável (`Object.freeze`) cobrindo status canônicos (`executed`, `rejected`, `no_op`), detecção de no-op com `changed: false`, mapeamento de revisões resultantes e sanitização para o cliente (`sanitizeReceiptForPublic`, Master §12.1, DEC-635–644).

Evidência:
- `npm run typecheck`: PASS;
- `npm run test:unit`: PASS — 169/169 (3 novos testes para G2.7);
- `npm run validate:package`: PASS;
- `npm run build`: PASS;
- `node --check dist/main.js`: PASS.

Não implementado nesta microtarefa:
- MutationCoordinator com fresh reads após locks e validação de expectedRevision (G2.8);
- TransactionStore e recovery shells (G2.9).

## G2.8 — MutationCoordinator no escopo G2 (fresh read após locks + revision check)

Status: `VALIDATED_SOURCE`

Implementado:
- `src/mutations/mutation-coordinator.ts` implementa o `MutationCoordinator` conectando planejamento e aquisição de locks, fresh reads estritamente após locks, validação de `expectedRevision` e `expectedRevisions`, validação de bloqueios de plano e commit atômico (Master §11.2, §11.5, §11.6, DEC-621–648, DEC-803–807);
- Garantia de fresh read: a leitura de estado do repositório/entidades só é executada após todos os locks serem adquiridos;
- Rejeição de stale revision: se o comando declara `expectedRevision` divergente do estado atual lido, a operação é rejeitada com `DM_REVISION_CONFLICT` (categoria `conflict`) sem invocar commit;
- Bloqueio de plano: se o plano gerado possui blockers, o commit não é chamado e o recibo retorna rejeição estruturada (`DM_PLAN_BLOCKED`);
- Liberação garantida de locks em todos os fluxos de sucesso ou erro (`finally`);
- Tratamento de falha de compensação reportando `DM_COMPENSATION_FAILED` (categoria `recovery`).

Evidência:
- `npm run typecheck`: PASS;
- `npm run test:unit`: PASS — 173/173 (4 novos testes para G2.8, comprovando que o lock estava ativo durante fresh read, conflito de revisão, bloqueio de plano e falha de compensação);
- `npm run validate:package`: PASS;
- `npm run build`: PASS;
- `node --check dist/main.js`: PASS.

## G2.9 — Transaction / Recovery shell

Status: `VALIDATED_SOURCE`

Implementado:
- `src/mutations/transaction-record.ts` implementa o ciclo de vida normativo estrito de transações: `planned -> claimed -> prepared -> committing -> committed`, com ramificações controladas para `compensating`, `compensated`, `needs-recovery` e `failed` (Master §11.7, DEC-649–660);
- `src/mutations/transaction-store.ts` implementa armazenamento indexado em memória por `transactionId` e `commandId`, listagem de transações não-resolvidas (`listUnresolved`) e transições atômicas que rejeitam saltos ilegais de estado com `DM_TRANSACTION_INVALID_TRANSITION`;
- `src/mutations/recovery-service.ts` implementa:
  - `scanOnStartup(currentEpoch)`: escaneia transações em aberto após failover ou reinicialização do Foundry; transações deixadas em `committing` são promovidas a `needs-recovery` (DEC-724–731) e as chaves de lock afetadas são imediatamente bloqueadas para isolar o domínio danificado enquanto domínios independentes continuam operando normalmente;
  - `recoverTransaction(transactionId, currentEpoch, compensator)`: execução idempotente de compensação/recuperação; transações já finalizadas são no-op seguro (DEC-845–858); se a compensação falhar, a transação permanece em `needs-recovery` com erro `DM_RECOVERY_COMPENSATION_FAILED`.

Evidência:
- `npm run typecheck`: PASS;
- `npm run test:unit`: PASS — 177/177 (4 novos testes direcionados para G2.9);
- `npm run validate:package`: PASS;
- `npm run build`: PASS;
- `node --check dist/main.js`: PASS.

## G2.10 — Multiplayer harness, failover acceptance & final G2 verification

Status: `VALIDATED_SOURCE`

Implementado:
- `tests/multiplayer/multiplayer-harness.test.ts` implementa o cluster de simulação multiplayer conectando múltiplos nós com papéis de GM preferido (`gm-1`), GM fallback (`gm-2`) e players (`player-1`, `player-2`) via `InMemoryTransportHub`;
- Verificação end-to-end de todos os cenários normativos obrigatórios do Master §11–12, §6–7, §47–49:
  1. **Preferred GM routing**: comandos remotos de players chegam autenticados ao GM preferido e retornam recibos válidos;
  2. **Failover de Primary Authority**: desconexão do GM preferido elege deterministicamente o fallback ativo (`gm-2`), incrementa `authorityEpoch` exatamente uma vez em todos os nós e roteia comandos subsequentes ao novo GM sem intervenção manual;
  3. **Deduplicação simultânea in-flight**: dois comandos com mesmo `commandId` e mesmo payload executam o handler apenas uma vez e compartilham o recibo;
  4. **Conflito de commandId reutilizado**: mesmo `commandId` com payload diferente é rejeitado com `DM_COMMAND_ID_REUSE_MISMATCH`;
  5. **Anti-spoofing de identidade**: payload de player contendo `userId` de GM é rejeitado com `DM_SECURITY_SENDER_SPOOFED`;
  6. **Rejeição de internal-only**: comandos marcados como internos são rejeitados via transporte remoto até mesmo se solicitados por GMs (`DM_SECURITY_INTERNAL_ONLY_COMMAND`);
  7. **Comando não encontrado**: comandos ou capabilities desconhecidas retornam `DM_COMMAND_HANDLER_NOT_FOUND` estruturado;
  8. **Ordenação lexicográfica de locks (deadlock-free)**: 4 clientes concorrentes solicitando conjuntos de locks invertidos (`[omega, alpha]`, `[alpha, omega]`, `[beta, alpha, omega]`, `[omega, beta]`) concluem sem starvation ou deadlock;
  9. **Conflito de revisão (preview vs confirm)**: deriva de revisão entre plano de preview e execução confirmada é rejeitada com `DM_REVISION_CONFLICT`;
  10. **Tratamento de falha de escrita e compensação**: falha de commit aciona compensação, e falha de rollback reporta `DM_COMPENSATION_FAILED` com liberação segura de locks;
  11. **Transação em aberto e recovery no startup**: transação em `committing` durante crash da autoridade é convertida em `needs-recovery` pelo novo GM, com bloqueio isolado das chaves danificadas e operação contínua dos domínios independentes;
  12. **Idempotência de recuperação**: re-execução de recovery em transação compensada é no-op seguro;
  13. **Benchmark de escala do Dedupe**: 5.000 comandos registrados e validados em cache LRU sem exaustão de memória e busca de 500 itens em menos de 50ms;
  14. **Benchmark de alta concorrência**: 50 mutações transacionais em domínios independentes executadas em paralelo com isolamento total.

## Acceptance Matrix Obrigatória de Gate G2

| Requisito Normativo (Master §11–12, G2 Spec) | Status | Evidência |
|---|---|---|
| Sender autenticado no authority side (Socketlib/transport context, nunca payload) | ATENDIDO | `tests/commands/revalidation-adversarial.test.ts`, `tests/multiplayer/multiplayer-harness.test.ts` |
| Anti-spoofing fail-closed (`DM_SECURITY_SENDER_SPOOFED`, `DM_SECURITY_SENDER_UNKNOWN`) | ATENDIDO | `tests/commands/revalidation-adversarial.test.ts`, `tests/multiplayer/multiplayer-harness.test.ts` |
| Internal-only rejeitado via socket (`DM_SECURITY_INTERNAL_ONLY_COMMAND`) | ATENDIDO | `tests/commands/command-bus.test.ts`, `tests/multiplayer/multiplayer-harness.test.ts` |
| Same commandId + same intent dedupe & in-flight share | ATENDIDO | `tests/commands/command-dedupe-store.test.ts`, `tests/multiplayer/multiplayer-harness.test.ts` |
| Same commandId + different payload conflict (`DM_COMMAND_ID_REUSE_MISMATCH`) | ATENDIDO | `tests/commands/command-dedupe-store.test.ts`, `tests/multiplayer/multiplayer-harness.test.ts` |
| Ordered multi-key locks (deadlock-freedom garantido) | ATENDIDO | `tests/mutations/lock-manager.test.ts`, `tests/multiplayer/multiplayer-harness.test.ts` |
| Fresh read estritamente após locks adquiridos | ATENDIDO | `tests/mutations/mutation-coordinator.test.ts` |
| Stale revision conflict (`DM_REVISION_CONFLICT`) | ATENDIDO | `tests/mutations/mutation-coordinator.test.ts`, `tests/multiplayer/multiplayer-harness.test.ts` |
| Timeout tratado com status query & retry seguro (`CommandTransport.getStatus`) | ATENDIDO | `tests/commands/revalidation-adversarial.test.ts` |
| CommandQueue scheduler determinístico (FIFO, prioridade interna, cancelamento em fila) | ATENDIDO | `tests/commands/revalidation-adversarial.test.ts` |
| Sanitização rigorosa de saída pública (tokens, senhas, secrets redigidos em result/details) | ATENDIDO | `tests/commands/revalidation-adversarial.test.ts` |
| Pre-validation rate limiting & abuse tracking em diagnósticos | ATENDIDO | `tests/commands/revalidation-adversarial.test.ts` |
| Facade estritamente read-only em `runtime.domains` (sem mutadores no objeto) | ATENDIDO | `tests/core/runtime-composition.test.ts` |
| Startup recovery scan isolando apenas domínios danificados | ATENDIDO | `tests/mutations/transaction-and-recovery.test.ts`, `tests/multiplayer/multiplayer-harness.test.ts` |
| Nenhuma mutação importante bypassa Primary Authority | ATENDIDO | Master §11.1 / Composição em runtime |

## Artefatos e Checksums (SHA-256)

| Arquivo | Tamanho | SHA-256 |
|---|---|---|
| `dist/domain-manager-v0.0.2.zip` | ~14 KB | Verificado via `npm run validate:artifact` |
| `dist/domain-manager-g2-full-checkpoint.zip` | ~180 KB | Verificado via `npm run validate:g2-full` |

## Delimitação Arquitetural e Próximos Gates

1. **Transporte Dirigido com Socketlib**: O `FoundryCommandTransportAdapter` implementa RPC dirigido via `socketlib` (`executeAsUser` diretamente para `authorityUserId`), eliminando broadcast-first de payloads de mutação. `socketlib` é declarado em `relationships.requires` no `module.json`.
2. **Transaction/Recovery Shell**: Conforme a especificação do Gate G2 (§11–12, §47–49), o G2.9 implementa o Transaction/Recovery shell com estados formais, lock isolation no startup para transações em `committing`, e fail-closed com outcome `unknown`. A persistência durável distribuída em disco entre diferentes sessões e clusters é responsabilidade formal dos Gates G10/G11.

## Conclusão do Gate G2

O **Gate G2 — Authority / Commands / MutationCoordinator** está integralmente concluído, com todos os 28 apontamentos da auditoria externa e os refinamentos dos Ciclos 1 e 2 de revalidação solucionados e cobertos por 228 testes adversariais (0 falhas).
Nenhuma etapa do Gate G3 foi iniciada, em cumprimento estrito às instruções normativas.
O módulo está pronto para auditoria externa e smoke testing no Foundry VTT v13.351+.



