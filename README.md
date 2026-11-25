# Mesa Aberta

Sistema de autoatendimento em português para operar várias lojas na mesma instalação. O cliente pede pelo QR da mesa ou pelo tablet do balcão. O restaurante acompanha preparo, entrega e pagamentos presenciais. Uma publicação atualiza a aplicação de todas as lojas.

Usamos **Node.js 24 LTS** (desenvolvimento em **24.22.3**), Express 5, EJS e MySQL 8.4 com InnoDB. O mesmo processo Node serve páginas, formulários, JavaScript e imagens. O navegador precisa de JavaScript para montar o carrinho. O Windows precisa apenas do Node, do Git e do MySQL Server com o cliente de linha de comando.

## A. Primeira instalação no Windows

**PowerShell.** Confira as ferramentas em qualquer pasta. Se um comando estiver ausente, instale o Node 24 LTS com npm, Git para Windows e MySQL Community Server 8.4. Inclua a pasta `bin` do MySQL no PATH e abra outro PowerShell.

```powershell
node --version
npm --version
git --version
mysql --version
```

Baixe a versão que contém este projeto. Se recebeu o ZIP, extraia-o e entre na pasta que contém `package.json`. Para usar o GitHub depois de enviar ou integrar esta versão ao repositório, execute:

```powershell
git clone https://github.com/iagotqueiroz/autoatendimento-restaurantes.git
cd autoatendimento-restaurantes
```

**PowerShell, na pasta do projeto.** Instale as versões do lockfile. O segundo comando abre o cliente MySQL e pede a senha administrativa definida durante a instalação.

```powershell
npm ci
mysql -u root -p
```

**Cliente MySQL, no prompt `mysql>`.** Execute na primeira instalação:

```sql
SOURCE scripts/bancos-locais.sql
exit
```

O arquivo SQL cria `mesa_aberta` e `mesa_test`, cria o usuário local `mesa_app` e concede acesso a esses bancos. O MySQL mostra a senha gerada na coluna _generated password_. Guarde-a. Quem já criou esse usuário deve usar a senha existente. Você também pode executar o conteúdo do arquivo no MySQL Workbench.

**PowerShell, na pasta do projeto.** Crie a configuração local e gere um segredo aleatório de sessão.

```powershell
Copy-Item .env.example .env
node -e "const fs=require('node:fs');const p='.env';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/^SESSION_SECRET=$/m,'SESSION_SECRET='+require('node:crypto').randomBytes(48).toString('hex')))"
notepad .env
```

Preencha `DB_PASSWORD` com a senha do usuário do banco e salve. Para uma senha contendo `#`, envolva o valor em aspas. Preserve esse arquivo nas próximas atualizações.

| Variável                        | Valor local e finalidade                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| NODE_ENV                        | `development` em desenvolvimento e `production` na hospedagem                                   |
| PORT                            | `3000` localmente. A hospedagem fornece a porta do processo                                     |
| PUBLIC_URL                      | `http://localhost:3000` para usar no próprio PC. É a origem absoluta usada ao gerar os QR Codes |
| DB_HOST / DB_PORT               | `127.0.0.1` e `3306` por padrão                                                                 |
| DB_NAME / DB_USER / DB_PASSWORD | `mesa_aberta`, `mesa_app` e a senha correspondente                                              |
| SESSION_SECRET                  | Segredo de pelo menos 32 caracteres. Gere um próprio para produção e preserve-o entre versões   |
| TRUST_PROXY                     | Número de proxies confiáveis até o processo. Use `0` no PC                                      |
| MIGRATE_ON_START                | `false` para rodar migrações manualmente. `true` aplica as pendentes antes de aceitar tráfego   |

**PowerShell, na pasta do projeto.**

```powershell
npm run migrate
npm run admin
npm run demo
npm start
```

A migração termina com **Banco atualizado**. O comando `admin` pede o e-mail do administrador da plataforma e uma nova senha, ocultando a digitação. O comando **opcional** `demo` pede uma senha escolhida por você e cria duas lojas fictícias apenas em desenvolvimento. O servidor informa **Mesa Aberta na porta 3000**. Deixe o terminal aberto. Use Ctrl+C para encerrar.

### Endereços e contas

| Uso                     | Endereço no computador                          | Acesso                                            |
| ----------------------- | ----------------------------------------------- | ------------------------------------------------- |
| Cadastro do restaurante | http://localhost:3000/cadastro                  | Cria dono e loja com piloto de 14 dias            |
| Login                   | http://localhost:3000/login                     | Encaminha ao painel do perfil                     |
| Plataforma              | http://localhost:3000/painel/plataforma         | Credenciais do comando `admin`                    |
| Dono                    | http://localhost:3000/painel/loja               | Conta cadastrada ou `dono@casa-do-almoco.example` |
| Cozinha                 | http://localhost:3000/painel/cozinha            | Dono ou `cozinha@casa-do-almoco.example`          |
| Caixa                   | http://localhost:3000/painel/caixa              | Dono ou `caixa@casa-do-almoco.example`            |
| Tablet de demonstração  | http://localhost:3000/l/casa-do-almoco          | Público                                           |
| Cliente na mesa         | Link **Abrir mesa** ou QR em **Mesas e balcão** | Público, identifica a mesa pelo código estável    |

As três contas da demonstração usam a senha definida em `demo`. Para a segunda loja, substitua `casa-do-almoco` por `chapa-do-bairro`. Use perfis de navegador diferentes para simular funcionários simultâneos. Configure o tablet compartilhado em um perfil de navegador exclusivo, sem login de funcionário.

### Ler o QR com o celular na mesma rede

1. No PowerShell, rode `ipconfig` e localize o IPv4 do adaptador Wi-Fi do computador, por exemplo `192.168.1.42`.
2. No arquivo `.env`, defina `PUBLIC_URL=http://192.168.1.42:3000` usando o seu IP. Reinicie o Node. Permita conexões à porta 3000 pelo Firewall do Windows **na rede privada**.
3. No celular conectado ao mesmo Wi-Fi, abra o endereço acima. O servidor já escuta nas interfaces de rede. Redes de convidados podem isolar dispositivos.
4. Baixe o QR da mesa depois de configurar o endereço. A câmera deve abrir o nome da loja e a mesa correta. `localhost` no celular aponta para o próprio celular. Para placas definitivas, gere o QR com o domínio HTTPS definitivo. Renomear a mesa ou trocar produtos conserva o código.

## B. Publicar na Hostinger

A documentação oficial de implantação da Hostinger lista aplicações Node nos planos Business e Cloud e descreve o vínculo de repositórios pelo hPanel. A especificação oficial inclui Express e Node 24 nas configurações aceitas. Consultei essas fontes em 25/11/2026. O acesso à sua conta e as opções habilitadas no seu contrato precisam ser conferidos no seu painel. [Guia oficial de implantação](https://github.com/hostinger/claude-plugin/blob/main/skills/deploy-to-hosting/SKILL.md) · [Especificação da Hostinger](https://github.com/hostinger/api/blob/HEAD/openapi.mcp.json)

1. No hPanel, abra **Sites** e o gerenciamento do seu plano Business. Procure a opção de adicionar uma aplicação web Node.js. Se estiver ausente, informe o identificador do plano ao suporte e pergunte se esse contrato permite um processo Express 24 com MySQL, domínio próprio e deploy Git. Confirme a habilitação antes de contratar outro serviço.
2. Adicione o site para o subdomínio, por exemplo `pedidos.meudominio.com.br`. No provedor de DNS do domínio, configure o registro indicado para esse site no hPanel. Espere o apontamento e a emissão do certificado SSL; abra o domínio com HTTPS.
3. Na área de bancos MySQL do site, crie **um banco de produção e seu usuário**. Anote host, porta, nome completo, usuário com prefixo e senha. Conceda ao usuário acesso ao banco da aplicação, incluindo criação e alteração de tabelas para migrações.
4. Envie esta versão ao GitHub. Conecte a conta na área de Git do site (**Websites → Manage → Advanced → Git**, conforme o guia oficial; o idioma e os rótulos podem variar). Autorize o repositório específico e selecione a branch que contém `server.js` e `package-lock.json`. Configure o destino como **aplicação Node.js**.
5. Preencha as configurações da aplicação conforme a tabela abaixo. Nas variáveis do ambiente de execução, informe os valores do banco real, `NODE_ENV=production`, `PUBLIC_URL=https://pedidos.meudominio.com.br`, um novo `SESSION_SECRET` e `MIGRATE_ON_START=true`. Deixe a plataforma fornecer `PORT`. O arquivo `.env` local fica fora do Git.
6. Confirme com a hospedagem o número de proxies confiáveis e o envio de `X-Forwarded-Proto: https`. Para **um proxy confiável** entre o cliente e o Node, use `TRUST_PROXY=1`. A aplicação usa cookie Secure em produção, HttpOnly e SameSite=Lax. Reinicie a implantação após alterar variáveis.
7. Publique e confira os logs de build e de inicialização. As migrações registram cada versão aplicada em `migrations`. A inicialização valida acesso às sessões e à tabela de lojas.
8. Crie o primeiro administrador pela linha de comando protegida, conforme abaixo. Entre pelo domínio HTTPS, cadastre uma loja, publique um produto e baixe o QR usando o domínio público.

| Campo de implantação       | Valor                                                       |
| -------------------------- | ----------------------------------------------------------- |
| Framework e versão         | Express, Node.js 24.x                                       |
| Diretório raiz             | `.` (pasta do package.json)                                 |
| Gerenciador / instalação   | npm / `npm ci --omit=dev` quando o comando for configurável |
| Build / diretório de saída | Sem compilação e sem pasta de saída                         |
| Arquivo de entrada         | `server.js`                                                 |
| Inicialização              | `npm start`, que executa `node server.js`                   |
| Porta                      | `process.env.PORT`                                          |

**Terminal do servidor**, quando seu plano disponibilizar Node e as variáveis da aplicação nesse terminal. Entre no diretório da implantação que contém `package.json`. Para migração manual e administração:

```sh
npm run migrate
npm run admin
```

Se o terminal do plano não oferecer Node, `MIGRATE_ON_START=true` já executa as migrações. **No PowerShell do seu PC**, na pasta configurada do projeto, rode `npm run admin:sql`. Informe e-mail e senha em prompt privado. Copie a instrução INSERT gerada e execute-a na aba SQL do phpMyAdmin **do banco de produção já migrado**. Ela contém o hash da senha. Mantenha-a privada e descarte a cópia depois. O cadastro público sempre cria um dono.

**Validação externa com dois aparelhos.** No computador, entre como dono e abra caixa e cozinha em abas separadas. No celular em dados móveis, leia o QR, confira domínio, mesa e HTTPS, faça um pedido antecipado e anote o número. Confirme o pagamento no caixa, observe a chegada na cozinha, aceite, prepare e marque pronto. Faça a entrega no caixa e atualize o acompanhamento no celular. Recarregue a página do dono para conferir a sessão. Teste também som na cozinha e leitura da placa impressa à distância de uso.

## C. Operar o primeiro turno

1. **Abrir a loja.** O cadastro cria um piloto com vencimento. Em **Minha loja**, crie uma categoria e sua ordem. Em **Produtos**, informe nome, descrição, foto e preço. A promoção opcional passa a ser o preço base. Use **Pausar** para um item esgotado.
2. **Configurar opções.** No produto, clique em **Adicionar grupo**. Para uma bebida obrigatória, escreva **Bebida**, use mínimo 1 e máximo 1, e cadastre **Água** por R$ 0,00 e **Suco** por R$ 3,00. Para até dois adicionais, crie outro grupo com mínimo 0 e máximo 2. Cada opção pertence ao seu produto.
3. **Publicar.** Confira a prévia. Em **Configurações**, ajuste nome, logo, endereço curto, horários diários, fuso e canais. Horários iguais abrem 24 h; um fechamento anterior à abertura atravessa a meia-noite. Habilite recebimento e publicação. Escolha pagamento antecipado ou posterior em cada canal.
4. **Preparar os pontos de atendimento.** Crie a Mesa 1, baixe o PNG, imprima sem cortar a margem branca e teste a leitura. Em **Equipe**, crie os acessos de caixa e cozinha. Abra o link do balcão no tablet e deixe o painel da cozinha aberto no dispositivo da equipe. Toque em **Ativar som**. A fila consulta o servidor a cada cinco segundos, informa a última atualização e tenta novamente após uma queda.
5. **Pagar antes.** Envie um pedido pelo canal configurado para antecipado. O cliente recebe o número. Após receber o dinheiro, Pix presencial ou cartão na maquininha, localize o pedido no caixa e confirme a baixa. A fila da cozinha passa a oferecer **Aceitar pedido → Iniciar preparo → Marcar pronto**. O caixa confirma a entrega.
6. **Pagar depois.** Faça outro pedido pelo segundo canal. Ele chega à fila de aceite com pagamento pendente. A entrega e a baixa são ações independentes. Busque a mesa no caixa para ver os pedidos individuais, valores e situação de cada um.
7. **Cancelar e devolver.** Antes da entrega, cancele pelo caixa e informe o motivo. Se já foi pago, a situação passa a **a devolver**. Faça a devolução presencial e só então registre a confirmação. O histórico mostra atendente, horário e motivo.
8. **Encerrar.** Pause o recebimento, conclua os pedidos aceitos e filtre **pendente** e **a devolver** no caixa. No painel da plataforma, renove manualmente com situação **ativa** e novo vencimento. A suspensão impede novos pedidos e conserva as operações sobre pedidos existentes.

O carrinho fica no navegador por loja e canal. Se o envio perder a resposta, use **Consultar ou repetir envio**. O servidor reconhece a tentativa já registrada. Se um item ou preço mudar, recarregue, edite ou remova o item e confirme novamente. No celular, guarde o link privado de acompanhamento. No balcão, a confirmação exibe o número e volta ao início por botão ou após 20 segundos.

## D. Testar, atualizar e manter

### Executar a suíte no Windows

**PowerShell, na pasta do projeto.** Com o MySQL em execução e o banco de teste criado, faça a preparação abaixo uma vez. A substituição parte do nome local padrão:

```powershell
Copy-Item .env .env.test
node -e "const f=require('node:fs');const p='.env.test';f.writeFileSync(p,f.readFileSync(p,'utf8').replace(/^DB_NAME=mesa_aberta/m,'DB_NAME=mesa_test'))"
npx playwright install chromium
npm test
```

O teste exige um banco exclusivo com nome terminado em `_test`. Sobe seu próprio servidor na porta 3319, usa lojas de teste com nomes únicos e encerra o processo no fim. Os registros ficam nesse banco para inspeção. Se necessário, defina `TEST_PORT` ou `CHROMIUM_PATH` com o caminho do Chromium instalado. A aplicação em desenvolvimento pode continuar na porta 3000.

**Validação realizada.** 13 testes passaram na suíte de integração com MySQL Community Server 8.4.13 e Chromium. Os cenários cobrem cadastro e publicação com foto, decodificação do QR, isolamento, CSRF, preços e limites, mesa e modalidade do tablet, filas de pagamento, concorrência de caixas, reenvio concorrente, pausa e suspensão, etapas, devolução, perfis, recuperação após perda da resposta, limpeza do tablet e persistência de sessão, imagens e histórico após migração repetida e reinício. Um backup de teste foi restaurado em outro banco, com a mesma contagem de pedidos, imagens e bytes de imagem. O teste de atualização simula uma nova execução sobre o banco existente. O aceite no hPanel, o Wi-Fi do estabelecimento, câmera, impressão, som e maquininha exigem o ambiente do restaurante.

### Enviar uma versão nova

**PowerShell, na pasta do repositório.** Desenvolva com `npm run dev`, rode `npm test` e confira `git status`. Inclua apenas os arquivos que pretende publicar. Exemplo para uma branch de trabalho:

```powershell
git switch -c melhoria-cardapio
git add -p
git status
git commit -m "Atualiza o cardápio"
git push -u origin melhoria-cardapio
```

Para arquivos novos, use `git add caminho/do/arquivo` antes do commit. Na primeira publicação, inclua também o lockfile, as migrações e os arquivos de interface. Revise e integre a branch no GitHub. Faça backup antes de publicar. Implante a revisão integrada pelo hPanel e confira os logs, uma loja existente, a foto de um produto e o histórico de um pedido. Anote o commit implantado. Mantenha as migrações aplicadas no histórico e acrescente um novo arquivo numerado para futuras mudanças. O executor separa comandos SQL por ponto e vírgula no fim da linha; use instruções simples e reexecutáveis.

### Backup e restauração

Fotos e logos são decodificados com Sharp, limitados a 5 MB/20 megapixels, reduzidos para até 900 × 900 e gravados como WebP na tabela `images`. Cada imagem tem um identificador próprio com cache HTTP. O banco preserva o conjunto completo em uma atualização do código.

**Terminal com cliente MySQL**, na pasta onde deseja gravar o backup. Exemplo local; na hospedagem use os dados reais ou a exportação do phpMyAdmin com estrutura, dados e BLOBs em hexadecimal. Proteja o arquivo, pois ele contém registros e sessões.

```sh
mysqldump --set-gtid-purged=OFF -h 127.0.0.1 -u mesa_app -p --single-transaction --no-tablespaces --hex-blob --result-file=mesa-backup.sql mesa_aberta
```

**Cliente MySQL**, conectado como administrador em uma instância de restauração, aberto na pasta do arquivo. Use um banco novo e vazio:

```sql
CREATE DATABASE mesa_restauracao CHARACTER SET utf8mb4;
USE mesa_restauracao;
SOURCE mesa-backup.sql
SELECT COUNT(*) FROM orders;
SELECT COUNT(*), SUM(OCTET_LENGTH(data)) FROM images;
SELECT name FROM migrations ORDER BY name;
```

Compare com as contagens de origem no momento do backup. Em uma instalação de teste, aponte `DB_NAME` para esse banco com um usuário autorizado, entre em uma loja, abra uma foto e consulte um pedido antigo. Guarde cópias periódicas fora da hospedagem, com acesso restrito.

**Voltar uma versão.** Para problema apenas de código, reimplante o commit anterior se ele aceitar o esquema atual. Para mudança incompatível de banco, pause pedidos, preserve uma cópia do estado atual, restaure o backup em outro banco, valide o código anterior contra ele e planeje como conciliar pedidos e pagamentos feitos desde o backup antes de trocar a conexão. A reversão de um commit não desfaz migrações.

### Recuperar acesso

O operador autorizado da plataforma deve verificar a identidade da pessoa. No terminal protegido, com acesso ao banco correto e na raiz do projeto, execute `npm run recover`, informe o e-mail e a nova senha. O sistema atualiza o hash e invalida as sessões anteriores dessa conta. Entregue a nova senha por canal privado. O dono também pode remover o acesso de um funcionário em **Equipe**.

### Diagnóstico rápido

| Sintoma                                | Como resolver                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL recusa a conexão                 | Verifique se o serviço está ligado, host, porta e permissões. Teste `mysql -h 127.0.0.1 -P 3306 -u mesa_app -p mesa_aberta`. No hPanel, confira os prefixos do usuário e do banco |
| Variável ausente ou tabela inexistente | Confira a pasta de execução, nomes das chaves, tamanho do segredo e o banco selecionado. Rode `npm run migrate`                                                                   |
| Falha ao iniciar ou carregar Sharp     | Confira Node 24 e logs. Rode `npm ci` no sistema de destino com as dependências opcionais habilitadas; módulos nativos dependem da plataforma                                     |
| Login volta para a tela de entrada     | Verifique HTTPS, cabeçalho do proxy, `TRUST_PROXY`, persistência de `SESSION_SECRET` e acesso da aplicação à tabela `sessions`                                                    |
| QR abre domínio incorreto              | Ajuste `PUBLIC_URL`, reinicie e baixe outro PNG. Para manter placas antigas após mudança de domínio, preserve o domínio antigo com redirecionamento do caminho da mesa            |
| Cozinha sem atualização                | Confira o horário de atualização, conexão, sessão e se o pagamento antecipado foi baixado. Um pedido pronto sai da fila de preparo. Reative o som se o navegador exigir um gesto  |
| Carrinho mostra alerta de mudança      | Recarregue pelo mesmo endereço e revise o item. Em envio sem resposta, primeiro use a consulta da tentativa existente                                                             |
| Porta ocupada                          | Altere `PORT` e `PUBLIC_URL` juntos no desenvolvimento. Em produção use a porta fornecida pelo serviço                                                                            |

### Mapa do código

| Caminho                           | Responsabilidade                                                     |
| --------------------------------- | -------------------------------------------------------------------- |
| `server.js`                       | Inicialização, sessão, proteção CSRF, login e rotas públicas         |
| `src/accounts.js`                 | Cadastro transacional, hash, validade inicial do piloto              |
| `src/private.js`                  | Permissões e operações de dono, equipe, plataforma e QR              |
| `src/catalog.js`                  | Validação de imagens, preços de produtos e opções                    |
| `src/orders.js`                   | Horário, assinatura, total, idempotência, preparo, baixa e devolução |
| `src/db.js`                       | Conexão MySQL, consultas parametrizadas e transações                 |
| `views/`                          | Telas EJS e textos em português                                      |
| `public/app.css`                  | Cores, componentes e disposição responsiva                           |
| `public/cart.js`, `public/app.js` | Carrinho, modo tablet e atualização da cozinha                       |
| `migrations/`, `scripts/`         | Esquema versionado, instalação, administração e demonstração         |
| `tests/turno.test.js`             | Fluxos HTTP e testes de navegador contra o banco real                |

### Demonstração de cinco minutos

| Tempo   | O que mostrar                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| 0–1 min | Na loja de demonstração, abra Mesa 1, confirme o pagamento posterior para mesas e escaneie o QR             |
| 1–2 min | No celular, escolha o prato, selecione suco e faça uma observação. Mostre o total e confirme                |
| 2–3 min | Mostre o mesmo número na cozinha, aceite e inicie o preparo. Abra o acompanhamento no celular               |
| 3–4 min | Marque pronto. No caixa, busque Mesa 1 e registre um Pix presencial após simular o recebimento              |
| 4–5 min | Confirme a entrega, confira quem recebeu e quando, e atualize o link do cliente para mostrar o encerramento |
