# G6 — Formulários de ocupação territorial

Data: 2026-10-01. Branch: `feat/g6-continuous`. Candidata: v0.0.8. G6 parcial.

## Entrega

Criação de declarações de ocupação com ocupante (seis tipos de parte), estado nativo, visibilidade, vigência e seleção múltipla de presenças/reivindicações de controle visíveis no próprio território. Campos avançados recolhidos. Referências opcionais, inclusive históricas, mantêm os registros existentes; ocupação não cria presença, controle, propriedade ou vencedor.

Inspector apresenta registros, distribuição dos cinco estados e vigência separada do estado declarado. Ultrapassar o prazo apenas muda a apresentação temporal; não encerra ocupação automaticamente. Encerramento auditado preserva ocupante, referências e histórico; repetição no mesmo estado é no-op.

Jogadores enviam propostas. Revisão estruturada pelo GM permite editar ocupante, referências, estado inicial e janela de uma declaração, preservando ID/sourceRef e o pedido original. Encerramento permanece vinculado ao alvo original. Aprovação usa a revisão solicitada; atualização explícita da revisão do alvo exige conferir a mudança. Rejeição não depende de formulário válido nem de território disponível.

## Erros encontrados, causas e correções

| Achado | Causa | Solução e testes |
|---|---|---|
| Proposta Player aceitava referências secretas | Owner validava existência, sem audiência das referências de ocupação | Admissão pela projeção autenticada de estado fresco; secreto/inexistente/tipo errado rejeitados uniformemente, sem gravações. |
| Player podia propor encerramento de ocupação secreta por ID | End validava existência, sem testar visibilidade da ocupação e das dependências | Admissão pela lista projetada; alvo e referências inacessíveis compartilham rejeição. |
| Aprovação editada pelo GM expunha referência privada | Sanitização genérica não filtrava strings em presenceIds/controlClaimIds | Consulta da decisão reavalia estado persistido, alvo e referências; approvedIntent fica null quando indisponível. |
| FormData poderia perder seleções múltiplas | Serializer existente mantinha só o último valor por nome | getAll serializado em JSON nos formulários de ocupação e revisão; ordem, lista vazia e múltiplas seleções testadas. |
| Seleção desaparecida poderia ser removida silenciosamente ao atualizar | Opções vêm de projeção atual; rascunho pode usar versão anterior | Alerta/flag bloqueia envio até limpeza explícita do rascunho ou das referências de revisão, sem mostrar IDs indisponíveis. |

Os três defeitos de privacidade foram reproduzidos antes da correção: suíte vertical 100 testes, 97 PASS e 3 FAIL. Após correção, os três passaram. Novas verificações cobrem também índice antigo, audiência alterada depois da aprovação, ocupação cujo dependency ficou privado e create intents com referências inline.

A validação inicial apontou tipagem da coleção de campos de revisão: anotação Record<string,string> aplicada. Ajustes de fixture: chamada direta necessária para testar clock undefined (wrapper usava default 10); fence instalado na API gm.recovery.fenceRegistry, e não no campo inexistente gm.mutations. Nenhum dos dois ajustes enfraquece assertivas de produto.

## Testes e resultado

16 testes específicos de UI e 111 testes verticais G6; **regressão final 1155/1155 PASS** (30 novos), zero falhas/skips. TypeScript/build/package/validate:release PASS localmente; CI pendente. Evidência: `docs/evidence/G6_TERRITORY_OCCUPATION_VALIDATION.json`. Workflow específico guarda logs e ZIP sem publicar release.

Cobertura: estados/partes/namespace de controle/listas/duplicatas/janelas/zero/inteiros seguros; histórico sem reativar dependências; HTML escapado; ausência de referência privada nas opções; drafts/revisão/reset; binding multi-select; GM/Player/terceiro; revisão editada e original imutável; alvo de encerramento fixo; expiração sem mutação; fenced approval/reject; retry exato e recarga; create intents; estado persistido versus índice antigo.

## Limites e próximo passo

Teste real no Foundry somente ao fim do bloco G6. Não houve publicação de release nem início do G7. Este recorte implementa criação com estados nativos e encerramento: alteração dos estados intermediários de um registro já persistido e policies automáticas continuam fora deste formulário/owner atual. Transferências, direitos efetivos, agregados Facilities/People/Economy, integração de influência, diagnósticos e escala permanecem pendentes.

**Próximo passo:** exibir reivindicações territoriais herdadas no inspector, com origem e distinção das reivindicações locais. Parar nesta parte e aguardar autorização.
