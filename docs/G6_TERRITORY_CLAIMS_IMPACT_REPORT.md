# G6 — Prévia dos impactos nas reivindicações herdadas

Data: 2026-10-01. Branch: `feat/g6-continuous`. Candidata: v0.0.8. G6 parcial.

## Entrega

A prévia de alteração hierárquica mostra os pais antes/depois e as reivindicações herdadas recebidas, perdidas e mantidas. Hierarquias física e administrativa têm conjuntos independentes de territórios afetados: o alvo e todos os seus descendentes no eixo alterado. Eixo sem mudança não produz impactos. Desanexar para raiz e mudanças simultâneas nos dois eixos estão cobertos.

Cada reivindicação mantém origem, revisão da fonte, parte, tipo e contestação. A comparação usa o par origem/claim ID, preservando IDs iguais em territórios distintos e ancestrais comuns. Fontes locais vigentes aparecem como contagem preservada. Início inclusivo/fim exclusivo, lifecycle e policy de propagação usam o tick autoritativo; o cálculo não escolhe vencedores.

Os registros dos descendentes não são copiados nem regravados. Confirmar grava somente a hierarquia/revisão/auditoria do alvo; coleções locais, demais fontes, ocupações, direitos e instalações mantêm sua independência. A consulta da herança reflete a nova árvore na próxima leitura.

## Achados, causas e soluções

| Achado | Causa | Solução e evidência |
|---|---|---|
| Prévia não apresentava impactos herdados nos descendentes | Retorno e UI exibiam apenas o write set e sua quantidade | Cálculo puro antes/depois dos dois eixos e tabela por território; testes de subárvores, fontes comuns, concorrência e raiz. |
| Formulário podia limpar pais/motivo ao renderizar depois da prévia | Formulário genérico não tinha draft restaurado | Rascunho de reparent preservado/restaurado; binding real de prévia, render e submit testado. Mudança de contexto limpa o rascunho. |
| Confirmação podia usar impactos antigos apesar da revisão do alvo estar igual | Guard anterior verificava apenas campos e revisão primária | `previewSnapshot` inclui fingerprint canônico do catálogo territorial, intenção e tick. Preparação sob locks reavalia fontes persistidas; drift retorna `DM_TERRITORY_PREVIEW_STALE` sem writes. |
| Catálogo apenas indexado podia omitir adição territorial externa | Preparação relia somente IDs já conhecidos em memória | Reparent enumera armazenamento, relê IDs atuais/anteriores e valida estado/identidade/revisão; teste de adição externa não indexada invalida snapshot. |
| Fonte fenced ou inválida podia produzir prévia incompleta | Disponibilidade anterior focava locks do comando primário | Toda a coleção territorial usada na prévia de reparent precisa estar disponível e válida; fonte ausente/corrupta/incoerente/fenced bloqueia cálculo. |

Os achados acima foram identificados pela inspeção dos fluxos existentes e verificados nos testes da implementação. Não são apresentados como reprodução de falhas na versão anterior.

O snapshot usa o detector de mudanças canônico já existente no projeto (`computeFingerprint`), sem funcionar como credencial. Autenticação/GM-only são verificadas separadamente. O fingerprint não aparece na interface. Uma alteração territorial alheia ao ramo também invalida a prévia: a revalidação é conservadora e usa o catálogo inteiro. Otimização/benchmark de escala fica para o recorte correspondente.

## Ajustes encontrados nos testes

Primeira suíte específica: 13/15 PASS; as duas falhas eram fixtures tentando clonar uma função e alterar um DTO congelado. Clonar somente dados e preparar cópia mutável para o teste de HTML corrigiu ambos, sem mudar assertivas de produto.

Primeira suíte vertical: 137/139 PASS. O teste antigo permitia recuperar a prévia original após editar e restaurar campos; foi reforçado para exigir nova prévia após qualquer edição. O teste novo tentava remover contestação via `contest-claim`, operação nativa que somente contesta e resultou em no-op; passou a encerrar uma fonte para testar uma alteração real do ancestral. Execução final: 139/139 PASS.

## Validação

15 testes específicos de cálculo/contrato/UI/bindings e 139 verticais G6; **regressão final 1206/1206 PASS** (31 novos), zero falhas/skips. TypeScript/build/package/validate:release PASS localmente. GitHub Actions pendente; registrar resultado final em `docs/evidence/G6_TERRITORY_CLAIMS_IMPACT_VALIDATION.json`. Workflow próprio preserva logs e ZIP sem publicar release.

Cobertura inclui GM/Player/terceiro e spoofing; privacidade da prévia GM; snapshot versus alteração do ancestral, visibilidade sem mudança de revisão, tick, catálogo externo, ação/motivo e revisão primária; fences/corrupção; no-op; detach para raiz; campos e HTML escapados; confirmação com snapshot; recarga/retry exato sem segunda auditoria; propostas Player imutáveis e aguardando decisão GM; ausência de cópias de claims e writes nos descendentes.

## Limites e próximo passo

Esta prévia é GM-only, conforme o contrato existente. Player continua enviando proposta ordinária. `previewSnapshot` é obrigatório no fluxo de confirmação de reparent pela interface GM; comandos legados sem esse campo continuam compatíveis e revalidam a hierarquia, mas não vinculam uma prévia anterior. Editor estruturado/prévia da revisão de propostas de hierarquia pelo GM permanece pendente.

Direitos e demais estados herdados ainda não têm seus impactos completos nesta prévia. Transferências, acesso efetivo/capabilities, aggregates, diagnóstico e escala continuam parciais. Foundry real somente ao concluir o bloco G6. Sem publicação de release ou início do G7.

**Próximo passo:** exibir direitos territoriais efetivos no inspector, com origem, vigência e condições, distinguindo direito de concessão de capabilities. Parar nesta parte e aguardar autorização.
