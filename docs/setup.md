# Instalação e configuração

Para rodar a distribuição em contêineres, siga o [guia Docker](docker.md). Este documento cobre desenvolvimento a partir do código e configuração manual.

## Desenvolvimento local

Use Node.js 22.12+, npm e Docker Compose v2. Na raiz:

```sh
npm ci
npm run dev:local
```

O launcher em `server/integration/local-dev.ts` prepara um ambiente persistente e isolado em `.orgmap/local-dev/`, usando `compose.local-dev.yaml` e PostgreSQL 18. Ele não herda URLs de banco e credenciais de outros hosts. E-mails ficam em `.orgmap/local-dev/smtp/`.

Acesse http://orgmap.localhost:5230 e crie sua conta e organização. Não existem contas de demonstração necessárias à instalação. A configuração do modelo de governança e dos círculos é feita pela UI com as permissões da organização.

Opções do launcher:

```sh
npm run dev:local -- --api-port=3331 --web-port=5231 --hostname=orgmap.localhost
```

A porta do PostgreSQL desse ambiente é 55433, definida no Compose. API e web precisam de portas distintas. Os hostnames locais aceitos são `orgmap.localhost`, `core.orgmap.localhost` e `qa.orgmap.localhost`; use o primeiro no desenvolvimento comum.

Ctrl+C encerra os processos da aplicação. O banco permanece no Docker e os dados são conservados para o próximo início. Não remova `.orgmap/local-dev/` para reiniciar. Para alterações de servidor ou migrations, pare o launcher e inicie novamente.

## Instalação operada

O fluxo manual usa `compose.yaml`, `server/src/main.ts` e a composição em `server/integration/`. Ele exige provisionamento explícito de banco, papéis SQL, armazenamento e workers; não basta iniciar apenas o frontend.

| Variável | Responsabilidade |
| --- | --- |
| `DATABASE_URL` | Conexão restrita da aplicação; não use a credencial de migrations no HTTP. |
| `MIGRATION_DATABASE_URL` | Conexão do operador para aplicar migrations. |
| `PORT` | Porta da API; o processo HTTP manual usa 3001 por padrão. |
| `ALLOWED_ORIGINS` | Origens web aceitas pelo servidor. |
| `ORGMAP_PUBLIC_URL` | Origem pública canônica dos links de convite e notificações, por exemplo `https://orgmap.work`. Sem ela, o envio usa a primeira origem de `ALLOWED_ORIGINS`. Informe somente a origem, sem caminho, consulta ou fragmento; HTTPS é obrigatório fora de localhost. O worker de e-mail precisa receber essa configuração. |
| `ORGMAP_INTEGRATION_CONFIG` | Caminho do JSON privado de configuração da composição. |
| `PLATFORM_BLOBS_DIRECTORY` | Diretório dos blobs, quando explicitamente definido pelo operador. |
| `PLATFORM_DISPATCH_DATABASE_URL` | Credencial restrita de descoberta dos jobs do dispatcher. |
| `IAM_MAIL_ENV_FILE` | Arquivo privado do worker de e-mail de contas. |
| `ORGMAP_MAIL_FROM` | Remetente dos e-mails de conta e notificações; no Brevo, use um endereço validado. Sem configuração, o desenvolvimento SMTP local usa `account@orgmap.local`. |
| `BREVO_API_KEY` | Quando presente, envia e-mails de conta e notificações pela API transacional do Brevo; exige `ORGMAP_MAIL_FROM` validado no provedor. |

O JSON de integração deve ficar fora do Git, ter permissões **0600** e conter apenas os provedores configurados. Um exemplo mínimo, sem serviços externos:

```json
{
  "blobsDirectory": ".orgmap/blobs"
}
```

SMTP, OIDC, SAML, deliveries e webhooks são opcionais e precisam de configuração operacional própria. O código da composição em `server/integration/` documenta as chaves e o processamento dos workers. A API e os workers devem usar a mesma configuração e o vínculo correto de host, banco e armazenamento. Consulte [backup e recuperação](docker.md#backup-e-atualização) antes de migrar ou restaurar uma instalação existente.

Nenhum segredo é carregado automaticamente de `.env` pelo fluxo manual; configure o ambiente do processo ou seu supervisor. O launcher `dev:local` gera sua própria configuração.

## Convites e acompanhamento

O compositor de Membros e Administração usa o mesmo fluxo de convite. O e-mail segue o idioma efetivo do workspace, inclui o botão de aceite e preserva o convite durante login ou cadastro. A tela **Acompanhar convites** mostra pendentes e histórico, com reenvio e cancelamento. Members acompanham os próprios convites; Owners acompanham todos. Guests não recebem acesso a essa tela.

Reenviar gera um novo link com validade de sete dias e invalida o anterior. Se um Owner reenviar um convite de outra pessoa, passa a ser o responsável pelo convite e pelos próximos avisos. Cancelar invalida o link e os envios pendentes; convites aceitos não podem ser reenviados ou cancelados. Durante um envio externo em andamento, aguarde e atualize antes de tentar essas ações.

Quem convidou recebe avisos nativos de aceite e de problema no envio, respeitando suas preferências de notificação. Falhas comprovadas permitem até cinco tentativas; as primeiras quatro não geram aviso de falha. Um resultado incerto gera aviso imediatamente e exige conferência antes de um reenvio manual. **Enviado** indica confirmação do transporte de e-mail, sem comprovar chegada à caixa de entrada; acompanhamento de abertura e bounces não faz parte desse fluxo.

A fila de convites usa o worker IAM; os avisos usam o dispatcher de notificações da plataforma. Ambos precisam estar ativos e receber a origem pública canônica e a configuração de e-mail. O launcher local mantém esses fluxos dentro do ambiente de desenvolvimento.

## Notificações do workspace

Os eventos do catálogo são produzidos pelos comandos reais dos respectivos domínios, na mesma transação: propostas e prazos de consentimento, atribuições e términos de papéis/círculos, escopo de papéis, objetivos e resultados-chave, tarefas, atualizações de projetos, reuniões, atas, comentários e resultados de convites. Atribuições nominais avisam as pessoas afetadas; atualizações e comentários dependem do acompanhamento do recurso. Seguir uma reunião também abrange a publicação de sua ata, desde que os acessos à origem e à ata continuem válidos. Atribuir uma pessoa não concede acesso ao recurso.

O sino, a lista de notificações, as preferências e os e-mails usam o idioma efetivo do workspace, mesmo quando a Conta usa outro idioma. E-mails incluem organização, ação, título do recurso, pessoa responsável quando aplicável, detalhes e datas pertinentes, link para abrir o recurso e link para controlar aquele evento. O acesso é revalidado antes da entrega e da leitura no app. Guests recebem o título atual autorizado, sem snapshots históricos de pessoas, hierarquia ou conteúdo.

Em **Preferências de notificações**, cada pessoa pode controlar os canais **E-mail** e **Aplicativo** por evento e módulo e ligar/desligar os recursos que acompanha. Regras bloqueadas pela organização continuam prevalecendo, e restaurar padrões não altera os acompanhamentos. Silenciar e-mail não desliga o sino. As preferências e o acompanhamento são conferidos novamente antes da entrega; alterações não recriam avisos já suprimidos.

Séries recorrentes geram uma convocação por pessoa e comando, com a quantidade de encontros e a primeira ocorrência pertinente. Replays e alterações sem efeito não geram novos avisos. Resultados automáticos de consentimento notificam também o autor; desligar os canais não bloqueia o início do prazo. Falhas de transporte mantêm retentativas limitadas, enquanto resultados incertos permanecem sem repetição automática.

## Problemas comuns

- Docker indisponível: inicie o daemon e confira `docker compose version`.
- Dependências: use a versão suportada de Node e rode `npm ci` na raiz.
- Porta ocupada: escolha outras portas de API/web; não encerre processos de outra instalação.
- Inicialização interrompida ou banco existente: consulte o manifest e os logs privados; use os procedimentos de recuperação, sem remover os dados.
- Windows: use WSL2 em filesystem Linux para preservar as permissões POSIX dos arquivos privados.
