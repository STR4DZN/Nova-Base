# G6 — Formulários de direitos territoriais — 2026-10-01

## Resultado e escopo

Concessão e revogação agora têm formulários próprios no inspector territorial. A concessão aceita os seis beneficiários canônicos (Domínio, Actor, parte narrativa, grupos populacional/operacional e notável), tipo com namespace, estado ativo/inativo, propagação, revogabilidade, visibilidade e janela com início inclusivo/fim exclusivo. Início vazio usa o tick da consulta autenticada; zero é preservado. Origem de grupos/notáveis é validada junto da existência da parte pela autoridade.

Condições são linhas estruturadas de tipo + identificação ID/UUID + valor, com adicionar/remover sem perder campos. Capacidades declaradas são opcionais, uma com namespace por linha. Referências inválidas, duplicadas e capacidades repetidas são rejeitadas na interface. A verdade das condições pertence ao provider autoritativo: ausência de confirmação mantém o direito condicionado não efetivo. Conceder não executa consequences nem escreve no ledger.

Revogação seleciona apenas fontes locais visíveis, ativas e revogáveis. Fontes herdadas e termos de Agreements continuam no inspector com navegação para sua origem; não entram na seleção e não são copiados. Revogação conserva beneficiário, janela, condições, grants e fonte, altera somente `active` e anexa evento auditável. A política nativa não revogável continua sendo aplicada pela autoridade.

Player envia proposta ordinária, sem alterar o território. GM pode conceder/revogar diretamente ou revisar a proposta em campos estruturados. O original permanece imutável; revisão preserva alvo, operação e ID da fonte. Campo opcional de revisão atual exige conferir outra edição antes de aprovar. Rejeição depende somente da proposta e permanece disponível quando o alvo está indisponível ou em recovery.

Rascunhos conservam campos e ID após falha, ficam vinculados à revisão e são isolados entre territórios/abas. Reset explícito permite usar a revisão atual. Os controles genéricos duplicados de direito foram removidos.

## Achados, causas e soluções

| Achado | Causa | Solução e evidência |
|---|---|---|
| Player podia propor revogação de direito secreto por ID adivinhado | Admissão verificava controle do território, mas o owner buscava o ID na coleção integral | Reproduzido antes da correção: 170 PASS/1 FAIL; proposta secreta foi aceita. Admissão agora verifica coleção local projetada antes da preparação; secreto/ausente têm `DM_TERRITORY_RIGHT_UNAVAILABLE`, sem writes. Log `docs/evidence/G6_TERRITORY_RIGHT_FORMS_BEFORE.log`. |
| Revisão podia expor conteúdo privado escolhido pelo GM | Projeção genérica de approvedIntent não verificava o direito local | Consulta revalida fonte fresca/audiência/fences e oculta approvedIntent indisponível. Testes adversários cobrem grant secreto, revogação com visibilidade alterada, fonte ausente/corrupta/fenced e colisão de ID privado. Original do solicitante permanece visível e intacto. |
| Metadados arbitrários em referências podiam acompanhar approvedIntent público | Redação genérica copiava objetos completos | Projeção de grant aprovado retorna somente campos canônicos; beneficiário, condição e fonte sanitizados. Teste injeta marcadores em quatro objetos e verifica ausência na resposta Player. |
| Revisão podia substituir direito/operação pela API | Guard genérico preservava apenas espécie/modo/alvo | Guard específico de propostas de direito preserva espécie da ação e ID da fonte, antes de preparar writes. Interface também fixa fonte de revogação e preserva ID/sourceRef da concessão original. |

Somente o primeiro achado tem reprodução sobre o código anterior. Os demais foram cobertos por inspeção e testes adversários da solução.

## Ajustes durante validação

- Um teste de tick inválido usava helper com parâmetro default e acabava substituindo `undefined` por 10. Passou a chamar o parser diretamente; produção não foi alterada.
- Primeira montagem dos novos testes verticais: 175/184 PASS, nove recusas de permissão. `createDiplomacyDraft` territorial não usa a lista de partes; a fixture passou a registrar uma reivindicação de controle do Domínio antes da proposta. Nenhuma permissão foi relaxada.
- Primeira regressão completa: 1287/1288 PASS. O double de DOM de ocupação retornava verdadeiro para qualquer querySelector; o novo handler passou a identificar revisão de direito pelo campo `rightReview` realmente serializado. O fluxo de ocupação voltou a passar.

## Validação

**1288/1288 testes PASS** (29 novos), específicos 15/15 e verticais 184/184; zero falhas/skips. TypeScript/build/package/validate:release PASS localmente. GitHub Actions pendente de persistência/verificação. Evidência canônica: `docs/evidence/G6_TERRITORY_RIGHT_FORMS_VALIDATION.json`. Workflow próprio preserva logs, relatório e ZIP da candidata 0.0.8, sem publicar release.

Cobertura inclui beneficiários/janelas/flags/tipos customizados, condições ID/UUID, namespaces/duplicatas, escaping, bindings de adicionar/remover, rascunhos/revisões, propostas e revisão GM, revogação auditada, privacidade/fences, partes inexistentes, controle antes da mudança, recarga e retry exato dos tickets existentes. Testes usam os owners, transporte e armazenamento compostos reais com doubles de host; não são homologação Foundry real.

## Limites e próxima parte

O editor permite até 100 condições e seis tipos canônicos de parte; o contrato nativo de extensões não foi ampliado. Condições são declarações: o formulário não resolve automaticamente existência/audiência de qualquer referência de addon, não confirma sua verdade e não cria locks para providers externos. Consumers/access policy gerais, efeitos compostos e benchmarks de escala continuam parciais.

Retry exato pela API foi testado, mas a interface ainda não conserva ticket de comando para resultado desconhecido. Próxima parte delimitada: fluxo seguro de ticket/retry/status na interface de diplomacia, preservando commandId após erro ou timeout e evitando reaplicar mutações com novo ID.

**PARAR AQUI.** G6 permanece parcial; Foundry real somente ao concluir o bloco G6. G7 não iniciado; nenhuma release publicada.
