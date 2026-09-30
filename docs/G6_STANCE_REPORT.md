# G6 — postura das relações: parte isolada

Data: 2026-09-30. Base: `f571772ff7b388c17197a4c5edc38ef038fd1849`, branch `feat/g6-continuous`.

## Escopo e fonte

Parte autorizada: postura das relações (G6.1 / Rodada 08 §1.2 e §2.3 / Master §18).
A pedido do usuário, executar esta parte, testar, registrar e parar. G7 e demais lacunas do G6 não são iniciados.

## Lacunas e soluções

- Definitions anunciavam postura derivada, mas somente os eixos eram projetados: agora há regras ordenadas, versionadas e configuráveis, com intervalos inteiros por eixo e razões estruturadas.
- Postura manual era persistível apenas na criação, sem operação editável: definir/limpar usa o owner, autoridade, revisão e histórico existentes. Evento `stance-changed` registra antes/depois. Mesmo valor é no-op.
- UI não mostrava postura: inspector mostra classificação e eixos que a sustentam; postura manual tem formulário; criação oferece política e regras avançadas.
- Regras e modificadores privados são filtrados ANTES de classificar para cada audiência. Não entram em razões nem revelam sua existência pelo status da política.
- Relações assimétricas recebem classificações independentes por direção. Postura manual mantém o escopo de instância do contrato anterior.
- Drafts novos usam snapshot v2 com regras iniciais de confiança/neutralidade/desconfiança; thresholds pertencem ao conteúdo do draft. Core não fixa eixos ou rótulos.
- Snapshots antigos não são migrados nem alterados. Definitions derived sem regras continuam legíveis, explicitamente sem configuração. Não se inventa classificação retrospectiva.

## Verificação executada

15 testes específicos e 2 testes verticais novos: intervalos/defaults, condições combinadas/precedência, sigilo de regras/modificadores, expiração, direções, legacy, validação de políticas, edição/limpeza/no-op, histórico forjado, round-trip, permissões, proposal/GM approval/retry/reload, XSS, drafts/UI e fixture de 1000 registros.

Workflow `g6-stance-validation.yml`: typecheck, testes alvo, suíte completa, build, package e validação da candidata. Evidências e ZIP gerados como artifact; não publica release.

**Estado final: PARTE IMPLEMENTADA E AUTOMATED PASS; aguarda smoke/interface reais do Foundry.**

- Commit de código validado: `bb844d6c0aeb0236e10deca740d759372de21bd5`.
- Workflow: https://github.com/STR4DZN/Nova-Base/actions/runs/36762797052 — SUCCESS.
- Alvo de postura: 15/15 PASS. Cluster vertical G6: 32/32 PASS, incluindo dois novos casos.
- Suíte completa: **895/895 PASS**, fail/cancelled/skipped = 0 (baseline documentada 878; 17 casos novos).
- TypeScript, build, empacotamento e validação de release/pacote/artefato: PASS.
- ZIP de revisão e logs: https://github.com/STR4DZN/Nova-Base/actions/runs/36762797052/artifacts/11119627107
- Digest do artifact agregado: `e90da6714d6882bc5ef2a8f3b3cee0c2e32fceb00009d1ed9aab791f36094b96`.
- Primeira execução `36762629087`: typecheck encontrou TS18046 no acesso a `stanceChange` após validação. A referência passou a usar o tipo já validado; reexecução completa acima PASS. Nenhum teste foi removido ou ignorado.

Este chat não tem terminal/checkout local; a execução ocorreu em Ubuntu/Node 22 no GitHub Actions. A aprovação automática não equivale a execução real Foundry.

## Limites

- Resolver desta parte utiliza axes/modifiers. Agreements/Reputation/Disputes como fontes compostas continuam pendência separada da matriz.
- Nenhuma prova de interface real ou transporte/flags Foundry foi inventada. Smoke Foundry permanece separado.
- Esta parte não fecha G6 nem homologa versão nova. Release v0.0.8 publicada permanece preservada.
- Não instalar o ZIP de revisão pelo manifest antigo: é candidato para revisão/testes; publicação e bump de versão não fazem parte desta tarefa.

## Próxima parte

Após teste e registro, parar. Selecionar a próxima pendência da matriz G6 somente em nova autorização.
