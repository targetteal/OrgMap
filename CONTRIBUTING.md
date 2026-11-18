# Contribuir com o OrgMap

Use Git, Node.js 22.12 ou superior, npm e Docker com Compose v2. No Windows, use WSL2 e mantenha o checkout no sistema de arquivos Linux.

## Preparar o ambiente

No GitHub, faça um fork se você não tiver acesso de escrita. Use a URL do seu fork no comando abaixo, ou a URL mostrada se estiver na equipe.

```sh
git clone https://github.com/targetteal/OrgMap.git
cd OrgMap
npm ci
npm run dev:local
```

Abra [http://orgmap.localhost:5230](http://orgmap.localhost:5230) e crie sua conta e organização. O launcher provisiona o PostgreSQL local, aplica migrations e inicia o frontend com recarga, a API e os workers. Ctrl+C encerra a aplicação e conserva o banco e os arquivos em `.orgmap/local-dev/`. Veja [configuração](docs/setup.md) para portas e diagnóstico.

## Abrir um PR

Parta da `main` atual de `targetteal/OrgMap`. Se estiver usando um fork, sincronize a `main` dele antes de começar.

```sh
git switch main
git pull --ff-only
git switch -c minha-alteracao
```

O [mapa da arquitetura](docs/architecture.md) ajuda a encontrar o módulo responsável e o [DESIGN.md](DESIGN.md) descreve os padrões de interface.

Faça uma alteração com escopo claro. Mantenha regras no módulo dono, integrações nos ports/adapters e estilos nos tokens do Maré. Preserve alterações de outras pessoas. Não reescreva migrations aplicadas.

Rode `npm run build`, `npm run test:web` para mudanças na interface e os testes pertinentes ao seu módulo. Para UI, confira o resultado no navegador. O [guia de testes](docs/testing.md) explica os runners e os bancos temporários. Faça commit, envie a branch para seu remoto com `git push -u origin minha-alteracao` e abra o PR para `targetteal/OrgMap:main`. Descreva o problema, o comportamento resultante, as verificações e qualquer limitação material.

Use as [issues](https://github.com/targetteal/OrgMap/issues) para bugs e propostas. Para vulnerabilidades, consulte o [canal privado](SECURITY.md).

Ao enviar uma contribuição, confirme que você pode disponibilizá-la nos termos da [licença MIT do projeto](LICENSE). Para material de terceiros, inclua a origem e os avisos exigidos pela licença aplicável.

## O que vai para o Git

Código, migrations, contratos, documentação atual e evidências curadas. Não versione `.env`, bancos, dumps, uploads, tokens, `node_modules`, builds ou diretórios privados `.orgmap/`. Capture evidências novas em `.orgmap/qa/` e só promova para `docs/` o que for útil para revisão ou documentação.

## Encerrar uma branch

Integre o trabalho útil e confirme que está na `main` antes de excluir a branch. Um worktree só pode ser removido depois de verificar alterações únicas e processos que o utilizam. Bancos, blobs e backups exigem tratamento próprio; não são descartáveis por estarem num diretório ignorado.
