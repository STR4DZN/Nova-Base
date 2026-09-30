# G6 — auditoria completa do plano e da implementação

**Atualização v0.0.8:** revisão G0–G6 corrigiu 13 defeitos, com 878/878 testes locais PASS. Novo smoke necessário; detalhes/evidências em `docs/G0_G6_REVIEW.md`. As lacunas desta matriz continuam explícitas.

**Atualização por partes — postura:** resolver derivado por eixos/direções, postura manual auditada e UI concluídos nesta parte; 895/895 testes PASS, TypeScript/build/package PASS em GitHub Actions. Ver `docs/G6_STANCE_REPORT.md`. Não fecha as demais linhas do Gate.

**Atualização por partes — configuração de reputação:** criação com múltiplas trilhas, faixas, privacidade, apresentação e decadência; adição/edição de políticas pelo GM com versões e histórico preservados. 917/917 testes PASS e TypeScript/build/package/validate:release PASS no GitHub Actions. Resultado e evidência em `docs/G6_REPUTATION_CONFIGURATION_REPORT.md` e `docs/evidence/G6_REPUTATION_CONFIGURATION_VALIDATION.json`. Não fecha as demais linhas do Gate.

Data: 2026-09-30. Projeto: `STR4DZN/Nova-Base`, branch `feat/g6-continuous`. Escopo: Gate G6, sem iniciar G7. Esta auditoria substitui a interpretação anterior de que faltava apenas smoke para fechar todo o plano.

**Veredito: não é possível confirmar 100% de implementação ou de homologação.** O núcleo dos quatro subsistemas existe, mas há funcionalidades previstas ainda ausentes/parciais e verificação real Foundry pendente. Esta revisão encontrou quatro defeitos concretos no núcleo, reproduziu cada um por teste, corrigiu-os e retestou. O candidato corrigido serve para smoke dos fluxos implementados; não é fechamento do Gate.

## Fontes e precedência

Foram cruzados:

- `Documentos/99_DOMAIN_MANAGER_MASTER_SPECIFICATION_V1.md`: normalizações MASTER-NORM-004/006/009/010; invariantes §4; boundaries §5; identidade §6; capabilities §10; autoridade §11; receipts/audit §12; Relations/Reputation/Agreements/Territory §18–21; projeção §25; gates §54; DoD §55; dependency/checklist/product scenarios §57–59; Rodada 08 completa, DEC-3201–4100, incluindo suas leis finais e acceptance; DEC-098–114 como contexto histórico; sequência final da Rodada 12.
- `Documentos/GATES/16_G6_RELATIONS_REPUTATION_AGREEMENTS_TERRITORY.md`: G6.1–G6.10, acceptance obrigatório, testes mínimos e condição de parada.
- `Documentos/01_DOCUMENT_AUTHORITY_AND_TRACEABILITY.md`, `02_IMPLEMENTATION_PLAN_MASTER.md`, `06_FEATURE_DEFINITION_OF_DONE.md` e `98_MASTER_TRACEABILITY_INDEX.md`.
- Playbooks `30_TESTING_ACCEPTANCE`, `32_UI_UX_IMPLEMENTATION`, `34_SECURITY_SECRETS_PROJECTION`, `35_PERFORMANCE_SCALABILITY` e `36_MULTIPLAYER_CONCURRENCY_RECOVERY`.
- Código, testes, BUILD_STATE e relatório de aceitação efetivamente presentes neste checkout.

O Master prevalece sobre o relatório e sobre a interpretação do plano. Recursos opcionais não são transformados em obrigação universal. Também não se declara completo um modo opcional que a API/Definition anuncia, mas não implementa. G7/G8/G9/G10/G11 continuam responsáveis por suas infraestruturas gerais; a existência desses gates não autoriza apagar requisitos específicos da Rodada 08.

Não se calcula uma porcentagem por contagem de linhas: requisitos têm pesos e dependências diferentes. A matriz abaixo fornece rastreabilidade sem um número artificial de “conclusão”.

## Legenda

- **IMPLEMENTADO LOCAL**: código e teste de comportamento encontrados; não equivale a homologação Foundry.
- **PARCIAL**: parte existe, mas falta integração, fluxo público/UI, evidência ou extensão prometida.
- **AUSENTE**: não foi encontrada implementação utilizável daquele recurso.
- **DEPENDÊNCIA POSTERIOR/OPCIONAL**: não deve ser simulada para fechar G6; a limitação continua explícita.
- **PENDENTE FOUNDRY**: exige servidor/navegador/Documentos reais.

## Matriz G6.1–G6.10

| Microbuild | Estado | Evidência e lacuna |
|---|---|---|
| G6.1 Definitions/instances | PARCIAL | `relations/types`, registry versionado, parties/scopes/axes/lifecycle e unicidade corrigida no comando. Postura derivada por eixos/direções, regras de Definition e edição manual auditada/UI implementadas e testadas nesta parte. Snapshots antigos derived sem regras permanecem explicitamente sem configuração; integrações compostas são pendência separada. |
| G6.2 Modifiers/history | IMPLEMENTADO LOCAL | `relation-history.ts`: base separada, stacking, incidentes, reversão exata, expiração e histórico após término; testes unitários e verticais. Incidentes compostos com outras fontes não têm um fluxo geral público. |
| G6.3 Reputation | PARCIAL | Tracks/audiences, entries, reversão, decadência e bandas funcionam. UI cria múltiplas trilhas e configura faixas, visibilidade, apresentação e decadência; GM adiciona trilhas/edita políticas com histórico e snapshots versionados. Filtros de histórico e integrações compostas permanecem pendentes; Scheduler pertence a G8. |
| G6.4 Agreements | PARCIAL | Propose/counter/accept/reject/activate/amend/renew/expire têm modelo e testes. UI não oferece renew/expire-proposal e não mostra diff completo das rodadas. |
| G6.5 Obligations/rights/grants | PARCIAL | Evidência, alegação, contestação, decisão e grant derivado; owner econômico real. Outros owners/term providers não têm extensão pública instalada; direitos sem capabilities não possuem consulta pública completa de effective rights. |
| G6.6 Hierarchy | PARCIAL | Árvores/eixos, raízes, ciclos, revisões, preview puro e histórico. O preview público/UI não mostra toda a lista de impactos herdados calculada pelo modelo de hierarquia. |
| G6.7 Claims/presence/influence/access | PARCIAL | Modelos e comandos de claims/recognition/presence/influence/rights/links/occupation/dispute existem. Algumas ações e breakdowns só são alcançáveis por API; dashboard não cobre tudo. |
| G6.8 CapabilityResolver | IMPLEMENTADO LOCAL COM LIMITES | Proveniência, escopo, validade, condições que falham de forma fechada, herança de direitos explícitos e de tratados corrigida. Integrações de enforcement em construção/acesso/flows continuam parciais. |
| G6.9 UI/read models | PARCIAL | Seis abas, pesquisa/páginas, árvore lazy, inspector e ações principais. Faltam overview de atenção, filtros de estado, vários formulários/advanced editor e breakdowns. |
| G6.10 Semantic acceptance | NÃO FECHADO | Separações conceituais passam localmente; DoD completo e toda a Rodada 08 não estão satisfeitos. Sigilo da carga real e smoke GM/Player/F5/failover ainda precisam de evidência. |

## Matriz de toda a Rodada 08

As referências R08 abaixo são subseções do register congelado anexado ao Master. Uma linha pode reunir vários bullets da subseção; a coluna de limite identifica o que impede considerar o conjunto 100%.

| Fonte R08 | Requisito | Estado e constatação |
|---|---|---|
| 1.1 | Definition/Instance, refs, multiparty, symmetry, scopes, lifecycle | IMPLEMENTADO LOCAL; integração com party providers externos é indisponível e rejeitada, sem execução fictícia. |
| 1.2 | Axes, stance, modifiers | IMPLEMENTADO AUTOMATED: axes/ranges/modifiers, postura derivada por regras e direções, postura manual projetada/editável na UI, razões por eixos e sigilo. Configuração antiga sem regras permanece explícita; não houve migração silenciosa. |
| 1.3 | Subject/audience, tracks, entries, decay, bands | IMPLEMENTADO AUTOMATED no modelo e na configuração pela UI; múltiplas trilhas, faixas, apresentação, privacidade e decay configuráveis, edição GM auditada e proposta de criação com tempo da aprovação. Smoke real pendente. |
| 1.4 | Agreements independentes, terms e lifecycle | IMPLEMENTADO LOCAL para termos nativos; extensões via novos owners/providers são parciais. |
| 1.5 | Ownership/admin/control/presence/influence/access; competing/secret claims | IMPLEMENTADO LOCAL; não escolhe vencedor nem exige força universal. |
| 2.1 | Events/incidents, corrections, refs/time/effects | PARCIAL: append/reversal/modifiers funcionam; attribution contestada e incidente composto Relation→Reputation não têm fluxo completo. |
| 2.2 | Reputation dinâmica e decay auditável | IMPLEMENTADO LOCAL manual; Scheduler/TimeProvider completo pertence a G8. |
| 2.3 | Derived Relation state/stance e reasons sanitizados | PARCIAL: scores e resolver de postura por axes/modifiers têm razões sanitizadas e direções; combinação com agreements/reputation/disputes continua pendente. |
| 2.4 | Obligation lifecycle/requirements/evidence | IMPLEMENTADO LOCAL para declarações, refs e decisões; receipts externos não são resolvidos automaticamente em todos os owners. |
| 2.5 | Partial/alleged/contested breach, grace, consequences | PARCIAL: decisões e consequences econômicas funcionam; consequences públicas de Relation/Reputation/Rights não estão integradas como owners. |
| 2.6 | Proposal rounds, counter, amendments, renewal/expiry | IMPLEMENTADO LOCAL no modelo; renew e expire-proposal não estão na UI. |
| 3.1 | Territory/location hierarchy, roots, revision, optional geography | IMPLEMENTADO LOCAL; não cria árvore paralela de Locations. |
| 3.2 | Ownership ≠ administration ≠ control | IMPLEMENTADO LOCAL e testado com fontes coexistentes. |
| 3.3 | Contextual recognition | IMPLEMENTADO LOCAL no modelo/API; criação/consulta de recognition na UI é parcial. |
| 3.4 | Presence ≠ influence, axes/modifiers/decay | PARCIAL: fontes próprias funcionam; resolver composto Facilities/Agreements/Presence/Reputation não está integrado. |
| 3.5 | Links: direction/status/cost/capacity/dependencies/secrecy | IMPLEMENTADO LOCAL no modelo/API; edição de links pela UI ausente. Route computation completa é explicitamente opcional. |
| 3.6 | Rights de Agreement/policy/grant, duration/conditions/inheritance | PARCIAL: grants explicit/treaty e herança corrigida; não há consulta pública unificada de direitos sem grants, nem todos os consumers aplicam access policy. |
| 3.7 | Transfer/lease/concession; history/batch/coordination | PARCIAL: transferência em lote pela API; UI transfere um alvo e não fornece seleção em lote. Lease/concession não alteram ownership e podem ser representados como rights. |
| 3.8 | Inheritance derivada e reparent preview/impacts | PARCIAL: cálculo puro e auditoria funcionam; effective claims não são expostos no inspector e impactos herdados não aparecem completos na prévia pública. |
| 3.9 | Facilities/People/Economy consumers | PARCIAL: Facility possui locationRef; transfer não transfere Facilities; faltam população territorial agregada, enforcement de build/access e flows territoriais completos. |
| 4.1 | Persistent multi-territory/party/claim dispute | IMPLEMENTADO LOCAL, incluindo decisão explícita e history. |
| 4.2 | Recognition contextual, sem legitimidade universal | IMPLEMENTADO LOCAL. |
| 4.3 | Influence pressure composta por policy | PARCIAL: base/modifiers/decay por fonte; providers compostos e pressão operacional completos ausentes. |
| 4.4 | Administrative ConflictRecord/WarRecord | AUSENTE: não há records utilizáveis. Não existe simulação automática, o que respeita o não objetivo; isso não equivale a implementar os records narrativos previstos. |
| 4.5 | Optional GM-triggered CrisisRecord | DEPENDÊNCIA POSTERIOR/OPCIONAL; não cria crises por threshold. Ausência não é blocker do núcleo mínimo por si só. |
| 4.6 | Sanctions estruturadas via Economy/Territory policies | AUSENTE como fluxo dedicado; não existe ledger paralelo de sanctions. |
| 4.7 | Border incidents com Territory refs | PARCIAL: relation scope pode referenciar território; formulário/categorias e atribuição contextual de border incident não estão completos. |
| 4.8 | Occupation lifecycle, control/presence sem ownership automático | IMPLEMENTADO LOCAL no modelo/API; UI de occupation/withdrawal e policies é parcial. |
| 4.9 | Secrets/intelligence/discovery/rumor | PARCIAL: visibility local e projeção antes do socket; Knowledge/discovery/rumor completos pertencem a G7. Sigilo do storage no servidor permanece pendente. |
| 5.1 | Diplomacy Overview com mudanças/expiring/breaches/disputes/inbox | PARCIAL: navegação unificada existe; overview priorizado de atenção não existe. |
| 5.2 | Reputation UI tracks/bands/GM breakdown/history/filtering | PARCIAL: configuração de múltiplas trilhas/faixas/policies/decay e breakdown GM de valores, versões e cursor implementados; histórico de configuração separado e projeção Player sanitizada. Faltam filtros avançados, breakdown completo de fontes e integração com atividade. |
| 5.3 | Agreement dashboard/details/due/compliance/evidence/amendments/round diff | PARCIAL: dados básicos no DTO; UI não mostra due/compliance/evidence/amendments e diff de rounds de forma completa. |
| 5.4 | Territory dashboard com claims/recognition/influence/rights/related aggregates | PARCIAL: claims/presence/influence/rights/occupation/links; recognition, disputes relacionados, Facilities/população e inherited effective state incompletos. |
| 5.5 | Controller proposals/inbox/approve/reject/edit preserving original | PARCIAL: backend completo para intent suportado; GUI edita delta/revision, não qualquer proposta estruturada. |
| 5.6 | Existing authority/revisions/concurrent acceptance/batch | IMPLEMENTADO LOCAL; servidor Socketlib/failover real exige smoke. |
| 5.7 | Owner read models/indexes/rebuildable audience filtering | PARCIAL: índices de kind/children e DTOs existem; overview, índices de status/expiry/party e caches especializados incompletos. |
| 5.8 | Content export/packs/migrations preserving ambiguity/history | DEPENDÊNCIA POSTERIOR: infraestruturas gerais G10; não há importer/exporter/migrations específicos G6 completos. Definitions versionadas não substituem isso. |
| 5.9 | Diagnostics de broken refs/orphans/expired grants/leakage + repair preview | PARCIAL: validators, erros e fences existem; relatório de integridade G6 e repair preview dedicados ausentes. |
| 6.1 | Stable/versioned/world/private reusable diplomatic templates | AUSENTE: `createDiplomacyDraft` é factory de draft, não template persistido/versionado/importável. |
| 6.2 | Quick create + advanced hidden fields/editor/preview | PARCIAL: criação e validação existem; formulário de ação exibe muitos campos juntos, editor avançado e preservation de input não estão completos. |
| 6.3 | Bulk normal pipeline + preview/targets/child receipts | PARCIAL: API de transferência em lote e intent durável; UI e operações bulk genéricas não existem. Exemplos adicionais de bulk não são obrigação universal. |
| 6.4 | Notifications/Activity Feed | AUSENTE como feed unificado; histories locais não equivalem ao read model de notificações priorizadas. |
| 6.5 | Optional advisories sem mutation/crisis automática | DEPENDÊNCIA POSTERIOR/OPCIONAL; não implementado, não simulado. |
| 6.6 | Optional Domain Overview diplomacy summary | DEPENDÊNCIA POSTERIOR/OPCIONAL; não está integrado e não duplica dados em Domain. |
| 6.7 | Public boundaries para Requests/Missions/Knowledge | DEPENDÊNCIA POSTERIOR G7; intent/refs/owners fornecem base, sem simulação dos subsistemas futuros. |
| 6.8 | Incremental/lazy/virtualized/cache/batching/selective refresh/benchmarks | PARCIAL: páginas, children index, lazy history e fixtures grandes; ainda há scans completos por capabilities/render/territorial mutation, sem benchmark Foundry SMALL/MEDIUM/LARGE ou prova de memória limitada. |
| 6.9 | Acceptance de todos os modelos + shared infrastructure | NÃO FECHADO: stance, UI/consumers/content/diagnostics/evidência real deixam pendências explícitas. |
| 6.10 + leis finais | Independent truths, no auto legitimacy/war/crisis, authority/audit | IMPLEMENTADO LOCAL para separações centrais; leis de secrets/rebuild/bulk não dispensam as pendências de transporte/UI/escala acima. |

## Acceptance obrigatório do Gate 16

| Item | Resultado |
|---|---|
| Relation ≠ Reputation | PASS local; alteração em reputação não muda relação. |
| Agreement ≠ Relation | PASS local; entities/owners/repos e contracts separados. |
| Ownership/admin/control separados | PASS local; claims independentes podem coexistir. |
| Claim ≠ recognition | PASS local; recognition contextual referencia claim existente. |
| Breach não auto-terminate | PASS local; lifecycle de obrigação/acordo separado. |
| Expiry remove grants derivados | PASS local; tick/condition/source policy, sem apagar histórico. |
| Competing claims coexistem | PASS local; transferência supersede apenas seleção explícita. |
| Sem war resolution automático | PASS estrutural; não existe escolha automática de vencedor. |

Esses oito itens verdes são necessários, mas insuficientes: o próprio Gate exige implementação vertical sem caminhos públicos temporários, testes mínimos e DoD. Não se usa essa tabela curta para apagar o restante do Master.

## Defeitos reproduzidos e corrigidos

| ID | Erro real / causa | Correção | Prova |
|---|---|---|---|
| G6-AUD-001 | `allowMultiple:false` não era aplicado no runtime: o guard existia apenas como função unitária. | `prepareOwnerIntent` valida uniqueness antes do create, sob catalog lock. Mesmo type/parties/scope é rejeitado; scope distinto continua permitido. | Teste falhou antes, passou depois; inclui duas criações concorrentes que resultam em apenas uma relação. |
| G6-AUD-002 | Right herdável de tratado dava grant somente no território exato: provider filtrava scope sem resolver ancestry. | AgreementCapabilityProvider deriva herança pelo eixo solicitado, mantém source Agreement/term e scope do descendente. Não copia rights nem concede globalmente. | Teste falhou antes, passou depois; verifica provenance, herança, ausência de cópia/global grant e remoção na expiração do right. |
| G6-AUD-003 | Territory detail reconhecia controllers via recognition/influence/occupation, mas branch/parent/capability helpers usavam subconjuntos diferentes. | Todos esses caminhos usam `territoryOwner.parties`. | Teste falhou antes, passou depois; controller apenas por recognition consegue detail, filhos, parent e capabilities do mesmo território restrito. |
| G6-AUD-004 | Projection de Reputation devolvia refs originais com campos não declarados; effectiveInfluence era calculada a partir do objeto canônico em vez da projeção. | Refs públicas de Reputation normalizadas por validator; influência calculada a partir do estado já projetado. | Teste falhou antes, passou depois; marcador extra não aparece no DTO Player nem influencia o shape da resposta. |

Arquivos de produção alterados apenas no cluster G6: `diplomacy/owner-commands.ts`, `diplomacy/diplomacy-query.ts`, `diplomacy/capability-command.ts`, `aggregation/diplomacy-capability-providers.ts`, `reputation/reputation-model.ts`, `territory/territory-owner.ts`. Fixtures do teste de runtime agora declaram explicitamente `allowMultiple:true` onde vários vínculos eram intencionais; os novos casos de unicidade usam false.

## Infraestrutura, segurança e DoD

| Regra | Resultado e limite |
|---|---|
| Reutilizar PrimaryAuthority/CommandBus/MutationCoordinator | PASS local; não foi criado runtime/transport paralelo na produção. |
| Fresh-read, ordered locks e revision | PASS local nos fluxos de mutation; custos de scan/locks globais territoriais ainda são limite de escala. |
| Retry mesmo commandId e query de status | PARCIAL: facade oferece commands.prepare/execute/retry/status com ticket estável e autorização por sender; status depende do cache da autoridade atual. UI e status durável pós-reload não estão completos. Não criar outro commandId para recuperar outcome desconhecido. |
| No-op não incrementa revisão | PASS local nos modelos; envelope pode persistir recibo mesmo sem alteração semântica. |
| Audit append-oriented e recovery | PASS local de events/intents/receipts; diagnostic/repair GUI completos permanecem parciais. |
| Visibility antes de derive/transport | PASS nos DTOs testados, incluindo regressões; não prova privacidade dos flags distribuídos pelo servidor Foundry. |
| Canonical Journal flags privados | PENDENTE FOUNDRY: ownership NONE e nome neutro são configuração, não prova de ausência de payload. |
| Records/ref/provider inválidos | PARCIAL: parties, Territory parent/link/claim e owners têm guards; resolução especializada de todos os refs de terms/scope/evidence e repair não está completa. |
| Time abstraction | PARCIAL: business recebe worldTick; composition usa game.time.worldTime como default. TimeProvider/Calendar/Scheduler completos permanecem G8. |
| Custom providers/registries | PARCIAL: definitions versionadas e categorias namespaced aceitas; runtime de term/effect owners oferece apenas composição interna nativa/econômica, sem todos os addons/world providers do plano. |
| UI loading/empty/error/permission/input/keyboard | PARCIAL: empty/error e controles HTML básicos existem; estados distinguíveis, input preservado, permission-aware actions e acessibilidade real ainda precisam de trabalho/revisão. |
| Performance e memória | PARCIAL: testes de escala provam integridade, não budgets de latência/payload/DOM/memória em império no Foundry. |
| Source-of-truth/repository boundaries | PASS estrutural do cluster: UI envia intents; providers de grants não persistem valores derivados. |
| Migration/import/export | DEPENDÊNCIA POSTERIOR G10; revisar impacto do schema G6 e preservar dados/história. |
| Graph/Canvas overlay | OPÇÃO POSTERIOR, conforme DEC-109/114; ausência não bloqueia G6 mínimo. |

## Evidência de testes

- Antes da correção: **26 testes verticais, 22 PASS e 4 FAIL**. Cada FAIL corresponde aos quatro bugs da tabela. Log: `docs/evidence/G6_SPEC_AUDIT_BEFORE.log`.
- Após a correção inicial: **26/26 PASS**. A verificação final inclui também a corrida de unicidade. Log alvo final: `docs/evidence/G6_SPEC_AUDIT_TARGET.log`.
- Suíte completa final: **859 testes, 859 PASS, 0 FAIL, 0 skipped**, resultado registrado em `docs/evidence/G6_AUTOMATED_TESTS.log`, após as correções.
- TypeScript, build, package/artifact e integridade CRC/conteúdo do checkpoint: **PASS** sobre o candidato corrigido. Log de validação: `docs/evidence/G6_SPEC_AUDIT_VALIDATION.log`.
- O roteiro `scripts/g6-foundry-smoke.js` também é executado pelo teste local `g6-foundry-runner.test.ts` contra os owners reais. DOM/Documentos/transporte são doubles. **Não se registra isso como Foundry E2E real.**

## O que falta para afirmar 100%

Prioridades antes de fechar G6:

1. Completar razões compostas de stance com Agreements/Reputation/Disputes, sem inventar thresholds universais; implementar/enquadrar templates versionados separados de Definitions. Configuração de postura e de trilhas de reputação possuem relatórios próprios.
2. Completar overview, detalhes/ações/formulários G6, diff de negotiation/review, recognition/links/influence/occupation, renewal, preview de impacts e fluxo público seguro de retry/status.
3. Completar diagnostics/read models/consumer contracts necessários; resolver as lacunas de direitos/effects/integrations e os guards especializados de refs.
4. Medir/corrigir scans/cache/memória nos fluxos quentes; cobrir cenários de escala e audiência suficientes, sem antecipar business dos gates seguintes.
5. Executar o roteiro no servidor Foundry real com GM/Player/F5/failover e confirmar que flags canônicas não chegam ao Player. Se chegarem, corrigir armazenamento/sanitização antes de qualquer homologação.
6. Consolidar as dependências posteriores e opções em uma matriz aprovada, sem reclassificar silenciosamente ausência como “concluído”.

**Pode testar agora:** sim, o candidato corrigido permite smoke dos fluxos implementados em um mundo de testes. **Pode declarar G6 100%/GATE_ACCEPTED:** não. Um smoke sem FAIL não comprova funcionalidades que o roteiro ainda não exercita nem itens ausentes do plano.
