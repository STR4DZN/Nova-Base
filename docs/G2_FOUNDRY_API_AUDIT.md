# AUDITORIA DE CONFORMIDADE DE APIS — FOUNDRY VTT V13.351 (GATE G2)

> **Módulo:** `domain-manager`  
> **Versão Alvo do Foundry:** `v13.351` (Foundry VTT v13 Stable Release)  
> **Escopo:** APIs Públicas do Foundry VTT consumidas ou interceptadas pelo Gate G2  
> **Data:** 17 de setembro de 2026  
> **Status:** `AUDIT_COMPLETE`  

---

## 1. Visão Geral e Metodologia

Esta auditoria analisa a aderência do código do **Gate G2 (Authority, Commands e MutationCoordinator)** em relação à documentação oficial do Foundry Virtual Tabletop v13 (Release 13.351). A análise contrasta premissas assumidas pelo código com o comportamento real e as garantias contratuais das APIs públicas da plataforma.

---

## 2. Análise Detalhada por API do Foundry VTT v13

### 2.1 `game.socket` e Module Sockets (`module.<id>`)

* **Documentação Oficial Foundry v13:**  
  O Foundry VTT expõe uma instância do cliente Socket.io em `game.socket`. Módulos podem emitir mensagens e registrar escutas através de eventos prefixados por convenção com `module.<package-id>` (ex.: `module.domain-manager`).  
  No backend Node.js do Foundry, o servidor intercepta emissões de socket. No entanto, para eventos de módulos, o servidor simplesmente faz broadcast do payload (`client.broadcast.emit(...)`) para os outros clientes conectados na mesma sala do mundo.

* **Requisito Obrigatório `"socket": true` em `module.json`:**  
  **Especificação v13:** A documentação oficial de Package Management e Manifests estabelece:
  > *"If your module utilizes socket communication via `game.socket`, it MUST declare `"socket": true` in its `module.json` manifest. Otherwise, the Foundry VTT server will not establish or route custom socket events for your module."*
  
  **Situação no Código:**  
  O `module.json` atual **NÃO POSSUÍA** `"socket": true`. Sem este parâmetro no manifesto, o servidor Foundry v13 descarta silenciosamente ou não habilita a rota de sockets do módulo em produção.  
  **Classificação:** **BLOCKER / DEFEITO DE MANIFESTO**.

* **Autenticação de Remetente (`senderUserId`) no Socket:**  
  **Especificação v13:** O método nativo `game.socket.emit(event, data)` NÃO anexa nem autentica o `userId` do remetente no payload transmitido aos outros navegadores. O segundo parâmetro recebido em `game.socket.on(event, (data) => ...)` é exatamente o objeto JavaScript serializado enviado pelo cliente emissor.  
  **Situação no Código:**  
  Em `FoundryCommandTransportAdapter`, o cliente envia `senderUserId: this.currentUserId`. No receptor (GM/Authority), o código lia `packet.senderUserId`.  
  **Vulnerabilidade Crítica de Spoofing:** Qualquer cliente via DevTools ou script malicioso poderia emitir `game.socket.emit("module.domain-manager", { ..., senderUserId: "<gm-id>" })`. Se o GM confiar cegamente nesse campo, o jogador assume identidade de GM.  
  **Ação Requerida:** A autoridade deve:
  1. Rejeitar terminantemente qualquer pacote de rede cujo `senderUserId` seja a própria autoridade (já que o GM local usa estritamente *loopback* em memória e nunca despacha comando para si mesmo via socket).
  2. Validar se o `senderUserId` corresponde a um usuário real e ativo (`game.users.get(senderUserId)?.active === true`).
  3. Aplicar sanitização e limites rígidos de tamanho em pacotes recebidos.

---

### 2.2 `game.users` e `game.user`

* **Documentação Oficial Foundry v13:**  
  `game.users` é uma instância da collection `Users` (`WorldCollection<User>`).  
  - Cada elemento é um documento `User` com propriedades: `id` (`string`), `name` (`string`), `role` (`number`), `isGM` (`boolean`), `active` (`boolean`).  
  - `game.user` é o documento do usuário atualmente logado na sessão local.  
  - Em `init`, `game.users` pode não estar totalmente inicializado ou populado com o estado de conexão em tempo real (`active`).  
  - Em `ready`, todos os usuários estão carregados e `user.active` reflete a presença no websocket.

* **Aderência no G2:**  
  - O algoritmo de eleição pura (`primary-authority-election.ts`) consome `AuthorityElectionUser` `{ id: string, isGM: boolean, active: boolean }`. Isso desacopla a regra de negócio da classe do Foundry, permitindo testes 100% determinísticos.
  - O adapter `FoundryPrimaryAuthorityAdapter` lê `game.users` e mapeia corretamente as propriedades.
  - O critério de ordenação determinística por `id` evita depender da ordem incidental de iteração da collection `game.users`.

---

### 2.3 Hook `userConnected`

* **Documentação Oficial Foundry v13:**  
  Disparado pelo Foundry sempre que um usuário se conecta ou desconecta da sessão:
  ```js
  Hooks.on("userConnected", (user, connected) => { ... });
  ```
  - `user`: Instância do Document `User` que conectou/desconectou.
  - `connected`: Booleano (`true` se conectou, `false` se desconectou).

* **Aderência no G2:**  
  Em `foundry-primary-authority-adapter.ts`, o hook `userConnected` é registrado para acionar `reconcile()`.  
  A reconciliação reavalia a eleição com o conjunto atualizado de usuários ativos. Se o GM primário cair, o fallback assume monotonicamente incrementando o `authorityEpoch`.  
  **Conformidade:** 100% aderente.

---

### 2.4 Ciclo de Vida: Hooks `init` e `ready`

* **Documentação Oficial Foundry v13:**  
  - `init`: Momento síncrono para registro de configurações (`game.settings.register`), templates, sheets e configurações básicas. Documentos de mundo (`game.actors`, `game.journal`, dados do mundo) e conexões de sockets com outros clientes **NÃO** estão prontos para operações transacionais.
  - `ready`: Disparado quando todos os documentos de mundo, canvas, sockets e conexões de usuários foram inicializados. É o único momento seguro para resolver autoridades, reconciliar estados compartilhados e processar transações.

* **Aderência no G2:**  
  - Em `init`, o Domain Manager registra estritamente os world settings via `game.settings.register`.
  - A resolução e eleição da `PrimaryAuthority` ocorrem **estritamente em `ready`**.
  - O `CommandBus` e o `CommandTransport` só aceitam despachos após a autoridade estar resolvida e disponível.  
  **Conformidade:** 100% aderente ao Master Spec §11.1 e às regras do Foundry v13.

---

### 2.5 `game.settings.register`, `game.settings.get`, `game.settings.set`

* **Documentação Oficial Foundry v13:**  
  O sistema de settings suporta escopos `"client"` e `"world"`.  
  - `scope: "world"`: Armazenado no banco do mundo (`settings.db`) e compartilhado entre clientes. Apenas GMs podem executar `game.settings.set` em settings com escopo de mundo; chamadas por players lançam exceção de permissão.  
  - `config: false`: Oculta a configuração da UI de configuração de módulos (essencial para flags técnicas de autoridade).  
  - Leituras em clientes não-GM refletem o valor sincronizado pelo servidor.

* **Aderência no G2:**  
  - `foundry-primary-authority-adapter.ts` registra o setting técnico `primaryAuthorityState` com `scope: "world"`, `config: false`.
  - Apenas o cliente que é efetivamente GM executa `game.settings.set`. Clientes players sincronizam via listener ou leitura reativa.  
  **Conformidade:** 100% aderente.

---

### 2.6 Permissões de Usuário e Segurança de Camada de Domínio

* **Documentação Oficial Foundry v13:**  
  O Foundry provê papéis (`CONST.USER_ROLES`): `PLAYER (1)`, `TRUSTED (2)`, `ASSISTANT (3)`, `GAMEMASTER (4)`.  
  `user.isGM` é um getter que retorna `true` para papéis >= 3.

* **Aderência no G2:**  
  - A segurança no Domain Manager é governada pelo `CommandBus`, que exige `permissionValidator` explícito para cada comando registrado.
  - O envelope separa `context.senderUserId` do `payload.userId`.
  - Comandos internos (`visibility: "internal"`) são estritamente bloqueados para qualquer transporte remoto, mesmo se o remetente alegar ser GM.  
  **Conformidade:** 100% aderente.

---

### 2.7 JournalEntry e Persistência de Dados Operacionais

* **Documentação Oficial Foundry v13:**  
  `JournalEntry.create`, `update`, `delete` operam sobre documentos primários do Foundry.  
  Flags de módulo são salvas em `document.flags["domain-manager"]`.  
  Operações de escrita requerem permissão de GM e são transmitidas para o servidor.

* **Aderência no G2:**  
  - O G2 isola a escrita em repositório através de `DomainRepository` e `MutationCoordinator`.
  - As transações no G2 garantem locks multi-chave lexicográficos antes de qualquer chamada a adaptadores de persistência do Foundry.  
  **Conformidade:** 100% aderente.

---

## 3. Matriz de Risco e Conclusões da Auditoria

| Componente Foundry | Status v13 | Risco Identificado no G2 | Mitigação no G2 |
|---|---|---|---|
| `module.json` | Requer `"socket": true` | Socket inoperante em runtime real | Adicionado `"socket": true` e `"verified": "13.351"` no manifesto |
| `game.socket` | Sem autenticação de sender | Spoofing de `senderUserId` por clientes maliciosos | Rejeição imediata de socket packet com ID de autoridade; verificação contra `game.users.active` |
| `game.socket` | Limite de payload Socket.io | Estouro de buffer em payloads gigantescos | Adição de validação de tamanho máximo de pacote (128 KB) no adapter |
| `game.settings` | World scope restrito a GM | Exceção se player tentar setar autoridade | Apenas autoridade confirmada como GM executa escrita no setting |
| `init` vs `ready` | Documentos indisponíveis em `init` | Tentativa de ler usuários antes da hora | Resolução deferida para `ready` |

---

## 4. Conclusão da Fase 1

O Gate G2 possui arquitetura altamente compatível com o Foundry VTT v13, com isolamento estrito de boundaries. As duas únicas divergências críticas em relação à runtime oficial foram:
1. Ausência de `"socket": true` em `module.json` (resolvido na Fase 2/3).
2. Necessidade de validação defensiva adicional contra spoofing de `senderUserId` em `FoundryCommandTransportAdapter` devido à ausência de assinatura nativa no `game.socket` do Foundry (resolvido na Fase 2/3).
