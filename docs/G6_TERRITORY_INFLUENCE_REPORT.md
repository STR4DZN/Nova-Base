# G6 — Formulários de influência territorial

Data: 2026-10-01. Branch: `feat/g6-continuous`. Candidata: v0.0.8. Gate G6 parcial.

## Entrega

Interface para registrar influência com múltiplos eixos independentes, base/limites inteiros, decadência opcional até baseline, parte, audiência e vigência. Até 32 eixos e 32 modificadores iniciais por formulário. Modificadores posteriores e encerramento de fonte/modificador passam pelo owner, CommandBus e coordenador existentes. Jogadores enviam propostas; o GM aprova ou rejeita pelo fluxo existente. Pedido original preservado.

Detalhes mostram fontes visíveis, vigência e cálculo por eixo: base, decadência, modificadores e resultado limitado. Influência não cria propriedade, controle, presença ou direitos. Encerrar conserva os dados e acrescenta histórico; encerramento repetido é no-op.

## Achados, causas e soluções

| Achado | Causa | Solução / verificação |
|---|---|---|
| Formulário desconectado | Arquivo preparatório sem integração na aplicação | Bindings de criação, linhas dinâmicas, modificadores, encerramento e detalhes; teste de eventos da aplicação. |
| Ações sobre influência secreta poderiam usar IDs adivinhados | Novas operações precisam de admissão por audiência, além de existência | Admissão sobre fonte/modificador persistidos; secreto/inexistente rejeitados sem gravação; testes no runtime. |
| Aprovação editada poderia expor referência privada | Projeção de propostas não reconhecia as novas ações | Releitura de fonte/audiência na consulta; approvedIntent indisponível retorna null. |
| Checkbox desmarcado voltava ao padrão ativo | FormData omite checkbox desmarcado | Serialização explícita de vazios nos formulários de influência; binding e rendering testados. |
| Alternância de encerramento recuperava rascunho anterior | Dois rascunhos concorrentes para o mesmo formulário | Um rascunho compartilhado de encerramento; alternância testada em ambas as direções. |

Os casos de segurança acima são verificações de prevenção para as novas operações; não se afirma reprodução no código publicado anterior. Durante a regressão, a primeira serialização de checkboxes afetou mocks de outros formulários: a alteração foi restringida aos formulários de influência. Três testes específicos iniciais também precisaram informar o kind da operação, e a fixture de permissões precisou fornecer domains.read. O validador documental exigiu preservar a referência à aceitação do Gate G5 na próxima ação; o registro foi corrigido e o teste específico passou.

## Validação

14 testes específicos; 97 testes verticais do G6; regressão completa: 1125 testes. TypeScript, build, package e validate:release. Evidência em `docs/evidence/G6_TERRITORY_INFLUENCE_VALIDATION.json`. **PASS local: 1125/1125, zero falhas/skips; TypeScript/build/package/validate:release PASS. GitHub Actions PASS: commit `a391b3e2ba875da5ee3982f938e326947c96f57e`, workflow `36896312954`; 11 workflows aprovados.** Workflow específico conserva logs e ZIP sem publicar release.

Cobertura: parsing/partes/namespace/limites/inteiros/zero/janelas, eixos duplicados, decadência, modificadores órfãos, preservação de linhas, escape HTML, drafts/revisão, bindings/checkbox/alternância, GM/Player/terceiro, aprovação editada privada, índice antigo, comandos repetidos e recarga sem efeitos duplicados.

## Limites e próximo passo

Teste real no Foundry somente ao concluir o bloco G6, conforme instrução. Não há edição retroativa de eixos/base de fontes já registradas: adicionam-se modificadores ou encerra-se a fonte. A aprovação usa o fluxo genérico; um editor estruturado da proposta pelo GM continua na matriz geral. Integração automática com Facilities/Agreements/Presence/Reputation, escala e demais pendências G6 permanecem abertas.

**Próximo passo:** formulários de ocupação territorial, com referências visíveis de presença e controle e encerramento auditado. Parar nesta parte; aguardar autorização. G7 não iniciado.
