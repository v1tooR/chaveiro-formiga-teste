# Backup e restauração

Até aqui o projeto não tinha nenhuma cópia de segurança. Nenhum script, nenhuma
rotina, e no plano free do Supabase não existe PITR. Enquanto o banco é de
demonstração isso é irrelevante; no dia em que entrar comanda de cliente, é o
único risco da lista que **não tem desfazer**.

```bash
npm run backup                                   # banco local
npm run backup -- --nuvem                        # Supabase Cloud

npm run restaurar -- backups/local-... --banco-de-teste   # ensaio seguro
npm run restaurar -- backups/local-...                    # para valer
```

Os backups vão para `backups/`, que está no `.gitignore` — contêm dados de
cliente e fotos de peças, e não podem entrar no repositório.

## O que um dump do `public` não salva

Esta é a parte que costuma ser descoberta tarde. Um `pg_dump --schema=public`
parece completo e não restaura este sistema. Faltam três coisas, e sem qualquer
uma delas a cópia é inútil:

| Falta | Consequência |
|---|---|
| `auth.users`, `auth.identities` | `profiles` fica com FK para usuário inexistente. **Ninguém entra no sistema.** |
| `storage.objects` | O Storage não sabe que as fotos existem, mesmo com os bytes no disco. |
| Os binários das fotos | **Não estão no Postgres.** Dump de banco nenhum leva um byte de imagem. |

O terceiro é o mais fácil de esquecer e o mais caro: a foto é a prova do estado
em que a peça foi recebida, que é justamente a disputa que o sistema existe para
resolver.

Por isso o backup tem quatro partes:

```
backups/local-20260811-093832/
├── 1-logins.sql       auth.users + auth.identities (data-only)
├── 2-aplicacao.sql    schema public, estrutura + dados
├── 3-storage.sql      storage.buckets + storage.objects (data-only)
├── fotos/             os binários, em <order_id>/<arquivo>
└── MANIFESTO.md       contagens, origem e como restaurar
```

## Decisões que valem explicar

**`auth` e `storage` saem só com dados, não com estrutura.** Essas tabelas
pertencem ao GoTrue e ao storage-api, que as criam e migram conforme a versão da
imagem. Carregar estrutura nossa por cima brigaria com a versão instalada no
destino.

**O `public` sai com `--clean --if-exists`.** A restauração derruba o que existir
antes de recriar, então funciona tanto em banco vazio quanto em banco já migrado.
Sem isso, restaurar exigiria um banco recém-criado — e é sempre num momento ruim
que se descobre esse tipo de requisito.

**`--no-owner`, mas nunca `--no-privileges`.** A extensão `supautils` reatribui a
posse de tudo para `supabase_admin`, então `ALTER OWNER` só produziria erro. As
`GRANT`s, ao contrário, **têm** que vir: são a autorização do sistema. Sem elas o
papel `authenticated` perde acesso a tudo e o app fica em branco com a base
intacta.

**Os binários vão pela Storage API, não pelo disco.** É o único jeito que funciona
igual no self-hosted (backend `file`, num volume Docker) e na nuvem (backend S3,
sem acesso ao disco). A lista dos arquivos vem do banco; os bytes, da API.

**A ordem da restauração não é negociável:** logins → aplicação → índice do
Storage → binários. `public.profiles` tem FK para `auth.users`; inverter derruba
tudo com violação de chave.

## `--banco-de-teste`: use antes de precisar

Backup que nunca foi restaurado não é backup, é arquivo. O modo de ensaio cria um
banco novo ao lado do que está no ar, carrega a cópia lá, conta as linhas e
derruba o banco no fim — **sem encostar em produção**.

```
  → 1/4 logins
  → 2/4 aplicação
  → 3/4 índice das fotos
  → 4/4 binários
    envio de foto conferido (1 arquivo de prova, já removido)

  Restaurado:
    comandas : 166
    itens    : 184
    clientes : 80
    logins   : 6 (6 com senha)
    fotos    : 19 no índice

  Compare com o manifesto do backup:
    | Comandas (não excluídas) | 166 |
    ...
```

Três detalhes do ensaio que não são enfeite:

- **"6 com senha"** existe porque a senha é o que se perde em silêncio.
  `auth.users` pode voltar com todas as linhas e `encrypted_password` vazio: a
  contagem bate, o relatório fica verde e ninguém consegue entrar.
- **O envio de uma foto de prova.** O ensaio não pode reenviar as fotos para
  valer — o Storage fala com o banco no ar, não com o banco de ensaio, e a carga
  cairia em cima dos arquivos de produção. Mas pular tudo deixaria metade do
  backup sem verificação, então sobe um arquivo para um prefixo descartável e
  apaga. Prova a chave, o endpoint e o formato da requisição, que é onde esse
  passo falha na prática.
- **A estrutura de `auth`/`storage` é copiada do banco vivo**, já que o banco de
  ensaio nasce vazio e o backup (corretamente) não a guarda. Não é trapaça: o que
  está sendo verificado é se o backup devolve comandas, clientes, logins e fotos.
  A estrutura do GoTrue vem da imagem nos dois casos.

## O que ainda falta

- **Agendamento.** Hoje o backup roda quando alguém digita. Numa loja em operação
  isso precisa ser tarefa agendada, com o resultado saindo da máquina —
  backup guardado no mesmo disco do banco não protege contra a perda do disco.
- **Retenção.** Nada apaga backup antigo. `backups/` cresce para sempre.
- **Ensaio periódico.** O `--banco-de-teste` existe, mas nada obriga a rodá-lo.
  O momento em que se descobre que a cópia não volta não pode ser o da
  emergência.

## Correção que veio junto

`scripts/lib/psql.sh` passou a traduzir o endereço do banco quando o cliente roda
**dentro** do container.

`SUPABASE_DB_URL` aponta para `127.0.0.1:54322`, que é a porta publicada no host.
Quando não há `psql` na máquina — o caso comum no Windows — os scripts usam o
cliente do container, e lá essa porta não existe: o Postgres escuta na 5432.

O sintoma era `Connection refused` numa stack no ar, o que manda quem depura
investigar o container errado. Isso derrubava `npm run db:migrate` numa
instalação limpa, e derrubou o `backup` na primeira execução. A correção fica na
biblioteca compartilhada, então vale para `migrate`, `seed`, `reset-to-prod`,
`backup` e `restaurar` de uma vez.
