# DOMAIN MANAGER — BUILD STATE

## Identidade

- Module version: `0.0.8` (candidata corrigida G0–G6; novo smoke necessário; cobertura G6 parcial)
- Gate de código atual: `G6 — auditoria do plano: núcleo implementado; cobertura normativa parcial e smoke Foundry PASS reportado pelo usuário`
- Estado local: `GATE_G6_PARTIAL_SPEC_COVERAGE_AUTOMATED_PASS_NEW_FOUNDRY_SMOKE_REQUIRED`
- Estado externo: `GATE_G5_ACCEPTED_GATE_G6_IN_PROGRESS`
- Schema Domain: `1`
- Data de conclusão do Gate G5: `2026-09-21`

## Parte G6 — Reivindicações herdadas no inspector — 2026-10-01

- Inspector apresenta reivindicações vigentes locais/herdadas com origem e revisão, policy de propagação separada e escolha independente de hierarquia física/administrativa. Navegação admitida para a origem sem copiar claims para coleções locais.
- Estado fresco e audiência por origem: controle do filho não concede acesso aos pais. Ancestral privado/ausente/inválido/fenced interrompe a cadeia; ciclo visível contribui somente fontes locais. Relógio autoritativo e recarga sem writes/eventos.
- **1175/1175 testes PASS** (20 novos), específicos 8/8 e verticais 123/123; TypeScript/build/package/validate:release PASS localmente. GitHub Actions PASS: commit `c59eab694716ffb620ed7df89f1ec7a5dc62f4ad`, workflow `36904323664`; 13 workflows aprovados. Relatório `docs/G6_TERRITORY_CLAIMS_REPORT.md`; evidência `docs/evidence/G6_TERRITORY_CLAIMS_VALIDATION.json`. Nenhuma release publicada.
- **PARAR AQUI. Próximo passo:** prévia dos impactos sobre reivindicações herdadas ao alterar a hierarquia territorial; aguardar autorização. Foundry real ao fim do bloco G6. G6 parcial; G7 não iniciado.

## Parte G6 — Ocupação territorial — 2026-10-01

- Criação e encerramento auditado pela interface, referências visíveis de presença/controle, resumo de estado/vigência, propostas Player e revisão estruturada GM preservando original/identidade.
- Três falhas de privacidade reproduzidas e corrigidas: referências privadas aceitas; end de ocupação secreta; referência privada exposta em aprovação editada. Consulta usa estado fresco. Seleção múltipla preservada; referências indisponíveis exigem reset explícito.
- **1155/1155 testes PASS**, específicos 16/16 e verticais 111/111; TypeScript/build/package/validate:release PASS localmente. GitHub Actions PASS: commit `7746af52868005dcaf54ca791c3e12eaaddc8d2e`, workflow `36899199164`; 12 workflows aprovados. Relatório `docs/G6_TERRITORY_OCCUPATION_REPORT.md`; evidência `docs/evidence/G6_TERRITORY_OCCUPATION_VALIDATION.json`. Nenhuma release publicada.
- **PARAR AQUI. Próximo passo:** exibir reivindicações territoriais herdadas no inspector, com origem e distinção das locais; aguardar autorização. Foundry real ao fim do bloco G6. G6 parcial; G7 não iniciado.

## Parte G6 — Influência territorial — 2026-10-01

- Formulários com vários eixos, limites, decadência, modificadores e vigência; detalhes/cálculo por eixo; propostas Player, aprovação/rejeição GM e encerramento auditado sem apagar histórico.
- Admissão de fonte/modificador secreto, aprovação privada e leitura fresca protegidas. Rascunhos preservados em erro e vinculados à revisão; checkboxes e alternância de encerramento testados.
- **1125/1125 testes PASS**, incluindo 14 específicos e 97 verticais; TypeScript/build/package/validate:release PASS localmente. GitHub Actions PASS: commit `a391b3e2ba875da5ee3982f938e326947c96f57e`, workflow `36896312954`; 11 workflows aprovados. Relatório `docs/G6_TERRITORY_INFLUENCE_REPORT.md`; evidência `docs/evidence/G6_TERRITORY_INFLUENCE_VALIDATION.json`. Nenhuma release publicada.
- **PARAR AQUI. Próximo passo:** formulários de ocupação territorial, com referências visíveis de presença e controle e encerramento auditado; aguardar autorização. Foundry real ao fim do bloco G6. G6 parcial; G7 não iniciado.

## Parte G6 — Ligações territoriais — 2026-10-01

- Escopo: criação/lista/resumo de ligações, destinos visíveis com busca paginada e alteração de estado; propostas/revisão GM preservando pedido original. Foundry real ao fim do bloco G6.
- Corrigidos três defeitos reproduzidos: destinos privados admitidos no submit Player; alteração de link secreto por ID; destino privado exposto na aprovação revisada. Estado fresco, audiência/fences uniformes, locks source/graph/dependências e projeção aprovada sanitizada. Declarações não executam rota/dependências/recursos nem concedem trânsito.
- Rascunhos vinculados à revisão e preservados em erro; seleção fora da página por consulta individual; revisão estruturada e rejeição independente. **1106/1106 testes PASS** (30 novos), específicos 17/17 e verticais 92/92. TypeScript/build/package/validate:release PASS localmente e no GitHub Actions. Commit validado `e0a0d44fd4a373cb80c17adccdea348e51a17bcc`; workflow `36889612860` SUCCESS (dez workflows PASS). Evidência `docs/evidence/G6_TERRITORY_LINKS_VALIDATION.json`. Relatório `docs/G6_TERRITORY_LINKS_REPORT.md`. Nenhuma release publicada.
- **PARAR AQUI. Próximo passo:** formulários de influência territorial, com eixos e modificadores; aguardar autorização. G6 parcial; G7 não iniciado.

## Parte G6 — Reconhecimento territorial — 2026-10-01

- Escopo: formulário contextual, resumo/lista sanitizados, claims visíveis, seis tipos de parte, posições/janelas e proposta/revisão GM sem reescrever pedido original. Concluir, validar automaticamente, registrar e parar. Foundry real ao fim do bloco G6.
- Controller não pode sondar claim secreto: submit admite audiência antes de preparar; secreto/inexistente uniforme. Aprovação editada oculta referências privadas no proposal Player. Reject escreve/bloqueia apenas proposal e não exige disponibilidade do alvo; approve conserva revalidação/locks.
- Rascunho/revisão preservados em erro, reset explícito e isolamento entre registros/abas. Existência de parties validada pela autoridade. Declaração não transfere propriedade nem calcula legitimidade.
- **1076/1076 testes PASS** (27 novos), específicos 17/17 e verticais 79/79. TypeScript/build/package/validate:release PASS localmente e no GitHub Actions. Commit validado `50a6c1be955d541ce09d8030a40b898b9826d7a7`; workflow `36869786902` SUCCESS (nove workflows PASS). Evidência `docs/evidence/G6_TERRITORY_RECOGNITION_VALIDATION.json`. Relatório `docs/G6_TERRITORY_RECOGNITION_REPORT.md`; ZIP/logs no artifact `g6-territory-recognition-candidate` da candidata v0.0.8. Atualizar recognition persistido não existe no owner atual (bulk é opcional); demais UIs/integrações/escala continuam parciais. Nenhuma release publicada.
- **PARAR AQUI. Próximo passo:** formulários de ligações territoriais, com destinos visíveis e estado operacional; aguardar autorização. G6 parcial; G7 não iniciado.

## Parte G6 — Painel geral da diplomacia — 2026-10-01

- Escopo: overview dos seis owners, com pendências/alertas, mudanças recentes GM, filtros/janelas e drilldown seguro. Concluir, validar automaticamente, registrar e parar. Foundry real ao fim do bloco G6.
- Cards/linhas só depois de audiência/busca/fences, antes de categoria/página. Inbox GM/remetente; obrigações atuais visíveis; tick da autoridade para vigência/carência, horas reais para auditoria GM. Sem mutar lifecycle nem confirmar quebra por atraso.
- API pública imutável `diplomacy.overview.query`, aba Painel geral e inspectores existentes. DTO mínimo sem intenções, refs ou termos privados. Consulta falha remove cards antigos.
- **1049/1049 testes PASS** (24 novos), específicos 17/17 e verticais 69/69. TypeScript/build/package/validate:release PASS localmente e no GitHub Actions. Commit validado `d48b83cc150051fdb31c50c26386169c0fd987fd`; workflow `36861469777` SUCCESS (oito workflows PASS). Evidência `docs/evidence/G6_DIPLOMACY_OVERVIEW_VALIDATION.json`. Relatório `docs/G6_DIPLOMACY_OVERVIEW_REPORT.md`; ZIP/logs no artifact `g6-diplomacy-overview-candidate` da candidata v0.0.8. G6/§5.1 parcial nas dependências Crisis/Activity Feed/índices/escala; nenhuma release publicada.
- **PARAR AQUI. Próximo passo:** formulários de reconhecimento territorial, com seleção das reivindicações visíveis e proposta/revisão pela autoridade; aguardar autorização. G6 parcial; G7 não iniciado.

## Parte G6 — Filtros e fontes do histórico de reputação — 2026-10-01

- Escopo: filtros por trilha/tipo/fonte/ID ou UUID/ticks e breakdown GM de todos os lançamentos filtrados antes de paginação; concluir, validar automaticamente, registrar e parar. Foundry real ao fim do bloco G6.
- Entradas e fontes com páginas/totais independentes. Deltas aplicados, antes/depois, reversões, decadência, razões e momentos; somas exatas BigInt em strings, sem mistura de escalas/trilhas. Valores atuais e histórico canônico não são alterados.
- GM-only no owner e consulta de detalhe; Player/stranger sem histórico/fontes/contagens e probing uniforme. UI preserva campos inválidos, reseta páginas na aplicação/drilldown e limpa filtros ao trocar registro/aba.
- **1025/1025 testes PASS** (26 novos), específicos 21/21 e verticais 62/62. TypeScript/build/package/validate:release PASS localmente e no GitHub Actions. Commit validado `b0bc32c596a05755c2354b79aaef74801fdf917a`; workflow `36858630332` SUCCESS. Evidência `docs/evidence/G6_REPUTATION_HISTORY_VALIDATION.json`. Relatório `docs/G6_REPUTATION_HISTORY_REPORT.md`; ZIP/logs no artifact `g6-reputation-history-candidate` da candidata v0.0.8. Nenhuma release publicada.
- **PARAR AQUI. Próximo passo:** painel geral da diplomacia com pendências e alertas; aguardar autorização. G6 parcial; G7 não iniciado.

## Parte G6 — Dashboard dos acordos por estado — 2026-10-01

- Escopo desta parte: dashboard e filtros de ciclo de vida; concluir, validar automaticamente, registrar e parar. Foundry real somente ao fim do bloco G6.
- Cards e dropdown com estados exatos/grupo negociação. Totais calculados pela autoridade após audiência/busca/fences, antes de estado/página; DTO mínimo sem termos/obrigações/definições. Emendas e prazos não alteram lifecycle automaticamente.
- Busca/estado compostos, reset de seleção/página/histórico/editor ao trocar filtro, proteção de namespace/detalhe e UI de consulta indisponível sem contagens antigas.
- **999/999 testes PASS** (21 novos), específicos 17/17 e verticais 57/57. TypeScript/build/package/validate:release PASS localmente e no GitHub Actions. Commit validado `d56323e3bcf3012573db243b3d9f0e7dc3c107fd`; workflow `36854669271` SUCCESS. Evidência `docs/evidence/G6_AGREEMENT_DASHBOARD_VALIDATION.json`. Relatório `docs/G6_AGREEMENT_DASHBOARD_REPORT.md`; ZIP/logs no artifact `g6-agreement-dashboard-candidate` da candidata v0.0.8. Nenhuma release publicada.
- **PARAR AQUI. Próximo passo:** filtros e detalhamento das fontes no histórico de reputação; aguardar autorização. G6 parcial; G7 não iniciado.

## Parte G6 — Editor de múltiplos termos dos acordos — 2026-09-30

- Escopo desta parte: editar vários termos sem perder os existentes; concluir, validar automaticamente, registrar e parar. Foundry real ao fim do G6.
- Cópia de termos/duração, add/remove/move com IDs estáveis, payload JSON completo em campos avançados e prévia obrigatória sanitizada. Erros/conflitos preservam rascunho; edição vinculada às revisões do acordo/proposta.
- Seleção explícita resolvida no owner existente preserva termos privados não incluídos no DTO Player. Aprovação/rounds/ativação/efeitos continuam no pipeline existente; consulta e prévia não executam operações.
- **978/978 testes PASS** (22 novos), específicos 17/17 e verticais 53/53. TypeScript/build/package/validate:release PASS localmente e no GitHub Actions. Commit validado `6fbafd44395fbb76ed0c746070d253ffe0992d95`; workflow `36805799751` SUCCESS. Relatório `docs/G6_AGREEMENT_TERM_EDITOR_REPORT.md`; evidência `docs/evidence/G6_AGREEMENT_TERM_EDITOR_VALIDATION.json`. ZIP/logs no artifact; nenhuma release publicada.
- **PARAR AQUI. Próximo passo:** dashboard dos acordos por estado/filtros; aguardar autorização. G6 parcial; G7 não iniciado.

## Parte G6 — Detalhes dos acordos pela UI — 2026-10-01

- Escopo: vencimentos/tolerância, cumprimento, evidências e histórico de emendas; executar esta parte, validar automaticamente, registrar e parar. Foundry real somente após concluir o bloco G6.
- Obrigações atuais/históricas com termo de origem preservado, estados registrado/derivado, alegação/confirmação/contestação, evidências visíveis e consequências declaradas. Consulta não altera estado ou executa consequências.
- Emendas GM com origem/snapshots/diff sanitizado antes/depois; eventos/páginas existentes. Player mantém fronteira de visibilidade e aprovação pelo GM.
- **956/956 testes PASS** (18 novos), específicos 14/14 e verticais 48/48. TypeScript/build/package/validate:release PASS localmente e no GitHub Actions. Commit validado `cee2e48758539a2c76ea312d66404e84c4f1127b`; workflow `36801837066` SUCCESS. Relatório `docs/G6_AGREEMENT_INSPECTOR_REPORT.md`; evidência `docs/evidence/G6_AGREEMENT_INSPECTOR_VALIDATION.json`. ZIP/logs no artifact; nenhuma release publicada.
- **PARAR AQUI. Próximo passo:** editor completo de múltiplos termos; aguardar autorização. G6 parcial; G7 não iniciado.

## Parte G6 — Negociação de acordos pela UI — 2026-09-30

- Escopo autorizado: renovação manual, prazo/expiração de propostas e comparação entre rodadas; implementar, testar automaticamente, registrar e parar. Teste real no Foundry somente depois de concluir o bloco G6.
- Operações via owner/pipeline existentes; Player envia proposta ao GM. Prazo de aceitação separado da duração dos termos; relógio da autoridade decide expiração. ID explícito inválido não usa fallback.
- Snapshots/ofertas/votos/duração e diff antes/depois para todos os termos recebidos no DTO, calculado após filtro de audiência. Formulários preservados após falha; emenda sem reapproval recebe audit ID.
- **938/938 testes PASS** (21 novos), específicos 15/15 e verticais 44/44. TypeScript/build/package/validate:release PASS localmente e no GitHub Actions. Commit validado `ad54ca355eda1c525c38a1489db2200cf9e846cb`; workflow `36800171829` SUCCESS.
- Relatório: `docs/G6_AGREEMENT_NEGOTIATION_REPORT.md`. Evidência: `docs/evidence/G6_AGREEMENT_NEGOTIATION_VALIDATION.json`. ZIP/logs no artifact; nenhuma release publicada nesta parte.
- Dashboard, inspector completo de vencimentos/compliance/evidências/emendas, editor completo de vários termos e demais linhas G6 continuam parciais.
- **PARAR AQUI. Próximo passo:** inspector dos acordos, aguardando autorização. G6 parcial; G7 não iniciado.

## Parte G6 — Configuração das trilhas de reputação — 2026-09-30

- Instrução atual: executar parte por parte, testar, registrar e parar. Esta tarefa cobre somente configuração de trilhas pela UI.
- Criação com múltiplas trilhas, faixas, intervalo/baseline/valor inicial, visibilidade, apresentação e decadência opcional. GM adiciona trilhas e configura políticas de registro existente.
- Versões globais livres sob catalog lock, snapshots e entries preservados, no-op/revisão, histórico de configuração e cursor ancorado no tempo da autoridade/aprovação. DTO Player sanitizado; configuração de políticas existentes é exclusiva do GM.
- **917/917 testes PASS** (22 novos); específicos 16/16, verticais 38/38. TypeScript/build/package/validate:release PASS. Commit validado `3f04a5208aaf13beb2cbc4d00cc7fcca7dc83c16`; workflow `36767688723` SUCCESS.
- Relatório: `docs/G6_REPUTATION_CONFIGURATION_REPORT.md`. Evidência: `docs/evidence/G6_REPUTATION_CONFIGURATION_VALIDATION.json`. ZIP/logs no artifact; nenhuma release publicada nesta parte.
- Filtros/breakdown de fontes, integrações compostas, demais linhas G6 e verificação Foundry real continuam pendentes. Scheduler geral pertence a G8.
- **PARAR AQUI.** Aguardar próxima parte; G6 parcial e G7 não iniciado.

## Parte G6 — Postura das relações — 2026-09-30

- Instrução atual do usuário: executar parte por parte, testar, registrar e parar. Esta tarefa cobre somente postura das relações.
- Resolver derivado configurável por Definition, eixos efetivos/direções e razões sanitizadas. Regras/modifiers privados filtrados antes de classificar.
- Edição/limpeza de postura manual pelo owner e pipeline existentes, com revisão, no-op e eventos antes/depois. UI exibe postura/razões e oferece criação/política/regras e edição manual.
- Drafts novos usam snapshot v2; snapshots v1 preservados. Definitions antigas derived sem regras indicam política sem configuração.
- **895/895 testes PASS** (17 novos); TypeScript/build/package/release validation PASS no GitHub Actions. Commit de código validado `bb844d6c0aeb0236e10deca740d759372de21bd5`, workflow `36762797052` SUCCESS.
- Relatório: `docs/G6_STANCE_REPORT.md`. Evidência: `docs/evidence/G6_STANCE_VALIDATION.json`. ZIP/logs no artifact do workflow; não houve publicação de release.
- G6 segue parcial. Razões compostas com Agreements/Reputation/Disputes, demais linhas da matriz e smoke/interface reais continuam pendentes.
- **PARAR AQUI.** Aguardar escolha/autorização da próxima parte; não iniciar G7.

## Revisão atual G0–G6

Candidata v0.0.8: 13 defeitos reproduzidos/corrigidos; 878/878 testes locais PASS. Relatório `docs/G0_G6_REVIEW.md`. Novo smoke necessário; a confirmação Foundry da v0.0.7 permanece histórica. Os registros de gates abaixo não equivalem a ausência de bugs. G6 permanece parcial e G7 não iniciado.

## Estado canônico

- **Gate G0**: Concluído e verificado.
- **Gate G1**: Concluído e verificado (Domain schema, validators, JournalEntry adapter, repository, index incremental, cycle prevention).
- **Gate G2**: Concluído, auditado, homologado e aceito em ambiente real Foundry VTT v13.351 + Socketlib.
- **Gate G3**: Concluído, auditado, homologado e aceito soberanamente pelo usuário (`GATE_G3_HOMOLOGATED_AND_ACCEPTED`).
- **Gate G4**: Concluído, auditado, homologado e aceito pelo usuário. Implementação completa de todos os 10 microbuilds (G4.1 a G4.10) de acordo com o Master Specification (§14, §11–12, §42, DEC-1416–2305) e `Documentos/GATES/14_G4_ECONOMY_RESOURCES.md`.
- **Gate G5**: Concluído (G5.1 a G5.10 e remediações) e aceito pelo usuário em 2026-09-29 após declarar “rodei o .js que voce me mandou e todos os testes passaram” e autorizar a continuidade. Estado: `GATE_G5_ACCEPTED`. Evidência de smoke é reportada pelo usuário; logs separados de Player/F5/failover não foram fornecidos nem são inventados neste registro.
- **Gate G6**: **núcleo dos quatro subsistemas implementado; G6.1–G6.9 não estão 100% completos contra todo o plano**. Auditoria integral: `docs/G6_FULL_SPEC_AUDIT.md`. Quatro bugs de unicidade, herança de right de tratado, acesso territorial restrito e projeção pública foram reproduzidos/corrigidos. **859/859 testes PASS**, TypeScript/build/package PASS. Permanecem lacunas de stance, templates, overview/UI, diagnostics/consumers, retry/status público, escala e dependências posteriores. Em 2026-09-30, após a entrega da candidata e do roteiro, o usuário confirmou “Todos os testes passaram”. Smoke Foundry registrado como PASS reportado pelo usuário; relatórios JSON individuais não foram anexados e não são inventados. Esse resultado não cobre funcionalidades ausentes do plano. Não marcar `GATE_ACCEPTED`. G7 não iniciado.
  - **G5.1 (Project model / lifecycle — definition / instance / revision)**: Concluído. Separação formal de `ProjectDefinition` (reutilizável, versionada, catalogada em `ProjectDefinitionRegistry`) e `ProjectInstance` (execução concreta por domínio com `revision`, `workRequired`, `workCompleted`, `lifecycle`, `clampProgress`), cálculo puro de progresso inteiro derivado (`calculateProjectProgress` com clamp de goal por DEC-086, DEC-087, DEC-090), máquina de estados de ciclo de vida (`validateProjectLifecycleTransition` cobrindo os 11 estados canônicos de Master §15.4 e reabertura auditada via `allowReopen`), definições canônicas iniciais (`CANONICAL_PROJECT_DEFINITIONS`), e modelo de capacidade em domínio `domain-manager:projects` (`DomainProjectsData`, `tryGetDomainProjectsData`, `withDomainProjectsData`, `getDomainProjectsData`) validado e registrado no `CapabilityRegistry`.
  - **G5.2 (Progress / resolver / history)**: Concluído. Implementação do modelo de histórico append-oriented (`ProjectEntry`), validação estrita de fontes e metadados (`PROJECT_ENTRY_SOURCE_KINDS`), transição de estado pura (`applyProjectEntry`) com suporte a setbacks negativos (DEC-088) e clamp no objetivo por padrão (DEC-090), regras de compensação/reversão auditada (bloqueio de reversão dupla com `DM_PROJECT_REVERSAL_ALREADY_EXISTS` e proibição de reversão de reversão), contrato extensível de resolução pura de progresso (`ProgressResolver`), implementação padrão (`StandardProgressResolver` / `domain-manager:standard`) sem mutação da instância, e catálogo `ProgressResolverRegistry` com factory e suporte a congelamento (`freeze`).
  - **G5.3 (Start plan)**: Concluído. Implementação do modelo de plano pré-execução (`ProjectStartPlan`), avaliação desacoplada de pré-condições (`evaluateProjectStartPlan`) sem mutação direta de Domain/People/Economy, mapeamento de intenção de reservas econômicas (`ProjectEconomicReservationIntent`) para custos upfront e reserved, avaliação de workforce (`ProjectWorkforceIntent`) e requisitos estruturados (`ProjectRequirementEvaluation` com status satisfied/unsatisfied/unavailable/error), detecção e diagnóstico de blockers (`ProjectBlocker`: capacidade ausente, fundos insuficientes, requisitos insatisfeitos, ciclo de vida inválido e `DM_PROJECT_REVISION_MISMATCH`), e commit atômico (`commitProjectStartPlan`) com suporte aos estados `active` e `initializing`, incremento de revisão e geração de `ProjectEntry` inicial.
  - **G5.4 (Advance / block / pause / cancel)**: Concluído. Implementação do modelo de avanço e ciclo de vida (`ProjectAdvancePlan`, `ProjectReceipt`, `ProjectCancellationPolicy`, `ProjectAdvanceBatchPlan`), avaliação pura de pré-condições de avanço (`evaluateProjectAdvancePlan`) sem mutações em Domain/People/Economy, execução atômica de avanço (`commitProjectAdvance`) com suporte a auto-complete configurável (DEC-089), integridade de recuos/setbacks negativos com piso em zero (DEC-088) e clamp no objetivo por padrão (DEC-090), bloqueio com razão diagnóstica obrigatória (`blockProject`) e desbloqueio com transição legal para `active` ou `paused` (`unblockProject`), suspensão com preservação de reservas/alocações (`pauseProject`) e retomada auditada (`resumeProject`), cancelamento conforme política (`cancelProject`) proibindo cancelamento de projetos terminados, e suporte a avanço em lote atômico ou best-effort (`evaluateProjectAdvanceBatchPlan`, `commitProjectAdvanceBatch`).
  - **G5.5 (Completion plan)**: Concluído. Implementação do modelo de conclusão não-checkbox (`ProjectCompletionPlan`, `ProjectCompletionOutcome`, `ProjectCompletionSideEffect`, `ChildReceipt`), avaliação pura de pré-condições de conclusão (`evaluateProjectCompletionPlan`: meta de unidades inteiras atingida `workCompleted >= workRequired`, ciclo de vida `active`, capacidade de projetos habilitada, requisitos de conclusão e contínuos satisfeitos, e checagem de concorrência otimista), commit atômico de conclusão (`commitProjectCompletion`) com transição para `completed`, registro de `completedAt`, incremento de revisão, geração de `ProjectEntry` de encerramento (`PROJECT_COMPLETED`), execução de side-effects coordenados (criação de Facility por DEC-096, recompensas de recursos) e emissão de recibos filhos (`ChildReceipt`) com registro explícito de falhas parciais (`partialFailure: true`, sem ocultação por Master Spec §15.4).
  - **G5.6 (Facility model / readiness)**: Concluído. Implementação formal do subsistema de instalações em `src/facilities/*` de acordo com Master Spec §16 e DEC-2601–2750: `FacilityDefinition` (reutilizável, versionada, catalogada em `FacilityDefinitionRegistry` com definições canônicas de armazém, oficina básica e posto de guarda), `FacilityInstance` (execução concreta por domínio ou independente com ID estável, `level`, `revision`, slots, módulos e upgrades ativos), separação estrita e inequívoca entre ciclo de vida (`FacilityLifecycle`: planned, underConstruction, inactive, operational, degraded, disabled, decommissioned, destroyed) e prontidão operacional (`FacilityReadiness`: ready, limited, blocked, unavailable) onde `lifecycle ≠ readiness` (instalações não-operacionais ou com readiness blocked/unavailable não concedem capacidades), cálculo puro de capacidades efetivas (`calculateFacilityEffectiveCapabilities`), modelo de capacidade em domínio `domain-manager:facilities` (`DomainFacilitiesData`, `tryGetDomainFacilitiesData`, `withDomainFacilitiesData`, `getDomainFacilitiesData`) registrado no `domainCapabilityRegistry`.
  - **G5.7 (Facility maintenance / repair)**: Concluído. Modelo de manutenção preventiva e reparos (Master Spec §16.5, DEC-2601–2750): tracking de ciclos e status de manutenção (`FacilityMaintenanceStatus`: current, due, overdue, exempt), avaliação pura de plano de manutenção (`evaluateFacilityMaintenancePlan`) e commit atômico (`commitFacilityMaintenance`), plano de reparos com distinção estrita entre reparo direto e reparo dependente de projeto (`evaluateFacilityRepairPlan`, `commitFacilityRepair`), degradação estrutural e aplicação pura de dano (`applyFacilityDamage`) com geração de condições namespaced (`FacilityCondition`) e integridade limitada por piso 0 e teto max.
  - **G5.8 (Downtime model)**: Concluído. Modelo formal de atividades de interlúdio e downtime (Master Spec §17, DEC-2751–2900): `DowntimeDefinition` (catálogo e registry com definições canônicas de treinamento de atributos, patrulha de guarda e forja de armamentos), `DowntimeInstance` (execução concreta por domínio com escopos individual/grupo/domínio/flexível e ciclo de vida de 9 estados), separação estrita de modelo contra projetos (`Downtime ≠ Project`), suporte a atividades de duração indefinida e finita (`durationTicks: null | number`), participantes representados por entidades de domínio (`participant ≠ Foundry User`), e modelo de capacidade em domínio `domain-manager:downtime` (`DomainDowntimeData`) registrado no runtime.
  - **G5.9 (UI + integrations)**: Concluído. Implementação de apresentadores, renderizadores HTML semânticos com proteção estrita contra XSS via `escapeHtml`/`escapeAttribute`, e controllers para ApplicationV2 (com mock isomorfo headless) para os três subsistemas: Projects (`ProjectsApplication`, `ProjectsApplicationController`, `buildProjectsViewModel`, `renderProjectsSubsystemHtml`), Facilities (`FacilitiesApplication`, `FacilitiesApplicationController`, `buildFacilitiesViewModel`, `renderFacilitiesSubsystemHtml`), e Downtime (`DowntimeApplication`, `DowntimeApplicationController`, `buildDowntimeViewModel`, `renderDowntimeSubsystemHtml`).
  - **G5.10 (Cross-system acceptance & scale)**: Concluído. Verificação formal de todos os 8 critérios obrigatórios do checklist de aceitação do Gate G5 (progresso inteiro e % derivado, pureza de resolvers, completion não-checkbox, integridade de fronteiras sem mutação de Economy/People, desacoplamento estrito `lifecycle ≠ readiness`, `Downtime ≠ Project` com participantes de domínio, reporte explícito de falhas parciais, e histórico append-oriented com proteção contra dupla reversão); integração com `DomainIntegrityChecker` para validação de integridade dos domínios G5; suíte de estresse e volume multi-domínio em escala (10 domínios, 25 projetos com 5 lotes sucessivos de avanço totalizando 125 entradas, 30 instalações com condições degradadas/manutenção atrasada, 20 atividades de downtime com durações indefinidas e finitas, e geração em massa de ViewModels); e testes adversários de concorrência otimista (`DM_PROJECT_REVISION_MISMATCH`) e rejeição estrita de transições ilegais de ciclo de vida (`DM_PROJECT_INVALID_TRANSITION`).

## Correção do blocker do smoke People/Workforce — 2026-09-29

- O smoke real abortou em Project Start + workforce 5: `this[#domainRepository].update is not a function`.
- `PeopleService` público agora usa `PeopleReadRepository` e não expõe allocate/release/restore de workforce.
- `WorkforceReservationService` interno recebe `DomainRepositoryContract` mutável e é injetado em Projects e recovery pelo `WorkforceReservationPort`.
- Sete testes de regressão da composição real foram adicionados. O código original reproduziu o erro do Foundry; a correção passou.
- Validação local final: **686/686 testes PASS**, TypeScript/build/package/artifact PASS.
- Relatório: `docs/G5_SMOKE_PEOPLE_WORKFORCE_FIX_REPORT.md`.
- Pendência histórica superada pela aceitação/continuidade do usuário em 2026-09-29. A aceitação não se baseia somente nos testes locais; o usuário reportou smoke sem falhas no Foundry.

## G6.1 — Modelo de relações — 2026-09-29

- Fonte: Master §18, DEC-098–104, DEC-3201–3350 §1.1–1.2 e Gate G6.1.
- `RelationDefinition` versionada, parties tipadas com roles extensíveis, referências de People com Domain proprietário, escopo independente de Domain, scores base inteiros por axis/range.
- Simetria explícita: score compartilhado em relação simétrica; direção por parties em relação assimétrica. Lifecycle mínimo `active`/`ended` (DEC-104), sem reabertura silenciosa.
- Validação estrita de referências, timestamps, cardinalidade, scores, visibilidade, versão e duplicatas. Stance derivada não é persistida como base.
- Registry guarda versões exatas e snapshots imutáveis; não sobrescreve instâncias com conteúdo novo.
- **754/754 testes PASS**, sendo 61 novos de G6.1; TypeScript PASS; fixtures pequenas, inválidas, multi-party, round-trip e escala de 1000 relações.
- Relatório: `docs/G6_1_RELATION_MODEL_REPORT.md`. G6.2 e G6.3 foram executados após autorização contínua do usuário; 10 e 10 testes alvo PASS, TypeScript PASS.
- Release instalável permanece no G5 corrigido `v0.0.6`; esta etapa entrega checkpoint de código, sem disponibilizar comportamento diplomático incompleto ao usuário do Foundry.

## Evidência local Gate G5

| Verificação | Resultado |
|---|---|
| TypeScript strict (`tsc --noEmit`) | PASS (0 erros) |
| Testes unitários e integração (`node tests/run-tests.mjs`) | PASS — 679/679 (0 falhas, 0 regressões) |
| Relatório de Aceitação G5 | Gerado (`docs/GATE_G5_ACCEPTANCE_REPORT.md`) |
| Regressões G0/G1/G2/G3/G4 | 0 (todos os 444 testes anteriores preservados e passando) |
| Testes novos Gate G5 | 235 testes dedicados (G5.1 a G5.10: 101 testes + 66 testes adversários em g5-revalidation-adversarial.test.ts + 10 testes de lock-set em g5-lockset-contract.test.ts + 5 testes de fence em g5-recovery-fence.test.ts + 19 testes de kernel em g5-transaction-kernel.test.ts + 34 testes de hardening T1–T22 em g5-kernel-hardening.test.ts) |
| Remediação de Auditoria G5-AUD-001 a G5-AUD-010 | PASS — 100% remediado, endurecido e verificado |
| Remediação de Revalidação G5-REVAL-001 a G5-REVAL-012 | PASS — 100% remediado, endurecido e verificado |
| Remediação de Revalidação 2 G5-REVAL2-001 a G5-REVAL2-010 | PASS — 100% remediado, endurecido e verificado |
| Remediação de Revalidação 3 G5-REVAL3-001 a G5-REVAL3-007 | PASS — 100% remediado, endurecido e verificado |
| Remediação de Revalidação 4 G5-REVAL4-001 a G5-REVAL4-012 | PASS — 100% remediado, endurecido e verificado |
| Remediação de Revalidação 5 G5-REVAL5-001 a G5-REVAL5-009 | PASS — 100% remediado, endurecido e verificado |
| Remediação de Revalidação 6 G5-REVAL6-001 a G5-REVAL6-005 | PASS — 100% remediado, endurecido e verificado |
| Remediação Master G5 (Patches A–F & Kernel Hardening T1–T15) | PASS — CompositeMutationSession, lockKey factory, RecoveryFenceRegistry, TransactionalChildHandler, pre-allocated entity intents, compensator intent fallback, lock release triggers e safe-mode enforcement |
| Build do pacote (`node build.mjs`) | PASS (`dist/main.js` gerado) |
| Empacotamento (`node scripts/package.mjs`) | PASS (`dist/domain-manager-v0.0.6.zip` gerado) |
| Validação de pacote (`node scripts/validate-package.mjs`) | PASS |
| Validação de artefato (`node scripts/validate-artifact.mjs`) | PASS |

## Remediação Master Gate G5 (DOMAIN_MANAGER_G5_MASTER_REMEDIACAO_FINAL)

1. **Camada de Execução Canônica (`CompositeMutationSession`)**:
   - Centralizou todo o protocolo transacional de Projetos, Downtime e Facilities em uma única máquina de estados determinística (`planned -> claimed -> prepared -> committing -> committed / needs-recovery`).
   - Implementou invariantes INV-01 a INV-11: validação estrita de locks e ausência de namespace proibido (INV-01), persistência durável antes de efeitos filhos (INV-02), checkpoints de intenção/recibo por step (INV-03, INV-04, INV-05), captura e wrapping fail-closed de exceções (INV-06, INV-11), barreira lógica de recovery fence imediata (INV-07), reconciliação segura e commit durável (INV-09, INV-10).

2. **Fábrica Canônica de Locks e Zero-Divergence (`lockKey`)**:
   - Chaves geradas exclusivamente via `lockKey.domain()`, `lockKey.project()`, `lockKey.downtime()`, `lockKey.facility()`.
   - Rejeição fail-closed com `DM_TX_LOCKSET_DIVERGENCE` caso o conjunto de locks do comando divirja do MutationPlan ou do TransactionRecord (Finding 2: Project Start com `[domain]` estrito; Finding 3: Downtime Resolution com `[domain, downtime:<id>]` e banimento total do prefixo `activity:`).

3. **Barreira Lógica de Recuperação (`RecoveryFenceRegistry`)**:
   - Bloqueia novas mutações concorrentes ou sobrepostas no mesmo escopo com `DM_RECOVERY_SCOPE_BLOCKED` imediatamente quando uma transação entra em `needs-recovery`, independentemente de retenção ou contenção de lock físico.
   - Scan de inicialização (`scanOnStartup`) instala fences para todas as transações não resolvidas antes de aceitar comandos no runtime.

4. **Idempotência no Ledger e Ajustes Econômicos (§17)**:
   - `EconomyService.commitAdjust` agora registra e valida `appliedIdempotencyKeys` diretamente no domínio e no `LedgerStore`, revertendo o saldo em memória caso o flush do ledger falhe e garantindo deduplicação estrita em repetições pós-falha.

5. **Compensadores Compartilhados e Resolvidos Duravelmente (§19)**:
   - Todos os compensadores de Projetos, Downtime e Facilities agora aceitam `TransactionRecord | string`, reidratam o registro mais atualizado a partir do `TransactionStore`, e evitam dados defasados.

6. **Matriz de Testes Abrangente (Grupos A a I, T1–T12 Hardening, 657/657 PASS)**:
   - Grupo A (Lock-set identity: A1 a A8): 10 testes em `g5-lockset-contract.test.ts`.
   - Grupo B (Immediate compensation exceptions): testado em `g5-transaction-kernel.test.ts`.
   - Grupo C (Restart idempotency & Section 17): testado em `g5-transaction-kernel.test.ts`.
   - Grupo D (Runtime fence isolation): testado em `g5-recovery-fence.test.ts`.
   - Grupo E (Startup fence isolation & pending locks): 5 testes em `g5-recovery-fence.test.ts` (E1, E2, E3).
   - Grupo F (Parent reconciliation crash points): 8 testes em `g5-transaction-kernel.test.ts` (F1 a F8).
   - Grupo G (Child intent crash points G1, G2, G3): testado em `g5-transaction-kernel.test.ts`.
   - Grupo H (Multi-step compensation com skip idempotente): testado em `g5-transaction-kernel.test.ts`.
   - Grupo I (Coordinator isolation failure handling): testado em `g5-recovery-fence.test.ts`.

## Endurecimento da Auditoria de Aceitação Master Gate G5 (Patches A–F)

1. **Patch A — Contrato Formal de Efeitos Filhos Transacionais (`TransactionalChildHandler`)**:
   - Criado contrato formal em `src/mutations/child-handler-contract.ts` com métodos `execute()`, `reconcile()` e `compensate()`.
   - Adicionado estado `"executing"` e campo `operationRef?: string` em `RecoveryStep` (`src/mutations/recovery-step.ts`).
   - `CompositeMutationSession.runChildStep` grava a intenção em memória imediatamente antes da execução, mantendo sincronismo estrito entre a intenção declarada e a execução. Se o flush do recibo falhar após a execução, o passo entra no estado `"unknown"` com `receipt: undefined` e instala a fence imediatamente.

2. **Patch B — Idempotência de Intenção e Pré-Alocação de IDs em Subsistemas**:
   - `EconomyService`: Suporte completo a idempotência por `operationRef`, gravação de recibos (`OperationReceiptRecord`) e reconstrução do ledger sem re-aplicação de saldos em repetições.
   - `PeopleService`: Suporte a `reservationId` e `operationRef` pré-alocados em alocações de workforce.
   - `FacilitiesService`: Suporte a `facilityId` e `operationRef` pré-alocados em criação de instalações.
   - `ProjectsService`: Pré-alocação antecipada de identificadores de entidades antes do disparo de mutações filhas.

3. **Patch C — Fallback dos Compensadores para Intenção Gravada no Write-Ahead**:
   - Quando recibos estão ausentes (devido a falha no flush do recibo / crash G2), os compensadores de Projetos (`compensateProjectStart`, `compensateProjectCompletion`, etc.) consultam `(step.intent as any)?.reservationId` e `(step.intent as any)?.facilityId` para garantir que recursos e instalações criadas sejam devidamente desfeitas.
   - Em `project-completion-domain-operation-plan.ts`, pré-alocação de `anticipatedFacilityId` garante rastreabilidade total no plano e no compensador.

4. **Patch D — Pipeline de Inicialização de Locks e Recovery Assíncrono**:
   - `LockManager` implementa `onLockReleased` disparando automaticamente `recoveryService.retryPendingLockAcquisitions()` para desbloquear transações pendentes de recuperação sem polling.
   - Removido `clear()` prematuro em `RecoveryService` para manter integridade dos locks adquiridos.

5. **Patch E — Enforçamento de Safe-Mode em Falha de Recovery no Startup**:
   - `CommandBus` e `DomainManagerRuntime` implementam modo de segurança (`setMutationsEnabled(false)`): comandos mutantes são sumariamente rejeitados com `DM_RUNTIME_SAFE_MODE` enquanto consultas e leituras permanecem disponíveis.

6. **Patch F — Suíte de Testes de Endurecimento T1–T15 e Matriz de Crash Points G1/G2/G3**:
   - `tests/runtime/g5-transaction-kernel.test.ts`: Cenário G5-GROUP-G atualizado para testar explicitamente os 3 crash points canônicos: G1 (crash no intent planejado antes da execução), G2 (crash no flush do recibo após execução de efeito filho), G3 (crash no flush com recibo já gravado).
   - `tests/runtime/g5-kernel-hardening.test.ts`: 15 cenários rigorosos cobrindo sobrevivência de IDs pré-alocados, timeouts de steps, rejeição segura não-aplicada, falha de flush do recibo, fallback de compensadores, retentativa via listener de liberação de locks, bloqueio por safe mode, idempotência de ajustes econômicos, verificação estrita do contrato `TransactionalChildHandler`, unicidade de `operationRef` (T13), reconstrução fail-closed do ledger (T14) e barreira de transição de autoridade primária com bloqueio seletivo de recovery fence (T15).

## Remediação de Revalidação Final de Endurecimento Gate G5 (Blockers 1–5 & Testes T1–T15)

1. **Blocker 1 — Unicidade Estrita de `operationRef` entre Transações**:
   - `CompositeMutationSession.runChildStep` gera determinística e unicamente `operationRef` como `${session.transactionId}:${stepId}` (ou `${session.transactionId}:${stepDef.operationRef}` se especificado), garantindo que IDs de steps nunca colidam entre transações distintas nem entre planos sucessivos.
   - IDs pré-alocados de reservas econômicas (`reservationId`) e workforce (`workforceReservationId`) incorporam monotonicamente o `transactionId`.
   - Testado e verificado pelo teste **T13**.

2. **Blocker 2 — Registro Estável de Handlers Filhos no Runtime e Fail-Closed em Recovery**:
   - Adicionada instância canônica compartilhada de `TransactionalChildHandlerRegistry` em `DomainManagerRuntimeOptions`, exposta no runtime e injetada em `ProjectsService` e `DowntimeService`.
   - Durante recuperação (`compensateProjectCompletion`, `compensateDowntimeResolution`), se o custom handler para um step `unknown` ou `executing` não estiver registrado no runtime, a recuperação falha fechada com `DM_RECOVERY_HANDLER_UNAVAILABLE`, mantendo a transação em `needs-recovery` com recovery fence ativa.
   - Se o handler estiver registrado e implementar `reconcile()`, o resultado do reconcile determina o curso: `not-applied` (não compensa), `applied` (executa compensação do handler), `unknown` (mantém em `needs-recovery`).
   - Testado e verificado pelos testes **T6** e **T7**.

3. **Blocker 3 — Reconciliação Econômica Pré-Compensação (`EconomyService.reconcileAdjustment`)**:
   - Adicionado método `reconcileAdjustment(operationRef)` no `EconomyService` que consulta o `LedgerStore` e os `operationReceipts` do domínio para determinar o estado exato da mutação (`applied`, `not-applied`, `unknown`).
   - Os compensadores de Projetos e Downtime invocam `reconcileAdjustment` antes de emitir estornos/reversões para steps econômicos que caíram em `unknown` ou `executing`. Se `not-applied`, o estorno é ignorado (evitando criação indevida de saldo). Se `applied`, o estorno é executado. Se `unknown`, falha fechado e mantém a fence.
   - Testado e verificado pelo teste **T5**.

4. **Blocker 4 — Barreira de Recuperação no Failover de Autoridade Primária Durante a Sessão**:
   - `DomainManagerRuntime.handleAuthorityTransition` implementa serialização determinística via mutex assíncrono.
   - Ao iniciar a transição, mutações no `CommandBus` são desabilitadas sincronamente (`setMutationsEnabled(false)`).
   - Aguarda a reconciliação da autoridade. Se o host local for eleito Autoridade Primária, executa `scanOnStartup(currentEpoch)` instalando as recovery fences e executando safe auto-recovery para transações seguras.
   - Somente após a instalação das fences e recuperação segura, as mutações são reabilitadas (`setMutationsEnabled(true)`).
   - Comandos que chegam durante a transição são rejeitados pelo barreira de safe mode. Comandos após a transição sobre domínios afetados são bloqueados pela fence com `DM_RECOVERY_SCOPE_BLOCKED`, enquanto domínios não afetados operam normalmente.
   - Testado e verificado pelos testes **T8** e **T15**.

5. **Blocker 5 — Reconstrução Fail-Closed do Ledger e Confirmação de Recibo**:
   - `EconomyService.commitAdjust` na rota de retentativa pós-restart/reidratação valida o resultado de `ledgerStore.append`.
   - A chamada `ledgerStore.flush()` é protegida por try/catch fail-closed, retornando `DM_DOMAIN_STORAGE_ERROR` caso a persistência durável no disco falhe.
   - Em caso de sucesso na reconstrução, o recibo é atualizado duravelmente no documento do domínio com `state: "ledger-confirmed"` e `ledgerEntryId: entry.id`.
   - Testado e verificado pelos testes **T10** e **T14**.

## Remediação de Revalidação do Commit 836ee57 — Blockers A a D e Testes T16-A a T19

1. **Item A (CRÍTICO — Race condition no AuthorityRecoveryBarrier)**:
   - Em `DomainManagerRuntime.handleAuthorityTransition`, adicionado contador sequencial monotônico `authorityTransitionSequence` e garantia estrita de exclusão mútua.
   - Quando chamadas concorrentes entram na barreira enquanto uma transição anterior ainda está executando (`previousLock`), ao acordar da espera a rotina reaplica imediatamente `setMutationsEnabled(false)` antes de verificar se o estado de autoridade mudou.
   - Caso `authority.reconcile()` lance ou retorne erro, a transição falha em modo fechado com safe mode ativo (`setMutationsEnabled(false)` mantido), garantindo que comandos mutantes continuem rejeitados e diagnósticos permaneçam acessíveis.
   - Testado e verificado pelos testes **T16-A** e **T16-B**.

2. **Item B (CRÍTICO — Unificação de providerOperationRef na Economia)**:
   - Em `EconomyService.commitAdjust`, definido `providerOperationRef = params.idempotencyKey ?? transactionId`.
   - Esse identificador unificado é registrado em `txRecord.recoveryData.providerOperationRef`, repassado como `{ operationRef: providerOperationRef }` ao `provider.mutateBalance` e utilizado no rollback de compensação do provedor (`{ operationRef: opRef }`).
   - A reconciliação externa via `reconcileAdjustment` consulta `provider.reconcileAdjustment` com essa mesma chave estável, eliminando discrepâncias entre o `operationRef` interno do provedor e a referência registrada no journal da transação.
   - Testado e verificado pelo teste **T17**.

3. **Item C (CRÍTICO — TransactionalChildHandlerRegistry como Fonte Autoritativa em Execução e Recuperação)**:
   - Injetado `childHandlerRegistry` como fonte primária com precedência sobre fallbacks em `ProjectsService`, `DowntimeService`, `ProjectCompletionDomainOperationPlan` e `DowntimeResolutionPlan`.
   - Em `ProjectCompletionDomainOperationPlan`, handlers customizados agora têm seus recibos mapeados adequadamente para `sideEffectHandlers` para evitar falso positivo de `partialFailure`.
   - Nos compensadores de recuperação (`compensateProjectCompletion` e `compensateDowntimeResolution`), para steps em estado `unknown` ou `executing`, o método `reconcile()` é obrigatório. Se o desfecho for `applied` (ou se o step já estava `applied`), o método `compensate()` é obrigatório.
   - Caso o handler não implemente o contrato requerido, a recuperação falha fechada com `DM_RECOVERY_HANDLER_CONTRACT_INSUFFICIENT`, retendo a transação em `needs-recovery` com recovery fence ativa e sem compensação cega.
   - Testado e verificado pelos testes **T18-A**, **T18-B** e **T18-C**.

4. **Item D (ALTO — Validação Fail-Closed da Persistência de ledger-confirmed e Reconciliação no Retry)**:
   - Em `EconomyService.commitAdjust`, validado formalmente o `Result` retornado por `this.#domains.update(...)` tanto no fluxo normal quanto na rota de reconstrução do ledger, retornando o erro caso a persistência falhe sem mascarar o problema.
   - Em retentativas idempotentes onde o ledger entry já existe fisicamente mas o recibo no documento do domínio permaneceu em `balance-applied`, o recibo é atualizado e confirmado com `state: "ledger-confirmed"` e `ledgerEntryId`.
   - Testado e verificado pelo teste **T19**.

## Remediação do Último Blocker Estático — Unificação de Ownership no Recovery de Provedor e Compensação Crash-Idempotente (T20-A a T20-C)

1. **Unificação de Recovery Ownership para Ajustes de Provedor em Transações Compostas G5**:
   - Quando `EconomyService.commitAdjust` é executado como filho de uma transação composta G5 (`recoveryOwner: "parent"` com `parentTransactionId: session.transactionId`), ele não cria um `TransactionRecord` filho `economy:provider-adjust` no `TransactionStore`. A `CompositeMutationSession` pai é a detentora autoritativa única da recuperação.
   - Em caso de timeout ou outcome `unknown` do provedor, o erro é propagado para a sessão pai, que classifica o step como `unknown`, transiciona para `needs-recovery` e instala a recovery fence sem gerar transação filha duplicada no store.
   - Propagado `recoveryOwner: "parent"` e `parentTransactionId` em todos os 8 fluxos e compensadores G5 (`project-start`, `project-advance`, `project-completion`, `downtime-start`, `downtime-resolution`, `facilities-service` maintenance/repair, e respectivos compensadores).
   - Testado e verificado pelo teste **T20-B** (0 transações `economy:provider-adjust`, exatamente 1 transação `projects:start`, recuperação limpa com saldo net 0).

2. **Compensação Crash-Idempotente em Provedores de Moeda**:
   - No compensador standalone `economy:provider-adjust`, a chave de compensação é derivada determinística e estavelmente como `compensationRef = ${data.providerOperationRef ?? record.transactionId}:compensation`.
   - Antes de aplicar `-deltaMinor`, o compensador invoca `provider.reconcile(domainUuid, resourceId, providerRef, compensationRef)`. Se o desfecho já for `written`, a chamada de mutação é pulada, prevenindo dupla compensação caso o processo caia durante a recuperação ou a recuperação seja re-executada.
   - `ManualCurrencyProvider.mutateCurrency` implementa defesa em profundidade: checa `options?.operationRef`. Se a operação já foi registrada com delta idêntico, retorna sucesso imediato sem aplicar mutação de saldo novamente; se registrada com delta conflitante, rejeita com `DM_ECON_PROVIDER_CONFLICT`.
   - Testado e verificado pelos testes **T20-A** (crash após compensação standalone -> retry de recovery -> saldo e delta inalterados) e **T20-C** (ordem de recuperação invertida ou concorrente entre outer e inner recovery -> idempotente, saldo líquido correto).

3. **Pré-validação de Recursos de Provedor em Project Start**:
   - Em `executeProjectStartDomainOperationPlan`, adicionada consulta de disponibilidade via `context.economyService.getAccountAvailability` para popular `availableResources` antes de avaliar `evaluateProjectStartPlan`, permitindo que recursos suportados por provedores externos sejam avaliados com precisão no plano puro sem rejeição espúria de fundos insuficientes.

## Remediação da 6ª Revalidação Gate G5 — G5-REVAL6-001 a G5-REVAL6-005

1. **G5-REVAL6-001 (CRÍTICO — Checkpoints de Compensação Compartilhados e Reversão Fail-Closed em Falha de Persistência)**:
   - Em `RecoveryService.markCompensationStepCompleted`, se a chamada a `transactionStore.flush()` falhar, o estado em memória é revertido imediatamente para o registro anterior (`transactionStore.save(currentRecord)`), impedindo que checkpoints de compensação não persistidos permaneçam em memória como falsos positivos.
   - Em operações imediatas de compensação (`project-start-domain-operation-plan`, etc.), o estorno de custos é executado e persistido antes da liberação de alocações, e qualquer falha transiciona de forma determinística para `needs-recovery`.

2. **G5-REVAL6-002 (CRÍTICO — Idempotência Estrita no Ledger de Compensação via IdempotencyKey e Verificação Prévia)**:
   - Em compensações que envolvem ajustes econômicos (`EconomyService`), os passos de compensação utilizam chave idempotente determinística estável baseada em `${transactionId}:${compensationStepId}` e consultam o histórico/ledger para garantir que nenhum ajuste de estorno seja aplicado em duplicidade durante retentativas após falhas parciais.

3. **G5-REVAL6-003 (CRÍTICO — Transferência Atômica de Locks sem Lacuna / Zero-Gap Lock Transfer para needs-recovery)**:
   - Ao transicionar uma transação para `needs-recovery` em runtime, os locks associados são retidos e transferidos atomicamente para o escopo de recovery antes da liberação do contexto do coordenador de mutações, impedindo qualquer corrida ou execução concorrente de novas mutações sobre as chaves em disputa antes da devida recuperação.

4. **G5-REVAL6-004 (CRÍTICO — Aquisição All-or-Nothing de Locks no Startup e Rejeição de Locks Parciais)**:
   - Em `RecoveryService.scanOnStartup`, caso qualquer chave do conjunto de locks de uma transação não possa ser adquirida imediatamente (conflito ou contenção), todas as chaves já adquiridas são liberadas e a transação é postergada de forma limpa sem retenção de locks parciais.
   - Em `RecoveryService.recoverTransaction`, a execução é sumariamente rejeitada com `DM_RECOVERY_LOCK_FAILED` caso qualquer lock do conjunto necessário não esteja sob posse do autor de recuperação.

5. **G5-REVAL6-005 (CRÍTICO & TEST GAP — Reversão de Memória em Erro de Flush no Scan e Expansão para 66 Cenários Adversários)**:
   - `scanOnStartup` captura snapshots originais em memória antes de aplicar transições em lote; caso o flush em lote falhe, todos os registros em memória são revertidos para seus estados originais para evitar corrupção de estado transitório.
   - A matriz de testes adversários em `tests/runtime/g5-revalidation-adversarial.test.ts` foi expandida com 7 novos cenários complexos (Cenários 19 a 25), totalizando 66 testes adversários com 100% de aprovação (66/66) e elevando o total do repositório para 611/611 testes passando sem regressões.

## Remediação da 5ª Revalidação Gate G5 — G5-REVAL5-001 a G5-REVAL5-009

1. **G5-REVAL5-001 (CRÍTICO — safeAutoRecovery Estrito em `RecoveryService.recoverAll()`)**:
   - `RecoveryService.recoverAll()` filtra explicitamente registros não resolvidos para executar recuperação automática apenas quando `record.safeAutoRecovery === true`.
   - Transações com `safeAutoRecovery: false` permanecem estritamente em `needs-recovery` com isolamento de locks para revisão e reconciliação manual pelo GM.

2. **G5-REVAL5-002 (CRÍTICO — Reconciliação do Parent State Antes de Compensação em Crash pós-Domain Save)**:
   - Em caso de crash na janela entre o save do domínio e o commit durável da transação (`committing`), os compensadores de recuperação primeiro verificam se a alteração no domínio pai já foi aplicada (inspeção de revisão, status, desfechos ou existência da entidade).
   - Se o efeito já estiver gravado no domínio, a transação é reconciliada e finalizada como `committed` (sem estornos indevidos ou dupla execução). Caso contrário, a compensação é executada de forma limpa.

3. **G5-REVAL5-003 (CRÍTICO — Write-Ahead `recoveryData` com Barreira de `flush()` Durável por Etapa Irreversível)**:
   - Eliminados todos os blocos vazios ou `catch` best-effort em flushes write-ahead.
   - Cada débito progressivo, consumo de reserva econômica, liberação de workforce, criação de facility e crédito de recursos atualiza o `recoveryData`, grava no `TransactionStore` e aguarda `await transactionStore.flush()` antes de avançar para a próxima etapa.
   - Falhas no flush de write-ahead abortam imediatamente em fail-closed com compensação dos passos anteriores e roteamento para `needs-recovery`.

4. **G5-REVAL5-004 (CRÍTICO — Falha no Flush Final de `committed` Nunca é Engolida)**:
   - As transições para `committed` em todos os planos de Projetos, Downtime e Facilities tratam a falha de persistência no flush final sem engolir erros: se o flush falhar, o chamador recebe erro estruturado (`DM_TRANSACTION_COMMIT_UNCONFIRMED`), a transação transiciona para `needs-recovery` e exige reconciliação durável.

5. **G5-REVAL5-005 (CRÍTICO — Idempotência Estrita de Compensadores com Checkpoints por Etapa)**:
   - Implementado rastreamento de progresso de compensação com checkpoints gravados em `recoveryData.completedSteps` e validados via `isCompensationStepCompleted()`.
   - Em caso de falha parcial durante o rollback seguida de nova tentativa de recuperação, etapas já concluídas com sucesso são ignoradas (safe no-op), impedindo estornos repetidos ou re-devoluções duplicadas de saldo econômico.

6. **G5-REVAL5-006 (CRÍTICO — Atomicidade em Débitos de Conclusão de Projeto e Reversão em Falhas)**:
   - No loop de custos `onCompletion` em `project-completion-domain-operation-plan.ts`, se qualquer débito subsequente falhar, todos os débitos efetuados anteriormente são reversamente compensados de forma atômica (`compensatePriorSteps`).
   - Se a compensação falhar, a transação é encaminhada diretamente para `needs-recovery` com registro dos débitos pendentes.

7. **G5-REVAL5-007 (ALTO — Liberação de Workforce em Project Completion Fail-Closed)**:
   - A liberação de workforce em `project-completion-domain-operation-plan.ts` diferencia ausência de reserva de erros reais de persistência/repositório.
   - Erros de armazenamento na leitura ou liberação de reservas bloqueiam sumariamente a conclusão do projeto e acionam compensação/needs-recovery.

8. **G5-REVAL5-008 (ALTO — Recuperação de Facilities com Restauração de Snapshot da Instalação)**:
   - `FacilitiesService.maintainFacility` e `repairFacility` gravam o snapshot e revisão anterior da instalação no `recoveryData`.
   - O compensador de recuperação reconcilia o estado do domínio e, caso a operação precise ser revertida, restaura fielmente o snapshot e revisão anterior da `FacilityInstance`.

9. **G5-REVAL5-009 (TEST GAP — Cobertura Completa de 59 Cenários Adversários)**:
   - Adicionados novos cenários adversários em `tests/runtime/g5-revalidation-adversarial.test.ts` cobrindo: falha de flush pós-débito child, crash após save do domínio com reconciliação para committed, falha no flush final de committed, cancelamento com snapshots write-ahead, idempotência de compensação em retry pós-falha parcial, múltiplos custos de conclusão com falha intermediária, erro de workforce release fail-closed, isolamento de `safeAutoRecovery: false`, falhas de leitura no compensador, retomada de compensação interrompida e isolamento de locks sem deadlocks de startup. Total: 59/59 testes aprovados.

## Remediação da 4ª Revalidação Gate G5 — G5-REVAL4-001 a G5-REVAL4-012

1. **G5-REVAL4-001 (CRÍTICO — Ciclo de Vida Canônico de Transação: prepared -> committing -> committed e Validação de Result)**:
   - Corrigidas as transições de ciclo de vida em `executeDowntimeStartPlan` e `executeDowntimeResolutionPlan` para seguir a máquina canônica estrita: `planned -> claimed -> prepared -> committing -> committed`.
   - Todas as chamadas a `record.transition()` validam explicitamente o `Result`, abortando fail-closed e falhando a operação se a transição for rejeitada.

2. **G5-REVAL4-002 (CRÍTICO — Barreira de Durabilidade await flush() Imediatamente Após prepared)**:
   - Inserida barreira obrigatória `await this.#transactionStore.flush()` imediatamente após a transição para `prepared` em todos os planos compostos de Projetos (`start`, `advance`, `cancel`, `completion`), Downtime (`start`, `resolution`) e Facilities (`maintenance`, `repair`).
   - Se o flush falhar, a operação aborta sumariamente em fail-closed antes de emitir qualquer escrita persistente nos serviços filhos ou no domínio.

3. **G5-REVAL4-003 (CRÍTICO — Tratamento Fail-Closed de Falhas de Compensação Reversa)**:
   - Em caso de falha de persistência de domínio durante `startActivity`, `startProject`, `advanceProject`, `cancelProject`, `maintainFacility` e `repairFacility`, os planos tentam compensação reversa dos efeitos colaterais.
   - Se qualquer passo da compensação reversa falhar, a transição para `failed` é sumariamente rejeitada e o registro é transicionado para `needs-recovery` com detalhes da falha parcial (`partialFailure: true`), assegurando reconciliação posterior pelo `RecoveryService`.

4. **G5-REVAL4-004 (CRÍTICO — lockOwner = "recovery_" + record.transactionId para Prevenir Auto-Deadlock)**:
   - Em todas as operações de recuperação executadas pelo `RecoveryService`, os compensadores de recuperação propagam explicitamente `lockOwner = "recovery_" + record.transactionId` para chamadas a `EconomyService` e `PeopleService`, prevenindo contenção e auto-deadlock ao manipular locks de domínio.

5. **G5-REVAL4-005 (ALTO — Compensadores de Recuperação Validam Results e Preservam needs-recovery em Falhas)**:
   - Todos os compensadores registrados no `RecoveryService` (para `projects:completion`, `facilities:maintenance`, `facilities:repair`) validam estritamente o `Result` de cada etapa de reversão (ajustes de saldo, estorno de facilities, restauração de workforce).
   - Qualquer erro parcial impede a finalização da transação como compensada, retornando erro de Result e mantendo o registro em `needs-recovery`.

6. **G5-REVAL4-006 (ALTO — Restauração de Reservas Econômicas Consumidas e Workforce Liberado em Recuperação)**:
   - Implementados métodos de restauração formal: `PeopleRepository.restoreReservation` e `PeopleService.restoreWorkforceReservation` para reativar reservas liberadas, e `EconomyService.restoreReservation` para recompor reservas econômicas consumidas e seus saldos.
   - O plano `executeProjectCompletionDomainOperationPlan` captura `consumedReservationSnapshots` e `releasedWorkforceSnapshots` duráveis no `recoveryData`, permitindo que o compensador de recuperação recomponha integralmente as reservas em caso de rollback pós-conclusão.

7. **G5-REVAL4-007 (ALTO — Plano Atômico Composto para Avanço de Projeto com Estorno de Custos Progressivos)**:
   - Criado `executeProjectAdvanceDomainOperationPlan` encapsulando o cálculo cumulativo exato de custos progressivos, débito econômico, gravação de entrada e save de domínio.
   - Em caso de falha no save do domínio, os débitos efetuados são reversamente compensados (`compensateDebits`) com verificação de Result; falha na compensação encaminha para `needs-recovery`.

8. **G5-REVAL4-008 (ALTO — Plano Atômico Composto para Cancelamento de Projeto com Snapshot e Restauração)**:
   - Criado `executeProjectCancelDomainOperationPlan` encapsulando captura de snapshots de reservas econômicas ativas e workforce, liberação coordenada e transição do projeto para `cancelled`.
   - Em caso de falha de persistência do domínio, as reservas econômicas e de workforce são restauradas ao seu estado ativo original via `restoreReservation` e `restoreWorkforceReservation`.

9. **G5-REVAL4-009 (MÉDIO — Encaminhamento de Contexto de Execução no Auto-Complete de Downtime)**:
   - `DowntimeService.advanceActivity`, ao detectar que o novo tempo decorrido atinge ou excede a duração da atividade, aciona `completeActivity` encaminhando integralmente a proveniência original do chamador: `commandId`, `authorityEpoch`, `correlationId` e `causationId`.

10. **G5-REVAL4-010 (MÉDIO — Transações Duráveis com Recuperação em Manutenção e Reparo de Facilities)**:
    - `FacilitiesService.maintainFacility` e `FacilitiesService.repairFacility` foram equipados com orquestração transacional durável (`type: "facilities:maintenance"` e `"facilities:repair"`), com barreira `await flush()`, ciclo canônico (`prepared -> committing -> committed`), compensação com roteamento para `needs-recovery`, e registro de compensadores no `RecoveryService`.

11. **G5-REVAL4-011 (BAIXO — Normalização de Limites Arquiteturais e Atualização de Documentação)**:
    - Formalizado que `DomainOperationPlans` (`executeProjectStartDomainOperationPlan`, `executeProjectAdvanceDomainOperationPlan`, `executeProjectCancelDomainOperationPlan`, `executeProjectCompletionDomainOperationPlan`, `executeDowntimeStartPlan`, `executeDowntimeResolutionPlan`) atuam como coordenadores/orquestradores de transação entre subsistemas independentes (`EconomyService`, `PeopleService`, `FacilitiesService`), enquanto os modelos e resolvers de domínio (`StandardProgressResolver`, entidades puras) permanecem estritamente puros e sem efeitos colaterais em subsistemas externos.
    - Contagens e evidências alinhadas em 586 testes passando com zero falhas e zero regressões. Documentação mantida estritamente no estado `GATE_G5_COMPLETED_PENDING_USER_ACCEPTANCE`.

12. **G5-REVAL4-012 (CRÍTICO — Suíte de Testes Adversários de 41 Casos)**:
    - Expandida a suíte `tests/runtime/g5-revalidation-adversarial.test.ts` de 26 para 41 testes (+15 novos testes adversários), cobrindo integralmente as matrizes de falha e transição auditadas na 4ª revalidação, incluindo cancelamento com falha no estágio People, avanço de downtime com auto-complete econômico via CommandBus e recuperação pós-crash de reparo de facility, start de projeto e start de downtime via `recoverAll(1)`. 100% de aprovação (41/41).

## Remediação da 3ª Revalidação Gate G5 — G5-REVAL3-001 a G5-REVAL3-007

1. **G5-REVAL3-001 (CRÍTICO — Respeito Estrito às Fronteiras de Serviço e Eliminação de Mutações Cruzadas Diretas)**:
   - Eliminada qualquer mutação direta cross-subsystem. Fluxos compostos orquestrados via `executeProjectStartDomainOperationPlan` e `executeProjectCompletionDomainOperationPlan`.
   - `ProjectsService` consome o contrato formal `PublicPeopleApi` (`allocateWorkforceReservation`, `releaseWorkforceReservation`), sem tocar diretamente no documento de People ou `withDomainPeopleData`.
   - Operações de Downtime orquestradas via `executeDowntimeStartPlan` e `executeDowntimeResolutionPlan`.

2. **G5-REVAL3-002 (CRÍTICO — Transação Preparada e Compensação Reversa Explícita em Falhas de Múltiplos Passos)**:
   - Início de projeto, início de downtime, manutenção e reparo de instalações preparam `TransactionRecord` durável antes de efeitos colaterais.
   - Em caso de falha de persistência ou passos subsequentes, é executada compensação reversa garantida: cancelamento/liberação de reservas econômicas e workforce, e estorno/reembolso de débitos efetuados (`compensateDebits`).

3. **G5-REVAL3-003 (ALTO — Validação Fail-Closed do Result de Liberação e Consumo de Reservas)**:
   - No cancelamento e conclusão de projetos, retornos de `releaseReservation`, `releaseWorkforceReservation` e `consumeReservation` são checados estritamente.
   - Se a liberação de reserva ou workforce falhar, a operação falha em modo fechado (retornando o erro de Result correspondente), impedindo que o projeto mude de estado com recursos ou mão-de-obra presos em estado inconsistente.

4. **G5-REVAL3-004 (ALTO — recoveryData Durável e Compensador Idempotente em RecoveryService para projects:completion)**:
   - `needs-recovery` armazena `recoveryData` durável contendo `{ type: "projects:completion", projectId, planId, domainUuid, projectSnapshot, createdFacilityIds, debitedCostRefs, creditedResourceRefs, consumedReservationIds, authorityEpoch }`.
   - Registrado compensador idempotente `"projects:completion"` no `RecoveryService`: estorna recursos creditados, reembolsa custos debitados, desfaz facilities criadas e restaura o snapshot do projeto. Execuções repetidas são safe no-ops idempotentes.

5. **G5-REVAL3-005 (ALTO — Classificação Mandatória vs Opcional de Desfechos de Downtime e Bloqueio Fail-Closed)**:
   - `DowntimeOutcomeDefinition` estendido com `readonly optional?: boolean`.
   - Desfechos sem `optional: true` são estritamente obrigatórios. Falha em desfecho mandatório aborta a conclusão da atividade com `DM_DOWNTIME_MANDATORY_OUTCOME_FAILED`, estornando efeitos parciais e mantendo a atividade em `inProgress` (fail closed).

6. **G5-REVAL3-006 (ALTO — Permissão Estrita GM-Only para facilities:apply-damage)**:
   - Comando `facilities:apply-damage` declarado GM-only no contrato e validado por `validateGmOnlyCommandPermission`.
   - Tentativa de despacho por Domain Controller não-GM é sumariamente rejeitada com `DM_SECURITY_PERMISSION_DENIED`.

7. **G5-REVAL3-007 (CRÍTICO — Suíte de 11 Testes de Injeção de Falhas e Alinhamento de Documentação)**:
   - Implementados 11 testes de injeção de falhas (testes 16 a 26) em `tests/runtime/g5-revalidation-adversarial.test.ts` cobrindo exatamente as 11 matrizes de falha auditadas (rollback de start em falha de save, transição para needs-recovery em falha de child facility, transição para needs-recovery em falha de save após side-effects, recuperação idempotente via RecoveryService, fail-closed em cancelamento por falha de liberação de reserva econômica/workforce, reembolso de manutenção/reparo em falha de save, reembolso de downtime start em falha de save, bloqueio de conclusão de downtime por desfecho mandatório falho, e rejeição de apply-damage não-GM).
   - Documentação de contagem de testes alinhada em todo o repositório (571 testes passando).

## Remediação da 2ª Revalidação Gate G5 — G5-REVAL2-001 a G5-REVAL2-010

1. **G5-REVAL2-001 (CRÍTICO — Nested lock / reentrância entre MutationCoordinator e EconomyService)**:
   - Adicionado parâmetro opcional `lockOwner?: string` propagando o `commandId` para operações de ajuste e reserva no `EconomyService`.
   - Normalizadas todas as chaves de lock para `domain:${normalizeDomainId(domainUuid)}`.
   - Reentrância concedida sem deadlock ou timeout quando `lockOwner` corresponde ao titular do lock.

2. **G5-REVAL2-002 (CRÍTICO — Ciclo de vida completo de reservas econômicas no ReservationStore)**:
   - Expostos métodos `listReservations` e `getReservation` no `EconomyService`.
   - Cancelamento de projeto em `ProjectsService.cancelProject` consulta reservas ativas vinculadas ao projeto e as libera no `ReservationStore` com status `"released"`.

3. **G5-REVAL2-003 (ALTO — Débito econômico progressivo e de conclusão fail-closed)**:
   - `ProjectsService.advanceProject` e `completeProject` abortam estritamente caso o débito econômico retorne saldo insuficiente ou erro, prevenindo avanços com falha contábil.

4. **G5-REVAL2-004 (ALTO — Rastreamento cumulativo exato de custo progressivo com perda fracionária zero)**:
   - Substituído cálculo incremental de passo por deltas cumulativos: `dueAfter = Math.floor((workCompletedAfter * totalCost) / workRequired)`, `dueBefore = Math.floor((workCompletedBefore * totalCost) / workRequired)`, `delta = dueAfter - dueBefore`.
   - Garante precisão inteira estrita sem perda de frações e convergência exata ao `totalCost` em 100%.

5. **G5-REVAL2-005 (ALTO — Atomicidade de transação de conclusão e recuperação de falha parcial)**:
   - `ProjectsService.completeProject` prepara o `TransactionRecord` no `TransactionStore` antes dos efeitos colaterais.
   - Em caso de falha de side effect ou de persistência, transiciona para `"needs-recovery"`. Handlers ausentes em modo estrito falham fechados com `success: false, partialFailure: true`.

6. **G5-REVAL2-006 (ALTO — Propagação de proveniência através do MutationCoordinator e serviços G5)**:
   - `authorityEpoch`, `correlationId` e `causationId` capturados em `createMutationPlan.customData` e payload do writeSet, propagados até serviços G5 e registrados no `TransactionRecord`.

7. **G5-REVAL2-007 (ALTO — Validação de pré-condições no início de Downtime)**:
   - `DowntimeService.startActivity` valida: capacidades requeridas habilitadas (`DM_DOWNTIME_REQUIRED_CAPABILITY_DISABLED`), prontidão operacional de instalações requeridas com `lifecycle === "operational"` e `readiness !== "unavailable"` (`DM_DOWNTIME_REQUIRED_FACILITY_MISSING`), existência de participantes no `DomainPeopleData.notables`, e verificação de ocupação ativa (`DM_DOWNTIME_PARTICIPANT_BUSY`).

8. **G5-REVAL2-008 (ALTO — Desfechos de Downtime sem handler falham fechados)**:
   - Em `DowntimeService.completeActivity`, desfechos não-econômicos sem handler registrado geram `ChildReceipt` com `success: false`, falhando em modo fechado.

9. **G5-REVAL2-009 (ALTO — Reserva de capacidade de Workforce no DomainPeopleData)**:
   - Alocação de mão-de-obra de projetos é registrada em `DomainPeopleData.reservations` como `"active"`.
   - Na conclusão ou cancelamento, é transicionada para `"released"`. `calculateWorkforce()` deduz reservas ativas da capacidade disponível.

10. **G5-REVAL2-010 (CRÍTICO — Suíte adversarial end-to-end via CommandBus.execute())**:
    - Suíte `tests/runtime/g5-revalidation-adversarial.test.ts` expandida para 15 testes, validando todos os cenários G5-REVAL2 executados através de `CommandBus.execute()` com `LockManager` compartilhado.

## Remediação da Revalidação Final (6ª Rodada) — G4-REVAL6-001

1. **G4-REVAL6-001 (CRÍTICO / RECUPERAÇÃO — Reconciliação Prévia de Provedores Pós-Queda e Resolução de Divergência)**:
   - Compensador `economy:provider-adjust` em `EconomyService` executa pré-reconciliação mandatória chamando `provider.reconcile(domainUuid, resourceId, providerRef, transactionId)` antes de tomar decisões de commit/reversão.
   - Trata o caso crítico em que `provider.flush()` falhou durante `commitAdjust`, a transação ficou em `needs-recovery` e o servidor reiniciou (reidratando o provider ao snapshot anterior, perdendo a mutação em memória).
   - Quando `hasLedgerEntry && providerOutcome === "not-written"`: estorna a entrada do ledger local (`deltaMinor: -data.deltaMinor`, `source: { type: "recovery" }`), dá flush no store e transiciona a transação para `"failed"`, zerando o delta líquido do ledger e convergindo com o provedor reidratado (sem falso-commit e sem divergência persistente).
   - Se `providerOutcome === "unknown"`, mantém a transação estritamente em `"needs-recovery"`.
   - Se `hasLedgerEntry && providerOutcome === "written"`, transiciona a transação para `"committed"`.
   - Suíte de testes: `tests/economy/providers.test.ts`.

## Remediação da Revalidação Final (5ª Rodada) — G4-REVAL5-001 a G4-REVAL5-004

1. **G4-REVAL5-001 (ALTO / RECUPERAÇÃO — Durabilidade de Histórico de Operações, Outcome Explícito & Fail-Closed em Débito)**:
   - `#operations` persistido e reidratado em `ManualCurrencySnapshot`, assegurando que `reconcile()` funcione após reinicialização do sistema.
   - `EconomyService.commitAdjust` interpreta explicitamente `outcome: "unknown"` (transiciona transação para `"needs-recovery"`, flushes, retorna `DM_ECON_PROVIDER_TIMEOUT`) e `outcome: "failed-before-write"` (termina em `"failed"` sem recuperação, flushes, retorna `DM_ECON_PROVIDER_MUTATION_FAILED`).
   - `commitAdjust` em débito (`deltaMinor < 0`) falha imediatamente em modo fechado com `DM_ECON_PROVIDER_UNAVAILABLE` caso `readBalance()` falhe, nunca ignorando a verificação de saldo.
   - Suíte de testes: `tests/economy/providers.test.ts`.

2. **G4-REVAL5-002 (ALTO / SEGURANÇA — Isolamento Multi-Domínio com Chaves Qualificadas no Ledger)**:
   - `LedgerStore.queryPaged` recebe `allowedDomainResourceKeys`, aplicando filtragem qualificada por domínio (`${entry.domainUuid}:${entry.resourceId}`) antes de computar `totalCount`, `hasMore`, `hasPrev` e cursores.
   - Domínios com o mesmo `resourceId` não vazam contagem ou existência de entradas para não-GMs.
   - Suíte de testes: `tests/economy/ledger-pagination.test.ts`.

3. **G4-REVAL5-003 (ALTO / SEGURANÇA — Projeção Segura de Transações e Sanitização Cross-Domain)**:
   - Transações envolvendo recursos estritamente secretos/invisíveis são omitidas de `listTransactions` para não-GMs e rejeitadas com `DM_SECURITY_PERMISSION_DENIED` em `getTransaction`.
   - Transferências cross-domain expõem apenas `lockKeys` referentes aos domínios acessíveis pelo usuário requisitante; chaves de outros domínios e do sistema interno são removidas.
   - `failureReason` interno é mascarado para `"Transaction failed"` para visualizadores não-GM.
   - `EconomyPresenter.buildEconomyViewModel` aplica as mesmas regras de filtragem e sanitização.
   - Suíte de testes: `tests/economy/public-api-isolation.test.ts`.

4. **G4-REVAL5-004 (MÉDIO / ALTO — Rollback de Estado em Memória em Falhas de Storage)**:
   - `ThresholdService`: adicionado `rollbackThreshold(id, previous)`; `economy:set-threshold` executa rollback restaurando a definição anterior (ou deletando nova) se o `flush()` falhar, retornando `DM_DOMAIN_STORAGE_ERROR`.
   - `CustomResourceDefinitionStore`: `save()` restaura o mapa de `#definitions` prévio caso `#persist()` lance exceção.
   - `economy:register-custom-resource`: persiste no store primeiro e rejeita antes de modificar o `ResourceDefinitionRegistry` global em caso de erro de I/O.
   - Suíte de testes: `tests/economy/thresholds-and-rollup.test.ts`.

## Remediação da Revalidação Final (4ª Rodada) — G4-REVAL4-001 a G4-REVAL4-004

1. **G4-REVAL4-001 (ALTO — Provider Mutation Outcome, Pre-Compensation Reconciliation & Fail-Closed Stale Cache)**:
   - Expandido contrato de provedores de recursos (`ResourceProvider`) com `ProviderMutationOutcome` (`"written"`, `"not-written"`, `"unknown"`), `operationRef`, `lastMutatedAt` e método opcional `reconcileOperation(operationRef)`.
   - `ManualCurrencyProvider` atualizado com armazenamento durável de histórico de operações e reconciliação idempotente.
   - Em caso de timeout/falha de rede externa durante mutação de provedor, a transação é marcada como `"needs-recovery"` sem gerar mutação errônea ou inconsistência no ledger local.
   - O compensador de recuperação executa pré-reconciliação: se o provedor certificar que a mutação `"not-written"`, a transação é finalizada como `"failed"` sem emitir estorno reverso espúrio; se confirmar `"written"`, aplica compensação segura.
   - Checagem rigorosa de expiração de cache (DEC-16806): se o saldo cacheado tiver idade superior ao TTL configurado, a operação falha em modo fechado com `DM_ECON_PROVIDER_STALE_CACHE`.
   - Suíte de testes dedicada: `tests/economy/providers.test.ts`.

2. **G4-REVAL4-002 (ALTO/SEGURANÇA — Eliminação de Bypass Mutável em PublicEconomyApi & Propagação de Erro de Storage em ThresholdService)**:
   - Eliminados métodos mutáveis diretos (`registerThreshold`, `thresholds`) da fachada `PublicEconomyApi`, garantindo que toda alteração de limiar passe pelo pipeline canônico autenticado (`setThreshold` despacha comando `economy:set-threshold` via `CommandBus`).
   - `ThresholdService.flush()` propaga rejeições de persistência assíncronas do storage adapter subjacente.
   - Handler `economy:set-threshold` captura falhas de persistência no flush e retorna estruturado `DM_DOMAIN_STORAGE_ERROR`.
   - Suíte de testes dedicada: `tests/economy/thresholds-and-rollup.test.ts` e `tests/economy/public-api-isolation.test.ts`.

3. **G4-REVAL4-003 (ALTO — Paginação do Ledger com Consciência de Visibilidade e Proteção contra Vazamento de Metadados)**:
   - `LedgerStore.queryPaged` atualizado para receber parâmetro `allowedResourceIds`.
   - Filtro de visibilidade é aplicado antes do cálculo de `totalCount`, `hasMore`, `hasPrev` e cursores de paginação (`cursor`, `nextCursor`, `prevCursor`), prevenindo vazamento de existência ou volume de transações de recursos secretos para jogadores sem permissão.
   - Fachada `PublicEconomyApi.queryLedger` computa o conjunto exato de IDs visíveis ao requisitante antes de delegar ao store.
   - Suíte de testes dedicada: `tests/economy/ledger-pagination.test.ts`.

4. **G4-REVAL4-004 (MÉDIO/ALTO — Superfícies T4: Quick Resource Create, Histórico de Transações, Provider Health Status Shell e Agregação de Contas Derivadas Incompletas)**:
   - **Quick Resource Create**: Handler `economy:register-custom-resource` verifica duplicidade em `ResourceDefinitionRegistry` e `CustomResourceDefinitionStore`, rejeitando colisões com `DM_ECON_RESOURCE_ALREADY_EXISTS`. Na UI, o controller `dispatchQuickResourceCreateAndAccount` sanitiza os dados contra valores `undefined` garantindo payloads estritamente JSON-safe.
   - **Histórico de Transações**: Implementados `getTransaction` e `listTransactions` em `PublicEconomyApi` com verificação de posse do documento de domínio (permissão mínima `LIMITED` / nível >= 1 para não-GMs, retornando `DM_SECURITY_PERMISSION_DENIED` se não autorizado) e sanitização em `TransactionRecordDto`.
   - **Provider Status Shell**: Visualização e verificação de integridade de provedores (`healthy`, `degraded`, `unavailable`, `incompatible`) com `lastCheckedAt` e renderização de badges na UI (`renderProviderStatusSection`).
   - **Agregação de Contas Derivadas**: Contas no modo `"derived"` cujos domínios de origem não puderem ser resolvidos marcam `stats.isComplete = false`, incrementam `unknownContributorCount` e registram o UUID em `unknownContributors`.
   - Suítes de testes: `tests/economy/thresholds-and-rollup.test.ts`, `tests/economy/public-api-isolation.test.ts`, `tests/economy/economy-ui.test.ts`.

## Remediação da Revalidação Final (3ª Rodada) — G4-REVAL3-001 a G4-REVAL3-007

1. **G4-REVAL3-001 (CRÍTICO — Matriz de Reconciliação de Recuperação de Transferências e Testes de Queda em 6 Pontos)**:
   - Implementada matriz de reconciliação exata no compensador de recuperação de `economy:transfer` e `economy:convert` em `EconomyService`: reconcilia contas `srcAccount` e `tgtAccount` e entradas do ledger para determinar o progresso exato antes da falha.
   - Aplica compensação cirúrgica: se nenhum débito ocorreu, marca `failed`; se o débito ocorreu mas o crédito não, estorna o débito sem criar entradas fantasmas; se débito e crédito ocorreram antes do commit do record, finaliza para `committed`.
   - Suporte a transição de estado `compensating -> committed` no `TransactionRecord`.
   - Suíte de testes `tests/economy/fault-recovery.test.ts` cobrindo os 6 pontos discretos de falha/queda (`tx_crash_point_1` a `tx_crash_point_6`), comprovando conservação estrita de massa, ausência de duplicidade ou entradas órfãs no ledger, e idempotência estrita.
2. **G4-REVAL3-002 (ALTO/SEGURANÇA — Proveniência de `authorityEpoch` Autenticado)**:
   - Handlers de comandos econômicos em `src/economy/commands/economy-commands.ts` obtêm `authorityEpoch` estritamente de `ctx.authorityEpoch` (autenticado pelo `CommandBus`), prevenindo falsificação de epoch via payload.
   - Verificado adversariamente em `tests/economy/economy-transactions.test.ts`.
3. **G4-REVAL3-003 (ALTO — Fila de Persistência Serializada em Stores)**:
   - Implementada cadeia `#persistQueue: Promise<void> = Promise.resolve();` em `LedgerStore`, `ReservationStore` e `TransactionStore`.
   - Gravações concorrentes são serializadas em FIFO rigoroso, eliminando race conditions onde snapshots intermediários mais lentos poderiam sobrescrever snapshots posteriores.
   - Verificado com testes de persistência com atrasos invertidos em `tests/economy/storage-persistence.test.ts`.
4. **G4-REVAL3-004 (ALTO — Transações e Compensação para Provedores / Persistência de ManualCurrency)**:
   - Criado `ManualCurrencyStorageAdapter` (`InMemoryManualCurrencyStorageAdapter`, `FoundryJournalManualCurrencyStorageAdapter`) com rehidratação automática no boot do runtime (`runtime.initialize()`).
   - Operações `commitAdjust` para contas de provedor (`mode === "provider"`) agora participam do fluxo transacional com `TransactionRecord` durável (`claimed -> prepared -> committing -> committed`), registrando compensador `"economy:provider-adjust"` que desfaz a mutação em caso de falha posterior.
5. **G4-REVAL3-005 (ALTO/SEGURANÇA — Projeção Canônica na UI com Clearance e Mascaramento de Razão)**:
   - `buildEconomyViewModel` utiliza `EconomyProjectionService.isAccountVisible(acc, viewer)` verificando permissões públicas, secretas e com restrição de clearance via `viewer.allowedRestrictedRefs`.
   - Razões (`reason`) de reservas e entradas do ledger são omitidas para usuários não-GM (`viewer.isGm ? reason : undefined`).
   - Teste de segurança dedicado em `tests/economy/economy-ui.test.ts`.
6. **G4-REVAL3-006 (ALTO — Pipeline Único de Ações na UI ApplicationV2)**:
   - Removidos listeners manuais redundantes de clique em `[data-action]` no `EconomyApplication`, preservando a delegação nativa `DEFAULT_OPTIONS.actions` do Foundry v13 como único pipeline de despacho.
   - Teste automatizado confirma exatamente 1 disparo por clique.
7. **G4-REVAL3-007 (MÉDIO/ALTO — Comandos Canônicos, Auto-Avaliação de Limiares e Metadados de Agregação)**:
   - Criado `ThresholdStorageAdapter` (`InMemoryThresholdStorageAdapter`, `FoundryJournalThresholdStorageAdapter`) com rehidratação no boot e fila serializada em `ThresholdService`.
   - Auto-avaliação de limiares (`#evaluateThresholds`) integrada a todas as mutações no `EconomyService` (`commitAdjust`, `commitTransfer`, `commitConvert`, `reserve`, `consumeReservation`, `reverseLedgerEntry`).
   - Comandos canônicos registrados no `CommandRegistry`: `economy:set-threshold` e `economy:register-custom-resource` (GM-only), além de suporte a `reason` em `economy:release-reservation`.
   - `EconomyAggregationProvider` rastreia integridade (`isComplete: boolean`) e lista explicitamente `unknownContributors` caso domínios ou provedores falhem.

## Remediação de Auditoria Estrutural e Hardening (G4-AUD-001 — G4-AUD-012)

1. **G4-AUD-001 (Persistência Durável de Ledger, Reservas e Transações)**: `FoundryJournalLedgerStorageAdapter`, `FoundryJournalReservationStorageAdapter` e `FoundryJournalTransactionStorageAdapter` conectados por padrão no runtime de produção; rehidratação assíncrona mandatória em `runtime.initialize()` antes do boot de `module.api`; métodos `flush()` aguardados em todas as operações críticas com propagação de erros de persistência.
2. **G4-AUD-002 (Recuperação e Atomicidade em Falhas de Múltiplos Passos)**: Transações com compensador de recuperação registrado (`EconomyService.#registerRecoveryCompensators`); `RecoveryService.recoverAll(currentEpoch)` executado automaticamente no startup para reconciliar transações pendentes de sessões anteriores; atomicidade estrita em transferências com rollback seguro de saldo de origem caso o destino falhe no passo 2; conservação estrita de massa (`sum(balances) = invariant`).
3. **G4-AUD-003 (Integridade Cross-Domain em Reservas e Estornos)**: Rejeição com `DM_ECON_RESERVATION_DOMAIN_MISMATCH` ao tentar consumir ou liberar reservas de outro domínio; restauração atômica do estado prévio da reserva (`rollbackConsume`) sem mutações indevidas de saldo.
4. **G4-AUD-004 (Isolamento do Runtime Público e Proteção contra Bypass)**: `PublicModuleApi` exposto em `module.api` contendo apenas fachadas seguras (`PublicEconomyApi`, `PublicPeopleApi`, read-only `domains`, `diagnostics`); `commitTransfer`, `commitConvert`, `commitAdjust` e stores mutáveis completamente removidos do escopo público.
5. **G4-AUD-005 (Injeção Canônica do DomainControllerProvider)**: `DomainControllerProvider` canônico injetado no runtime padrão e propagado a todos os comandos econômicos.
6. **G4-AUD-006 (Contas Provider-Backed / Derivadas e Semântica Fail-Closed)**: `ManualCurrencyProvider` integrado com `ResourceProvider` contract (`readBalance`, `mutateBalance`, `applyDelta`), com fail-closed para saldos cacheados desatualizados (`DM_ECON_PROVIDER_STALE_CACHE`) e badges visuais de status na UI.
7. **G4-AUD-007 (Projeção e Visibilidade Secreta de Contas e Transações)**: Projeção de dados econômicos com sanitização estrita para não-GMs; `PublicEconomyApi.getReservation` falha em modo fechado com `DM_SECURITY_PERMISSION_DENIED` para contas não visíveis; `hiddenContributors` oculta identificadores de domínios secretos para não-GMs.
8. **G4-AUD-008 (Limiares com Edge Detection e UI Completa)**: `ThresholdService` com rastreamento de bordas de subida/descida (`#crossedStates`, `evaluateCrossings`), prevenindo tempestades de alertas; interface gráfica enriquecida com modal de detalhes de recurso (`openResourceDetail`), pré-visualização de impacto antes/depois (`#dm-transfer-preview`, `#dm-adjust-preview`) e ações de liberação de reservas (`releaseReservation`).
9. **G4-AUD-009 (Paginação do Ledger e Escala)**: Paginação por cursor e limites (`queryPaged`) e ordenação descendente padrão; testado em escala com 10.000+ transações em menos de 100ms; controles de navegação paginada (Previous/Next) na UI.
10. **G4-AUD-010 (Suporte a Limiares, Recursos Customizados e Rollup Multi-Domínio)**: `CustomResourceDefinitionStore` com persistência durável em JournalEntry, agregação multi-domínio com controle de privacidade e no-op em ajustes com delta zero.
11. **G4-AUD-011 (Matriz de Testes de Falha, Segurança Cross-Domain, Reinício e Recuperação Idempotente)**: Testes rigorosos cobrindo injeção de falhas no passo 2 de transferências, sobrevivência do TransactionStore a reinicializações com reload via adapter, recuperação automática idempotente (RecoveryService.recoverAll) e rollback de consumo de reservas parciais e totais (tests/economy/fault-recovery.test.ts).
12. **G4-AUD-012 (Designação Canônica do Próximo Gate)**: Designação estrita e inequívoca do próximo gate como **Gate G5 — Projects / Facilities / Downtime**, mantendo o estado `GATE_G4_PENDING_USER_ACCEPTANCE` até aceitação soberana do usuário.

## Remediação de Auditoria e Hardening Gate G5 (G5-AUD-001 — G5-AUD-010)

1. **G5-AUD-001 (CRÍTICO — Composição do Runtime e Registro de Comandos no CommandBus)**: `ProjectsService`, `FacilitiesService` e `DowntimeService` integrados ao `DomainManagerRuntime`; todos os 17 comandos canônicos de Projects, Facilities e Downtime registrados no `CommandRegistry` antes da chamada a `registry.freeze()`; `PublicModuleApi` expandido expondo `projects` (`PublicProjectsApi`), `facilities` (`PublicFacilitiesApi`) e `downtime` (`PublicDowntimeApi`).
2. **G5-AUD-002 (ALTO — Eliminação de Mutação Direta de Documento via .save() em UI Controllers)**: `ProjectsApplicationController`, `FacilitiesApplicationController` e `DowntimeApplicationController` tipados estritamente com `DomainReadRepository` como `#domains` (onde o método `.save()` fisicamente não existe); todas as operações de mutação roteadas obrigatoriamente através de `CommandBus.execute(command)` e `MutationCoordinator`.
3. **G5-AUD-003 (ALTO — Serviço Canônico e API Pública de Projetos)**: Criação de `ProjectsService` com operações atômicas (`startProject`, `advanceProject`, `pauseProject`, `resumeProject`, `cancelProject`, `completeProject`) integradas ao `TransactionStore` e `ReservationStore`; criação da fachada pública `PublicProjectsApi` e sua implementação padrão `DefaultPublicProjectsApi` isolando repositórios internos.
4. **G5-AUD-004 (ALTO — Cálculo de Saldo Disponível e Validação de Workforce em Projetos)**: `ProjectsService.startProject` calcula formalmente o saldo disponível via `availableMinor = balanceMinor - reservedMinor` antes de avaliar reservas econômicas; verificação estrita de capacidade de força de trabalho contra grupos operacionais e populacionais ativos.
5. **G5-AUD-005 (ALTO — Serviço de Instalações, API Pública e Remoção de Bypass de Reparo)**: Criação de `FacilitiesService` e `PublicFacilitiesApi`; remoção completa de fallbacks com bypass de reparo em UI e serviços (`DM_FACILITY_REPAIR_REQUIRES_PROJECT` estritamente lançado quando o reparo requer projeto); registro de comandos canônicos de facilities com autorização por Domain Controller/GM.
6. **G5-AUD-006 (ALTO — Serviço de Downtime e API Pública)**: Criação de `DowntimeService` e `PublicDowntimeApi` para início, avanço, pausa, retomada, conclusão e cancelamento de atividades; registro de comandos canônicos de downtime com verificação de participantes de domínio.
7. **G5-AUD-007 (MÉDIO — Fail-Closed em Viewer e Autorização em Presenters/Controllers)**: `viewerIsGm` padronizado para `false` por padrão em todos os presenters e controllers; acesso de visualizadores não-GM sem titularidade de controller rejeitado com `DM_SECURITY_PERMISSION_DENIED`.
8. **G5-AUD-008 (MÉDIO — Propagação de Corrupção de Dados em Facilities e Downtime)**: `tryGetDomain*Data` retorna `Result` de erro em payloads corrompidos; `getDomain*Data` lança erro descritivo (`DM_CORRUPT_FACILITIES_DATA`, `DM_CORRUPT_DOWNTIME_DATA`) em vez de mascarar silenciosamente corrupção com defaults vazios.
9. **G5-AUD-009 (ALTO — Suíte de Integração Vertical End-to-End)**: Implementação de `tests/runtime/g5-runtime-vertical.test.ts` cobrindo composição do runtime, segurança de autoridade primária vs controller vs estranho não autorizado, controllers ApplicationV2 mutando via CommandBus e sobrevivência à recarga de persistência (4/4 testes passando).
10. **G5-AUD-010 (BAIXO — Designação Canônica Estrita do Próximo Gate G6)**: Ponteiro do próximo gate corrigido para apontar estritamente para **Gate G6 — Relations / Reputation / Agreements / Territory** (`Documentos/GATES/16_G6_RELATIONS_REPUTATION_AGREEMENTS_TERRITORY.md`).

## Remediação da Revalidação Final — G5-REVAL-001 a G5-REVAL-012

1. **G5-REVAL-001 (CRÍTICO — Resolução Estrita de Documentos de Domínio e Normalização JournalEntry.<id>)**: Normalização formal de identificadores via `normalizeJournalEntryId` e `normalizeDomainId` (`src/core/identity/refs.ts`) integrada ao `DomainRepository`, `ProjectsService`, `FacilitiesService` e `DowntimeService`, assegurando compatibilidade estrita com stores não-tolerantes do Foundry VTT.
2. **G5-REVAL-002 (CRÍTICO — Resolução Autoritativa de Viewer e Fail-Closed Contra Spoofing)**: `DefaultPublicProjectsApi`, `DefaultPublicFacilitiesApi` e `DefaultPublicDowntimeApi` usam `resolveCurrentViewer(viewer)` para determinar autoridade GM/usuário a partir da sessão real, neutralizando tentativas de spoofing de privilégios (`viewer.isGm: true`) por clientes não-GM.
3. **G5-REVAL-003 (ALTO — Verificação de Capacidade de Força de Trabalho e Ciclo Transacional de Reservas)**: `ProjectsService.startProject` e `evaluateProjectStartPlan` calculam capacidade via `calculateWorkforce` sobre o subsistema `People`, debitam custos upfront via `economyService.commitAdjust`, criam reservas com `reserve` e liberam em `cancelProject`. Releitura de documento fresco antes de salvar previne conflitos de revisão.
4. **G5-REVAL-004 (ALTO — Execução Obrigatória de Comandos G5 via MutationCoordinator)**: Comandos de Projects, Facilities e Downtime registrados com `transactional: true`, `mutationDefinition` e `createTransactionalHandler`; despachos em bus sem coordenador falham em modo fechado com `DM_TRANSACTIONAL_COORDINATOR_REQUIRED`.
5. **G5-REVAL-005 (ALTO — Side Effects de Conclusão Coordenados com Execução Real e Recibos Filhos)**: `ProjectsService.completeProject` executa mutações reais cross-service (criação de facilities via `facilitiesService.createFacility`, crédito de recursos via `economyService.commitAdjust`) emitindo `ChildReceipt`s duráveis com releitura atômica do documento de domínio.
6. **G5-REVAL-006 (ALTO — Transição Transacional para needs-recovery em Falha Parcial)**: Falhas em side effects registram `partialFailure = true` e transicionam o registro da transação no `TransactionStore` para `needs-recovery`.
7. **G5-REVAL-007 (ALTO — Imposição de Invariantes de Participantes e Instalações em Downtime)**: `DowntimeService.startActivity` valida limites de participantes (`minParticipants`, `maxParticipants`, papéis permitidos) e instalações requeridas (`DM_DOWNTIME_REQUIRED_FACILITY_MISSING`).
8. **G5-REVAL-008 (ALTO — Débito Upfront e Execução Real de Desfechos em Downtime)**: Início debita custos upfront da economia e conclusão executa definições de desfechos creditando recursos reais à economia do domínio, gravando `outcomesApplied`.
9. **G5-REVAL-009 (ALTO — Débito Real de Custos em Manutenção e Reparo de Instalações)**: `FacilitiesService.maintainFacility` e `repairFacility` debitam recursos reais da economia via `economyService.commitAdjust`.
10. **G5-REVAL-010 (MÉDIO — Histórico Append-Only e Condições Canônicas em Danos de Instalação)**: `FacilitiesService.applyDamage` delega para `applyFacilityDamage`, gravando condições estruturais e anexando entradas ao histórico da instalação.
11. **G5-REVAL-011 (MÉDIO — Preservação de Identidade Transacional e Época de Autoridade)**: Preserva `commandId`, `authorityEpoch !== 1`, `correlationId` e `causationId` sem fabricação de identificadores artificiais.
12. **G5-REVAL-012 (CRÍTICO — Suíte de Testes Adversários de Revalidação Dedicada)**: Suíte rigorosa `tests/runtime/g5-revalidation-adversarial.test.ts` (9/9 testes passando) cobrindo todos os 12 achados de revalidação.

## Remediação de Blocker Estático Real — Atomicidade Provider ↔ Ledger em Child Operations (T21)

1. **Classificação Explícita de Outcome Desconhecido em Falhas de Provedor**:
   - `DM_ECON_PROVIDER_STORAGE_ERROR` adicionado à lista explícita de `isExplicitUnknown` em `CompositeMutationSession.runChildStep()`. Erros de armazenamento ou timeout de provedores marcam imediatamente o step como `unknown` e a transação pai como `needs-recovery`, ativando a recovery fence correspondente.
2. **Reconciliação Co-Dependente Provider ↔ Ledger (`reconcileProviderAdjustment`)**:
   - Implementada reconciliação formal que avalia tanto o estado no provedor (`written` | `not-written` | `unknown`) quanto no LedgerStore (`present` | `absent`).
   - Mapeia com precisão para a matriz de desfechos:
     - `fully-applied`: Provedor e ledger foram ambos gravados com sucesso.
     - `not-applied`: Falha ocorreu antes de qualquer alteração no provedor ou ledger.
     - `provider-only` (Caso A): Provedor foi debitado/creditado, mas processo caiu antes do `ledgerStore.flush()`.
     - `ledger-only` (Caso B): Ledger foi persistido, mas flush ou confirmação do provedor falhou.
     - `unknown`: Provedor retornou status incerto/timeout ou lançou exceção durante reconcile.
3. **Matriz de Compensação Atômica e Reconstrução Fiel de Auditoria (`compensateProviderAdjustment`)**:
     - `fully-applied`: Aplica mutação reversa no provedor (`-deltaMinor`) e adiciona `LedgerEntry` de compensação com `sourceRef: "${operationRef}:compensation"` (saldo líquido zero, histórico íntegro).
     - `not-applied`: No-op estrito sem geração de entries órfãs ou alterações de saldo.
     - `provider-only`: Reconstrói a `LedgerEntry` original ausente com `sourceRef: operationRef`, reverte o provedor e adiciona a `LedgerEntry` de compensação correspondente, preservando fidelidade contábil estrita de 2 lançamentos (débito original + compensação) com saldo líquido zero.
     - `ledger-only`: Adiciona a `LedgerEntry` de compensação anulando a entrada existente no ledger sem mutar o provedor (saldo líquido zero).
     - `unknown`: Falha fechado com `DM_RECOVERY_RECONCILIATION_UNCERTAIN`, mantendo `needs-recovery` e recovery fence ativa para intervenção manual.
4. **Roteamento Unificado de Compensadores de Subsistemas G5**:
   - Todos os compensadores de Projetos, Downtime e Instalações (`compensateProjectStart`, `compensateProjectAdvance`, `compensateProjectCompletion`, `compensateDowntimeStart`, `compensateDowntimeResolution`, `compensateFacilityMaintenance`, `compensateFacilityRepair`) foram unificados através de `EconomyService.compensateAdjustment()`, delegando contas provider-backed para `compensateProviderAdjustment`.
5. **Suíte de Testes de Hardening T21-A a T21-F**:
   - 6 novos cenários cobrindo Caso A (provider-only), Caso B (ledger-only), idempotência de retry, falha antes da gravação (not-applied), fail-closed em incerteza (unknown) e captura de falha de flush do provedor em `CompositeMutationSession`.

## Remediação de Gap Residual — Inclusão de Steps "executing" na Recuperação de Instalações (T22)

1. **Inclusão do Estado `executing` no Filtro de Steps de Instalações**:
   - Em `src/facilities/services/facility-recovery-compensators.ts`, o filtro de passos de compensação foi alinhado aos compensadores de Projetos e Downtime para incluir `step.state !== "executing"`.
   - Steps em estado `executing` após crash não são mais ignorados silenciosamente, sendo encaminhados à reconciliação atômica via `economyService.compensateAdjustment(...)`.
2. **Reconciliação Fail-Safe sem Compensação Cega**:
   - Se o efeito econômico foi gravado antes do crash, a reconciliação detecta o débito e aplica o estorno correspondente exatamente uma vez, restaurando o saldo inicial e liberando a recovery fence após transição para `compensated`.
   - Se o processo caiu antes da mutação econômica, a reconciliação reporta `not-applied` e age como no-op seguro sem emissão de estornos fantasmas.
3. **Suíte de Testes de Hardening T22-A a T22-C**:
   - `T22-A`: Facility Maintenance com step `executing` e débito aplicado -> recuperação detecta débito, estorna exatamente uma vez, saldo restaurado, transação `compensated`, fence liberada.
   - `T22-B`: Facility Repair com step `executing` e débito NÃO aplicado -> reconciliação `not-applied`, saldo mantido sem estornos fantasmas, transação `compensated`.
   - `T22-C`: Facility Maintenance com step `executing` e recurso provider-backed aplicado -> integração completa com a matriz T21 Provider↔Ledger.

## Próxima ação canônica

- **Gate G6 — Relations / Reputation / Agreements / Territory: reivindicações herdadas no inspector implementadas nesta parte**, após a aceitação do Gate G5. **1175/1175 testes PASS**, específicos 8/8 e verticais 123/123; TypeScript/build/package/validate:release PASS localmente. GitHub Actions PASS: commit `c59eab694716ffb620ed7df89f1ec7a5dc62f4ad`, workflow `36904323664`; 13 workflows aprovados. Relatório `docs/G6_TERRITORY_CLAIMS_REPORT.md`. **PARAR AQUI**. Próxima parte: prévia dos impactos sobre reivindicações herdadas ao alterar a hierarquia territorial; aguardar autorização. Foundry real somente após concluir o bloco G6. Gate G6 parcial; não iniciar G7.

## G6.4–G6.5 — Acordos e obrigações — 2026-09-29

- Proposals separadas dos termos ativos, rounds/snapshots, aceitações multiparty, amendments com antes/depois, renewal/expiry auditados.
- Obligations separadas de compliance derivado; evidence/contest/alleged/confirmed; breach não encerra acordo.
- Rights/capabilities derivadas por source effective/expiry/conditions; contratos de effects via CompositeMutationSession com locks, intenção prévia e recibo real.
- G6.4: 11 testes PASS. G6.5: 10 testes PASS. TypeScript PASS. Ligação do owner econômico real, comandos/persistência/recovery e testes verticais concluída em G6.9–G6.10.
- Validação JSON de entidades duráveis permite histórico acima de 1000 itens e aliases serializáveis, rejeita ciclos; não altera limites de transporte de Commands.
