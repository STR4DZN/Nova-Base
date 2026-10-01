# G6 — negociação de acordos pela interface

Data: 2026-09-30 (America/Sao_Paulo). Branch: `feat/g6-continuous`. Base: `bac1668c3e1e6a4105e1f7139d126b1de90faff3`.
Escopo: uma parte de G6.4/G6.9, Master §20 e Rodada 08 §2.6/§5.3. Implementar, testar automaticamente, registrar e parar. Teste real no Foundry somente após concluir o bloco G6, conforme instrução do usuário.

## Problemas, causas e soluções

| Problema | Causa | Solução e comportamento |
|---|---|---|
| Renovação existia no modelo, mas não na UI | Operação e campos ausentes | Renovação manual envia `renew` pelo owner/pipeline existentes, com revisão e `automatic:false`; exige estender prazo finito de acordo active/breached. Player envia proposta ao GM. |
| Proposta não podia receber prazo pela UI nem expirar | Criação fixava `proposalExpiresAtWorldTick:null`; falta de ação | Prazo de aceitação separado da duração dos termos, controle por proposta e ação geral `expire-proposal`; o owner usa relógio da autoridade, preserva termos vigentes em emenda expirada e mantém snapshots. |
| Erro de ID podia agir sobre a última proposta | Lookup desconhecido caía em fallback | ID explicitamente informado precisa existir; escolha em branco usa proposta em negociação ou a mais recente. A revisão exata da proposta acompanha cada ação. |
| UI mostrava somente ID/estado/revisão da proposta | Ausência de read model e renderer de rodadas | Snapshots, oferta, votos e duração de cada rodada; diff de adição/remoção/alteração, campos, payload, ordem e duração com antes/depois. Primeira oferta não inventa rodada anterior. |
| Diff poderia revelar conteúdo secreto se calculado sobre dados canônicos | Comparação precedendo projeção | Owner compara exclusivamente snapshots já filtrados para a audiência. Alteração apenas secreta não produz mudança no diff visível. Não há comparação privada no DTO Player. |
| Emenda sem reapproval falhava pela UI | Faltava `amendmentId` exigido pelo modelo | UI fornece identificador de auditoria único; evento e snapshot before/after continuam no owner existente. |
| Falha apagava formulário | Inputs não eram retidos pelo controller | Operação, seleção, valores, checkbox, motivo e texto preservados após falha local/autoridade; motivo do controle de expiração retido apenas na proposta escolhida. Conteúdo escapado. |

Nenhum Scheduler, serviço de negociação paralelo, transporte ou armazenamento novo. Diff é read model derivado, não uma cópia persistida da verdade. Renovação automática geral e tempo/calendário permanecem G8.

## Validação

- **938/938 testes PASS**, 0 FAIL, 0 skipped; 21 testes novos nesta parte.
- **15/15 específicos** e **44/44 verticais** (6 novos) PASS.
- TypeScript, build, package e validate:release: **PASS**, localmente (Node 24.19.0) e no GitHub Actions (Ubuntu + Node 22.23.3).
- Commit de código validado: `ad54ca355eda1c525c38a1489db2200cf9e846cb`.
- Workflow [36800171829](https://github.com/STR4DZN/Nova-Base/actions/runs/36800171829), job `110172500981`: **SUCCESS**.
- [ZIP v0.0.8 e logs](https://github.com/STR4DZN/Nova-Base/actions/runs/36800171829/artifacts/11135348160), artifact `g6-agreement-negotiation-candidate`, retenção de 14 dias. Hash do container de evidências: `sha256:633c2ab597c9ed38ae089007cfaa59b504b3fbd3196809799045dd37a5f0c3e7` (não é o hash isolado do ZIP instalável).
- Evidência permanente: `docs/evidence/G6_AGREEMENT_NEGOTIATION_VALIDATION.json` e `docs/evidence/G6_AGREEMENT_NEGOTIATION_CI_SUMMARY.log`.

A primeira execução completa local teve 937 PASS/1 FAIL: a seção de próxima ação citava só Agreements, mas o validador documental exige também Relations/Reputation/Territory. O registro foi corrigido sem enfraquecer o teste, e a suíte completa foi repetida. No preparo dos testes verticais, foram corrigidos três erros de fixture (assinatura da consulta de capabilities, campo items da lista e referência compartilhada que o envelope JSON rejeita); as asserções de negócio permaneceram.

Os testes usam owners reais com host/transporte simulados. Não há execução de UI/Documentos/socket em servidor Foundry real nesta parte; conforme instrução do usuário, essa execução fica para o encerramento do bloco G6. Nenhuma release foi publicada.

## Limites e próxima parte

Não fecha G6 ou toda a Agreement UI: dashboard por estado, inspector completo de obrigações/vencimentos/compliance/evidências/emendas, editor completo de snapshots com vários termos, integrações dos demais owners e benchmarks reais continuam nas linhas parciais da matriz. O formulário básico de termos continua produzindo um snapshot com um termo; esta parte não o apresenta como editor completo. Diff de todos os termos recebidos via API funciona.

**Próximo passo:** completar o inspector dos acordos — vencimentos, cumprimento das obrigações, evidências e histórico de emendas. Parar após esta parte e aguardar autorização. Foundry real fica para o fim do bloco G6; G7 não iniciado.
