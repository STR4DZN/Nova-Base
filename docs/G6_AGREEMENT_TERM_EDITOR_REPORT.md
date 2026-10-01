# G6 — editor de múltiplos termos dos acordos

Data: 2026-09-30 (America/Sao_Paulo). Branch: `feat/g6-continuous`. Base: `be33a782672a4a4ef128fb1b5795dbd0435f1d98`.
Escopo: esta parte de G6.4/G6.9, Rodada 08 §5.3/§6.2. Concluir, validar automaticamente, registrar e parar. Teste real no Foundry somente ao concluir o bloco G6.

## Problemas, causas e soluções

| Problema | Causa | Solução |
|---|---|---|
| Emenda/contraproposta do formulário antigo substituía todos os termos por um | Builder construía um snapshot de um termo | Editor copia todos os termos visíveis e permite editar, adicionar, remover e reordenar; IDs estáveis e payloads completos preservados. |
| Snapshot Player poderia apagar termos privados ausentes do DTO | Snapshot filtrado não representa todo o acordo canônico | Seleção explícita `baseTermIds` no mesmo comando do owner; somente slots selecionados são substituídos/removidos, os demais termos canônicos são preservados. Colisão com ID fora da seleção falha; contraproposta parte da última rodada canônica. |
| Campos novos podiam zerar prazo/condições/dados desconhecidos | Formulário único não carregava payload completo | Duração de origem copiada, descrição null/vazia distinguida, condições/refs/consequências e campos adicionais preservados. Dados completos dos tipos nativos editáveis por JSON em seção avançada fechada inicialmente. Selecionar outro tipo aplica um modelo novo de payload somente naquela linha. |
| Recarregar detalhe poderia associar input antigo à revisão nova | Uso da revisão atual sem vínculo ao rascunho | Editor guarda revisão do acordo e proposta de origem; conflito mantém rascunho e exige reabrir após revisão. A autoridade continua aplicando os guards existentes. |
| Confirmar poderia enviar remoções ou mudanças sem conferência | Ausência de diff anterior ao envio | Prévia obrigatória de alterações visíveis: adição/remoção/edição/ordem/duração. Mudança de campos invalida a prévia e retira o diff antigo da tela. Conferência é local e não executa operações. |
| Operações de várias linhas podiam descartar texto/JSON inválido | Recriação/parsing antecipado dos inputs | Add/remove/move renomeiam campos sem interpretar JSON; erros preservam todos os inputs. Binding do editor mantém espaçamento do texto. Valores escapados. |

Player envia proposta ao GM pelo pipeline existente; aprovar a alteração cria a proposta de termos ou aplica emenda direta conforme Definition. Reapproval e ativação continuam nos owners existentes. Campos simples legados via controller passam a acrescentar um termo, preservando os não selecionados; API sem seleção explícita continua aceitando snapshot completo intencional, por compatibilidade.

Nenhum armazenamento, transporte, Scheduler ou executor de efeitos novo. `baseTermIds` pertence ao comando, não ao estado persistido; snapshots/rounds/emendas canônicos armazenam o conjunto completo resolvido. Termos fora da seleção preservam conteúdo e ordem relativa. A prévia Player mostra somente mudanças visíveis, sem inferir conteúdo privado.

## Validação

- **978/978 testes PASS**, 0 FAIL, 0 skipped; 22 novos nesta parte (17 específicos + 5 verticais).
- **17/17 específicos** e **53/53 verticais** PASS; 15/15 de negociação continuam PASS.
- TypeScript/build/package/validate:release **PASS localmente e no GitHub Actions**, Node local 24.19.0.
- Commit de código validado: `6fbafd44395fbb76ed0c746070d253ffe0992d95`.
- Workflow [36805799751](https://github.com/STR4DZN/Nova-Base/actions/runs/36805799751), job `110189735042`: **SUCCESS**, Ubuntu + Node 22.23.3.
- [ZIP v0.0.8 e logs](https://github.com/STR4DZN/Nova-Base/actions/runs/36805799751/artifacts/11137402007), artifact `g6-agreement-term-editor-candidate`, retenção de 14 dias. Hash do container: `sha256:e5857cdafa21251e75771c1170a31eeadbe2824a77725224ec9b4c29aa457e98` (não é o hash isolado do ZIP instalável).
- Hash SHA256 do ZIP local validado: `4cad5441cc1b7e764e56137f9698d7c52d7d4658a9080cfe15a168f3ad1405e6`.
- Evidência permanente: `docs/evidence/G6_AGREEMENT_TERM_EDITOR_VALIDATION.json` e `docs/evidence/G6_AGREEMENT_TERM_EDITOR_CI_SUMMARY.log`.

Durante a implementação, o typecheck encontrou perda de narrowing ao reatribuir a union de ações; o merge foi movido para variáveis locais, mantendo a ação original. Duas fixtures específicas inicialmente tinham título com espaços nas extremidades e uma capacidade sem IDs, proibidos pelo schema existente; foram corrigidas sem relaxar validators. O teste anterior de emenda direta foi migrado para o novo editor, mantendo as verificações de auditoria/antes/depois; a preservação do formulário geral agora verifica renovação/evidências e a preservação de múltiplos termos tem testes próprios.

Os testes usam host/transporte simulados com owners reais. Nenhum teste real no Foundry nesta parte; nenhuma release publicada.

## Limites e próxima parte

Esta parte conclui o editor avançado de múltiplos termos nativos; configurações estruturadas são editadas no objeto JSON completo. Não representa uma interface especializada de cada provider externo. Dashboard por estado, demais formulários/read models/integrações e escala real continuam pendentes na matriz; G6 parcial.

**Próximo passo:** dashboard dos acordos por estado, com filtros de ciclo de vida. Parar após esta parte e aguardar autorização. Foundry real ao fim do bloco G6; G7 não iniciado.
