# Publicar no Supabase Cloud

O projeto nasceu self-hosted em Docker. Este documento cobre a migração
para um projeto hospedado, mantendo as mesmas 27 migrations.

## O que muda, e o que não muda

**Não muda:** as migrations, os seeds, a RLS, as RPCs e o frontend. O
schema é o mesmo arquivo por arquivo — é essa a vantagem de ter o banco
descrito em migrations versionadas em vez de num dump.

**Muda:**

| | Self-hosted | Nuvem |
|---|---|---|
| Quem aplica migrations | `npm run db:migrate` (psql direto) | `npm run cloud:deploy` (CLI, com histórico) |
| Papel do dono | `supabase_admin` (supautils reatribui) | `postgres` |
| Criação de login | `bootstrap-users.sh` | Admin API, no `cloud-deploy.sh` |
| Chave do front | `anon` (JWT legado) | `sb_publishable_…` |

O `migrate.sh` continua servindo ao banco local, que é descartável. A
nuvem vai pela CLI porque `supabase db push` registra o que aplicou em
`supabase_migrations.schema_migrations` — sem esse histórico, o deploy
seguinte tentaria recriar tudo.

## Preparar

No `.env` (nunca versionado):

```bash
SUPABASE_PROJECT_REF=<ref>            # o subdomínio da URL do projeto
SUPABASE_DB_URL_CLOUD=<URI>           # Settings → Database → Connection string → URI
SUPABASE_SECRET_KEY=sb_secret_...     # Settings → API Keys
SEED_ADMIN_EMAIL=...
SEED_ADMIN_PASSWORD=...
```

Duas armadilhas na URI:

1. **Use a do pooler, não a conexão direta.** A direta é IPv6-only em
   projetos novos e falha em boa parte das redes domésticas.
2. **A senha precisa vir percent-encoded** (`@` → `%40`, `/` → `%2F`).
   A URI copiada do painel já vem; digitada à mão, não. O script barra
   antes de tentar, porque o erro que o Postgres devolve nesse caso fala
   de host inválido e não aponta para a causa.

## Aplicar

```bash
npm run cloud:deploy
```

Faz, em ordem: testa a conexão, aplica as migrations pela CLI, roda o
`seed_prod.sql` (papéis, matriz de permissão, domínio, equipe,
configuração e integrações — **nenhum cliente ou comanda**), garante o
login do responsável pela Admin API e imprime a conferência.

Só o schema, sem tocar em dado:

```bash
npm run cloud:migrations
```

## Apontar o frontend

```bash
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

O prefixo é `VITE_`, não `NEXT_PUBLIC_` — o painel do Supabase mostra o
exemplo em Next.js, mas este projeto é Vite e ignora qualquer outra
coisa. A publishable key pode ir para o navegador: quem protege os dados
é a RLS, não o segredo da chave.

## Depois de publicar

- [ ] **Bucket `order-photos` privado.** A migration cria, mas confirme em
      Storage → Buckets. Público ali significa foto de cliente acessível
      por URL.
- [ ] **Trocar a senha do responsável** no primeiro acesso.
- [ ] **Backup (PITR)** em Settings → Database. No plano free não existe:
      um `reset` sem atenção não tem desfazer.
- [ ] **Restringir a rede** em Settings → Database → Network Restrictions,
      se a operação sai de IP fixo.

## A guarda contra apagar dados reais

Com o `.env` apontando para a nuvem, `npm run db:reset:prod` deixa de
atingir um container descartável e passa a apagar a base da loja. O
comando é o mesmo, o nome é o mesmo — a diferença mora numa variável de
ambiente, e quem digita não vê.

Por isso `scripts/lib/alvo.sh` classifica o alvo antes e, quando é
remoto, exige que o operador digite o ref do projeto. Não é `[s/N]`: uma
tecla é fácil demais de apertar por reflexo.

Vale para `db:reset:prod`, `db:migrate` e `db:seed:demo`. O `--yes`
**não** libera alvo remoto — ele existe para CI contra o banco local, e
apagar produção não pode depender de uma flag genérica copiada de um
exemplo.

Automação consciente usa `PERMITIR_ALVO_REMOTO=1`, que é explícito no
nome.

## O que a nuvem recusou, e que o self-hosted aceitava

Achado ao rodar o reset de verdade contra o projeto hospedado:

```
42501: Direct deletion from storage tables is not allowed.
       Use the Storage API instead.
CONTEXT: PL/pgSQL function storage.protect_delete()
```

A instância hospedada protege `storage.objects` com uma trigger que
recusa DELETE por SQL. O `reset_to_prod.sql` limpava o bucket assim — e,
como o arquivo roda inteiro em uma transação, o erro **abortava o reset
todo**: o banco ficava intacto e a única mensagem falava de storage, sem
relação óbvia com o que o operador tinha pedido.

Agora a falha é capturada e o reset segue; os binários são apagados pela
camada de script, via Storage API. O metadado já vai embora com o
TRUNCATE das tabelas de negócio.

### E a ordem importa: limpe o bucket ANTES do reset

Investigando a mesma área apareceu um segundo problema, este de lógica e
não de plataforma.

`order_photos_storage_delete` só autoriza apagar foto cujo caminho aponta
para uma comanda **viva**. Depois do TRUNCATE não existe comanda nenhuma,
a policy nega o DELETE de todas as fotos, e elas viram binário órfão que
**nem o responsável remove pela aplicação** — ocupando disco para sempre.

Medido na nuvem: `HTTP 400` com a sessão do owner, `200` só com a service
key, que ignora a RLS.

```bash
npm run cloud:limpar-bucket           # lista o que apagaria
npm run cloud:limpar-bucket -- --sim  # apaga
```

Rode **antes** do reset, enquanto as comandas existem — ou depois, para
recolher órfãos deixados por um reset antigo.

Vale a generalização: **o self-hosted é mais permissivo que a nuvem**.
Superusuário no container aceita coisas que a instância gerenciada
recusa. Rodar contra a nuvem é a única forma de descobrir quais.

## Diferenças de versão

O ambiente local roda **PostgreSQL 15**; este projeto na nuvem, **17.6**.
As 27 migrations aplicaram sem ajuste, mas vale saber ao investigar
comportamento que difere entre os dois.

## Estado verificado na nuvem

| Item | Resultado |
|---|---|
| Migrations | 27/27, registradas em `schema_migrations` |
| Schema | 22 tabelas (todas com RLS), 4 views, 52 funções, 55 policies |
| Realtime | 9 tabelas na publicação |
| Storage | bucket `order-photos` criado |
| Seed de produção | 5 papéis, 10 módulos, 30 permissões, 6 na equipe, 4 integrações |
| Dados | 0 clientes, 0 comandas — primeira comanda nasce CF-0001 |
| Fluxo central | `create_order` gerou comanda + evento + lançamento numa transação |
| RLS anônima | `customers`, `orders`, `ledger_entries`, `audit_logs` devolvem 0 linhas; `integrations` recusa com 42501 |
| Erros de negócio | chegam em português (a correção do P0002 vale na nuvem) |
| Reset de produção | zera dados e preserva configuração |
| App no navegador | login do responsável, 10 módulos, estados vazios corretos, 0 erro de console |

## Storage verificado na nuvem

O bucket já nasce correto pelas migrations — `public = false`, limite de
10 MB, só `image/*`, 4 policies. Mas flag não é prova, então a cadeia foi
testada de ponta a ponta com uma comanda real:

| Teste | Resultado |
|---|---|
| Upload autenticado | 200 |
| `/object/public/...` sem sessão | **400** — bucket privado |
| `/object/...` sem sessão | **400** — negado |
| URL assinada | emitida |
| Baixar pela assinada | 200 — o app exibe |
| Assinada **adulterada** | **400** — assinatura validada |

Vale registrar por que a primeira tentativa falhou: subir para o caminho
`00000000-…/foto.png` foi recusado com *new row violates row-level
security policy*. Não era defeito — a policy de INSERT exige que o
primeiro segmento do caminho seja uma comanda existente, viva e não
finalizada. Foto só entra vinculada a uma comanda em aberto.
