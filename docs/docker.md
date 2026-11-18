# Rodar o OrgMap com Docker

Você precisa de Docker com Compose v2 e de um terminal. Para hospedar com HTTPS público, use um servidor Linux com domínio apontado para ele. Para trabalhar no código com recarga, siga o [guia de contribuição](../CONTRIBUTING.md).

## Testar em localhost

Baixe `orgmap-docker.tar.gz` na [última release do OrgMap](https://github.com/targetteal/OrgMap/releases/latest) e rode estes comandos na pasta do download. O pacote já aponta para as imagens públicas da versão que você baixou.

```sh
tar -xzf orgmap-docker.tar.gz
cd orgmap-docker
umask 077
cp .env.example .env
docker run --rm node:22-bookworm-slim node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

Preencha `ORGMAP_DB_PASSWORD` no `.env` com o valor gerado e mantenha uma cópia privada. Rode:

```sh
docker compose --profile operator pull
docker compose run --rm -T setup prepare
docker compose up -d --wait
```

Abra [http://localhost:5230/register](http://localhost:5230/register), crie sua conta e, depois, sua organização. A instalação começa vazia. Se a porta estiver ocupada, ajuste `ORGMAP_PORT` e `ORGMAP_PUBLIC_URL` juntos.

Para pausar, use `docker compose down`. Os volumes são preservados e a instalação retoma com `docker compose up -d --wait`. Use um nome de projeto Compose diferente com `-p` ou `COMPOSE_PROJECT_NAME` para cada instância independente e mantenha esse nome nos comandos seguintes.

## Compilar a partir do código

Clone o repositório e faça o build pelo Docker usando a configuração local do checkout.

```sh
git clone https://github.com/targetteal/OrgMap.git
cd OrgMap/ops/docker
umask 077
cp .env.example .env
docker run --rm node:22-bookworm-slim node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

Preencha `ORGMAP_DB_PASSWORD` em `.env` com o valor gerado. Mantenha esse arquivo privado e guarde uma cópia junto às credenciais da instalação. Rode:

```sh
docker compose -f compose.yaml -f compose.build.yaml --profile operator build
docker compose run --rm -T setup prepare
docker compose up -d --wait
```

Acesse [http://localhost:5230/register](http://localhost:5230/register) quando os serviços estiverem saudáveis.

## Hospedar em um servidor Linux

Baixe e extraia o pacote da [release](https://github.com/targetteal/OrgMap/releases/latest) como no teste local. Ele contém `compose.yaml`, `compose.https.yaml`, `Caddyfile` e `.env.example` com as imagens `-app`, `-operator` e `-web` da mesma versão.

Preencha `.env` como na instalação local, altere `ORGMAP_PUBLIC_URL` para a origem HTTPS, por exemplo `https://orgmap.exemplo.org`, e aponte o DNS desse nome para o servidor. O Caddy da configuração HTTPS recebe as portas 80 e 443 e gerencia o certificado. Libere ambas no firewall. Para reutilizar um proxy reverso existente, mantenha só o Compose base e encaminhe a origem HTTPS para `127.0.0.1:5230`, com suporte a WebSocket. [Documentação do Caddy](https://caddyserver.com/docs/automatic-https).

Com imagens de release, execute:

```sh
export COMPOSE_FILE=compose.yaml:compose.https.yaml
docker compose --profile operator pull
docker compose run --rm -T setup prepare
docker compose up -d --wait
```

No caso de build local, retire o passo `pull`. Abra `/register` na origem que configurou. O cadastro fica aberto. Para uma instalação restrita à sua equipe, limite o acesso na rede ou na entrada HTTPS de acordo com o público pretendido.

### E-mail

Para convites, notificações e recuperação por e-mail, preencha `BREVO_API_KEY` e `ORGMAP_MAIL_FROM` com a chave e o remetente validado no Brevo. Recrie o serviço `app` com `docker compose up -d --wait app` após configurar. Faça um ensaio de entrega com uma conta da equipe.

Sem a chave, os workers processam e-mail em uma caixa de teste privada no contêiner. Para conferir mensagens em uma instalação de teste, liste os arquivos com `docker compose exec app ls /var/lib/orgmap/local-mail`. Os arquivos contêm links privados. Em uma instância usada por outras pessoas, configure o provedor antes de depender de convites e recuperação.

### Operação

| Recurso | Onde fica |
| --- | --- |
| Banco PostgreSQL | Volume `postgres`. A conexão usa um socket Unix privado do projeto. |
| Arquivos, credenciais de runtime e autoridade de encerramento de organizações | Volume `data`. A API e os workers compartilham a mesma instalação. |
| Pacotes de backup | Volume `backups`, acessado pelo serviço de operação. Mantenha também cópias fora do host. |
| Certificados do Caddy | Volumes `caddy-data` e `caddy-config` ao usar a configuração HTTPS. |

Use `docker compose ps`, `docker compose logs --tail=100 app web postgres` e `/api/ready` para diagnosticar inicialização. A aplicação usa as roles restritas que o serviço `setup` provisiona. Se uma instalação ou migração for interrompida, preserve os volumes e os logs para diagnóstico.

## Backup e atualização

Rode na pasta da instalação com o mesmo projeto Compose e a configuração HTTPS já exportada, se aplicável. Pare os processos escritores e gere um pacote com um nome novo:

```sh
docker compose stop web app
docker compose run --rm -T setup backup antes-da-atualizacao
umask 077
docker compose run --rm --no-deps -T --entrypoint tar setup \
  -C /backups -czf - antes-da-atualizacao > antes-da-atualizacao.tgz
```

O pacote contém o dump, os arquivos referenciados, o manifesto de integridade e a autoridade de encerramento de organizações. Ele contém dados privados. Guarde o arquivo e a configuração da instalação num destino de backup privado. Para só tirar uma cópia, volte com `docker compose up -d --wait`.

Para atualizar, troque `ORGMAP_VERSION` pelo próximo tag, mantenha o mesmo projeto Compose e rode:

```sh
docker compose --profile operator pull
docker compose run --rm -T setup prepare
docker compose up -d --wait
```

Ao compilar do código, use o checkout da nova versão e o comando de [build a partir do código](#compilar-a-partir-do-código) para gerar os novos tags. A atualização executa o migrador versionado. Se ele falhar, investigue antes de subir a aplicação. Depois de aplicar migrations, uma volta de versão pode exigir restauração do backup compatível. Este procedimento cobre atualizações do OrgMap mantendo PostgreSQL 18.

## Restaurar em outra instalação

Use um novo projeto Compose, com volumes vazios, a versão que fez o backup ou uma versão compatível, uma senha nova e uma origem própria. Inicie pelo banco. Para substituir uma instalação, mantenha a origem desligada e use a cópia mais recente da autoridade de encerramento. Uma autoridade histórica pode desconhecer encerramentos posteriores ao backup. Se houver dúvida sobre sua atualidade, confirme a autoridade antes da restauração.

Use somente pacotes provenientes da sua própria operação. No projeto novo:

```sh
docker compose up -d --wait postgres
docker compose run --rm --no-deps -T --entrypoint tar setup \
  -C /backups -xzf - < antes-da-atualizacao.tgz
docker compose run --rm -T setup restore-new antes-da-atualizacao
docker compose up -d --wait
```

O restore valida o manifesto, as referências e os arquivos, reconcilia a autoridade e vincula o banco e os arquivos ao destino. Confira login, organização e download de um arquivo antes de usar essa instância. O banco da origem continua separado. Use o procedimento de captura acima para um backup regular da instância restaurada.
