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

## Verificação preparada

16 testes específicos e 6 verticais novos: criação múltipla, políticas/faixas inválidas, privacidade, versão e histórico, no-op, estado antigo, relógio, autoria GM, compartilhamento de snapshots, concorrência, proposta/aprovação, repetição/recarga, preservação do formulário, XSS e round-trip de 100 trilhas.

Workflow `g6-reputation-validation.yml` executa typecheck, testes alvo, suíte completa, build/package e validação de artefato. Evidências e ZIP em artifact, sem publicar release.

**Resultado ainda pendente de execução.** Não há terminal local disponível; testes são executados no GitHub Actions e não registrados como Foundry real.

## Limites e parada

Esta parte cobre configuração de trilhas. Filtros avançados de histórico/atividade e integrações compostas de reputação com os demais owners permanecem nas outras linhas de G6. Scheduler geral permanece G8. Smoke/interface/transporte reais continuam pendentes.

A versão publicada não é substituída. G6 não é homologado e G7 não é iniciado. Após registrar os testes, parar e aguardar próxima parte.
