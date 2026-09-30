# G6 — configuração das trilhas de reputação pela interface

Data: 2026-09-30. Base: `18ad4f02fd1656d0a7f92664a336f8776580d859`. Branch: `feat/g6-continuous`.
Escopo: uma parte de G6.3; Master §19 e Rodada 08 §1.3/§2.2/§5.2. Implementar, testar, registrar e parar.

## Problema e solução

- Criação pela UI usava uma única trilha fixa: formulário agora permite múltiplas trilhas com nome, identificador opcional, intervalo, baseline, valor inicial, faixas, privacidade, apresentação pública e decadência opcional.
- Faixas são configuradas por linhas `Nome | mínimo | máximo`. O owner valida inteiros, cobertura integral quando a apresentação é só faixa, ordem e ausência de sobreposição.
- Registro existente aceita adicionar trilha e configurar políticas pelo GM. Configuração recebe versão livre sob catalog lock; snapshots anteriores e entries de pontuação são preservados. Intervalo de uma trilha existente é imutável para preservar significado histórico; outro intervalo usa outra trilha.
- Antes/depois de versão e relógio, fonte, motivo e tempo constam de histórico de configuração independente das entries de pontuação. Alteração igual é no-op.
- Ao criar/adicionar trilha, o cursor de decadência é ancorado no tempo da autoridade; propostas usam tempo da aprovação. Troca de decay/baseline reancora explicitamente, sem cobrar períodos anteriores pela nova política.
- GM recebe políticas, valores e audit; Player mantém apresentação sanitizada, sem definições, cursor, fontes ou histórico de configuração. Alteração/probing de política existente via proposta Player é bloqueada antes de resolver a trilha.
- Campos de criação/configuração são preservados após erro; criação permite adicionar/remover e reordenar índices das trilhas sem perder os demais campos. Conteúdo é escapado.
- Nenhum Scheduler, saldo paralelo ou novo runtime/transporte foi criado.

## Verificação executada

16 testes específicos e 6 verticais novos: criação múltipla, políticas/faixas inválidas, privacidade, versão e histórico, no-op, estado antigo, relógio, autoria GM, compartilhamento de snapshots, concorrência, proposta/aprovação, repetição/recarga, preservação do formulário, XSS e round-trip de 100 trilhas.

- Testes específicos: **16/16 PASS**; cluster vertical: **38/38 PASS** (6 novos).
- Suíte completa: **917/917 PASS, 0 FAIL, 0 skipped**; 22 novos testes nesta parte, em relação ao código de postura.
- TypeScript, build, package e validate:release: **PASS**. Artefato installável v0.0.8 validado; nenhuma release publicada nesta parte.
- Commit validado: `3f04a5208aaf13beb2cbc4d00cc7fcca7dc83c16`.
- Workflow [36767688723](https://github.com/STR4DZN/Nova-Base/actions/runs/36767688723), job `110065874459`, Ubuntu + Node 22.23.3; resultado **SUCCESS**.
- [ZIP e logs do candidato](https://github.com/STR4DZN/Nova-Base/actions/runs/36767688723/artifacts/11122515857), artifact `g6-reputation-candidate`, retenção de 14 dias. O SHA-256 do container de evidências/ZIP é `sha256:5cf57fa5ed4b43125bdcc34a1ccc2cd046bbd6dde911361633eed92f5920fda2`; não é um hash isolado do ZIP instalável.
- Evidência persistida: `docs/evidence/G6_REPUTATION_CONFIGURATION_VALIDATION.json`.

Foram corrigidas duas falhas da validação: o teste integrado aplicava unwrap de Result a uma leitura direta do adapter; o BUILD_STATE anterior não usava a referência literal Gate G6 exigida pelo validador. As asserções foram mantidas e a suíte completa foi reexecutada. Não há terminal local disponível; execução ocorreu no GitHub Actions, sem teste real Foundry.


## Roteiro de verificação no Foundry — pendente

1. Como GM, abrir Diplomacia → Reputação e criar registro com duas trilhas: uma pública com apresentação só por faixa e outra secreta; configurar faixa, baseline, valor inicial e decadência. Salvar e reabrir.
2. Alterar nome/faixas/apresentação da trilha pública, fornecer motivo e conferir nova versão/histórico, pontuação e entries preservadas. Salvar de novo sem mudança: revisão e histórico não aumentam.
3. Adicionar terceira trilha; tentar faixas sobrepostas/incompletas e valor inicial fora do intervalo. A operação deve falhar e preservar os campos preenchidos.
4. Aplicar ajuste e decadência pela ação existente após um período; reconfigurar decadência e conferir cursor a partir do tempo atual. Recarregar com F5 e repetir consulta: efeitos e histórico não duplicam.
5. Como Player, conferir apenas faixa pública; a trilha secreta, valores numéricos ocultos, definições e histórico de configuração não devem estar no DTO recebido. Player não configura política existente nem envia essa alteração como proposta.
6. Verificar proposta de criação: antes da aprovação não existe registro; após aprovação, o cursor usa tempo da autoridade que aprovou.

Resultado deste roteiro: **não executado nesta parte**. CI usa owners reais com host/transporte simulados; não comprova DOM/Documentos/socket/flags privados em servidor Foundry.

## Limites e parada

Esta parte cobre configuração de trilhas. Filtros avançados de histórico/atividade e integrações compostas de reputação com os demais owners permanecem nas outras linhas de G6. Scheduler geral permanece G8. Smoke/interface/transporte reais continuam pendentes.

A versão publicada não é substituída. G6 não é homologado e G7 não é iniciado. **Execução encerrada após registrar os testes.** Aguardar próxima parte.
