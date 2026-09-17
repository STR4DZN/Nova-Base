# ANTIGRAVITY HANDOFF — DOMAIN MANAGER

## LEIA ISTO PRIMEIRO

Este ZIP é a base canônica atual do projeto Domain Manager.

NÃO restaure arquivos de versões antigas.
NÃO continue a partir da antiga linha 0.2.x do GitHub.
NÃO substitua contratos atuais por versões anteriores.
NÃO considere `dist/main.js` canônico até reconstruí-lo: o source avançou além do bundle existente.

Estado atual do desenvolvimento:

- G0: implementação local concluída; smoke Foundry externo ainda não registrado.
- G1: implementação local auditada/corrigida; 68/68 na auditoria de G1.
- G2 MT00: composition root concluído.
- G2.1a: deterministic Primary Authority election concluído.
- G2.1b: stateful Primary Authority + epoch/status concluído.
- G2.1c: adapter Foundry + lifecycle/settings/reconciliation concluído.
- Última suíte validada externamente: 108/108 PASS.
- Próxima microtarefa: **G2.2a — CommandTransport contract + authenticated sender boundary**.

## ORDEM DE LEITURA OBRIGATÓRIA

Antes de alterar código, leia nesta ordem:

1. `Documentos/00_README_FIRST.md`
2. `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`
3. `Documentos/GATES/12_G2_AUTHORITY_COMMANDS_MUTATIONCOORDINATOR.md`
4. `Documentos/03_CHAT_CODEX_MICROTASK_PROTOCOL.md`
5. `Documentos/05_CODING_STANDARDS_AND_DEPENDENCIES.md`
6. `Documentos/PLAYBOOKS/30_TESTING_ACCEPTANCE_PLAYBOOK.md`
7. `Documentos/PLAYBOOKS/36_MULTIPLAYER_CONCURRENCY_RECOVERY.md`
8. `docs/BUILD_STATE.md`
9. `docs/G2_MT03_FOUNDRY_AUTHORITY_ADAPTER_REPORT.md`
10. este arquivo.

O Master/DEC tem autoridade superior ao código quando houver conflito.
Se houver ambiguidade normativa material: PARE a parte afetada e registre `SPEC CONFLICT`.
Não improvise uma terceira regra.

## PASSO ZERO — PREPARAR O WORKSPACE

Este ZIP não inclui `node_modules`.

Na raiz do projeto:

```bash
npm install
npm run typecheck
npm run test:unit
npm run validate:package
```

Todos devem ficar verdes antes de iniciar nova implementação.

Depois execute:

```bash
npm run build
```

IMPORTANTE:
O `dist/main.js` existente no checkpoint é anterior às últimas alterações de source.
O primeiro rebuild oficial é obrigatório antes de gerar qualquer ZIP para Foundry.

Após o build, verifique pelo menos:

```bash
node --check dist/main.js
```

Não altere dependências/versões apenas para fazer testes passarem.
Dependências atuais intencionais:
- `typescript: 5.9.2`
- `esbuild: 0.27.2`

## BASELINE QUE DEVE SER PRESERVADA

### Primary Authority já implementada

O projeto já possui:

- eleição determinística pura;
- preferred GM ativo;
- fallback determinístico por `userId`;
- `PrimaryAuthorityService`;
- `authorityEpoch`;
- status stateful;
- listeners `onChanged`;
- snapshot/reidratação;
- adapter Foundry;
- world settings;
- resolução inicial em `ready`;
- reconciliação por `userConnected`;
- persistência atômica de identity + epoch;
- comportamento consistente em intervalo sem GM;
- sync remoto monotônico/fail-closed;
- composition root do G1/G2.

Não reimplemente isso.

### Invariantes da Authority que NÃO podem regredir

1. Existe uma única Primary Authority técnica global por mundo.
2. Ser GM não implica automaticamente ser a authority.
3. Preferred GM online vence.
4. Preferred GM offline cai para fallback.
5. Fallback considera apenas GMs ativos.
6. Fallback é explicitamente ordenado por `userId`; nunca usa ordem incidental da collection.
7. Authority é resolvida em `ready`, não em `init`.
8. Troca efetiva de executor incrementa epoch exatamente uma vez.
9. Reordenação de collection não incrementa epoch.
10. Retorno do mesmo executor após ausência temporária não fabrica epoch.
11. Estado persistido de identity + epoch é tratado atomicamente.
12. Overflow/estado inconsistente deve falhar fechado, nunca aplicar mudança parcial.
13. Players não devem escrever authority state.
14. Ainda NÃO existe CommandTransport/socket real, CommandBus, dedupe ou locks — não finja que existe.

## PRÓXIMA MICROTAREFA EXATA

### G2.2a — CommandTransport contract + Authenticated Sender Boundary

Faça SOMENTE esta microtarefa.

Objetivo:
definir os contratos puros que separam intenção recebida do contexto autenticado fornecido pelo transporte.

Deve incluir, no mínimo:

- envelope de command transportado;
- `commandId`;
- `type`;
- `contractVersion`;
- `payload`;
- expected revisions quando aplicável como estrutura de contrato;
- contexto autenticado separado;
- authenticated sender derivado do transporte/server context;
- nenhuma confiança em `userId` fornecido pelo payload;
- response/receipt transport-level mínimo ou contrato equivalente;
- interfaces independentes de socketlib/native socket.

Regras críticas:

- NÃO escolha ainda socketlib ou native socket como implementação definitiva.
- NÃO implemente broadcast execution.
- NÃO implemente CommandBus completo.
- NÃO implemente dedupe.
- NÃO implemente LockManager.
- NÃO implemente MutationCoordinator completo.
- NÃO implemente TransactionStore/Recovery.
- NÃO exponha `game.user` diretamente ao core do command.
- Transporte pode variar por Foundry version; semântica da Authority não.
- Somente handlers public-callable poderão futuramente ser alcançados via transporte.
- Internal-only futuramente deve ser rejeitado até para GM.
- Runtime schema validation acontecerá antes do handler; não antecipe biblioteca nova sem necessidade.
- Payload de cliente expressa intenção, não identidade autenticada.

Referência normativa principal:
`Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`, Authority/Command Pipeline, em especial Primary Authority, Transport/Socket, Authenticated Context e Security Boundaries.

## TAMANHO DA MICROTAREFA

Preferir pequeno cluster coeso, aproximadamente:
- 1–3 arquivos de produção novos/alterados;
- 1 arquivo de testes direcionados;
- documentação `BUILD_STATE`/relatório depois de verde.

Não faça refactor transversal por conveniência.

## TESTES OBRIGATÓRIOS DA G2.2a

Além dos happy paths, crie testes que provem:

- sender autenticado não é lido do payload;
- payload contendo `userId` falso não substitui authenticated sender;
- envelope inválido é rejeitado;
- `commandId` ausente/inválido é rejeitado no boundary adequado;
- `type` vazio/inválido é rejeitado;
- contract version inválida é rejeitada;
- expected revisions permanecem dados declarativos, não authority;
- contrato puro não depende de Foundry/socketlib;
- nenhum teste atual de G0/G1/G2.1 regride.

Depois execute:

```bash
npm run typecheck
npm run test:unit
npm run validate:package
npm run build
node --check dist/main.js
```

Se o projeto tiver scripts adicionais de artifact/package que continuem aplicáveis, execute-os também.

## PROCESSO DE TRABALHO

Para cada microtarefa:

1. leia as seções normativas;
2. liste os invariantes;
3. implemente o mínimo;
4. escreva testes adversariais;
5. rode testes direcionados;
6. rode regressão completa;
7. só depois atualize `docs/BUILD_STATE.md`;
8. gere relatório da microtarefa;
9. não avance automaticamente para a próxima microtarefa.

Formato de conclusão esperado:

```text
IMPLEMENTADO
- ...

TESTADO
- ...

NÃO ALTERADO
- ...

RISCO / DÍVIDA
- ...

PRÓXIMA MICROPARTE
- ...
```

## POLÍTICA DE CHECKPOINT

Ao concluir G2.2a:

- NÃO continue sozinho para G2.2b.
- gere um ZIP completo do projeto;
- inclua source, tests e docs;
- não inclua `node_modules`;
- informe comandos executados e resultados;
- informe SHA-256 do checkpoint;
- devolva o ZIP para nova auditoria externa.

## GITHUB

Não use a linha antiga 0.2.x como base.
Não faça merge para `main` nem publique release sem solicitação explícita.
O checkpoint deste ZIP é a verdade de desenvolvimento mais nova.

## REGRA FINAL

Qualidade e aderência normativa têm prioridade sobre velocidade.
Um teste verde não autoriza violar o Master.
Nenhuma mutation importante pode ganhar um caminho que futuramente permita bypass da Primary Authority/Command pipeline.
