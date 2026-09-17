# DOMAIN MANAGER — G1 AUDIT / FIX REPORT

## Resultado

**Código do G1: APROVADO LOCALMENTE APÓS CORREÇÕES.**

Estado formal do projeto: `READY_FOR_EXTERNAL_FOUNDRY_SMOKE` porque o smoke real do Foundry que já estava pendente desde G0 ainda não foi fornecido. Nenhum blocker local conhecido permaneceu após esta auditoria.

## Escopo auditado

- G1.1 Domain schema + validators
- G1.2 codec JournalEntry/flags
- G1.3 DomainRepository read/query/save
- G1.4 lifecycle create/load/update/archive/restore
- G1.5 revision/no-op
- G1.6 hierarchy/reparent/cycle
- G1.7 capabilities
- G1.8 indexes
- G1.9 integrity checker
- G1.10 acceptance/migration seed/package
- boundary de produção Foundry para `game.journal` / `JournalEntry.create`

## Erros encontrados e soluções

### G1-ERR-001 — Hierarquia tratava UUID Foundry como ID local

**Severidade:** BLOCKER  
**Arquivos:** `src/domains/domain-hierarchy-validator.ts`, `src/storage/repositories/domain-repository.ts`, `src/core/identity/refs.ts`

`parentDomainUuid` era comparado diretamente com `document.id` (`root`, `child`, etc.). O Master determina UUID Foundry completo para referências de Documents, portanto `JournalEntry.root` e `root` possuem semânticas diferentes.

**Correção:**
- validator central de UUID Foundry/JournalEntry adicionado;
- hierarchy nodes agora usam `uuid` canonical;
- repository carrega e preserva `Document.uuid` separadamente de `Document.id`;
- reparent/cycle/missing-parent usam UUID completo;
- UUID do documento é imutável durante save;
- índice agora contém e consulta `uuid`.

### G1-ERR-002 — `save/update` conseguia burlar o cycle validator

**Severidade:** BLOCKER  
**Arquivo:** `src/storage/repositories/domain-repository.ts`

O método `reparent()` validava ciclos, mas um consumer conseguia alterar diretamente `record.definition.hierarchy.parentDomainUuid` e chamar `save()`/`update()`, persistindo uma hierarquia que nunca passava por `validateDomainReparent()`.

**Correção:** toda alteração do parent é detectada dentro de `save()`. O mesmo validator de hierarchy/cycle/missing parent é executado antes da escrita, independentemente de o caller usar `reparent`, `save` ou `update`.

### G1-ERR-003 — `query()` ignorava o índice e fazia full scan sempre

**Severidade:** BLOCKER DE ARQUITETURA/PERFORMANCE  
**Arquivos:** `src/storage/repositories/domain-repository.ts`, `src/storage/indexes/domain-index.ts`

Embora G1.8 declarasse índice incremental, `DomainRepository.query()` chamava `store.list()` e decodificava todos os Domains em toda consulta. Isso contrariava o objetivo explícito de “queries sem full scan comum”.

**Correção:**
- primeira consulta faz lazy rebuild atômico do índice;
- consultas seguintes obtêm candidate IDs pelo `DomainIndex` e fazem `get(id)` apenas dos candidatos;
- create/update mantêm o índice incremental quando ele já foi inicializado;
- `rebuildIndex()` continua sendo o recovery explícito;
- filtros do repository foram alinhados ao índice (`uuid`, `name`, `alias`, `kind`, `scale`, `parent`, `tag`, `capability`, `lifecycle`).

### G1-ERR-004 — Validator podia lançar exception em payload malformado

**Severidade:** BLOCKER  
**Arquivo:** `src/domains/domain-validator.ts`

Payloads como `metadata.source = null` podiam atravessar checks superficiais e causar acesso de propriedade inválido em runtime. Um validator de boundary não pode lançar por input hostil/corrompido.

**Correção:** validação estrutural profunda usa guards de objeto antes de acessar seções aninhadas. Casos profundamente malformados agora retornam `Result.err` de forma determinística.

Também foram reforçados:
- `revision`/`schemaVersion` como safe integers;
- summary máximo de 500 caracteres;
- kind/scale não vazios e canonicalizados;
- alias máximo 20 e semanticamente único;
- tags máximo 50 e canonicalizadas;
- `parentDomainUuid` deve ser UUID JournalEntry completo;
- `archivedAt` finito e não negativo.

### G1-ERR-005 — Normalização canônica não era aplicada

**Severidade:** MAJOR  
**Arquivos:** `src/storage/codecs/domain-codec.ts`, `src/storage/repositories/domain-repository.ts`

Aliases/tags/IDs técnicos podiam ser persistidos com espaços, case inconsistente e duplicatas, apesar das decisões de normalização do Master.

**Correção:**
- aliases recebem trim, remoção de vazios e dedupe case-insensitive preservando a primeira grafia;
- alias semanticamente igual ao `JournalEntry.name` é removido;
- tags são normalizadas para technical slug e deduplicadas;
- kind/scale/capability IDs recebem canonicalização técnica;
- config keys de capability seguem o ID canonical;
- name é trimado na boundary do repository;
- summary recebe trim sem truncamento silencioso.

### G1-ERR-006 — Não existia store de produção para Foundry

**Severidade:** BLOCKER  
**Arquivo novo:** `src/storage/adapters/foundry-domain-document-store.ts`

O repository era testado somente com um store fake. Não existia implementação que ligasse o boundary a `game.journal` e `JournalEntry.create`, portanto a alegação de JournalEntry canônico não tinha caminho real no host.

**Correção:** criado `FoundryDomainDocumentStore`, com runtime injetável para testes e resolução dos globals Foundry em produção.

### G1-ERR-007 — Um store Foundry ingênuo trataria qualquer JournalEntry como Domain

**Severidade:** BLOCKER encontrado durante o fix  
**Arquivo:** `src/storage/adapters/foundry-domain-document-store.ts`

`game.journal` contém JournalEntries comuns além de Domains. Enumerar todos produziria falsos `DM_DOMAIN_PAYLOAD_INVALID` e poderia expor documentos não pertencentes ao subsystem.

**Correção:** `list()` e `get()` retornam somente JournalEntries que possuem `flags["domain-manager"]`. JournalEntries comuns são ignorados.

### G1-ERR-008 — Index não armazenava UUID, apesar do contrato normativo

**Severidade:** MAJOR  
**Arquivo:** `src/storage/indexes/domain-index.ts`

O Master fixa `uuid/name/aliases/kind/scale/parent/tags/capabilities` como campos indexados. O índice possuía local `id`, mas não `uuid`.

**Correção:** `DomainIndexEntry` agora preserva ambos: local `id` para lookup no store e `uuid` canonical para identidade/refs; query por UUID foi adicionada.

### G1-ERR-009 — Closeout documental contraditório

**Severidade:** MAJOR  
**Arquivos:** `docs/BUILD_STATE.md`, `docs/GATE_G1_ACCEPTANCE_REPORT.md`

O acceptance dizia `GATE_ACCEPTED`, enquanto o topo do `BUILD_STATE` ainda declarava `G0 / READY_FOR_EXTERNAL_SMOKE`, contendo histórico incremental contraditório.

**Correção:** `BUILD_STATE` foi consolidado em um estado canônico único. O acceptance de G1 agora distingue claramente “localmente validado” de “smoke real do Foundry pendente”.

### G1-ERR-010 — Validação do checkpoint não exigia a boundary Foundry

**Severidade:** MINOR/PROCESS  
**Arquivo:** `scripts/validate-gate1-full.mjs`

O full-checkpoint validator conseguia passar mesmo sem o adapter de produção.

**Correção:** validator do checkpoint passa a exigir o adapter Foundry, seus testes e este relatório de auditoria.

## Testes adicionados

Foram adicionados casos para:

- full UUID vs local ID em hierarchy;
- cycle via `save()` direto, sem usar `reparent()`;
- imutabilidade do UUID do documento;
- uso real do índice após o primeiro rebuild (`store.list()` não volta a ser chamado em queries comuns);
- nested malformed payload sem exception;
- safe integer, summary limit, duplicate aliases e kind vazio;
- canonicalização de aliases/tags/kind/scale/capabilities;
- remoção de alias igual ao `JournalEntry.name`;
- boundary de `game.journal` e `JournalEntry.create`;
- exclusão de JournalEntries comuns sem flag Domain.

## Resultado dos testes

- `npm run typecheck`: **PASS**
- suíte TypeScript executada por runner alternativo local: **68/68 PASS**
- `npm run validate:package`: **PASS**
- runtime package generation: **PASS**
- artifact validation: **PASS**
- full Gate 1 checkpoint validation: **PASS**
- `node --check dist/main.js`: **PASS**

### Nota de ambiente

O ZIP recebido não contém `node_modules`. Neste ambiente, `npm install` não conseguiu acessar o registry e o `npm run test:unit`/`npm run build` nativos dependem de `esbuild`. Para não fingir validação, a suíte foi executada por um runner de auditoria que transpila os mesmos `.ts` com o TypeScript global e executa os testes via `node --test`. O bundle `dist/main.js` não precisou ser alterado pelas correções do G1 e passou syntax/package validation.

## Estado final

- Blockers locais conhecidos: **0**
- Testes: **68/68 PASS**
- G1 local: **VALIDADO APÓS CORREÇÕES**
- Foundry real: **PENDENTE**
- G0 external smoke: **ainda pendente até evidência do usuário**
- Próximo Gate permitido formalmente: somente após registrar o smoke externo exigido pelo protocolo.
