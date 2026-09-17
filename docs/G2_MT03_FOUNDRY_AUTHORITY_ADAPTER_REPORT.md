# G2 MT03 — Foundry Primary Authority Adapter / Lifecycle / Persistence

## Resultado

**VALIDATED_SOURCE**

A microtarefa G2.1c foi implementada e validada localmente. A Primary Authority agora está conectada ao lifecycle do Foundry v13 por boundaries testáveis, sem introduzir CommandTransport, socketlib, CommandBus ou MutationCoordinator antes de seus microbuilds donos.

## Escopo normativo

Fontes principais:
- `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md` — DEC-511–540;
- `Documentos/GATES/12_G2_AUTHORITY_COMMANDS_MUTATIONCOORDINATOR.md` — G2.1;
- Foundry VTT v13 public API para `game.settings` e hook `userConnected`.

Invariantes aplicadas:
- preferred GM vive em world setting por `userId`;
- fallback continua determinístico e independente da ordem incidental de `game.users`;
- authority é resolvida em `ready`, não em `init`;
- conexão/desconexão dispara recálculo;
- epoch é persistido de forma leve;
- todos os clientes podem resolver a mesma identity, mas somente o cliente da authority efetiva escreve o state persistido;
- nenhum socket/CommandBus foi antecipado.

## Implementação

### `src/authority/foundry-primary-authority-adapter.ts`

Adicionado adapter de produção injetável para:
- `game.users.contents`;
- `game.user`;
- `game.settings.register/get/set`.

World settings:
- `preferredAuthorityUserId`: preferred GM opcional;
- `primaryAuthorityState`: JSON interno e atômico contendo `authorityUserId`, `authorityEpoch` e `initialized`.

O state técnico é persistido em uma única chave para impedir que identity e epoch sejam observados parcialmente atualizados.

### `src/authority/primary-authority-service.ts`

A integração encontrou e corrigiu uma falha de semântica de failover:
- `authorityUserId` agora representa o último executor técnico eleito;
- disponibilidade é derivada da presença/atividade atual do usuário;
- um período sem nenhum GM não substitui a identity por `null` nem incrementa epoch;
- se o mesmo GM retorna, epoch permanece;
- se outro GM assume, epoch avança exatamente uma vez;
- state persistido mais novo pode ser sincronizado atomicamente;
- state stale é ignorado;
- duas identities diferentes no mesmo epoch são tratadas como conflito e falham closed.

### `src/bootstrap/domain-manager-runtime.ts`

O composition root agora contém uma boundary `authority` explícita junto do repository de Domains.

Construção do runtime ainda não executa writes.

### `src/main.ts`

Lifecycle:
- `init`: registra settings, sem resolver authority;
- `ready`: compõe runtime e executa primeira reconciliação;
- `userConnected`: dispara reconciliação para conexão/desconexão;
- erros de sync/reconcile são logados pelo logger sanitizado existente.

## Erro arquitetural encontrado

### MT03-ERR-001 — drift de epoch durante intervalo sem GM

**Severidade:** blocker de consistência multiplayer.

#### Cenário anterior

1. GM-A era authority em epoch 4.
2. GM-A desconectava.
3. clients players mudavam localmente para `null` e incrementavam epoch para 5.
4. nenhum GM estava conectado para persistir esse epoch.
5. GM-B entrava com o world setting ainda em epoch 4.
6. diferentes clients podiam terminar em epochs divergentes.

#### Causa

O serviço confundia **indisponibilidade temporária** com **troca real de executor técnico**.

#### Solução

O serviço preserva a última identity eleita durante indisponibilidade e o adapter persiste `{authorityUserId, authorityEpoch}` atomicamente. Somente uma troca real `GM-A → GM-B` incrementa epoch.

#### Regressões adicionadas

- no-GM gap não avança epoch;
- retorno do mesmo GM não avança epoch;
- GM diferente após gap avança uma única vez;
- novo authority persiste o state;
- non-authority clients não escrevem world setting;
- state remoto mais novo converge clients stale;
- state corrupto/conflitante falha closed.

## Testes executados

- `npm run typecheck` — **PASS**
- Authority direcionado via transpile TypeScript + `node --test` — **PASS: 37/37**
- suíte completa via transpile TypeScript + `node --test` — **PASS: 108/108**
- `npm run validate:package` — **PASS**

O runner oficial `npm run test:unit` continua indisponível neste ambiente porque `esbuild` não está instalado no checkpoint e o registry externo não está acessível. Nenhum resultado desse runner foi inventado.

## Runtime package

Não foi gerado novo runtime ZIP nesta microtarefa porque `dist/main.js` só deve ser atualizado pelo build oficial esbuild. Este checkpoint é de **source validado**.

## Não alterado

- Domain schema/repository/storage do G1;
- algoritmo puro de eleição G2.1a;
- manifest/version;
- `dist/main.js` e runtime ZIP;
- CommandTransport/socket/socketlib;
- authenticated command context;
- CommandBus;
- dedupe/rate limit;
- locks;
- Plan/Receipt;
- MutationCoordinator;
- transaction/recovery.

## Próxima microtarefa

**G2.2a — CommandTransport contract + authenticated sender boundary.**

Criar primeiro os contratos puros e testes de identidade autenticada. A escolha concreta socketlib/native socket deve permanecer em adapter posterior, conforme o Master exige que transport seja abstraction e business logic não importe socketlib diretamente.
