# G6 — relatório da candidata publicada

> Revisão posterior: candidata v0.0.8 com 13 defeitos corrigidos nos blocos G0–G6 e 878/878 testes locais PASS. Este relatório conserva sua evidência histórica; ver `docs/G0_G6_REVIEW.md`. Novo smoke da build corrigida é necessário.

Data: 2026-09-30. Repositório: STR4DZN/Nova-Base, branch `feat/g6-continuous`. Baseline remoto recuperado: `b9fa7fe`. Módulo atual: `0.0.7`.

**Resultado revisado pela auditoria integral: núcleo implementado, cobertura do plano parcial. 859/859 testes automatizados PASS; smoke Foundry PASS reportado pelo usuário em 2026-09-30; cobertura integral do G6 ainda não concluída. G7 não iniciado.** A candidata G6 v0.0.7 está publicada no GitHub como prerelease para testes. A matriz normativa completa e as lacunas estão em `docs/G6_FULL_SPEC_AUDIT.md`; passar os testes do código existente não comprova funcionalidades ausentes.

## Implementação verificada

| Área | Comportamento |
| --- | --- |
| Relações | Definitions versionadas; partes/direções; eixos base; modificadores temporários; incidentes/reversões; histórico preservado após encerramento |
| Reputação | Sujeito/audiência independentes; trilhas/faixas; ajustes/reversões/decadência; projeção de faixa sem divulgar score reservado |
| Acordos | Draft, propostas e rodadas separadas de termos vigentes; aceitações por partes; ativação, emendas, suspensão, quebra e término independentes |
| Obrigações | Evidência, alegação, contestação e decisão separadas; vencimento/tolerância são leitura derivada; consequência somente por decisão explícita |
| Território | Uma árvore física compartilhada; árvore administrativa independente; claims/recognition/presence/influence/rights separados; links, occupation e disputes persistentes |
| Transferências | Seleção explícita de claims de ownership; concorrentes permanecem; lote revalida todos os alvos; não transfere propriedade de Facility |
| Capacidades | Providers de acordo/direito territorial; escopo, condições, validade e provenance; fonte expirada é retirada sem apagar história |
| Autoridade | Commands via CommandBus existente; sender autenticado pelo transporte; fresh state, revisão e locks canônicos; API pública sem store/save/adapter |
| Propostas | Controller propõe; GM aprova/rejeita/edita; pedido original imutável; aprovação revalida estado atual e grava revisão/entidade no mesmo plano durável |
| Persistência/recovery | Journal por entidade com ownership default NONE e nome neutro; transações duráveis; idempotência sobrevivendo ao reinício; isolamento de falhas incertas e reconciliação dos efeitos |
| Interface | ApplicationV2; seis abas; listas paginadas; árvores física/admin por índice de filhos; inspectors e histórico lazy; ações sem edição direta de flags |

## Problemas encontrados e corrigidos

| Problema | Causa | Correção e evidência |
| --- | --- | --- |
| API não compilava | Facade chamava `CommandBus.request`, inexistente | Usa `execute`; TypeScript PASS |
| Comandos novos não podiam ser registrados | Registry era congelado antes de compor G6 | Freeze ocorre após todos os registrations; regressão G5 e testes de composição PASS |
| Gravação concluída não podia confirmar commit | Session permanecia em `prepared` | Entrada durável em `committing` antes dos efeitos/gravações; teste vertical e storage incerto PASS |
| Incidente remoto era rejeitado | Histórico exige prefixo `reve`, mas recebia ID `cmd` | ID de evento determinístico derivado do comando; referência de comando mantida; incidente/reload/dedupe PASS |
| Possível repetição econômica ao retomar acordo | Comparação apenas com operações atualmente efetivas esquecia efeitos suspensos | Histórico de operações executadas no envelope de acordo; ativação/suspend/resume/reload não repetem pagamento |
| Consequência poderia ser confundida com atraso | Due/compliance não equivalem a quebra confirmada | Consequência exige decisão explícita `breached` com `applyConsequences`; decisão repetida não paga novamente |
| Resultado incerto poderia expor estado parcial | Gravação podia ocorrer sem confirmação de resposta | Stage não publica cache; fence bloqueia queries; recovery conclui lote apenas após comparação before/after |
| Recovery podia sobrescrever alteração externa | Repetição cega de after-image | Estado deve corresponder exatamente ao before ou after registrado; divergência mantém isolamento |
| Receipt de efeito recuperado podia ficar sem registro | Caminho de recovery não registrava todos os checkpoints | Intenção durável antes de executar efeito ausente; receipt/confirmação reconciliada persistidos antes do commit |
| Caminho de transferência ignorava validação de referências | Retorno antecipado antes da validação geral de parties | Todos os targets revalidam Domain/Actor/People via owner; comprador ausente não altera claims |
| Prévia podia ser confirmada com outra ação | UI guardava apenas um booleano de validação | Prévia vinculada a campos, ID de ação e revisão; edição/staleness exige nova prévia |
| Projeção podia revelar pai/link oculto ou metadados extras | Cópia de estado/campos sem resolver visibilidade do destino | Projeção territorial seleciona campos; pai/link/dispute refs ocultos são filtrados na autoridade; teste com marcador reservado PASS |
| Revisão do GM podia divulgar novo source secreto ao jogador | Query de proposta devolvia approvedIntent integral | Original permanece exato; visibilidade aplicada à intenção revisada antes de responder ao proponente |
| Obligation antiga podia ser projetada pela visibilidade de termo novo com mesmo ID | Filtro apenas por `termId` | Resolve snapshot exato de proposal/amendment antes da projeção |
| Recovery journal podia ser compartilhado com OBSERVER | Persistência transacional não exigia ownership privado | Criação/update explicitamente NONE; leitura de journal com permissões de Player falha; teste específico PASS |
| Prévia de hierarquia tinha custo quadrático | Recalculava ancestry de todos os nodes repetidamente | Descendentes por índice de filhos e caminhada iterativa; fixture de cadeia de 5000 mantida |
| Runner no sandbox escondia/falhava subprocessos | Restrição ambiental de IPC/subprocesso | Suíte real executada com autorização fora dessa restrição; contagem de subtestes conferida nos logs |

## Validação executada

| Verificação | Resultado |
| --- | --- |
| Suíte completa `npm test` | **859 testes, 859 PASS, 0 FAIL, 0 skipped** |
| Testes verticais G6.9/G6.10 e regressões da auditoria | **26 PASS**, incluindo quatro regressões que falhavam antes |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run validate:package` | PASS |
| `npm run validate:artifact` | PASS; ZIP de instalação coincide com manifest/bundle locais |
| Checkpoint completo | PASS; conteúdo necessário presente e integridade CRC verificada |
| Sintaxe de `scripts/g6-foundry-smoke.js` | PASS; execução real pendente |

Os testes novos exercitam runtime composto, transporte GM/Player, controle de Domain mesmo com Journal OBSERVER, persistência/restart, commandId durável, storage incerto, transferência parcial, divergência, projeção secreta, owner econômico real, aprovação editada, rejeição/staleness, UI via facade, árvores e paginação com 250 registros adicionais. As fixtures anteriores incluem 1000 relações e cadeia de 5000 territórios. Esses números são cenários de teste, não benchmarks de um mundo Foundry de produção.

Log completo preservado: `docs/evidence/G6_AUTOMATED_TESTS.log`. O checkpoint contém os testes para reprodução.

## Limites e requisitos de homologação

1. **O isolamento de transporte e a configuração de ownership foram testados com doubles. Isso não comprova que o servidor Foundry v13 remove os flags canônicos da carga enviada ao Player.** O smoke inspeciona os flags no cliente Player. Se ele encontrar estado canônico, este candidato NÃO está homologado: será necessário corrigir a persistência/sanitização do servidor antes de liberar G6.
2. Renderização e dispatch da UI foram testados em modo headless. Layout, interação real e integração com o ciclo ApplicationV2 precisam da sessão Foundry.
3. Efeito econômico padrão implementado: `domain-manager:economy` / `economy:adjust`. Intents sem owner real registrado são rejeitados; não há confirmação fictícia de efeitos de People/Facility ou terceiros.
4. Condições não resolvidas permanecem insatisfeitas. O runtime permite um resolver autoritativo por `diplomacyConditionSatisfied`; payload de cliente não fornece esse resolver.
5. Não há vencedor de guerra, legitimidade automática, transferência automática de Facility ou avanço para G7. Crises/conflitos opcionais não ganham execução fictícia.
6. Não foi feita execução GM/Player/F5/failover em Foundry neste chat. Não declarar `GATE_ACCEPTED` com base somente em testes headless.

## Roteiro no Foundry

Instalar pelo Manifest URL `https://github.com/STR4DZN/Nova-Base/releases/download/v0.0.7/module.json` e reiniciar a sessão. Versão `0.0.7`, canal `g6-candidate`. O script e o guia estão nos assets da release.

O script agora executa os fluxos centrais com fixtures próprias e fases persistidas: GM setup → Player propostas → GM aprovação editada/rejeição e injeção controlada → F5/recovery → troca de Primary GM → Player final. Instruções completas: `docs/G6_FOUNDRY_SMOKE_GUIDE.md`. Relatórios JSON acumulados são exportados por `DM_G6_SMOKE.download()` em cada navegador.

O próprio arquivo foi executado em um teste integrado contra os owners de produção, com Documentos/DOM/transporte simulados. O teste confirma as chamadas sem desativar o rate limit, recovery do before-image com recibo econômico perdido sem novo pagamento, exigência de recarga/troca real de ID/epoch nas fases e bloqueio se flags canônicas forem expostas ao Player. Isto não é evidência de execução no servidor Foundry.

O roteiro cobre os fluxos centrais, não todas as combinações possíveis dos modelos. Interação visual detalhada, integrações externas sem owner e execução real continuam nos limites descritos acima.

## Checkpoint e publicação

O usuário autorizou o upload e solicitou o roteiro Foundry em 2026-09-30. O commit `4959ade` inclui script, guia, teste integrado e evidência de 855 testes PASS.

A revisão automática rejeitou o push desta atualização: considerou que o texto do usuário autorizou upload de forma geral, mas não nomeou explicitamente `STR4DZN/Nova-Base` e `feat/g6-continuous` como destino. Nenhum commit foi enviado e não houve tentativa por outra rota. O destino configurado em origin é `https://github.com/STR4DZN/Nova-Base.git`.

Bloqueio histórico superado após a solicitação explícita de publicação no GitHub e a verificação da conta/repositório. A conexão autenticada publicou uma árvore idêntica à candidata local e o workflow `36718651288` reconstruiu, testou e publicou a prerelease `v0.0.7`. Manifest e ZIP foram baixados pelas URLs públicas, tiveram CRC/estrutura conferidos e são idênticos aos artefatos locais. Isto não marca `GATE_ACCEPTED`.

Após completar as pendências normativas e obter smoke real aprovado, reavaliar a aceitação do G6. A candidata publicada serve para testar o núcleo implementado. G7 continua fora da autorização atual.

## Auditoria integral do plano — 2026-09-30

A revisão de G6.1–G6.10, Master §18–21/§10–12/§25 e Rodada 08 completa corrigiu a classificação de conclusão. `docs/G6_FULL_SPEC_AUDIT.md` registra requisito por requisito. Permanecem stance derivada, templates versionados, overview/feeds, detalhes/formulários/preview, diagnostic/repair, retry/status público e consumers incompletos; infraestruturas gerais de gates posteriores continuam explicitamente separadas.

Quatro bugs tiveram reprodução negativa antes da correção: unicidade não aplicada no runtime, right herdável de tratado sem grant nos filhos, controle inconsistente de território restrito e metadados extras no DTO público de Reputation/influence. Todos foram corrigidos e retestados; suíte final 859/859 PASS. Não foi realizada homologação Foundry nem publicação remota nesta auditoria.

## Confirmação dos testes no Foundry — 2026-09-30

Após receber o manifest da candidata v0.0.7, o script e o roteiro de execução, o usuário informou: “Todos os testes passaram”. Registrado como aprovação do smoke pelo usuário. Relatórios JSON das sessões não foram anexados; resultados individuais, versões de ambiente e logs não são presumidos. As lacunas normativas da auditoria continuam abertas e impedem declarar G6 100% concluído ou iniciar G7.
