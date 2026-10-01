# G6 — Prévia dos impactos nos direitos herdados

Data: 2026-10-01. Branch: `feat/g6-continuous`. Candidata: v0.0.8. G6 parcial.

## Entrega

A prévia GM de reparent apresenta direitos herdados efetivos antes/depois, recebidos, perdidos e mantidos. O cálculo cobre o alvo e todos os descendentes de cada eixo alterado, separando localização física de hierarquia administrativa. Eixos sem mudança não geram impactos; detach para raiz e mudanças simultâneas são cobertos.

Fontes explícitas de Territory e termos nativos `domain-manager:right` de Agreement usam o mesmo read model do inspector. Cada entrada conserva origem/revisão, âmbito/revisão, ID, tipo, beneficiário, vigência, condições, revogabilidade e capacidades declaradas. Direitos sem grants continuam direitos. A identidade da comparação inclui espécie/ID da origem, âmbito, direito e beneficiário; fontes concorrentes e IDs iguais não são fundidos. Ancestrais comuns e direitos locais propagados aos descendentes podem permanecer herdados após a mudança.

A interface mostra as reivindicações e os direitos na mesma revisão da hierarquia, com capacidades declaradas em coluna própria. Não calcula o resultado final de capabilities nem executa grants/consequences. A confirmação grava somente a hierarquia/revisão/auditoria/receipt do alvo. Registros locais, descendentes, Agreements, ledger e propriedade de Facilities permanecem independentes; a próxima consulta do inspector recalcula a herança.

## Achados, causas e soluções

| Achado | Causa | Solução e evidência |
|---|---|---|
| Prévia de hierarquia não apresentava direitos herdados | Comparação existente cobria somente claims | Cálculo puro por eixo/subárvore, Territory e Agreement, com fontes iguais/comuns e empty grants testados. |
| Duplicar o cálculo poderia divergir do inspector | Direitos unificados estavam dentro da consulta com acesso a armazenamento | Extração do read model puro compartilhado; autorização e fresh read continuam na consulta autenticada. Regressão do inspector preservada; teste compara prévia e consulta real após confirmação. |
| Snapshot antigo não detectava alteração de tratado ou condição sem mudar o alvo | Fingerprint usava catálogo territorial/intenção/tick | Inclusão do catálogo fresco/validado de Agreements e resultados das condições relevantes. Revogação, suspensão, payload, visibilidade, emenda pendente, tick e mudanças de condição nos dois sentidos invalidam confirmação. |
| Agreement podia mudar durante preparação de reparent | Writers de Agreement e leitura da prévia tinham locks independentes | Lock conservador `diplomacy:catalog` compartilhado por reparent e todos os writers de Agreement. Teste pausa confirmação sob locks e demonstra que suspensão aguarda o commit. |
| Fonte indisponível podia omitir parte do impacto | Inspector pode omitir fontes não disponíveis, adequado para sua projeção contextual | Prévia GM exige catálogo válido/disponível: Agreement fenced, ausente durante revalidação, corrupto ou com identidade/revisão incoerente bloqueia revisão/commit. Catálogo externo também é descoberto. |

Os achados vêm da inspeção e dos testes da implementação. Não são apresentados como reprodução de defeitos na candidata anterior.

## Condições e confirmação

O tick vem da autoridade. Início inclusivo/fim exclusivo, lifecycle efetivo da Definition e policy de propagação continuam nos resolvers nativos. Apenas termos atuais participam; capability-only terms e emendas pendentes não conferem direitos. Alterar uma emenda pendente também invalida o snapshot conservador, sem substituir direitos atuais.

Condições são sanitizadas e avaliadas uma vez por referência em cada preparação, compartilhando o resultado entre antes/depois, descendentes e eixos. Somente `true` literal confirma; provider ausente, falso, retorno não booleano ou exceção não autoriza. Fora da janela ou fonte inativa não exige confirmação. A preparação do commit avalia novamente e compara o snapshot; resultados divergentes retornam `DM_TERRITORY_PREVIEW_STALE`, sem writes. O fingerprint é um detector de mudanças, não credencial; GM-only é admitido separadamente.

A interface GM exige claims, rights impact e snapshot para confirmar reparent. Player mantém proposta ordinária imutável, aguardando decisão GM. Comandos legados sem snapshot e aprovação genérica de proposta continuam revalidando o modelo, mas não vinculam uma prévia anterior. Retry exato com receipt durável reutiliza a execução anterior sem reexecutar condições ou gerar outra auditoria.

## Ajustes encontrados nos testes

TypeScript detectou inferência implícita de array vazio durante a extração do read model. O retorno vazio passou a ser expresso dentro do DTO tipado; a verificação final passou.

Os 155 testes verticais existentes passaram após a implementação. Na primeira execução dos 14 novos, a montagem de quatro tratados por consultas redundantes excedeu o rate limit de 50 requests/s da fixture. A montagem passou a usar as revisões retornadas pelo owner e revisões conhecidas das aceitações. Nenhum limite de produção foi alterado. A nova suíte passou e recebeu um teste adicional de concorrência.

## Validação

**1259/1259 testes PASS** (28 novos), específicos 13/13 e verticais 170/170; zero falhas/skips. TypeScript/build/package/validate:release PASS localmente. GitHub Actions pendente. Evidência canônica: `docs/evidence/G6_TERRITORY_RIGHTS_IMPACT_VALIDATION.json`. Workflow próprio preserva logs e ZIP sem publicar release.

Cobertura inclui múltiplas origens/beneficiários, direitos sem capacidades, condições e vigência de ambas as fontes, dois eixos/subárvores/raiz/no-op, ciclos/invalidade, emendas pendentes, atualização fresca e catálogo externo, acesso GM/Player/terceiro/spoofing, ausência de writes na prévia e de cópias na confirmação. UI incompleta não confirma, HTML é escapado e fingerprint não aparece na interface. Recarga/retry e serialização com Agreement foram exercitados pelo runtime real composto de teste.

## Limites e próxima parte

A leitura do catálogo e os locks são conservadores: mudanças em Agreement sem relação com o ramo também invalidam a prévia. Não houve benchmark de escala. O provider de condições existente não oferece locks/versionamento de suas dependências externas; os resultados ficam fixos durante cada preparação e são reavaliados na confirmação, sem prometer atomicidade com writers externos que ignorem o kernel. O desenho não substitui enforcement de access policy em todos os consumers nem calcula impactos completos de outros estados/aggregates herdados.

Foundry real somente ao concluir o bloco G6. Nenhuma release publicada; G7 não iniciado.

**Próximo passo:** formulários estruturados de concessão e revogação de direitos territoriais, com vigência, condições, capacidades declaradas e propostas Player/revisão GM. Parar nesta parte e aguardar autorização.
