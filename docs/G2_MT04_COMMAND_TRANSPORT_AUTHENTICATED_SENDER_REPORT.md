# G2 MT04 — CommandTransport Contract / Authenticated Sender Boundary

## Resultado

**VALIDATED_SOURCE**

A microtarefa G2.2a foi implementada e validada localmente. Foram definidos os contratos puros para o envelope de comando (`DomainCommand`), identificadores (`CommandId`), a abstração de transporte (`CommandTransport`), recibos de transporte (`TransportReceipt`), e a fronteira de contexto autenticado (`AuthenticatedCommandContext`), garantindo que o remetente autenticado seja estabelecido exclusivamente pelo contexto do transporte e nunca pelo payload fornecido pelo cliente.

## Escopo normativo

Fontes principais:
- `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`:
  - §11.3 Command envelope;
  - DEC-541–552 — Transporte / Socket Abstraction;
  - DEC-553–564 — Command Envelope;
  - DEC-565–572 — Sender Autenticado;
  - DEC-583–592 — Expected Revision como intenção declarativa;
- `Documentos/GATES/12_G2_AUTHORITY_COMMANDS_MUTATIONCOORDINATOR.md` — Microbuild G2.2;
- `Documentos/05_CODING_STANDARDS_AND_DEPENDENCIES.md` — Seções 56 e 57.

Invariantes aplicadas:
1. `commandId` é tipado (`cmd_${string}`) e validado no formato UUID v4 com prefixo obrigatório `cmd`.
2. `type` é estritamente namespaced no formato `<namespace>:<action>`.
3. `contractVersion` é validado como inteiro positivo seguro (baseline `COMMAND_CONTRACT_VERSION_V1 = 1`).
4. `payload` deve ser JSON-safe; funções, símbolos, bigints e referências circulares são rejeitados defensivamente no envelope.
5. `expectedRevision` e `expectedRevisions` permanecem dados declarativos de intenção do cliente; não alteram e não assumem estado de autoridade por si sós.
6. `senderUserId` é derivado unicamente de `TransportInboundContext.senderUserId`. É proibido confiar em qualquer campo de usuário contido no payload.
7. Qualquer tentativa do payload de declarar `userId`, `claimedUserId`, `senderUserId`, `senderId` ou `user.id` divergente do remetente autenticado do transporte é detectada como spoofing adversarial e rejeitada (`DM_SECURITY_SENDER_SPOOFED`).
8. Comandos técnicos da autoridade local (ex: ticks, schedulers, migrações) usam `senderUserId: null` com `OperationSource` técnico apropriado (`tick`, `provider`, etc.).
9. `AuthenticatedCommandContext` é imutável (`Object.freeze`) para impedir sobrescrita por handlers.
10. `CommandTransport` é puramente desacoplado de socketlib e de globais do Foundry VTT. Nenhuma biblioteca de socket concreta foi selecionada nesta microtarefa.

## Implementação

### `src/commands/command-envelope.ts`

Define:
- `CommandId`: tipo branded com prefixo `cmd_`;
- `createCommandId()` e `isCommandId()`;
- `ExpectedRevisions`: mapeamento tipado de alvos para revisões esperadas;
- `DomainCommand<TPayload>`: envelope canônico contendo `contractVersion`, `commandId`, `type`, `payload`, `issuedAtReal`, e campos opcionais `expectedRevision`, `expectedRevisions`, `targetRefs`, `authorityEpoch`, `reason`;
- `isCommandType()`: validação de namespace `<namespace>:<action>`;
- `validateCommandEnvelope()`: validação defensiva fail-closed do envelope e checagem de integridade JSON-safe.

### `src/commands/command-transport.ts`

Define:
- `TransportReceiptStatus`: `"delivered" | "acknowledged" | "executed" | "rejected" | "timed_out"`;
- `TransportReceipt<T>`: recibo de nível de transporte independente de estado de negócio;
- `TransportSendOptions`: opções de envio (`timeoutMs`, `correlationId`);
- `TransportInboundContext`: contexto autenticado gerado pelo transporte (`senderUserId`, `transportName`, `receivedAtReal`);
- `TransportInboundMessage`: mensagem encapsulada entregue à autoridade;
- `TransportInboundHandler`: handler assíncrono para mensagens de transporte recebidas;
- `CommandTransport`: interface abstrata pura para envio e registro de handlers de recebimento.

### `src/commands/authenticated-command-context.ts`

Define:
- `OperationSourceType` e `OperationSource`: taxonomia de origem da operação (`user`, `tick`, `project`, `event`, `provider`, `migration`);
- `AuthenticatedCommandContext<TPayload>`: contexto autenticado contendo o comando validado, `senderUserId`, `authorityUserId`, `authorityEpoch`, `receivedAtReal` e `source`;
- `createAuthenticatedCommandContext()`: fábrica de fronteira de segurança que extrai o remetente exclusivamente do transporte, inspeciona o payload para detectar e rejeitar spoofing/divergências (`DM_SECURITY_SENDER_SPOOFED`), valida a autoridade e congela o contexto.

## Testes executados

Novo arquivo de testes direcionados: `tests/commands/command-transport.test.ts` (24 novos testes):
- Validação e criação de `CommandId`;
- Validação estrita de formato namespaced de `type`;
- Validação de envelopes canônicos válidos e opcionais declarativos;
- Rejeição de envelopes não-objeto, versões ausentes, negativas, não-inteiras ou não suportadas;
- Rejeição de `commandId` malformado ou com prefixo incorreto;
- Rejeição de payloads ausentes, funções, símbolos e estruturas circulares;
- Rejeição de timestamps e revisões esperadas inválidas;
- Extração de `senderUserId` exclusivamente do contexto do transporte;
- **Teste adversarial**: rejeição de spoofing no payload via `userId`, `claimedUserId`, `senderUserId`, `senderId` e `user.id` (`DM_SECURITY_SENDER_SPOOFED`);
- Preservação da fronteira de remetente mesmo quando o payload declara id coincidente;
- Execução técnica de autoridade local com remetente nulo e `OperationSource` de tick;
- Imutabilidade do contexto autenticado contra sobrescrita maliciosa;
- `expectedRevision` e `expectedRevisions` preservados como intenção declarativa;
- Teste de transporte loopback in-memory validando envio, recebimento autenticado e rejeição de envelope na autoridade;
- Tratamento de timeout e ausência de receptor em nível de transporte;
- Independência total do core em relação a Foundry VTT e socketlib.

Resultados da suíte completa:
- `npm run typecheck` — **PASS**
- `npm run test:unit` — **PASS: 132/132** (108 regressões G0/G1/G2.1 + 24 testes novos de G2.2a)
- `npm run validate:package` — **PASS**
- `npm run build` — **PASS**
- `node --check dist/main.js` — **PASS**
- `npm run package` — **PASS**
- `npm run validate:artifact` — **PASS**

## Não alterado

- G0/G1 Domain schema, codec, repository, index, integridade e migrações;
- G2.1 Primary Authority eleição, serviço stateful e adapter Foundry;
- Nenhuma dependência externa adicionada;
- Nenhum socket concreto (socketlib ou nativo) selecionado como definitivo;
- Nenhum CommandBus, dedupe, LockManager, MutationCoordinator ou TransactionStore antecipado.

## Riscos / Dívidas restantes

- A implementação de transporte concreto no Foundry (socketlib vs native socket) ainda deve ser implementada em adapter isolado mantendo a abstração `CommandTransport`;
- O CommandBus completo (com registry público/interno, validação de permissões por handler e rate limit defensivo) será implementado em microtarefas subsequentes (G2.3+);
- O dedupe store em memória e o LockManager multi-chave ordenado permanecem em suas microbuilds donas.

## Próxima microparte

**G2.2b — Transport adapter / socket boundary abstraction** (ou conforme decomposição do Gate G2 aprovada pelo usuário).
