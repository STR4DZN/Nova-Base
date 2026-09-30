# G6 — execução contínua

Autorização em 2026-09-29: “Pode continuar até finalizar o G6”. Esta autorização
substitui a pausa por microbuild. Continuar sem iniciar G7. Cada microbuild só
muda para PASS após teste. Estado final exige integração vertical, não somente modelos.

| Etapa | Estado | Entrega / critério |
| --- | --- | --- |
| G6.1 | PASS (61 testes) | Definitions/instances/parties/axes/lifecycle |
| G6.2 | PASS (10 testes) | Modificadores base/temporários, stacking, expiry, incidents/reversals/ended; projeção filtra fontes antes do cálculo |
| G6.3 | PASS (10 testes) | Tracks, audience, entries/reversals, decay/bands/projeção |
| G6.4 | PASS (11 testes; modelo) | Agreement independente, proposals/counter/accept, lifecycle/amendments |
| G6.5 | PASS (10 testes; contratos) | Obligations/evidence/compliance, rights/grants via contratos |
| G6.6 | PASS (11 testes; modelo) | Hierarquia física/admin, raízes/ciclos, reparent preview/revision/history; cadeia de 5000 territórios |
| G6.7 | PASS (16 testes; modelo) | Claims/recognition/presence/influence/rights, links, transfer batch, occupation/disputes |
| G6.8 | PASS (10 testes) | CapabilityResolver com providers Agreement/territory-right, scope e provenance; expiry retira apenas a fonte vencida |
| G6.9 | PASS local | Runtime/Commands/storage/authority/projeção, propostas de Controller e revisão GM, UI/listas/árvores/inspectors |
| G6.10 | PASS automatizado; smoke Foundry pendente | 854/854 testes; 22 verticais novos; TypeScript/build/package PASS; candidato local, sem release remota |

## Invariantes

- Relations, Reputation, Agreements e Territory têm fontes de verdade independentes.
- Não alterar Economy/People/Facilities diretamente; effects por contratos owners.
- Não calcular legitimidade nem vencedor de guerras; crise exige decisão do GM.
- Expiry remove grants derivados sem apagar história; breach não encerra acordo.
- Scope/base/modifiers/derived distintos; secrets não influenciam payload público.
- Multiplayer usa CommandBus, Primary Authority e MutationCoordinator existentes.
- Mutação requer fresh state, revision, locks, idempotência durável e receipt.
- Journals canônicos de diplomacia devem ter acesso GM; Players recebem projeções
  por queries de autoridade, sem flags secretas inteiras replicadas para OBSERVER.
- Não disponibilizar stores/writes internos na API pública.

## Normativa já lida

Master §18–21, DEC-098–104, DEC-3201–4100 (Rodada 08); Gate G6;
protocolos de storage e microbuild. Acceptance completo da Rodada 08 inclui
incidents/stances, decay/bands, negotiation/amendment/renewal, hierarchy/rights,
claim/recognition, links/transfer/occupation/dispute e autoridade/projeção/escala.

## Continuidade

Checkout atual: `Nova-Base`, branch `feat/g6-continuous`; baseline remoto retomado `b9fa7fe`.
A release remota G5 v0.0.6 continua distinta do candidato G6 local, também com versão 0.0.6.
Próxima ação exata: homologar o candidato em Foundry com GM/Player/F5/failover e confirmar que flags canônicas não chegam ao cliente Player. O roteiro com fixtures e fases está em `docs/G6_FOUNDRY_SMOKE_GUIDE.md`; upload explicitamente autorizado pelo usuário em 2026-09-30. Não iniciar G7.

Checkpoint remoto G6.2/G6.3: branch `feat/g6-continuous`, commit `a1dbf1d9345997038f9c3f73683a69f73e6e78c9`.

## Retomada 2026-09-30

Recuperado HEAD remoto `b9fa7fe`: G6.1–G6.5 confirmados; alterações não publicadas da execução anterior não foram presumidas. G6.6 implementado e validado: 11 testes executados diretamente (sem subprocesso do runner no sandbox), TypeScript PASS. A suíte original encontra restrição ambiental EPERM ao criar subprocesso de TypeScript; reexecução fora do sandbox em andamento.

G6.7/G6.8: testes alvo PASS, TypeScript PASS; suíte completa 832/832 PASS fora da restrição ambiental de subprocessos. Publicação de commits ao GitHub bloqueada por revisão automática: este chat requer autorização explícita de escrita remota. Não houve tentativa alternativa de envio. Commits permanecem locais até autorização.

## Fechamento local G6.9–G6.10 — 2026-09-30

- Owners de negócio continuam separados. A camada compartilhada contém apenas envelopes, índices e transações.
- Primária autoriza e revalida; Player envia propostas sem mudar o estado canônico. Original e revisão aprovada são preservados; fontes secretas da revisão GM são filtradas antes da resposta ao proponente.
- Transação grava intenção antes dos efeitos; storage incerto é isolado. Recovery compara before/after images e reconcilia owner econômico antes de concluir o plano. Divergência nunca é sobrescrita.
- UI ApplicationV2 abre por `game.modules.get("domain-manager").api.diplomacy.open()`. Listas paginadas, detalhe/histórico lazy, árvores física e administrativa independentes e prévia territorial vinculada ao payload.
- Efeitos de ativação e consequências explícitas são registrados para não repetir em suspend/resume/reload. Owner indisponível e condição sem resolver falham de forma fechada.
- 22 testes verticais novos; suíte **854/854 PASS**, sem testes ignorados. TypeScript, build e validação de pacote PASS. Bundle atualizado.
- Smoke real e proteção de replicação dos flags pelo servidor continuam requisitos de homologação; os doubles de armazenamento não comprovam esse comportamento do Foundry.
- Push novamente negado: a revisão automática considerou “Certo, pode continuar” insuficiente para autorizar fonte/destino específicos. Nenhum envio por rota alternativa.

## Roteiro Foundry e autorização de upload — 2026-09-30

- Usuário autorizou upload e pediu o script Foundry; destino configurado: branch `feat/g6-continuous` de `STR4DZN/Nova-Base`. Nenhuma autorização para G7 ou homologação foi presumida.
- Roteiro ampliado: GM/Player, propostas, revisão editada, rejeição, relações, reputação, hierarquia/transferência em lote, direitos, disputa, tratado com owner econômico, UI e recuperação após F5 com pagamento uma vez. Failover exige outro Primary GM e epoch maior.
- Progresso persistido em fixture nova; relatórios por navegador exportáveis em JSON. Mutação de negócio usa somente API pública; a injeção modifica o before-image e o intent real de um tratado criado pelo próprio script. Setup/injeção parciais ficam interrompidos para diagnóstico.
- Teste integrado executa o arquivo entregue contra owners reais, com servidor/navegador simulados, incluindo bloqueio de payload privado no Player. Suíte completa **855/855 PASS**, sem ignorados; TypeScript/build/package PASS.
- Nenhuma execução real Foundry neste chat. Sigilo no servidor e UI real permanecem pendentes. Instruções: `docs/G6_FOUNDRY_SMOKE_GUIDE.md`.

A revisão automática rejeitou o push também após esta autorização geral: exige texto do usuário que nomeie o repositório e a branch. Nenhum commit enviado; sem transporte alternativo. Script/guia/checkpoint permanecem disponíveis localmente.

## Auditoria integral de G6 — 2026-09-30

- A pedido do usuário, toda a norma específica do G6 e a Rodada 08 foram cruzadas com código/testes. Matriz em `docs/G6_FULL_SPEC_AUDIT.md`. Conclusão anterior de implementação totalmente concluída foi corrigida: há cobertura parcial, além do smoke pendente.
- Quatro defeitos reais: uniqueness apenas unitária, herança de direitos de tratados incompleta, parties inconsistentes no acesso territorial e metadados extras no DTO público. Regressões: 22 PASS/4 FAIL antes; 26 PASS depois, incluindo race de criação única.
- Suíte completa final 859/859 PASS, sem ignorados; TypeScript/build/package PASS. Fonte, bundle e candidato atualizados.
- Lacunas de features documentadas não foram mascaradas nem movidas silenciosamente para gates seguintes. Auditoria não inicia G7, não homologou G6 e não publicou commits.

## Preparação da publicação candidata v0.0.7 — 2026-09-30

- Usuário solicitou instalação direta pelo link do manifest no GitHub. Repositório `STR4DZN/Nova-Base` verificado como público, pertencente à conta conectada, com permissão de escrita.
- Versão `0.0.7`, canal `g6-candidate`, URLs fixadas à release `v0.0.7`; G6 permanece parcial e não homologado. G7 não iniciado.
- Publicação automatizada pela branch `feat/g6-continuous`: instala dependências travadas, executa typecheck e testes, reconstrói e valida ZIP/URLs e cria prerelease com manifest, pacote, script e documentos de teste. A release G5 existente não é sobrescrita.
- Validação local: 859/859 PASS; TypeScript/build/package/release validation e sintaxe do smoke PASS. Publicação remota somente confirmável após sucesso do workflow e verificação dos assets.

## Publicação candidata concluída — 2026-09-30

- Conta/repositório verificados; publicação solicitada pelo usuário concluída via conexão autenticada do GitHub. O Git local não possuía credencial HTTPS.
- Árvore remota `4df8343b12397b85fc3fd0b0dae7ce5fa99f7ef1` idêntica à árvore local `306e17d`; commit publicado `ab0e6fc6346d2279dae81d533cfab272fcc85309`. Histórico local preservado em branch de arquivo.
- Workflow `36718651288` PASS em todas as etapas, incluindo 859 testes, TypeScript/build/package/release validation. Prerelease `v0.0.7` publicada com cinco assets.
- Manifest e ZIP baixados das URLs públicas: byte equality, CRC, estrutura, versão e links PASS. Digests publicados coincidem com os artefatos locais. Evidência: `docs/evidence/G6_RELEASE_PUBLICATION.json`.
- G6 permanece com cobertura parcial e homologação Foundry pendente; G7 não iniciado.

## Smoke Foundry aprovado pelo usuário — 2026-09-30

- Após a entrega do manifest da candidata e do roteiro, usuário confirmou: “Todos os testes passaram”.
- Resultado: `FOUNDRY_SMOKE_PASS_USER_REPORTED`. Não foram anexados relatórios JSON; não inventar logs individuais, versão do servidor ou resultados independentes por sessão.
- Próxima tarefa permanece no G6: completar lacunas de `docs/G6_FULL_SPEC_AUDIT.md`. Smoke aprovado verifica fluxos implementados; não cria funcionalidades ausentes. Não marcar aceitação integral nem iniciar G7.

## Revisão geral v0.0.8 — 2026-09-30

13 defeitos confirmados/corrigidos em G0/G2/G3/G4/G5/G6; tickets públicos G6 adicionados. 878/878 testes locais PASS; TypeScript/build/package validados. Roteiro G6 v2 inclui regressões de recibos e audiência de claims. Novo smoke Foundry necessário. G6 continua parcial contra toda a Rodada 08; G7 não iniciado. Ver `G0_G6_REVIEW.md`.
