# G5 — correção aplicada ao blocker People/Workforce do smoke

Data: 2026-09-29. Base: `126061cf53f043d77b7997b40888fe9fe0898756`, Nova-Base v0.0.6.

## Erro e causa

Project Start com workforce 5 falhava com `DM_PROJECT_START_BLOCKED` / `this[#domainRepository].update is not a function`.
O runtime injetava em Projects o mesmo PeopleService público construído com `readOnlyDomains`.
PeopleService criava PeopleRepository mutável usando `domains as any`, ocultando a incompatibilidade do TypeScript.
Simplesmente entregar o repositório mutável à API pública permitiria mutações diretas por allocate/release/restore.

## Solução aplicada

- Extraídas as consultas existentes para PeopleReadRepository, tipado com DomainReadRepository.
- PeopleRepository mantém as mutações existentes, estende o repositório de leitura e exige DomainRepositoryContract.
- PeopleService usa exclusivamente PeopleReadRepository, sem o cast `domains as any`.
- Removidos allocateWorkforceReservation, releaseWorkforceReservation e restoreWorkforceReservation da classe pública e de PublicPeopleApi. Os métodos fisicamente não existem em module.api.people.
- Criados WorkforceReservationPort e WorkforceReservationService internos. O port contém as três mutações e uma consulta de reservas sem projeção para captura dos snapshots de recovery.
- O runtime entrega mutableDomainRepo apenas ao serviço interno e o injeta em Projects. Start, Cancel, Completion e seus compensadores recebem o port interno; o serviço não é exposto no runtime público.
- Preservados os IDs antecipados, operationRef, protocolo CompositeMutationSession, CommandBus, autoridade, locks, fences e dados persistidos existentes.
- Migradas as fixtures de hardening/adversarial para o port interno. Não foram alterados os asserts ou resultados esperados dessas suítes.
- Bundle, source map e ZIP v0.0.6 recompilados. O hotfix mantém a versão para preservar o contrato do smoke existente; nenhum novo release remoto foi publicado.

## Testes executados e evidência

`tests/runtime/g5-workforce-composition.test.ts` compõe o runtime de produção, substituindo somente as fronteiras de host/persistência Foundry.

| Teste novo | Resultado |
|---|---|
| People público sem os três mutators; leitura sem update e sem writes | PASS |
| Survey Project A, workforce general 30, reserva 5 pelo public API → CommandBus; cancel libera | PASS |
| Start, advance e complete liberam workforce | PASS |
| Restart real de instâncias: executing intent com reserva aplicada e sem receipt; scan/fence/recoverAll libera uma vez | PASS |
| Restart de cancel parcial: recoverAll restaura reserva sem duplicar; retry não escreve | PASS |
| Restart de completion parcial: recoverAll restaura reserva sem duplicar; retry não escreve | PASS |
| TypeScript rejeita read-only no serviço/repositório mutável e rejeita API pública no port interno | PASS |

Antes de validar a correção, os seis testes funcionais foram executados com os arquivos src originais do HEAD base: **0/6 PASS**, reproduzindo o erro exato `update is not a function`. Os arquivos corrigidos foram restaurados e os mesmos seis testes passaram. O sétimo teste valida os contratos via tsc com `@ts-expect-error`, incluindo detecção de regressão da tipagem.

Validação final executada neste ambiente:

- `npm test`: **686/686 PASS**, 0 fail, 0 skip.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm run validate:package`: PASS.
- `npm run package`: PASS.
- `npm run validate:artifact`: PASS; ZIP contém os mesmos bytes de manifest/bundle/source map locais.
- `git diff --check`: PASS nos arquivos alterados.

## Resultado e próximo passo

O blocker está corrigido no código e reproduzido/validado em integração local. Não houve execução no Foundry do usuário nesta tarefa.
O G5 continua pendente do smoke real e G6 permanece bloqueado.

Instalar o ZIP corrigido substituindo os arquivos do módulo existente. Com o mundo carregado e a função do smoke disponível, executar `await DM_G5_SMOKE_CLEANUP()` para remover a fixture abortada. Se a função não estiver presente depois do reload, carregar novamente o runner para registrá-la. Dar F5 e executar o smoke completo desde o início, seguido da fase pós-F5 e da fase Player. Não continuar a partir do Project A abortado e não homologar o Gate apenas com os testes locais.
