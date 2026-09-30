# G0–G6 — revisão geral e correções da candidata v0.0.8

Data: 2026-09-30. Base: `bbcd525c859b0b600e2381d105a79be4de5892f0`, candidata anterior v0.0.7. Escopo: infraestrutura compartilhada, persistência, permissões, idempotência, cálculos numéricos e projeções dos blocos G0–G6. G7 não foi iniciado.

**Resultado: 13 defeitos corrigidos; nova release e novo smoke necessários.** A suíte anterior tinha 859 testes verdes e não exercitava estes casos. Isso demonstra por que PASS da suíte não prova ausência de erros nem implementação de recursos ausentes do plano.

## Defeitos reproduzidos e corrigidos

| ID | Bloco | Erro / causa | Correção e prova |
|---|---|---|---|
| REV-001 | G0 | Canonicalização perdia a chave JSON literal `__proto__`, tornando fingerprints de conteúdos diferentes equivalentes. | Objeto sem prototype na canonicalização. Teste de preservação literal falhou antes e passou depois. |
| REV-002 | G2 | Outro sender podia repetir um ID de consulta do GM e receber o DTO já autorizado para o GM. | Claim de dedupe vinculado ao sender autenticado, além do fingerprint. Replay entre usuários rejeitado sem devolver o conteúdo. |
| REV-003 | G2 | RPC de status autenticava a sessão, mas não verificava o dono do recibo. | Identidade do Socketlib passa até o CommandBus; status verifica requester. Inclui rejeição de contexto ausente, ID inválido e argumento extra de identidade forjado. |
| REV-004 | G2 | Cancelamento na fila não encerrava o dedupe; retries podiam esperar para sempre. | Cancelamento e falha de scheduler registram o mesmo recibo final e resolvem as esperas em andamento. |
| REV-005 | G2 | Ao atingir capacidade, o cache removia um comando ainda pendente. | Evicção somente de registros encerrados; cache composto só de pendências rejeita novas admissões com erro busy/retryable. O default de 5.000 é limite do cache, não de tokens nem do número total de ações do mundo. |
| REV-006 | G3 | Soma de população além do inteiro seguro era devolvida como número exato/estimado arredondado; hybrid também arredondava a comparação. | Soma em BigInt; total derivado fora do intervalo vira null/unknown com aviso. Hybrid preserva o total declarado e compara o subconjunto exatamente. |
| REV-007 | G3 | Capacidades, compromissos, reservas e totais de workforce podiam exceder o intervalo seguro sem bloquear o cálculo. | Adições/subtrações verificadas; overflow falha fechado. Repository retorna Result com erro tipado após filtrar as fontes por audiência. Segredo não provoca erro na consulta de um Player que não o vê. |
| REV-008 | G4 | Soma de capacity modifiers perdia unidades em overflow intermediário e dependia da ordem; hard maximum válido era aplicado tarde demais. | Acumulação BigInt e clamp do hard maximum antes da conversão. Testa ambas as ordens dos modifiers e o teto. |
| REV-009 | G5 | Custos progressivos usavam divisão em ponto flutuante: 7/10 de 90 cobrava 62 em vez de 63. | Divisão inteira BigInt da quantidade acumulada vezes custo; cobra 63 no primeiro avanço e os 27 restantes ao completar. Regressão atravessa o serviço e a conta econômica reais. |
| REV-010 | G6 | Recibo persistido podia ser reutilizado por outro requester após reload, antes da autorização do owner. | Recibos novos persistem requester; replay durável exige a mesma identidade. Proposta existente também verifica requester antes da admissão no cache para preservar retry legítimo. |
| REV-011 | G6 | Remoção de Territory deixava entradas no índice de parents; recriação do mesmo ID podia aparecer no parent antigo. | Remove ambos os vínculos e elimina sets vazios. Regressão remove/recria e verifica os dois eixos. |
| REV-012 | G6 | Dispute usava sua própria audiência para liberar claim restrito de outro Territory. | Referências são filtradas pela projeção do owner territorial com audiência do território. Player participante da disputa não recebe o claim; GM continua recebendo. |
| REV-013 | G6 | Create de Agreement aceitava `executedOperations` fabricado, permitindo pular efeitos futuros como se já executados. | Novo draft rejeita histórico de execução não vazio antes de qualquer persistência. Reidratação de Agreements existentes conserva seus recibos reais. |

Os testes anteriores de LRU e corrida entre usuários foram corrigidos: eles exigiam, respectivamente, evicção de pendência e compartilhamento de recibo entre senders. Os testes continuam cobrindo LRU de concluídos e dedupe simultâneo do mesmo sender.

## Retry público seguro

A API G6 agora fornece `diplomacy.commands.prepare(type, payload)`, `execute(ticket)`, `retry(ticket)` e `status(commandId)`. Guarde o ticket antes de executar; retry usa o mesmo ID e payload e passa novamente pelo pipeline normal. A API aceita somente tipos G6 e não expõe stores, adapters ou o CommandBus.

Status consulta o cache da autoridade atual. Depois de TTL, reload ou failover, ausência de status não significa que a mutação falhou. Retry do mesmo ticket reconcilia os recibos duráveis quando existentes; criar outro ID não é uma recuperação de outcome desconhecido. A UI ainda não possui o fluxo completo de tickets/status e esta lacuna permanece na matriz G6.

Compatibilidade: recibos v0.0.7 não tinham requester. Para submissions de Proposal, o requester persistido da própria proposta comprova o autor. Outros recibos legados sem comprovação falham fechados no replay; seus dados e histórico permanecem legíveis. Não se inventa um dono durante a atualização.

## Verificação e evidências

- Baseline: **859/859 PASS**.
- Candidata corrigida: **878/878 PASS**, sem skipped/cancelled/fail. Inclui 19 novos testes; `docs/evidence/G0_G6_REVIEW_AUTOMATED.log`.
- TypeScript, build, package, versões/URLs e conteúdo do ZIP: PASS; `docs/evidence/G0_G6_REVIEW_VALIDATION.log`.
- Regressões antes/depois em `docs/evidence/G0_G6_REVIEW_BEFORE.log` e `G0_G6_REVIEW_TARGET.log`; os casos de erro foram reproduzidos antes da correção. Testes adicionais de transporte/tickets/audiência reforçam as fronteiras após a correção.
- O roteiro entregue `scripts/g6-foundry-smoke.js` é executado localmente pelos owners reais e pelo adapter Socketlib real com host/browser/transporte simulados. Isso não equivale a Foundry E2E.

## Blocos anteriores e plano do G6

| Bloco | Resultado desta revisão |
|---|---|
| G0 | Correção de canonicalização; testes/build/package revalidados. |
| G1 | Repository, schema, revisão, índices e testes de storage/hierarquia incluídos na suíte completa; nenhum defeito novo confirmado neste bloco. |
| G2 | Quatro erros de dedupe/status/fila/cache corrigidos; transporte, autoridade, locks/recovery e testes multiplayer revalidados. |
| G3 | População e workforce corrigidos; separação por audiência preservada e testada. |
| G4 | Capacity modifiers corrigidos; ledger/reservations/providers/transações revalidados pela suíte. |
| G5 | Cobrança progressiva corrigida; testes de Projects/Facilities/Downtime e recuperação revalidados. |
| G6 | Quatro defeitos de persistence/index/audiência/recibos corrigidos, tickets públicos adicionados. Cobertura do plano continua parcial. |

Os documentos de aceitação anteriores são registros históricos; esta revisão não os usa como prova de que estes defeitos não existiam. A matriz completa `docs/G6_FULL_SPEC_AUDIT.md` conserva as pendências de stance, templates, overview/formulários, diagnostics, consumer/effect integrations e escala. Recursos ausentes não foram contabilizados como corrigidos nem como PASS. Não declarar `GATE_G6_ACCEPTED` ou 100% da Rodada 08.

## Release e smoke

A candidata **v0.0.8** possui novos assets e preserva v0.0.7. Instalação:

https://github.com/STR4DZN/Nova-Base/releases/download/v0.0.8/module.json

Execute novamente o smoke G6 v2 em mundo de testes, começando no Primary GM; as fixtures v1 não são reutilizadas. Além das fases existentes, ele verifica recibos GM/Player, claims restritos através de Dispute e rejeição de execução fabricada. Os scripts G2 e G5 anteriores acompanham os assets para revalidação dos fluxos compartilhados. O caso numérico exato de custo customizado é coberto pelo teste local de G5, não simulado como PASS do runner Foundry.

O PASS Foundry informado pelo usuário para v0.0.7 permanece histórico. **v0.0.8 ainda precisa de execução real GM/Player/F5/failover**; relatórios individuais não foram fornecidos para a nova versão.
