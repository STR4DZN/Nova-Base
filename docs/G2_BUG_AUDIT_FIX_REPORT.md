# RELATÓRIO DE AUDITORIA DE SEGURANÇA E CORREÇÃO DE VULNERABILIDADES — GATE G2

> **Módulo:** `domain-manager`  
> **Versão:** `0.0.2`  
> **Data:** 17 de setembro de 2026  
> **Autoridade Normativa:** `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md` (§11–12, §6–7, §35, §47–49)  
> **Status:** `AUDIT_AND_FIXES_COMPLETE` (100% dos testes aprovados / 0 regressões)  

---

## 1. Visão Geral da Auditoria Hostil

Em conformidade com as diretrizes de auditoria externa e o protocolo normativo do Gate G2, foi realizada uma varredura crítica e adversarial em busca de fragilidades, vulnerabilidades e potenciais falhas de concorrência ou segurança nas camadas de **Authority**, **CommandBus**, **CommandTransport**, **LockManager** e **MutationCoordinator**.

---

## 2. Análise Crítica por Área Normativa

### 2.1 Transport e Segurança de Socket
* **Pergunta:** `senderUserId` é confiável? O que acontece se um cliente malicioso enviar `senderUserId` forjado no packet?  
  * **Achado:** No `FoundryCommandTransportAdapter`, o cliente enviava `senderUserId` no packet de socket. Como a API nativa `game.socket.emit` do Foundry não anexa cabeçalho de autenticação de sessão do servidor, um cliente malicioso poderia enviar `senderUserId: "<gm-id>"`.  
  * **Correção:** O adaptador foi blindado com a invariante de que a **Primary Authority executa comandos locais estritamente via loopback em memória** (`#sendLocalLoopback`). Qualquer pacote de rede recebido pelo socket cujo `senderUserId` seja a própria autoridade local é categorizado como tentativa de spoofing e sumariamente rejeitado com `DM_SECURITY_SENDER_SPOOFED`. Além disso, se a collection `game.users` estiver presente no runtime, verifica-se se o remetente é um usuário real e ativo (`user.active === true`), rejeitando remetentes fantasmas com `DM_SECURITY_SENDER_UNKNOWN`.
* **Pergunta:** O que acontece se um cliente enviar packet com formato inesperado ou payload massivo?  
  * **Achado:** `isSocketRequestPacket` permitia primitivos no campo `command`.  
  * **Correção:** Validação estrita de objeto não-nulo para `command`, além de envelope validation no `CommandBus` que descarta envelopes com dados ilegais (`DM_VALIDATION_COMMAND_ENVELOPE_INVALID`).
* **Pergunta:** É possível invocar comandos internos via rede?  
  * **Garantia:** Verificado e comprovado no `CommandBus` (passo 5 do pipeline). Comandos com `visibility: "internal"` recebidos por transporte não-local são rejeitados com `DM_SECURITY_INTERNAL_ONLY_COMMAND`, mesmo que o remetente seja GM.
* **Pergunta:** Há proteção contra replay de comandos antigos com o mesmo `commandId`?  
  * **Garantia:** Verificado no `CommandDedupeStore`. Replays idênticos retornam o recibo em cache. Reutilização de `commandId` com payload alterado é bloqueada fail-closed com `DM_COMMAND_ID_REUSE_MISMATCH`.

### 2.2 Runtime e Pipeline de Comandos
* **Pipeline de Execução:** Ordem estrita garantida:
  1. Envelope validation
  2. Authority check
  3. Authenticated context + anti-spoofing check
  4. Handler lookup (`DM_COMMAND_HANDLER_NOT_FOUND`)
  5. Public vs Internal visibility check
  6. Rate limiting deslizante
  7. Schema validation
  8. Permission validation
  9. Dedupe claim
  10. Execution + receipt record
* **Sanitização de Diagnósticos (`sanitizeDiagnosticsValue`):**  
  * **Vulnerabilidade Encontrada:** Valores do tipo `BigInt` (ex.: timestamps de alta precisão ou inteiros de 64 bits) não eram tratados por `sanitizeDiagnosticsValue` (por ser primitivo não-objeto). Ao tentar serializar diagnósticos com `JSON.stringify`, o Node.js lançava `TypeError: Do not know how to serialize a BigInt`. Símbolos e funções também podiam causar anomalias na serialização.  
  * **Correção:** `BigInt` agora é convertido seguramente para `${value.toString()}n`, `Symbol` para `value.toString()` e `Function` para `[Function: name]`.

### 2.3 Deduplicação
* **Colisão de Fingerprint e Reutilização:** Algoritmo FNV-1a de 64 bits com serialização canônica determinística (`canonicalizeJson`). Se o mesmo `commandId` for submetido concorrentemente com payloads idênticos, as requisições compartilham a mesma `Promise` em andamento (`inFlightPromise`), evitando re-execução.
* **Política de Retenção:** TTL de 10 minutos com LRU de até 5.000 entradas. Comandos em estado `pending` nunca são descartados por timeout ou LRU.

### 2.4 Locks e Concorrência (`LockManager`)
* **Deadlock Freedom:** Ordenação lexicográfica determinística (`canonicalizeLockKeys`) elimina a possibilidade de deadlock cruzado (AB-BA).
* **Reentrância:** Suporte a locks aninhados pelo mesmo `ownerId` com contador de profundidade (`reentrantDepth`).
* **Starvation e Filas:** Fila FIFO estrita por chave com notificação e processamento reativo. A liberação de locks ou o cancelamento/timeout de requisições pendentes aciona imediatamente a avaliação da fila (`#processQueues`), garantindo que requisições subsequentes não sofram starvation.
* **Watchdog e Cancelamento:** Suporte a `timeoutMs` (`DM_LOCK_TIMEOUT`) e `AbortSignal` (`DM_COMMAND_CANCELLED`).

### 2.5 Revisões e Integridade de Estado
* **Vulnerabilidade Encontrada no `MutationCoordinator`:**  
  * **Bug de Fail-Open:** Na verificação de `expectedRevisions`, o código utilizava `if (current !== undefined && current !== expected)`. Se a entidade esperada não existisse no repositório (`current === undefined`), o `current !== undefined` avaliava como `false`, ignorando o conflito e permitindo que a mutação prosseguisse! O mesmo ocorria com `expectedRevision` global se `freshState.revision` fosse `undefined`.  
  * **Correção:** O código foi corrigido para **falhar fechado** (`if (current !== expected)` e `if (freshState.revision !== command.expectedRevision)`). Se o cliente especifica revisão esperada para uma entidade inexistente, a operação é sumariamente rejeitada com `DM_REVISION_CONFLICT`.

### 2.6 MutationCoordinator
* **Garantia de Fresh Read:** A leitura do estado atual (`freshRead`) ocorre **estritamente após** a aquisição dos locks multi-chave.
* **Tratamento de Exceções Não Capturadas:**  
  * **Bug:** Se o `commit` ou `buildPlan` lançasse uma exceção síncrona/assíncrona inesperada (ex.: erro de disco), a exceção vazava da promise sem acionar a compensação e sem gerar um `MutationReceipt` estruturado.  
  * **Correção:** `buildPlan` e `commit` foram encapsulados em blocos `try/catch`. Caso o `commit` lance uma exceção, o método `compensate` é acionado automaticamente para reverter qualquer efeito colateral e o coordinator retorna um recibo com status `"rejected"`, código `DM_COMMIT_FAILED` ou `DM_COMPENSATION_FAILED`, garantindo que os locks sejam sempre liberados no `finally`.

### 2.7 Manifesto Foundry (`module.json`)
* **Vulnerabilidade Encontrada:** O manifesto `module.json` não declarava `"socket": true` nem `"compatibility.verified": "13.351"`.  
* **Correção:** Declarado `"socket": true` e `"verified": "13.351"` no `module.json`, e adicionada validação compulsória em `scripts/validate-package.mjs`.

---

## 3. Registro dos Testes Adversariais Criados (Fase 3)

| Arquivo de Teste | Vulnerabilidade Testada | Resultado Inicial | Resultado Pós-Fix |
|---|---|:---:|:---:|
| `tests/foundry/manifest-socket.test.ts` | Declaração compulsória de `socket: true` e `compatibility.verified: "13.351"` | **FAIL** | **PASS** |
| `tests/diagnostics/sanitize-adversarial.test.ts` | Serialização JSON de `BigInt` e `Symbol` sem lançar `TypeError` | **FAIL** | **PASS** |
| `tests/mutations/mutation-coordinator-adversarial.test.ts` | Fail-closed de `expectedRevisions` em entidade ausente (conflito de revisão) | **FAIL** | **PASS** |
| `tests/mutations/mutation-coordinator-adversarial.test.ts` | Fail-closed de `expectedRevision` global em repositório sem revisão | **FAIL** | **PASS** |
| `tests/mutations/mutation-coordinator-adversarial.test.ts` | Tratamento resiliente de exceção em `commit` com acionamento de `compensate` | **FAIL** | **PASS** |
| `tests/commands/foundry-transport-adversarial.test.ts` | Rejeição imediata de spoofing de autoridade e remetente em pacote de socket | **FAIL** | **PASS** |

---

## 4. Auditoria de Ambiente Local do Foundry VTT (Fase 4)

* **Verificação Executada:**  
  - Processos em execução: busca por `*foundry*` via PowerShell (`Get-Process`).
  - Caminhos de instalação padrão inspecionados:
    - `%LOCALAPPDATA%\Programs\Foundry Virtual Tabletop\Foundry Virtual Tabletop.exe`
    - `C:\Program Files\Foundry Virtual Tabletop\Foundry Virtual Tabletop.exe`
  - Chaves de registro de desinstalação inspecionadas: `HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall` e `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall`.
* **Resultado:**  
  Nenhuma instalação local ou processo ativo do Foundry VTT foi detectado no ambiente do agente.
* **Formalização:**  
  A validação do módulo em tempo de desenvolvimento é garantida pelo test harness emulado (`multiplayer-harness.test.ts`, adapters com mocks de `game.socket` e `game.users`, `validate-package.mjs`). O teste com o binário real do Foundry v13.351 deve ser conduzido pelo usuário através do artefato zip distribuível `dist/domain-manager-v0.0.2.zip`.

---

## 5. Resumo das Métricas Finais

* **Total de Testes Automatizados:** 198 (198 aprovados, 0 falhas, 0 pulados)
* **Tempo de Execução:** ~2.8 segundos
* **TypeScript Typecheck:** 0 erros (`tsc --noEmit`)
* **Validação de Pacote:** Aprovada
* **Sintaxe do Bundle (`dist/main.js`):** Aprovada (`node --check`)
