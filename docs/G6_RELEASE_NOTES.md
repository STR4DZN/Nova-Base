# Domain Manager v0.0.7 — candidata G6

Instalação no Foundry VTT v13.351 pelo Manifest URL:

https://github.com/STR4DZN/Nova-Base/releases/download/v0.0.7/module.json

Requer socketlib 1.1.3+ (verificado com 1.1.4). Esta candidata inclui os commits G6 de relações, reputação, tratados e territórios, integração de autoridade, persistência, recuperação, propostas e interface inicial. Corrige unicidade de relações, herança de direitos de tratados, acesso territorial restrito e projeção pública.

Os testes automatizados do código auditado passaram (859/859); a publicação reconstrói e valida o pacote e suas URLs no GitHub Actions. Esta release é uma candidata para testes e não representa fechamento de 100% do plano G6. As pendências estão em `G6_FULL_SPEC_AUDIT.md`; a validação real no Foundry, incluindo Player, F5, troca de GM e sigilo do payload do servidor, permanece necessária. G7 não foi iniciado.

O arquivo `g6-foundry-smoke.js` e o roteiro `G6_FOUNDRY_SMOKE_GUIDE.md` estão nos assets desta release e em `scripts/` e `docs/` do repositório. Execute o script inteiro no console do navegador em um mundo de testes e siga as fases GM/Player descritas no roteiro.
