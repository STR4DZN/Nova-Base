# G6 — filtros e fontes do histórico de reputação

Data: 2026-10-01 (America/Sao_Paulo). Branch: `feat/g6-continuous`. Base: `b5f58e4c7298c04b1147d1d8efa9c713fb4c810e`.
Escopo: esta parte de G6.3/G6.9, Rodada 08 §5.2/§5.7. Concluir, validar automaticamente, registrar e parar. Teste real no Foundry somente ao concluir o bloco G6.

## Problemas, causas e soluções

| Problema | Causa | Solução |
|---|---|---|
| Histórico mostrava apenas evento, motivo e momento | Inspector genérico e janela bruta de entradas | Inspector GM apresenta ID, trilha, tipo, delta aplicado, antes/depois, fonte, tick, data e ID compensado pela reversão. |
| Filtro local de uma página esconderia resultados existentes em outras páginas | Paginação ocorreria antes de selecionar lançamentos | Read model da autoridade filtra todo o histórico por trilha, ajuste/reversão/decadência, tipo de fonte, referência exata ID/UUID e intervalo inclusivo de ticks; paginação posterior. Sem intervalo, inclui lançamentos antigos sem tick; com intervalo, exclui os sem tick. |
| Resumo da página não representa as fontes de todo o filtro | Falta de agregação e contagem antes da paginação | Breakdown completo do filtro, agrupado por trilha/tipo/modo de referência/valor. Totais, ganhos, perdas, saldo, contagens por tipo e primeiro/último momento; página de fontes separada da página de lançamentos. |
| Somar escalas diferentes ou valores solicitados produz números incorretos | Mistura de trilhas e ausência de distinção entre pedido e delta efetivamente aplicado | Cada trilha conserva sua escala. Somas usam deltas canônicos após limites, reversões e decadência; BigInt interno serializado em strings decimais exatas. Não confunde saldo filtrado com valor atual da trilha. |
| Contagens/fontes permitiriam inferir trilhas privadas ou números da apresentação por faixa | Novo DTO poderia contornar a projeção Player existente | Histórico, fontes e filtros detalhados são GM-only. Player/stranger recebem a projeção existente sem entries, fontes, definições ou contagens; pedidos detalhados falham com permissão antes de checar existência de trilha/fonte. |
| Mudança de filtros podia abrir página sem resultados ou carregar critérios de outro registro | Estado de paginação/filtro não tinha ciclo próprio | Aplicar/limpar/drilldown reinicia ambas as páginas e mantém registro selecionado. Troca de registro/aba limpa filtros. Input inválido preserva critérios aplicados/páginas e campos digitados; falha de leitura remove detalhe antigo e conserva campos para retry. |
| Próxima página aparecia quando a página final tinha exatamente 30 entradas | Decisão baseada somente no tamanho da página | Botões usam offset/limit/total da autoridade. Entradas e fontes têm total e controles separados. |

Filtros de reputação/source paging só são aceitos no namespace Reputation, com ID de detalhe. Entradas e fontes usam DTOs imutáveis separados do estado canônico. Referências ID e UUID com o mesmo texto permanecem distintas. Labels, motivos, filtros e referências são escapados; tabelas têm rolagem horizontal e horários identificados como São Paulo.

A fonte apresentada é a referência canônica já registrada. O pipeline público atual registra a referência do comando; esta parte não inventa vínculos com Mission/Agreement nem resolve documentos externos. Valores atuais, faixas, políticas, configurações, receipts e histórico append-oriented permanecem nos owners existentes. Nenhum storage, migração, índice novo, Scheduler ou execução de efeitos.

## Validação

- **21/21 testes específicos** e **62/62 verticais** PASS; 26 novos nesta parte (21 específicos + 5 verticais).
- **1025/1025 testes PASS**, 0 FAIL/0 skipped; 26 novos nesta parte.
- TypeScript/build/package/validate:release **PASS localmente e no GitHub Actions**, Node local 24.19.0.
- SHA256 do ZIP local validado: `515ec4cacddffb23bd4fd63086ddde8f080799e79f314da2c2ad49a7f2b6f0ca`.
- Commit de código validado: `b0bc32c596a05755c2354b79aaef74801fdf917a`.
- Workflow [36858630332](https://github.com/STR4DZN/Nova-Base/actions/runs/36858630332), job `110357074624`: **SUCCESS**, Ubuntu + Node 22.23.3. Os sete workflows acionados no commit concluíram com SUCCESS.
- [ZIP v0.0.8 e logs](https://github.com/STR4DZN/Nova-Base/actions/runs/36858630332/artifacts/11160037181), artifact `g6-reputation-history-candidate`, retenção de 14 dias. Hash do container: `sha256:3a1ca7cc1f8947b7d44c5482ebae257af6c928a3acdc6275ec7d4d3df3e28d69` (não é o hash isolado do ZIP instalável).
- Evidência permanente: `docs/evidence/G6_REPUTATION_HISTORY_VALIDATION.json` e `docs/evidence/G6_REPUTATION_HISTORY_CI_SUMMARY.log`.

Cobertura específica: schemas/escopo do namespace, combinação de filtros/intervalos inclusivos/ticks nulos, ID versus UUID, separação de trilhas/fontes, mais de duas páginas, BigInt acima de MAX_SAFE_INTEGER, campos canônicos e projeção GM/Player, DTO imutável, escaping, formulários, reset/preservação e bindings de aplicação/drilldown/paginação/limpeza.

Cobertura vertical com runtime/owners reais: ajuste limitado à faixa, retry do mesmo ticket, compensação exata, decadência negativa/positiva, filtros pelo API autenticado, fontes command/UUID canônicas, Player/stranger sem histórico ou probing, páginas independentes pelo controller, troca de registro, recarga sem mutação e página final com 30 lançamentos.

O primeiro typecheck identificou que TypedRef permite campos opcionais id/uuid. O helper foi ajustado para ler o UUID presente ou o ID previamente validado, mantendo a distinção dos tipos e os validators existentes. Os testes específicos e verticais passaram na primeira execução. Na revisão final, a descrição do filtro por referência exata foi corrigida para informar o tipo da fonte mesmo sem sourceType explícito; a regressão completa do código final passou. Host e transporte simulados; nenhum teste real no Foundry e nenhuma release publicada nesta parte.

## Limites e próxima parte

Esta parte conclui os filtros e o breakdown das fontes canônicas do histórico de reputação para o GM; apresentações Player por faixa/score continuam sanitizadas conforme política. Históricos de configuração preservam sua janela existente. O read model ainda percorre o histórico; não equivale a índices especializados, Activity Feed ou benchmark Foundry SMALL/MEDIUM/LARGE.

G6 permanece parcial nas demais UIs, integrações, providers, diagnósticos e escala real.

**Próximo passo:** painel geral da diplomacia com pendências e alertas. Parar após esta parte e aguardar autorização. Foundry real ao fim do bloco G6; G7 não iniciado.
