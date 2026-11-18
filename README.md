# OrgMap

OrgMap é uma aplicação para tornar visível como uma organização funciona: quem faz o quê, por que cada papel existe, quais acordos orientam o trabalho e como esses acordos mudam.

O projeto reúne estrutura organizacional em círculos e papéis, governança, tensões, projetos, reuniões e membros. A experiência usa o design system **Maré**, com cores configuráveis por organização, e contempla as particularidades de **Organizações Orgânicas (O2)**.

O código do OrgMap é distribuído sob a [licença MIT](LICENSE). Componentes incorporados, incluindo fontes e bibliotecas, mantêm suas respectivas licenças.

## O que você encontra no app

| Área | Para que serve |
| --- | --- |
| Papéis e círculos | Explorar a estrutura em círculos, rede ou lista; consultar propósito, responsabilidades, artefatos e pessoas. |
| Governança | Preparar propostas a partir de tensões, acompanhar decisões, restrições e encaminhamentos. |
| Projetos | Organizar trabalho em lista, kanban ou galeria, com tarefas, participantes, comentários e recursos. |
| Reuniões | Agendar encontros de círculo, conduzir a pauta e consultar atas e decisões. |
| Membros e configurações | Consultar pessoas e configurar organização, governança, papéis essenciais e aparência. |

Uma instalação nova começa com banco vazio.

## Rodar o OrgMap

- **Experimentar no computador** com uma instalação vazia e persistente via [Docker Compose](docs/docker.md#testar-em-localhost).
- **Hospedar no seu servidor** seguindo o [guia de HTTPS, atualização e backup](docs/docker.md#hospedar-em-um-servidor-linux).
- **Contribuir com o código** a partir de um clone e do [ambiente de desenvolvimento com recarga](CONTRIBUTING.md).

## Como o repositório está organizado

```text
OrgMap/
├── web/            # App React, componentes, estilos e testes de interface
├── server/         # API, domínios, migrations, integrações e operação
├── packages/       # Contratos, conteúdo rico e localização compartilhados
├── scripts/        # Comandos de desenvolvimento, validação e manutenção
├── tests/          # Testes de servidor, editor, localização e qualidade
├── docs/           # Guias de instalação e desenvolvimento
├── DESIGN.md       # Design system Maré e suas regras
├── AGENTS.md       # Orientação para agentes que trabalham no código
└── CONTRIBUTING.md # Fluxo de contribuição e verificações
```

Comece pelo [índice da documentação](docs/README.md) e pelo [mapa da arquitetura](docs/architecture.md).

## Desenvolver

```sh
npm run typecheck
npm run build
npm run test:web
```

Os testes de servidor usam bancos temporários e exigem o PostgreSQL do ambiente de testes; consulte [testes e validação](docs/testing.md) antes de executar `npm test`. Para uma alteração pontual, rode as verificações relacionadas ao módulo.

A configuração de uma instalação operada, incluindo armazenamento e conectores opcionais, está em [configuração](docs/setup.md#instalação-operada). Credenciais, bancos, uploads e arquivos `.env` nunca devem entrar no Git.
