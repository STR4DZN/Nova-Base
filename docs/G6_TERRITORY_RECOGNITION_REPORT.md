# G6 — Formulários de reconhecimento territorial

Data: 2026-10-01 (America/Sao_Paulo). Branch: `feat/g6-continuous`. Base: `4cf7d25ca1c8ecb2455aba297c6b882217130277`.
Escopo: esta parte de G6.7/G6.9, Rodada 08 §3.3/§5.4/§5.5. Concluir, validar automaticamente, registrar e parar. Teste real no Foundry somente ao concluir o bloco G6.

## Entrega

- Seção **Reconhecimento contextual** no inspector territorial: reivindicação, parte/audiência, posição, visibilidade e vigência. Resumo conta apenas declarações sanitizadas e vigentes no tick da autoridade, separando positive/negative/unknown. Não calcula votação ou legitimidade universal; não decide propriedade, direitos ou disputas.
- Formulário nativo com seleção das reivindicações visíveis, inclusive históricas ended/superseded. Parte por UUID de Domain/Actor ou ID narrativo; grupos populacionais/operacionais e notáveis usam ID local e UUID do Domínio de origem. Existência das referências continua validada pela autoridade.
- Posição positiva, negativa ou sem posição; origem People e campos de visibilidade/vigência em detalhes avançados; visibilidade public/restricted/secret; início explícito ou tick da consulta; fim exclusivo opcional. Tick 0 válido, inteiros seguros e fim posterior ao início. Motivo auditável obrigatório.
- GM registra pelo owner semântico; Player Controller envia intent ao inbox do GM. Envio não altera reivindicação nem grava reconhecimento antes da aprovação.
- Revisão específica de reconhecimento no inbox mostra pedido original e permite editar reivindicação, parte, posição, visibilidade e janela. Mantém ID/sourceRef do reconhecimento e identidade/modo do alvo; pedido original imutável. Revisão atual do alvo só muda por escolha explícita do GM após conferir outra edição. Rejeição não aplica reconhecimento.
- Formulários preservam campos inválidos/falhas/revisão antiga, com limpeza explícita para usar a revisão atual. Trocar registro/aba limpa o rascunho. Falha na consulta remove dados antigos. ID de declaração mantido durante tentativas de envio malsucedidas; replay exato de tickets continua pela API pública existente.

## Erros encontrados, causas e soluções

| Erro | Causa | Solução | Evidência |
|---|---|---|---|
| Controller podia propor reconhecimento de claim secreto por ID adivinhado | Submit validava participação no território e existência canônica, sem admitir o claim pela audiência | Filtro da projeção territorial antes de preparar intent; claim secreto/inexistente recebem o mesmo not-found | Teste falhou antes com true quando esperava false, passou após correção; nenhum registro de proposta/owner gravado no erro |
| Aprovação editada poderia expor um claim secreto ao remetente por payload público de reconhecimento | Redação genérica olhava visibility do valor aprovado, sem consultar visibility da reivindicação referenciada | Detalhe Player de proposal verifica território/claim/visibility/fences atuais; conteúdo revisado indisponível vira approvedIntent=null na projeção | Aprovação GM com claim secreto e reconhecimento público permanece oculta no território e no proposal, inclusive após recarga |
| Rejeitar proposta era bloqueado por fence do alvo, mesmo sem alterá-lo | Decisão calculava locks do intent também em reject | Reject bloqueia/escreve apenas o owner proposal; approve conserva locks e revalidação fresca do alvo | Falhou antes com DM_RECOVERY_SCOPE_BLOCKED; após correção, alvo bloqueado permanece intacto e a proposta é rejeitada |
| Campos inválidos da edição poderiam impedir rejeição no navegador | Required do claim/parte era aplicado a ambos os botões | Reject usa formnovalidate e valida motivo no controller/autoridade, sem validar os campos de uma ação que não será aplicada | Bindings headless e fluxo vertical de rejeição com campo inválido e alvo indisponível |

A correção de locks aplica-se às rejeições de propostas do inbox: a transação modifica apenas o proposal. Aprovações, fences do próprio proposal e barreiras globais de recovery permanecem sob o kernel existente.

## Validação automática

- **1074/1074 testes PASS**, 0 FAIL/0 skipped; 25 novos nesta parte.
- **17/17 específicos** e **77/77 verticais** PASS (oito novos verticais).
- **TypeScript, build, package e validate:release PASS** localmente, Node 24.19.0.
- SHA256 do ZIP local validado: `116b4c1c339fdd83a46e20fa0af62659c926566ce320f30df584d1e22c9ce640`.
- Validação independente no GitHub Actions pendente do commit desta parte.

Na revisão final, os campos de origem People e visibilidade/vigência foram agrupados em detalhes avançados, conforme §6.2; expandem para dados preenchidos/People. A regressão completa do código final passou novamente.

Cobertura específica: posições, seis tipos de parte, rejeição de Users/UUIDs/contextos inválidos, ticks/limites, somente claims admitidos, roundtrip de campos, estados temporais, projeção antes de contagem, escaping, empty state, rotas GM/Player, ID estável, revisão antiga, rascunho/reset/falha de leitura, edição GM original imutável e binding de aplicação.

Cobertura vertical com owners/CommandBus/transporte reais e host simulado: claim secreto/inexistente uniforme, três posições e vigência, Controller→inbox→GM edit/approve, stranger, stale envio/decisão, recarga e approved target privado, existência de partes, replay exato submit/approve e rejeição com alvo fenced sem tocar owner.

O primeiro fixture de runtime reutilizava a mesma referência sourceRef em três claims e foi rejeitado pelo contrato estrito de payload JSON do CommandBus; foi corrigido com objetos distintos antes de reproduzir o bug de audiência. Um teste de clock ausente acionava o default do helper de teste em vez de enviar undefined ao parser; a chamada foi corrigida. Typecheck passou desde a primeira execução. Nenhum desses ajustes enfraquece validators de produção.

Host e transporte simulados. Nenhum teste real no Foundry ou publicação de release nesta parte.

## Limites e próxima parte

Esta parte conclui criação, exibição e revisão GUI dos requests de recognition suportados pelo modelo atual. Alterar/encerrar uma declaração já persistida exige evoluir as ações do owner; §6.3 lista update recognition como exemplo opcional de operação bulk, não como obrigação universal; o modelo atual adiciona declarações e admite validade finita, não possui essas ações e elas não são contabilizadas como concluídas. O rascunho é mantido na sessão da aplicação, sem prometer persistência após F5. Providers namespaced futuros, demais dashboards/consumer contracts, índices e escala Foundry continuam parciais.

**Próximo passo:** formulários de ligações territoriais, com destinos visíveis e estado operacional. Parar após esta parte e aguardar autorização. Foundry real ao fim do bloco G6; G7 não iniciado.
