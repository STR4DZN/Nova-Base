# G6 — Reivindicações territoriais herdadas no inspector

Data: 2026-10-01. Branch: `feat/g6-continuous`. Candidata: v0.0.8. G6 parcial.

## Entrega

O detalhe territorial expõe `effectiveClaims` com ID/label/revisão da origem e indicação Local/Herdada. A hierarquia física é o padrão; o seletor consulta a hierarquia administrativa separadamente. O botão de origem abre somente um território presente na projeção admitida, sujeito a nova consulta autenticada.

Reivindicações vigentes usam o clock autoritativo, início inclusivo e fim exclusivo. Registros encerrados/superseded, futuros, expirados ou sem propagação ancestral não entram na derivação. Reivindicações concorrentes, IDs iguais em origens distintas e contestações permanecem separados. Não há eleição de vencedor ou conversão automática entre propriedade, administração, controle, presença, ocupação e direitos.

Natureza Local/Herdada descreve a origem do registro; a coluna de propagação mostra a policy `claim.inherited`. O próprio registro local pode propagar aos descendentes sem tornar-se herdado neste território. As coleções locais continuam independentes da projeção, inclusive nas opções de reconhecimento e ocupação.

## Privacidade e disponibilidade

Cada origem é lida do armazenamento persistido e projetada com a própria audiência. Controle do filho não concede acesso aos pais. Territórios privados, fences, registros ausentes, inválidos ou com identidade/revisão incoerentes interrompem a cadeia. A consulta não atravessa um ancestral inacessível para expor um avô público e não revela motivo de recuperação ou contagem de fontes ocultas.

Ciclo visível retorna somente as reivindicações locais, sem corrigir armazenamento. Uma cauda indisponível é tratada como o limite da projeção disponível. O inspector informa que a consulta usa origens acessíveis/disponíveis; não afirma completude da cadeia. Diagnóstico global da hierarquia permanece fora desta parte.

A consulta do próprio território também usa estado fresco, evitando derivar dados de um filho que tenha se tornado privado depois de indexado. Navegação revalida permissão. HTML/atributos escapam textos de origem, partes, IDs e tipos. Trocar o eixo invalida o detalhe anterior; falha de atualização remove o DTO antigo, preservando rascunhos de ações locais.

## Testes e correções durante a implementação

O primeiro teste vertical de reparent esperava o evento na coleção genérica de estado. A auditoria nativa de reparent fica em `territory.hierarchyHistory`; a assertiva foi corrigida para verificar essa coleção, mantendo a revisão e a ausência de cópias de claims. Primeira execução: 122/123 PASS; execução final: 123/123 PASS. Não foi identificado defeito de produto nessa falha.

8 testes de interface e 123 testes verticais G6. **Regressão final 1175/1175 PASS** (20 novos), zero falhas/skips. TypeScript/build/package/validate:release PASS localmente. CI pendente; resultado será registrado em `docs/evidence/G6_TERRITORY_CLAIMS_VALIDATION.json`. Workflow específico preserva logs e ZIP sem publicar release.

Cobertura: dois eixos/default físico; provenance e policy distintas; fontes concorrentes/contestadas; audiência independente GM/Player/terceiro; mudança de visibilidade no armazenamento versus índice antigo; ancestral privado com avô público; fences de origem/grafo; fonte ausente/inválida/identidade ou revisão incoerente; ciclos; limites temporais; reparent auditado; recarga sem writes/eventos; IDs herdados rejeitados como referências locais de reconhecimento/ocupação; escape HTML; drafts e bindings; origem indisponível rejeitada; falha sem DTO antigo.

## Limites e próximo passo

Sem teste real no Foundry nesta parte: executar somente ao fim do G6. Sem publicação de release ou início do G7. A derivação está no inspector; os impactos herdados completos na prévia de alteração hierárquica, direitos efetivos/capabilities, transferências, agregados Facilities/People/Economy, diagnósticos e escala permanecem pendentes.

**Próximo passo:** prévia dos impactos sobre reivindicações herdadas ao alterar a hierarquia territorial. Parar nesta parte e aguardar autorização.
