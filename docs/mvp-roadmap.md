# Mesa Aberta — benchmark funcional e roadmap do MVP

## Referências de produto

O recorte considera os padrões consolidados em plataformas brasileiras de cardápio e gestão de pedidos, como Anota AI, soluções de menu digital e a experiência de consumo do iFood. O objetivo não é copiar todas as funções, mas selecionar o menor conjunto que torna o produto vendável e confiável.

| Padrão observado no mercado                 | Valor para o restaurante                                | Decisão do Mesa Aberta |
| ------------------------------------------- | ------------------------------------------------------- | ---------------------- |
| Cardápio visual, busca e categorias rápidas | O cliente encontra e entende o produto sem ajuda        | Incluído no MVP        |
| Foto e adicionais no carrinho               | Reduz erro antes do envio e aumenta o valor do pedido   | Incluído no MVP        |
| Acompanhamento automático por etapas        | Reduz perguntas à equipe e ansiedade do cliente         | Incluído no MVP        |
| Pedir novamente sem perder o acompanhamento | Permite novas rodadas na mesma mesa                     | Incluído no MVP        |
| Cozinha e caixa atualizados automaticamente | Evita atualização manual e pedidos atrasados            | Incluído no MVP        |
| QR permanente por mesa                      | Simplifica implantação no salão                         | Incluído no MVP        |
| Pausa de produto e operação                 | Impede venda de item indisponível                       | Incluído no MVP        |
| Automação de WhatsApp                       | Ajuda aquisição, suporte e recuperação de venda         | Fase 2                 |
| Pagamento do pedido pelo celular            | Reduz fila, mas exige conciliação e reembolso           | Fase 2                 |
| Cupons, fidelidade e CRM                    | Aumenta recorrência depois que a operação está estável  | Fase 3                 |
| Relatórios avançados e estoque              | Melhora gestão, mas não é necessário para validar venda | Fase 3                 |

## MVP vendável

1. Landing page, cadastro, assinatura e bloqueio por pagamento.
2. Configuração guiada da loja, produtos, adicionais, mesas e equipe.
3. Cardápio responsivo com busca, fotos, categorias e carrinho persistente.
4. Pedido idempotente por mesa ou balcão.
5. Resumo visual antes de enviar, com foto, quantidade, adicionais e observação.
6. Acompanhamento automático, itens do pedido e ação **Pedir mais itens**.
7. Filas de cozinha e caixa atualizadas automaticamente.
8. Registro de pagamento presencial, cancelamento, devolução e histórico.

## Próxima fase: pagamento do pedido pelo cliente

O pagamento da mensalidade da plataforma e o pagamento do pedido do restaurante são produtos financeiros diferentes. Antes de liberar pagamento no cardápio, definir:

- quem será o recebedor legal de cada venda;
- modelo de marketplace/split ou credenciais próprias de cada restaurante;
- taxas, prazo de recebimento e responsabilidade por chargeback;
- cancelamento parcial, reembolso e conciliação;
- baixa automática do pedido somente após webhook aprovado;
- política para pedido pago que a cozinha não consegue atender.

Uma implementação segura deve começar com Pix e cartão em ambiente de testes, ledger próprio de transações e idempotência, sem reutilizar a credencial que recebe a assinatura do Mesa Aberta.

## Métricas para validar o MVP

- restaurantes que concluem a configuração e publicam o cardápio;
- tempo do cadastro até o primeiro pedido;
- pedidos concluídos sem ajuda da equipe;
- abandono no carrinho;
- tempo entre pedido, aceite, preparo e entrega;
- número de segundos pedidos feitos pela mesma mesa;
- falhas de envio, pagamentos pendentes e cancelamentos.
