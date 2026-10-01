# G6 — dashboard dos acordos por estado

Data: 2026-10-01 (America/Sao_Paulo). Branch: `feat/g6-continuous`. Base: `c2a7c2c5df798521c2faff4b6345ed57ea99b5a5`.
Escopo: esta parte de G6.4/G6.9, Rodada 08 §5.3/§5.7. Concluir, validar automaticamente, registrar e parar. Teste real no Foundry somente depois de concluir o bloco G6.

## Implementação

| Problema | Solução |
|---|---|
| A lista exigia percorrer páginas para identificar os estados dos acordos | Dashboard com todos, rascunhos, negociação, ativos, suspensos, quebra registrada, expirados e encerrados. Dropdown oferece também os oito estados exatos. |
| Contar apenas a página aberta produz totais incompletos | Consulta da autoridade conta após audiência, busca e fences de recovery, antes de filtro de estado e paginação. `total` continua sendo a quantidade da lista filtrada; `agreementSummary.total` corresponde ao conjunto visível encontrado pela busca. |
| Agregações podiam revelar registros privados | Mesmas permissões do owner antes da contagem. DTO da lista contém somente ID, label, revisão e lifecycle; resumo contém somente contagens. Não projeta termos, partes, obrigações, evidências ou definições. |
| Propostas iniciais e emendas poderiam misturar estados | Grupo negociação reúne `proposed` e `pendingApproval`. Uma emenda pendente conserva o estado registrado do acordo. Prazo vencido não reclassifica ou altera lifecycle; expiração depende do comando existente. |
| Mudar filtros poderia manter seleção e formulário de outro resultado | Mudança de estado reinicia página, seleção, histórico, formulário, prévia e editor. Busca mantém o estado e também reinicia seleção/página; limpar estado mantém a busca. Troca de aba limpa estado e campo não é enviado a detalhes/outros owners. |
| Falha de consulta poderia mostrar contagens ou detalhe antigo | Falha de leitura de acordos retira list/detail; UI indica resumo/lista indisponíveis e conserva o objeto do editor para recuperação após retry. |

Filtros são validados somente para consultas de lista de Agreements. Estado inválido, `all`, valor vazio no protocolo, combinação com ID e uso em outros namespaces falham. A interface omite o campo quando seleciona todos. Estado canônico inválido não gera contagem fictícia. Labels, busca e IDs são escapados; cards/seleção usam `aria-pressed` e CSS grid adaptável.

Nenhum contador persistido, índice novo, migração, Scheduler ou executor novo. O read model percorre os registros existentes do owner; não equivale a índice de lifecycle/expiry/party nem a benchmark Foundry. Consulta não altera revisões, histórico, relógio ou grants.

## Validação

- **999/999 testes PASS**, 0 FAIL/0 skipped; 21 novos nesta parte (17 específicos + 4 verticais).
- **17/17 específicos** e **57/57 verticais** PASS.
- TypeScript/build/package/validate:release **PASS localmente e no GitHub Actions**, Node local 24.19.0.
- SHA256 do ZIP local validado: `3dd578abb7c4a24167e19d7be88d67db645ceac1ee8721659fd48e000bb75ddb`.
- Commit de código validado: `d56323e3bcf3012573db243b3d9f0e7dc3c107fd`.
- Workflow [36854669271](https://github.com/STR4DZN/Nova-Base/actions/runs/36854669271), job `110344222127`: **SUCCESS**, Ubuntu + Node 22.23.2. Os seis workflows acionados neste commit concluíram com SUCCESS.
- [ZIP v0.0.8 e logs](https://github.com/STR4DZN/Nova-Base/actions/runs/36854669271/artifacts/11157426662), artifact `g6-agreement-dashboard-candidate`, retenção de 14 dias. Hash do container: `sha256:620506f16b5b32dfe74566a4e00264d9b62d167b8eaf56467ec89ad05bbb1fba` (não é o hash isolado do ZIP instalável).
- Evidência permanente: `docs/evidence/G6_AGREEMENT_DASHBOARD_VALIDATION.json` e `docs/evidence/G6_AGREEMENT_DASHBOARD_CI_SUMMARY.log`.

Cobertura específica: buckets completos/zeros/imutabilidade, grupo negociação, schema por namespace, mais de duas páginas, audiência e fences, composição busca/estado, ausência de dados privados, estado corrupto, UI e escaping, reset de seleção/rascunho, consulta separada de detalhes, indisponibilidade e bindings de clique/dropdown.

Cobertura vertical com runtime e owners reais: oito estados construídos por transições válidas, Player participante/stranger/GM, transporte autenticado, rejeição em outros namespaces, paginação/busca pelo controller, rehydrate sem escrita e emenda/prazo ultrapassado preservando lifecycle até comando explícito.

A primeira execução vertical encontrou três fixtures sem sourceRef, exigida pelo contrato existente dos eventos. Fixtures corrigidas com referência manual GM; validators preservados. Os testes usam host/transporte simulados. Nenhum teste real no Foundry e nenhuma release publicada nesta parte.

## Limites e próxima parte

Dashboard por estado/filtros complementa os detalhes implementados nas partes anteriores, com validação automática; confirmação visual/funcional em Foundry real permanece para o fim do bloco. A matriz G6 continua parcial nas demais UIs, providers, integrações, read models, diagnóstico e escala real.

**Próximo passo:** filtros e detalhamento das fontes no histórico de reputação. Parar após esta parte e aguardar autorização. Foundry real ao fim do G6; G7 não iniciado.
