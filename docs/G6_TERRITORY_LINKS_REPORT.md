# G6 — Ligações territoriais — 2026-10-01

Parte autorizada: formulários de TerritoryLink, destinos visíveis e estado operacional. Foundry real somente quando o bloco G6 estiver concluído; G6 permanece parcial e G7 não foi iniciado.

## Resultado

- Criação de ligações com destino admitido pela API autenticada, busca/páginas de 30 itens independentes da lista principal e seleção preservada fora da página por consulta individual. O próprio território é excluído. Erro remove destinos antigos sem apagar rascunhos.
- Tipo extensível com namespace; direção relativa ao território de origem; quatro estados: operacional, limitada, fechada e destruída. Vigência usa tick explícito da consulta, início inclusivo e fim exclusivo. Custo/capacidade opcionais distinguem zero de ausência. Dependências tipadas JSON em campos avançados.
- Lista/resumo calculados somente com links recebidos na projeção sanitizada, separando agendados/vigentes/expirados. Atualização de estado seleciona apenas links visíveis e mantém demais campos.
- GM grava pelo owner existente; Player envia proposta sem efeito no território. Revisão GM estruturada da criação/estado preserva pedido original, ID/fonte da declaração e ID do link em alterações de estado. Revisão do alvo opcional é explícita; conflitos/erros conservam campos. Rejeição não depende dos campos da alteração e exige motivo.
- Rascunhos vinculados à revisão, ID estável após falha de criação, isolamento entre registros/abas e reset explícito. Bindings preservam campos durante busca/paginação. Repetição exata usa os tickets existentes; reenviar um novo comando pela UI não é apresentado como retry exato.
- Existência/autoligação/parties/revisão continuam verificadas na autoridade. Locks de destino em gravação/aprovação e verificações frescas de fences protegem dependências. Submit Player mantém source/graph locks e admite destino antes de expor erros específicos de recuperação.

## Correções de segurança

Três defeitos foram reproduzidos antes das correções (79 testes anteriores PASS, três novos FAIL):

1. Player podia propor ligação a destino secreto/restrito não admitido; inexistente tinha comportamento distinto.
2. Player podia propor alteração de um link secreto por ID adivinhado.
3. Aprovação editada para destino privado expunha UUID no DTO da proposta do Player.

Submit agora verifica estado persistido fresco, audiência do destino e do link existente, além de propostas create com links. Secreto, inacessível, ausente ou destino bloqueado retornam `DM_TERRITORY_LINK_UNAVAILABLE` uniforme. Proposta de novo link secreto para destino admitido continua possível, pois o pedido pertence ao remetente e ao GM.

A projeção aprovada reavalia source/link/destino com estado fresco; quando indisponível, entrega `approvedIntent: null`, conservando registro canônico e pedido original. A projeção territorial também filtra destinos privados/bloqueados usando estado persistido fresco. Reload mantém a proteção. Rejeição altera somente proposal; não escreve o destino nem remove fence.

## Validação

Local: **1106/1106 testes PASS**, 0 falhas/skips (30 novos: 17 de UI e 13 verticais). Específicos: 17/17; verticais: 92/92. TypeScript, build, package e validate:release PASS. Node local 24.19.0; CI pendente, configurado para Node 22 em Ubuntu. O workflow específico guarda logs e ZIP candidato, sem publicar release.

Cenários incluem parsing/janelas/zero/dependências/HTML; drafts/revisão/review/bindings; criação/estados auditados; público/restrito/secreto/inexistente; mudança de visibilidade persistida; fences; concorrência; retries/reload; paginação/seleção preservada e ausência de efeitos econômicos/recíprocos.

Dois ajustes de fixture foram necessários durante a regressão: comparar o snapshot do ledger em vez do protótipo de uma classe clonada; consolidar captura de input em um listener para manter o mock de bindings existente. Não são registrados como os três defeitos de segurança reproduzidos.

## Limites e próxima parte

Atende Master Specification Rodada 12 §3.5 TerritoryLink e o recorte de formulários/dashboard §§5.4/6.2. Custo/capacidade/dependências são declarativos, sem movimentação econômica, execução de referências, cálculo de rota ou criação recíproca. Direitos de trânsito seguem seu próprio owner/resolver. Route computation completa não é requisito obrigatório do core.

Esta parte não muda tipo/direção/dependências de um link persistido: o owner existente oferece adição e alteração de estado. Resolução especializada de providers/dependências, demais integrações/diagnostics/escala e demais formulários permanecem parciais conforme auditoria.

**Próximo passo:** formulários de influência territorial, com eixos e modificadores. Parar aqui e aguardar autorização. Foundry real ao fim do bloco G6; nenhuma release publicada.
