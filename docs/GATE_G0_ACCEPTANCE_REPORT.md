# GATE G0 — ACCEPTANCE REPORT

## Resultado

`READY_FOR_EXTERNAL_SMOKE`

Não há blocker de código conhecido após a auditoria local. A aceitação formal
do Gate 0 permanece pendente do clean-install/boot em Foundry VTT v13.351+.

## Escopo validado

- bootstrap e hooks `init`/`ready`;
- manifesto e entry point JavaScript;
- typecheck e build;
- Result/PublicError/Warning;
- IDs, refs e namespaces;
- registries;
- logging e diagnostics sanitizados;
- repositories e fixtures;
- test harness;
- package e ZIP determinístico.

## Evidência local

```text
npm run typecheck         PASSOU
npm run test:unit         PASSOU — 22/22
npm run build             PASSOU
npm run validate:package  PASSOU
npm run package           PASSOU
npm run validate:artifact PASSOU
node --check dist/main.js PASSOU
ZIP reproducibility       PASSOU — duas gerações com SHA-256 idêntico
```

## Artefato validado

`dist/domain-manager-v0.0.1.zip`

Entradas exatas:

```text
module.json
dist/main.js
dist/main.js.map
```

O validator verifica nomes, tamanhos, CRC, manifesto e entry point.

## Smoke externo obrigatório

- [ ] Instalação limpa em Foundry VTT v13.351+.
- [ ] Ativação do módulo.
- [ ] Hook `init` executado.
- [ ] Hook `ready` executado.
- [ ] Console sem erro crítico.
- [ ] Evidência registrada.

## Decisão

O Gate 0 não está formalmente aceito ainda. O próximo passo exato é executar o
smoke externo; G1 não deve começar antes dessa evidência.
