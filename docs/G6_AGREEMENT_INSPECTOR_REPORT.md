# G6 — detalhes dos acordos pela interface

Data: 2026-10-01 (UTC). Branch: `feat/g6-continuous`. Base: `79f69842aecd927761a604c6922c8ff23107dd9f`.
Escopo: uma parte de G6.4/G6.9 e Rodada 08 §5.3. Implementar, validar automaticamente, registrar e parar. Teste real no Foundry somente após concluir o bloco G6, conforme instrução do usuário.

## Comportamento implementado

- Obrigações com responsável/beneficiário, requisito, vencimento, tolerância inclusiva, estado registrado e estado consultado; alegação, confirmação e contestação separados. Consulta usa o tick da autoridade recebido no DTO.
- Termo original preservado por geração; obrigações históricas identificadas e separadas das aplicáveis aos termos atuais. Read model derivado, clonado e imutável, sem nova persistência. Soma exata de vencimento/tolerância representada como string decimal para evitar overflow de inteiro seguro.
- Evidências visíveis com referência, declaração, posição, visibilidade e timestamp autorizado. Histórico GM com motivo, antes/depois, tick e fontes; páginas existentes respeitadas.
- Emendas GM com origem, termos completos antes/depois e diff de termos, ordem e duração. Comparação calculada após filtro de visibilidade. Player mantém a fronteira existente: sem histórico administrativo de emendas/eventos ou conteúdo secreto.
- Consequências declaradas exibidas para consulta. Seleção precisa da obrigação prepara o formulário existente; GM usa owner/pipeline e Player envia proposta para aprovação. ID inexistente falha localmente, revisão acompanha o comando e falha mantém input.

Vencimento não confirma quebra nem encerra acordo. Evidência não confirma pagamento ou satisfação por si só. Visualizar consequências não as executa. Obrigações históricas preservam seus termos e prazos anteriores. Nenhum Scheduler, transporte ou armazenamento paralelo foi introduzido.

## Validação

- **956/956 testes PASS**, 0 FAIL, 0 skipped; 18 novos nesta parte (14 específicos + 4 verticais).
- **14/14 específicos** e **48/48 verticais** PASS.
- TypeScript/build/package/validate:release PASS localmente, Node 24.19.0. CI será registrada após execução.

Na preparação dos testes verticais, a leitura do adapter usou inicialmente uma chave de ID simples, mas o armazenamento utiliza chave composta kind/id. A fixture foi corrigida; as asserções de revisão e consequências permaneceram, e os 48 testes verticais passaram.

Os testes verticais usam owners reais com host/transporte simulados. Não houve teste real no Foundry nesta parte, nem publicação de release.

## Limites e próxima parte

G6 permanece parcial. Dashboard por estado, editor completo de vários termos, demais linhas da matriz e teste real Foundry continuam pendentes. O formulário básico de termos ainda produz um snapshot de um termo; os detalhes exibem todos os termos recebidos pela API.

**Próximo passo:** editor completo dos termos dos acordos, permitindo vários termos sem perder os existentes. Parar após esta parte e aguardar autorização. Foundry real ao fim do bloco G6; G7 não iniciado.
