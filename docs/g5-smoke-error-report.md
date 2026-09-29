# Correções após o smoke G5

O log enviado teve 84 PASS, 2 FAIL e 1 SKIP. O fluxo de workforce do Project já
funcionou: início reservou workers, conclusão e cancelamento liberaram reservas.

## Corrigido no Domain Manager

- `durationTicks: null` era substituído pelo default devido a `??`. Agora null
  explícito ou default null preserva duração indefinida. Omitted usa o default;
  zero permanece zero. Avançar 100 ticks não conclui a atividade indefinida.
- A conclusão automática salvava lifecycle mas descartava o último avanço.
  Agora elapsedTicks e conclusão são persistidos juntos; falha ao salvar o pai
  mantém lifecycle e progresso anteriores. Durações e progresso inválidos são
  rejeitados.
- Durante essa regressão, foi encontrado um receipt narrativo built-in que
  exigia handler customizado na compensação. Novos receipts built-in recebem
  marca explícita e são compensados sem handler, pois não criam efeito externo.
  Handlers registrados continuam sujeitos à sua compensação. Transações antigas
  sem essa marca continuam com comportamento fail-closed; não há migração ampla
  nem liberação automática de efeitos desconhecidos.

## Corrigido no runner

O runner antigo tentava chamar `api.people.allocateWorkforceReservation`, método
interno removido da API pública por proteção de escrita. O runner v2 obtém a
reserva por `api.projects.startProject`, mantém os identificadores/intents reais
e prepara uma fixture própria de crash. Dois F5 reais verificam primeiro a
fence e depois a recovery. People permanece público somente para leitura.

## Erros de outros módulos no log

| Evidência | Origem observada | Próximo ajuste nesse módulo/mundo |
| --- | --- | --- |
| `cm-game-settings.js:62`, `html.find is not a function` | CodeMirror no hook renderMacroConfig | Adaptar hook ao elemento DOM de ApplicationV2 do Foundry v13 |
| `domain-floor.webp` / `domain-barrier.webm` ausentes; Sequencer baseTexture/blob | domain-expansion-lancer / arquivos de efeito | Restaurar assets e corrigir caminhos dos efeitos |
| `wreck.js:104`, acesso a `items` de null | csm-lancer-qol | Conferir Actor/token existente e adicionar tratamento de Actor ausente |
| TIMER.jpg 404 e avisos de depreciação/cache de áudio | Assets e outros módulos do mundo | Conferir caminhos e versões compatíveis com Foundry v13 |

Esses módulos não estão neste repositório; seus erros não foram alterados no ZIP
do Domain Manager. Não expor novamente mutações internas para contornar o runner.

## Entrega

Mantidos manifesto 0.0.6, nome do módulo ZIP e tag v0.0.6. Fontes, bundle e mapa
regenerados. 693/693 testes passaram, TypeScript e validações do pacote passaram.
O runner novo acompanha instruções para homologar GM, reload/recovery e Player.
O smoke live e failover físico com segundo GM ainda precisam ser executados.
