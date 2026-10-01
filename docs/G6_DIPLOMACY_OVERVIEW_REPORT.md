# G6 — Painel geral da diplomacia

Data: 2026-10-01 (America/Sao_Paulo). Branch: `feat/g6-continuous`. Base: `4dd1fe0ffd719d3cbc881a67cfba4682d1b46654`.
Escopo: esta parte de G6.9, Rodada 08 §5.1/§5.7. Concluir, validar automaticamente, registrar e parar. Teste real no Foundry somente ao concluir o bloco G6.

## Entrega

- Nova aba **Painel geral** e API imutável `diplomacy.overview.query`, comando público autenticado `diplomacy:overview`. A abertura existente em Relações foi preservada.
- Totais dos seis owners: Relations, Reputation, Agreements, Territory, Disputes e Proposals. Lista priorizada por quebra registrada, atraso após carência, vigência alcançada, disputas abertas, propostas pendentes, vigência próxima e alteração recente. Desempate estável por momento admitido e tupla owner/ID.
- Cards, pesquisa, filtro de categoria, páginas, horizonte configurável em ticks do mundo (0–1.000.000) e janela recente em horas reais (1–720). Contagens por registro depois de audiência, busca e fences, antes de categoria/página; razões múltiplas no mesmo registro não duplicam sua linha ou o total de atenção.
- Clique abre o inspector existente de cada owner/proposta, limpando pesquisa, páginas e árvore anterior. Ações continuam nos comandos semânticos existentes; o painel não cria ou altera registros.
- Atraso considera somente obrigações atuais, visíveis, pendentes/due e além da carência; satisfeitas e snapshots substituídos não geram atraso. Só lifecycle breached ou decisão confirmada visível conta como quebra; alegação automática não confirma quebra.
- Vigência usa estado persistido active/breached e tick autenticado da autoridade; prazo alcançado gera alerta, sem expiração automática. Suspensões e encerramentos não recebem alerta dinâmico de prazo/atraso. Disputas abertas incluem latent/active/escalated/frozen. Inbox admite GM ou remetente original, sem expor intenção ou dados privados.

## Fronteiras e correções verificadas

| Situação | Comportamento entregue |
|---|---|
| Acordo público contém obrigação secret/restricted | Só termos admitidos contribuem para atraso/quebra. Controller de parte pode ver restricted; stranger não; secret só GM. Sem payloads, refs, contagens de termos/evidências ou snapshots no DTO. |
| Atualização privada em reputação/território público | Mudanças recentes e timestamps de auditoria são GM-only; Player recebe changes=null e aviso explícito, sem deduzir o momento por updatedAt global. |
| Proposta pendente de outro Controller | Somente GM/remetente contam e recebem o item. |
| Registro ou grafo em recuperação | Fence exclui registros antes de derivados e agregação; indisponibilidade não mostra contagens antigas. |
| Deadline em tick 0, limite inclusivo ou soma acima de MAX_SAFE_INTEGER | Comparação exata BigInt; horas reais não se misturam com ticks. |
| Troca de filtro, aba, registro ou consulta falha | Página/filtros têm escopo do painel; falha limpa dados antigos; drilldown usa consulta de detalhe autenticada. |

## Validação automática

- **1049/1049 testes PASS**, 0 FAIL/0 skipped; 24 novos nesta parte.
- **17/17 específicos** e **69/69 verticais** PASS na regressão completa.
- **TypeScript, build, package e validate:release PASS** localmente, Node 24.19.0.
- SHA256 do ZIP local validado: `cb3bba42de4cd00ce6108424f68dc8dfb7781a45d565c6eae0d1dd9b5846f990`.
- Commit de código validado: `d48b83cc150051fdb31c50c26386169c0fd987fd`.
- Workflow [36861469777](https://github.com/STR4DZN/Nova-Base/actions/runs/36861469777), job `110366455248`: **SUCCESS**, Ubuntu + Node 22.23.2. Os oito workflows acionados concluíram com SUCCESS. CI confirma 17/17 específicos, 69/69 verticais e 1049/1049 na regressão completa, além de typecheck/build/package/validate:release.
- [ZIP v0.0.8 e logs](https://github.com/STR4DZN/Nova-Base/actions/runs/36861469777/artifacts/11161623971), artifact `g6-diplomacy-overview-candidate`, retenção de 14 dias. Hash do container: `sha256:e7c7a14733d644c0ff41d85c18561e8535330a5705cfb73bf425d605479fc08a` (não é o hash isolado do ZIP instalável).
- Evidência permanente: `docs/evidence/G6_DIPLOMACY_OVERVIEW_VALIDATION.json` e `docs/evidence/G6_DIPLOMACY_OVERVIEW_CI_SUMMARY.log`.

Cobertura adicionada: 17 testes específicos e sete cenários verticais (24 novos), incluindo seis owners, controller/stranger/GM, inbox, terms públicos/restritos/secretos, satisfação, fences, mais de duas páginas, recarga, clocks, imutabilidade e bindings de UI.

A primeira execução específica identificou um fixture de escaping com lifecycle inválido que não produzia destaque; o fixture passou a solicitar uma quebra confirmada explícita. Não houve falha de implementação nesse caso. Typecheck e demais específicos/verticais passaram.

Host e transporte simulados. Nenhum teste real no Foundry ou publicação de release nesta parte.

## Limites e próxima parte

Read model reconstruído por scan dos owners, sem persistir contadores, projetar todo o histórico de reputação ou duplicar estado. A janela recente mostra a última alteração canônica de cada registro (inclusive configuração de reputação), não cada evento; records legados com timestamp 0 não são apresentados como recentes. Não equivale ao Activity Feed unificado de §6.4 nem a índices/cache especializados ou benchmark Foundry SMALL/MEDIUM/LARGE. O card de todos mostra atenção; o total da lista pode incluir registros recentes sem pendência, conforme a explicação da UI.

Crises e dependências futuras não são simuladas nem apresentadas como zero/concluídas. G6/§5.1 permanecem parciais quanto a essas dependências, às demais UIs/integrações/diagnósticos e à escala real.

**Próximo passo:** formulários de reconhecimento territorial, com seleção das reivindicações visíveis e proposta/revisão pela autoridade. Parar após esta parte e aguardar autorização. Foundry real ao fim do bloco G6; G7 não iniciado.
