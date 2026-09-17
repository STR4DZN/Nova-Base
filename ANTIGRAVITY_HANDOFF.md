# ANTIGRAVITY HANDOFF — DOMAIN MANAGER

## LEIA ISTO PRIMEIRO

Este repositório é a base canônica atual do projeto **Domain Manager**.

- NÃO restaure arquivos de versões antigas.
- NÃO continue a partir da antiga linha 0.2.x do GitHub.
- NÃO substitua contratos atuais por versões anteriores.
- NÃO reverta implementações do Gate G2 para rascunhos ou microtarefas passadas (ex: microtarefas antigas).
- Reconstrua sempre `dist/main.js` via `npm run build` após alterações de código.

---

## 1. Estado Atual do Desenvolvimento

| Gate | Status | Descrição |
|---|:---:|---|
| **Gate G0** | CONCLUÍDO | Scaffold, contratos fundamentais, manifesto Foundry v13, scripts de build e validação de pacotes. |
| **Gate G1** | CONCLUÍDO | Domain Repository, schema/validators v1, JournalEntry bridge, hierarquia por UUID, no-op revisions, cycle prevention e integrity check. |
| **Gate G2** | CONCLUÍDO & AUDITADO (Ciclo 2) | Authority / Commands / MutationCoordinator completo. Eleição determinística com epoch, RPC dirigido via Socketlib com autenticação rigorosa via `this.socketdata.userId`, anti-spoofing fail-closed, deduplicação em memória, LockManager multi-chave deadlock-free, MutationCoordinator transacional, scheduler concorrente em CommandQueue (até 10 players), sanitização de saída pública e boundary de Transaction/Recovery shell. |
| **Gate G3** | **PRÓXIMO GATE** | **Domain Lifecycle & State Machine / People** (Iniciação estritamente após homologação externa do G2). |

---

## 2. Invariantes Fundamentais do Gate G2 (Que NÃO Podem Regredir)

1. **Autoridade Técnica Única**: Existe uma única Primary Authority técnica por mundo, eleita de forma determinística por GM preferido ativo ou menor `userId` ativo. Trocas reais de autoridade avançam monotonicamente o `authorityEpoch`.
2. **Identidade Confiável via Transporte (G2-AUD-002)**: O remetente do comando é obtido exclusivamente do contexto seguro de transporte (`this.socketdata.userId` no Socketlib ou metadados de sessão confiáveis). Argumentos controlados pelo chamador, payloads ou `declaredSenderUserId` NUNCA são fontes autoritativas de identidade.
3. **Topologia Dirigida (G2-AUD-004)**: Chamadas de mutação utilizam RPC dirigido via Socketlib (`executeAsUser` diretamente para a autoridade primária). Clientes secundários não recebem nem executam mutações broadcast.
4. **Proteção de Resposta (G2-AUD-003)**: O cliente aguardando resposta só aceita e resolve Promises originadas comprovadamente da autoridade primária eleita com epoch correspondente.
5. **Concorrência e Escalonamento (G2-AUD-015)**: O `CommandQueue` opera como um scheduler real de admissão concorrente (default: 10 comandos simultâneos para suportar 10 players), preservando ordem FIFO e prioridades internas do sistema, sem serializar o mundo antes do `LockManager`.
6. **Isolamento Fino de Recursos**: Comandos que acessam domínios/recursos independentes executam em paralelo. Comandos que disputam o mesmo recurso são serializados de forma justa e livre de deadlocks pelo `LockManager` com ordenação lexicográfica de chaves.
7. **Pipeline Seguro no CommandBus**: Validações de schema, permissões e conflitos de dedupe executam antes da admissão na fila de execução, impedindo o acúmulo de entradas fantasmas.
8. **Sanitização de Saída (G2-AUD-018)**: Todo recibo enviado a clientes remotos é sanitizado profundamente, redigindo campos sensíveis (`token`, `secret`, `password`, `apiKey`, `credential`, `authorization`).
9. **Transaction/Recovery Shell (G2.9)**: O G2 provê o shell em memória de transações e recuperação (isolamento de chaves afetadas por lock e varredura de inicialização pelo novo GM). Persistência de log durável em disco para recuperação distribuída pós-reboot pertence aos Gates G10/G11.
10. **Armazenamento Seguro (G2-AUD-008)**: `runtime.domains` é uma facade estritamente congelada e somente de leitura (`Object.freeze`). Métodos mutadores nunca são expostos fora do pipeline transacional autoritativo.

---

## 3. Próximo Gate

Após a homologação externa final do Gate G2:
- Avançar para o **Gate G3 — People / Domain Lifecycle & State Machine**.
- Consultar a especificação normativa `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md` e o playbook do G3 antes de iniciar qualquer alteração.

