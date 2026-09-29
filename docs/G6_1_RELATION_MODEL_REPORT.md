# G6.1 — Modelo de relações

Data: 2026-09-29. Estado: **G6.1 concluído / G6 em andamento**.

O usuário reportou smoke G5 com todos os testes passando no Foundry e autorizou
continuar. O fechamento do G5 registra essa evidência como relato do usuário;
não afirma possuir logs individuais de Player, reload ou failover físico.

## Objetivo e autoridade

Implementar somente Relation definitions/instances, parties, axes e lifecycle,
conforme Master §18, DEC-098–104, DEC-3201–3350 §1.1–1.2 e
`Documentos/GATES/16_G6_RELATIONS_REPUTATION_AGREEMENTS_TERRITORY.md` (G6.1).
Arquivos permitidos: `src/relations/types/*`, `src/relations/definitions/*`,
`tests/relations/*` e documentação de estado/relatório.

## Implementado

- Definition de tipo versionada e registry de versões exatas, com freeze e
  snapshots imutáveis. Não há presets inventados nem atualização automática de
  instâncias quando se registra uma nova versão.
- Instance com ID `rel_*` segundo a convenção existente, referência da definition
  e sua versão, schema, revision, parties, scope, baseAxes, visibility e timestamps.
- Parties Domain, Population Group, Operational Group, Notable, Actor, entidade
  narrativa e refs de integração namespaced. People embedded exige ID local e
  Domain proprietário. Parties são entidades, não contas User.
- Cardinalidade por definition, roles extensíveis e rejeição de entidades
  repetidas. Relação pode existir sem Domain proprietário.
- Eixos namespaced extensíveis, ranges/defaults inteiros seguros e scores base
  separados de qualquer valor temporário/derivado. Sem eixo universal obrigatório.
- Relação simétrica usa scores compartilhados; assimétrica registra from/to por
  party e mantém direções independentes. Scores omitidos podem usar o default da
  definition em um resolver futuro; o validator não fabrica scores persistidos.
- Stance manual opcional; stance derivada não é armazenada na base.
- Lifecycle mínimo active/ended: ended conforme DEC-104, preservando parties e
  scores e bloqueando reabertura silenciosa. Não há Command de encerramento nem
  apagamento de histórico nesta etapa; eventos/histórico entram no G6.2.
- Guard puro de duplicatas: mesmo type/parties/scope bloqueado por padrão,
  múltiplos types coexistem, escopos diferentes coexistem e allowMultiple é
  explícito. Mudança da versão da definition não contorna esse guard.

## Erros/gaps e soluções

| Item | Causa | Solução e resultado |
| --- | --- | --- |
| Ausência da fundação Relations | G6 ainda não iniciado | Tipos, validadores e registry isolados adicionados |
| BUILD_STATE ainda aguardava G5 | Confirmação do usuário ocorreu após último commit | Registrar aceitação reportada e G6.1 concluído, preservando evidência histórica |
| Comparação de scope sensível à ordem de propriedades | Serialização bruta pode variar | Guard compara chave canônica type/id/uuid; teste verifica ambas as ordens |
| Fixture Compendium inválida no primeiro teste | UUID de teste não obedecia ao helper existente | Corrigir fixture; nenhuma mudança no helper global |

## Checklist de fronteiras e segurança

- Relation continua independente de Reputation, Agreement e Territory.
- Nenhuma nova source-of-truth persistida: são contratos e validação pura.
- Sem alteração de schema Domain, namespace de flags, migração ou índice global.
- Sem leitura de clock, writes Foundry, socket, saldo econômico ou People.
- Sem facade pública parcial, UI fictícia ou bypass de Command/autoridade.
- Visibility é validada no modelo; projeção de secrets ainda não está implementada
  nem é exposta a Players.
- Existence dos refs e optimistic revision de mutações serão revalidados por
  serviços/Commands futuros. Esta etapa verifica forma do ref e versão do conteúdo;
  não diz que o documento referenciado existe no mundo.
- Permissões/recovery/reload de storage são N/A nesta microbuild, pois não há
  endpoint mutante nem storage. JSON round-trip está coberto por teste.

## Testado

- `node tests/run-tests.mjs`: **754/754 PASS**, 0 FAIL, 0 SKIP.
- **61 testes G6.1**, incluindo schema/refs inválidos, User rejeitado, bilateral/
  multi-party, direção, range, duplicatas, no-op lifecycle, snapshots, registry,
  versões, serialization/round-trip e fixture de 1000 relações.
- `node node_modules/typescript/bin/tsc --noEmit`: **PASS**.
- Build e validações do ZIP instalável anterior: **PASS**. O modelo não está
  publicado no runtime; release G5 v0.0.6 permanece igual.
- `git diff --check`: **PASS**.

## Entrega e parada

Checkpoint ZIP com os três fontes Relations, os testes e documentos atualizados.
Aplicar a um checkout do projeto para revisão/desenvolvimento; não é um módulo
instalável no Foundry nem uma UI nova.

Próxima microbuild: **G6.2 — modificadores temporários e histórico relacional**.
Nenhuma implementação de G6.2 foi iniciada. Não há blocker conhecido nesta etapa.
