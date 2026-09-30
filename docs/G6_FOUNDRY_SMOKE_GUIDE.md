# G6 — roteiro Foundry v13

Use `scripts/g6-foundry-smoke.js` inteiro no console do navegador (F12 → Console), em um **mundo de testes**, com a build candidata G6 e socketlib ativos. Instale a candidata v0.0.7 pelo manifest `https://github.com/STR4DZN/Nova-Base/releases/download/v0.0.7/module.json`; confira se `game.modules.get("domain-manager").api.diplomacy` existe.

O roteiro cria um Domain novo, dois tratados, relações, reputação, dois territórios, uma disputa e duas propostas. Todas as mutações de negócio usam a API pública. A fixture de queda usa o intent econômico real de um dos tratados criados pelo roteiro, modifica somente o seu before-image e a sua transação de teste. Os demais registros do mundo são preservados. A janela de injeção exige parar outras ações do módulo até F5.

## Execução

1. Conecte um **GM** e um **Player**. Execute o arquivo no **Primary GM**. A fase deve ficar `await-player`, sem FAIL. O primeiro Player conectado será configurado como controlador do Domain de teste.
2. Execute o mesmo arquivo no **Player escolhido**. Ele testa sigilo, permissões, reputação pública, interface e cria duas propostas; nenhum incidente é confirmado por ele.
3. Execute novamente no **Primary GM**. Ele aprova uma proposta editando +5 para +2, rejeita a outra e prepara a queda controlada. A fase deve ficar `await-reload`. **Pare as ações do módulo.**
4. Dê **F5 real no Primary GM**, aguarde o módulo carregar e execute novamente. A transação deve recuperar o tratado sem pagar duas vezes; o saldo de teste permanece **14**. A fase passa para `await-failover`. Executar na mesma página é FAIL, pois não prova recarga.
5. Conecte um **segundo GM** e escolha-o como Primary GM preferido nas configurações do módulo. Aguarde a mudança de autoridade e execute o arquivo **no novo Primary GM**. O script exige outro ID e uma epoch maior, confere estado persistido e confirma uma nova mutação. A fase passa para `completed`.
6. Dê F5 no **Player**, execute o arquivo novamente e confira os resultados após aprovação e failover.
7. Em cada navegador que executou testes, use `DM_G6_SMOKE.download()` para baixar os relatórios JSON acumulados. Envie os relatórios dos GMs e do Player para revisão.

Não é necessário editar IDs no script nem trocar de arquivo entre fases. O progresso fica no Journal `[DM G6 SMOKE] …`; os relatórios ficam no navegador de cada usuário. Se a fixture não aparecer no Player, confira que ele é o controlador escolhido e possui acesso de Observer ao Journal de teste.

## Resultados e limites

- `PASS`: a verificação descrita passou nesta execução.
- `FAIL`: não avance a homologação; o relatório registra o erro. Setup ou injeção parcial ficam interrompidos para diagnóstico, sem apagar fixtures.
- `PENDING`: depende de outro usuário, F5 ou troca de autoridade. Nenhuma dessas etapas é contabilizada como PASS antecipadamente.
- `completed`: as fases GM chegaram ao final; exige também relatórios Player sem FAIL e revisão de todas as fases. Não significa homologação automática.

A detecção de flags canônicas no Player é bloqueante, mesmo que a API filtre os detalhes. O roteiro não mascara esse resultado nem presume que ownership NONE implica sigilo no payload do servidor.

O teste local executa este mesmo arquivo contra os owners reais, com navegador/Documentos/sockets simulados. Ele verifica as chamadas, fases, efeitos e recuperação; não substitui a execução no servidor Foundry. A interface é testada por abertura, DOM das seis abas, carregamento do inspetor e fechamento; interação visual detalhada e os recursos de cada formulário continuam sujeitos à revisão no Foundry.

Este roteiro cobre os fluxos centrais G6. Não promete exaurir todas as combinações de emendas, obrigações, decadência, integrações externas ou falhas de disco. Integrações sem owner real continuam bloqueadas; condições sem resolver não concedem direitos. G7 não faz parte deste teste.

Os registros criados permanecem disponíveis para diagnóstico. Para descartá-los, use um mundo de testes descartável; o roteiro não apaga o histórico de transações do módulo.

## Auditoria de cobertura do plano

Consulte `docs/G6_FULL_SPEC_AUDIT.md` antes de interpretar o resultado como fechamento: a implementação ainda não cobre 100% do plano. O candidato auditado corrige unicidade, herança de rights de tratados, acesso territorial restrito e sanitização de refs/influência. O roteiro cobre fluxos centrais; funcionalidades ausentes não viram PASS.
