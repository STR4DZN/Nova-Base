# Smoke G5 v2 — Foundry v13.351 / Domain Manager v0.0.6

Use o arquivo `foundry-v13-g5-full-smoke-test.js` deste pacote, substituindo o
runner anterior. Cole o arquivo inteiro no console ou em uma macro Script.
Mantenha Socketlib ativo. Execute em um mundo de teste: o runner cria dois
Domains descartáveis e uma fixture controlada de crash no journal transacional.
Durante as fases de crash, nenhum cliente deve executar outras mutações do módulo
até o F5 indicado. Não cria um segundo runtime ou registro Socketlib.

1. Execute como GM. Deve criar fixtures, testar Projects/Facilities/Economy/
   Downtime/UI, salvar o crash de workforce e pedir F5.
2. Dê F5 de verdade e execute novamente como GM. Deve verificar isolamento do
   Domain afetado, permitir outro Domain e pedir um segundo F5.
3. Dê F5 e execute novamente como GM. Deve recuperar a reserva, conferir
   persistência e liberar novas mutações.
4. Com um Player conectado e o GM online, execute novamente como GM para
   atribuir o Player como Controller/OBSERVER. Execute o mesmo arquivo como esse
   Player para conferir comandos remotos e negações de acesso.
5. Guarde o resultado de cada fase: `DM_G5_SMOKE_REPORT` e o console mostram os
   PASS/FAIL/SKIP da execução atual. Todas as fases devem ter FAIL=0. Ausência de
   Player e failover físico de segundo GM são SKIP, nunca PASS simulado.

Para remover as fixtures, execute no GM `await DM_G5_SMOKE_CLEANUP()` após a
recovery e dê F5. O cleanup cancela operações ativas próprias, remove apenas os
Domains marcados pelo runner e preserva os journals globais de auditoria.
Não remove fixture com transação pendente. Uma primeira fase interrompida antes
da criação do crash pode ser limpa e recomeçada.

O ZIP `domain-manager-v0.0.6.zip` é o módulo instalável. Este ZIP de smoke contém
somente o runner, estas instruções e o relatório; não é instalado no Foundry.

## Validação feita no repositório

- 693 testes passaram, sem falhas ou skips; TypeScript passou.
- O próprio runner foi executado contra a composição de produção, com doubles
  somente nas fronteiras Foundry/DOM/transporte. As duas recriações de runtime
  verificaram fence, persistência e recovery de um child `executing` sem receipt.
- Build, manifesto, conteúdo exato do ZIP e sintaxe do runner foram validados.
- Isso não substitui execução real no Foundry. DOM ApplicationV2, Socketlib
  entre clientes reais e failover físico dependem do smoke no mundo de teste.
