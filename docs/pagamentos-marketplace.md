# Pagamentos no restaurante: arquitetura recomendada

## Decisão para o MVP

Cada restaurante conecta a própria conta Mercado Pago à plataforma. O cliente paga na conta da mesa ou no totem e o dinheiro é liquidado diretamente para o restaurante. A Mesa Aberta nunca recebe o valor bruto para depois fazer um repasse manual.

No início, a assinatura mensal deve continuar. Uma tarifa automática por transação pode ser adicionada depois que volume, custo de suporte, estornos e margem estiverem medidos. Isso evita trocar uma receita previsível por uma hipótese ainda não validada.

## Por que usar conta conectada

- O restaurante continua sendo o vendedor e recebedor da operação.
- KYC, saldo e liquidação ficam no provedor de pagamento.
- A plataforma reduz exposição fiscal, contábil, regulatória e a chargebacks.
- Uma tarifa da plataforma pode ser dividida automaticamente pelo recurso oficial de marketplace.
- Não é necessário guardar dados de cartão.

Não deve ser usado o token da assinatura da Mesa Aberta para cobrar os consumidores dos restaurantes. São fluxos e recebedores diferentes.

## Jornada prevista

1. O dono abre **Configurações > Pagamentos** e clica em **Conectar Mercado Pago**.
2. Ele entra na própria conta, conclui a validação exigida e autoriza a plataforma por OAuth.
3. A plataforma guarda os tokens de forma cifrada e mostra a conta como conectada.
4. Na mesa, pedidos sucessivos entram em uma única conta de atendimento.
5. Ao pagar, o servidor congela quais pedidos e qual valor fazem parte daquela tentativa.
6. O cliente segue para o checkout hospedado do Mercado Pago, com Pix ou cartão.
7. Um webhook informa a mudança. O servidor consulta o pagamento diretamente na API antes de dar baixa.
8. Apenas os pedidos congelados naquela tentativa são marcados como pagos. Eventos repetidos não geram baixa duplicada.

No totem, cada conclusão deve criar um atendimento isolado. Uma compra nunca pode enxergar ou pagar a compra anterior.

## Controles obrigatórios

- Checkout hospedado (Checkout Pro) no MVP, reduzindo o escopo PCI.
- OAuth com `state` aleatório, uso único, validade curta e associação ao restaurante autenticado.
- Tokens cifrados em repouso com AES-256-GCM e chave fora do banco.
- Webhook tratado como aviso, não como prova: sempre buscar o pagamento na API e validar recebedor, moeda, valor e referência.
- Idempotência na criação da cobrança e no processamento do webhook.
- Total calculado no servidor; o navegador nunca determina o valor cobrado.
- Registro imutável do valor, pedidos, provedor, identificador externo, estado e horários.
- Botão de pagamento bloqueado durante uma tentativa em andamento e retomada segura após falha de rede.
- Estorno e disputa tratados como estados próprios, com trilha de auditoria.
- Segredos somente em variáveis de ambiente; nunca no Git, HTML, logs ou suporte por mensagem.

## Configuração que será necessária

No painel de desenvolvedores do Mercado Pago, criar uma aplicação de marketplace/OAuth e cadastrar a URL de retorno de produção:

`https://pedidosres.site/pagamentos/mercado-pago/retorno`

Depois serão configuradas na Hostinger, sem compartilhar os valores:

```text
MP_MARKETPLACE_CLIENT_ID=...
MP_MARKETPLACE_CLIENT_SECRET=...
PAYMENT_TOKEN_ENCRYPTION_KEY=...
MARKETPLACE_FEE_PERCENT=0
```

A URL pública já existente (`PUBLIC_URL`) será usada para montar retorno e webhook. Credenciais de teste devem ser usadas até a homologação completa; produção só será ativada depois de testar pagamento aprovado, recusado, expirado, duplicado, estornado e webhook fora de ordem.

## Etapas de implementação

1. Conta unificada da mesa e isolamento do totem.
2. Cadastro da aplicação marketplace e conexão OAuth do restaurante. **Implementado.**
3. Cofre cifrado de credenciais e tela de estado da conexão. **Implementado.**
4. Intenção de pagamento com snapshot dos pedidos e checkout hospedado. **Implementado.**
5. Webhook verificado e baixa automática. **Implementado; requer homologação real.**
6. Estornos, conciliação, relatórios e tarifa automática da plataforma.

O pagamento presencial atual continua disponível durante a implantação. O botão online só é liberado para restaurantes conectados e homologados.
