# Domain Manager v0.0.8 — candidata G6 corrigida

Instalação no Foundry VTT v13.351:

https://github.com/STR4DZN/Nova-Base/releases/download/v0.0.8/module.json

Corrige 13 defeitos confirmados em G0/G2/G3/G4/G5/G6: autorização de replay/status, fila cancelada, cache de pendências, fingerprints, população/workforce, capacidade econômica, custos progressivos, dedupe durável, índice territorial, sigilo de claims e recibos fabricados. Adiciona tickets G6 para retry do mesmo comando e consulta de status.

878/878 testes locais passaram; TypeScript, build e pacote validados. O GitHub Actions reconstrói e valida antes de publicar. A candidata requer novo smoke Foundry; o PASS informado pelo usuário para v0.0.7 não é transferido automaticamente para esta build.

Use `g6-foundry-smoke.js` v2 e `G6_FOUNDRY_SMOKE_GUIDE.md`, começando nova fixture GM/Player/F5/failover. Os scripts G2 e G5 também estão nos assets. `G0_G6_REVIEW.md` registra causas, correções, testes e limites. `G6_FULL_SPEC_AUDIT.md` conserva as lacunas do plano: G6 ainda não é 100% nem GATE_ACCEPTED. G7 não foi iniciado.
