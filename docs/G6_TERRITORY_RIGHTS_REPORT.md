# G6 — Direitos territoriais efetivos no inspector

Data: 2026-10-01. Branch: `feat/g6-continuous`. Candidata: v0.0.8. G6 parcial.

## Entrega

O detalhe público de Territory reúne direitos explícitos do território e termos nativos `domain-manager:right` de Agreements. Inclui direitos sem grants, com beneficiário, tipo, origem/revisão, território de âmbito/revisão, vigência, condições, revogabilidade e policy de propagação. Direitos locais e herdados continuam distintos. IDs iguais em fontes distintas não são fundidos.

A consulta seleciona hierarquia física ou administrativa, independentemente do eixo das claims. A interface mostra direitos efetivos e mantém os demais direitos visíveis em uma seção recolhível, com motivos: inativo, acordo sem vigência ativa, agendado, expirado ou condições não confirmadas. O início é inclusivo e o fim exclusivo. Para Agreements, a janela exibida é a interseção entre duração do acordo e janela do termo; somente termos atuais e lifecycles efetivos da Definition podem contribuir. Propostas/emendas pendentes não conferem direitos.

Capacidades declaradas aparecem separadamente, inclusive “Nenhuma”. A tabela não substitui a resolução final de capacidades. Termos `domain-manager:capability` não são convertidos em direitos. A leitura não executa grants, operações ou consequences. Não grava direitos herdados nas coleções locais, nem altera Domain, ledger ou auditoria das fontes.

## Achados e soluções

| Achado | Causa | Solução e evidência |
|---|---|---|
| Inspector não reunia direitos de Territory e Agreement sem grants | Tabela local mostrava registros; resolver de capabilities respondia outra pergunta | DTO `territoryRights` reúne fontes autenticadas de todos os beneficiários visíveis; testes preservam direitos vazios e distinguem capability-only terms. |
| Vigência e condições não estavam explicadas no detalhe territorial | Registros locais não representavam a consulta efetiva | Uso dos resolvers nativos com tick autoritativo, estado derivado e condições confirmadas/não confirmadas/não avaliadas; limites temporais e suspensão/retomada testados. |
| Controle do filho não basta para mostrar origens ou termos privados | Fontes têm audiências independentes | Linhagem compartilhada com claims e autorização por Territory/Agreement/termo; tests de GM, Player e terceiro, cadeia privada e condições ocultas. |
| Índice em memória podia deixar direitos derivados desatualizados | Inspector agrega múltiplas fontes persistidas | Fresh read de cada origem e Agreements, descoberta de IDs externos, validação de estado/identidade/revisão e fences; alterações externas e fontes inválidas testadas. |

São constatações da inspeção e verificação da implementação, sem alegar reprodução de regressões na candidata anterior.

Condições usam o provider existente da autoridade. Somente `true` literal confirma; provider ausente, retorno falso/não booleano ou exceção não autoriza o direito. Referências são sanitizadas, memoizadas por consulta e avaliadas apenas em fontes visíveis, ativas e dentro da janela. Fontes fora da janela/inativas mostram “Não avaliada”. O cliente não define tick nem resultado das condições.

Ancestral inacessível/ausente/inválido/fenced interrompe a cadeia selecionada; ciclo visível fornece somente direitos locais. Acordos indisponíveis são omitidos, sem publicar seus IDs, condições, motivos de recovery ou contagens. Navegação da interface usa somente origens admitidas no DTO e executa nova consulta. Falha de recarga remove o detalhe anterior. Dados derivados não entram nas opções locais de revogação.

## Ajustes encontrados nos testes

Primeira suíte vertical: 150/153 PASS. Três fixtures novas usavam referência compartilhada rejeitada pelo envelope de comando, tratavam relatório já extraído como Result ou passavam objeto à API de capabilities que recebe UUIDs posicionais. Foram corrigidas as chamadas/fixtures mantendo assertivas. Depois, um teste adicional de revogação usou `rightId` em vez do campo nativo `id`; corrigido e retestado. Nenhuma dessas falhas exigiu alterar o comportamento de produto.

## Validação

**1231/1231 testes PASS** (25 novos), específicos 9/9 e verticais 155/155; zero falhas/skips. TypeScript/build/package/validate:release PASS localmente. GitHub Actions pendente. Evidência canônica: `docs/evidence/G6_TERRITORY_RIGHTS_VALIDATION.json`. Workflow próprio preserva logs e ZIP da candidata sem publicar release.

Cobertura inclui herança física/administrativa independente, concorrência de IDs, empty grants, private/restricted/secret, audiência de cada fonte e termo, tempos da autoridade, condições sem provider/false/throw/não booleanas, sanitização/memoização, propostas pendentes, suspensão/retomada, fonte revogada preservada e leitura após alterações externas. Fences, fonte ausente/corrupta/incoerente, ciclo, navegação/bindings, HTML escapado e ausência de cópias/writes econômicos estão cobertos.

## Limites e próximo passo

A consulta explica os direitos disponíveis no contexto visível; não promete completude sobre fontes ocultas/indisponíveis. “Condições não confirmadas” não distingue condição falsa de provider indisponível. Políticas externas de acesso e enforcement em todos os consumers, fontes de extensions/providers externos e breakdown composto de Facilities/população continuam pendentes. Não houve benchmark de escala da leitura do catálogo de Agreements. A resolução final de capabilities mantém seu contrato existente e não recebeu uma revisão geral nesta parte.

Foundry real somente ao concluir o bloco G6. Nenhuma release publicada; G7 não iniciado.

**Próximo passo:** prévia dos impactos sobre direitos herdados ao alterar a hierarquia territorial, incluindo fontes de Territory e Agreement. Parar nesta parte e aguardar autorização.
