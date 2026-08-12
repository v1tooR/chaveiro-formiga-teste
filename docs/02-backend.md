# Etapa 2 — Projeto do Backend

Supabase self-hosted. Single-tenant (uma loja) — ver [análise §2](01-analise-frontend.md).

---

## 1. Modelagem

19 migrations versionadas em [supabase/migrations/](../supabase/migrations/). Nunca edite uma
migration aplicada — toda alteração é um arquivo novo.

| # | Migration | Conteúdo |
|---|---|---|
| 01 | `20260729120000_extensions_and_helpers` | extensões, schema `private`, `set_updated_at`, normalização de busca/telefone |
| 02 | `20260729120100_profiles_and_permissions` | `roles`, `modules`, `role_modules`, `staff`, `profiles`, helpers `can_read`/`can_write`, trigger de novo usuário |
| 03 | `20260729120200_domain_tables` | `service_categories`, `order_statuses`, `customer_statuses`, `payment_methods`, `ledger_statuses`, `ledger_categories`, `photo_kinds` |
| 04 | `20260729120300_app_settings` | configuração singleton da loja |
| 05 | `20260729120400_customers` | clientes |
| 06 | `20260729120500_services` | catálogo + RPC `duplicate_service` |
| 07 | `20260729120600_orders` | comandas, com `amount_paid`/`balance`/`is_settled` |
| 08 | `20260729120700_order_children` | `order_photos`, `order_payments`, `order_events` |
| 09 | `20260729120800_ledger_entries` | lançamentos financeiros |
| 10 | `20260729120900_business_logic` | triggers + RPCs `create_order`, `register_order_payment`, `change_order_status`, `update_order`, impressão |
| 11 | `20260729121000_audit_logs` | auditoria append-only + trigger genérico |
| 12 | `20260729121100_integrations` | módulo de integrações + guarda antissegredo |
| 13 | `20260729121200_storage` | bucket privado `order-photos` + policies |
| 14 | `20260729121300_views_and_reports` | views de listagem + 10 RPCs de relatório |
| 15 | `20260729121400_realtime` | publicação + `REPLICA IDENTITY FULL` |
| 16 | `20260729121500_audit_noise_filter` | ignora o avanço do contador de comandas na auditoria |
| 17 | `20260729121600_auth_user_bootstrap` | criação de usuário resiliente à versão do schema `auth` |
| 18 | `20260730130000_kpis_finance_visibility` | KPIs financeiros vêm `NULL` para quem não tem o módulo |
| 19 | `20260730140000_append_only_allow_fk_setnull` | append-only sem bloquear `ON DELETE SET NULL` |

### Entidades

```
profiles ──1:1── auth.users
   │ role_key → roles ──< role_modules >── modules
   └ staff_id → staff

customers ──< orders >── services
                │  ├──< order_photos     (→ bucket order-photos)
                │  ├──< order_payments
                │  ├──< order_events     (append-only)
                │  └──< ledger_entries >── ledger_categories
app_settings (singleton)   integrations   audit_logs (append-only)
```

### Índices — o que cada um atende

| Índice | Consulta que ele serve |
|---|---|
| `orders_number_desc_idx` | listagem padrão de comandas |
| `orders_status_due_idx` | colunas do Kanban ordenadas por urgência |
| `orders_open_balance_idx` | filtro "com saldo" e tela de Financeiro |
| `orders_label_pending_idx` | fila de etiquetas |
| `orders_search_idx` (GIN trigram) | busca por número/serviço |
| `customers_phone_unique` | telefone é o identificador de balcão — impede cliente duplicado |
| `customers_search_idx` (GIN trigram) | busca acento-insensível por nome/e-mail/cidade |
| `ledger_entries_auto_open_idx` | baixa de pendências (regra 31) |

## 2. Autenticação e autorização

Supabase Auth (e-mail + senha). Sem auto-cadastro: `DISABLE_SIGNUP=true`.

> ⚠️ `ENABLE_EMAIL_SIGNUP=false` **não** é o jeito de bloquear cadastro — desliga o provedor de
> e-mail inteiro e ninguém consegue entrar (`email_provider_disabled`). Ver [.env.example](../.env.example).

A matriz módulo × papel é **dado** (`role_modules`), não código. RLS e front leem da mesma tabela.

```sql
-- Predicados usados por TODAS as policies
public.can_read(modulo)   -- SELECT
public.can_write(modulo)  -- INSERT/UPDATE/DELETE; roles.is_readonly vence a matriz
public.is_owner()         -- atalho para can_write('settings')
```

`SECURITY DEFINER` + `search_path` fixo: sem isso a policy consultaria `profiles`, que tem RLS, e
entraria em recursão.

### RLS por tabela

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `customers` | `customers`/`orders`/`production` (r) | `customers`/`service_desk` (w) | `customers` (w) | owner |
| `services` | `services`/`service_desk`/`orders` (r) | `services` (w) | `services` (w) | owner |
| `orders` | `orders`/`production` (r) | `orders`/`service_desk` (w) | `orders`/`production` (w) | owner |
| `order_photos` | `orders`/`production` (r) | + comanda não finalizada | `orders`/`production` (w) | `orders`/`production` (w) |
| `order_payments` | `orders`/`finance`/`customers` (r) | `finance`/`service_desk`/`orders` (w) | **bloqueado** | **bloqueado** |
| `order_events` | `orders`/`production` (r) | qualquer papel operacional | **bloqueado** | **bloqueado** |
| `ledger_entries` | `finance` (r) | `finance` (w), não automático | `finance` (w), não automático | owner |
| `app_settings` | todos | `settings` (w) | `settings` (w) | **bloqueado** |
| `integrations` | `settings` (w) | `settings` (w) | `settings` (w) | `settings` (w) |
| `audit_logs` | owner | via trigger | **bloqueado** | **bloqueado** |
| domínio | todos | owner | owner | owner |

**Verificado sobre HTTP** (`ledger_entries` visíveis por papel):

| papel | comandas | lançamentos | clientes | auditoria | integrações |
|---|---|---|---|---|---|
| owner | 120 | 281 | 80 | 543 | 6 |
| attendant | 120 | **0** | 80 | **0** | **0** |
| production | 120 | **0** | 80 | **0** | **0** |
| finance | 120 | 281 | 80 | **0** | **0** |
| viewer | 120 | **0** | 80 | **0** | **0** |

## 3. Client direto vs. RPC

**Client direto** quando a operação é de uma tabela e as regras cabem em constraint/trigger:
`customers`, `services`, `ledger_entries`, `app_settings`, `order_photos`, `integrations`.

**RPC** quando envolve mais de uma tabela e precisa ser atômica, ou quando a validação depende de
estado que o cliente não pode arbitrar:

| RPC | Por quê |
|---|---|
| `create_order` | numeração sequencial + comanda + fotos + eventos + 1–2 lançamentos, tudo ou nada |
| `register_order_payment` | `SELECT ... FOR UPDATE` na comanda: dois caixas recebendo ao mesmo tempo não passam do saldo |
| `change_order_status` | valida permissão e a trava de status final |
| `update_order` | aceita só os campos que a UI edita |
| `mark_labels_printed` | ignora comandas finalizadas e devolve quantas realmente marcou |
| `duplicate_service` | resolve colisão de nome no servidor |
| `dashboard_kpis`, `report_*` | agregação sobre a base inteira — no cliente veria só a página |

**Edge Functions** ficam reservadas às integrações externas: é o único lugar com acesso ao segredo.

## 4. Módulo de integrações

Tabela `integrations`: `key`, `name`, `kind`, `provider`, `config` (JSON não sensível), `enabled`,
`secret_ref`.

Três barreiras contra segredo no banco:

1. `guard_integration_config()` rejeita chave de config que contenha `token`, `secret`, `password`,
   `api_key`, `senha`, `chave`… — verificado: `{"api_key": "..."}` é recusado.
2. `integrations_enabled_needs_secret`: não habilita sem `secret_ref`.
3. `secret_ref` guarda o **nome** da variável (`^[A-Z][A-Z0-9_]{2,60}$`), nunca o valor.

`integration_status` (view sem `security_invoker`) expõe só `enabled`/`last_status` para todos os
papéis — a tabela em si é visível apenas ao responsável.

Adapters isolados atrás de uma interface comum ([src/lib/api/integracoes.ts](../src/lib/api/integracoes.ts)):

```ts
chamarIntegracao(key, payload): Promise<ResultadoIntegracao>
// → { ok: false, motivo: 'nao_configurada' | 'desabilitada' | 'erro' }
```

Trocar de provedor de WhatsApp mexe em uma Edge Function; nenhuma tela é tocada.

## 5. Política de exclusão

| Entidade | Política | Motivo |
|---|---|---|
| `customers` | soft (`deleted_at`) | carrega histórico financeiro |
| `services` | soft + `active` | comandas antigas referenciam; o front só **arquiva** |
| `orders` | soft | cancelamento é `status_key='cancelada'`, não exclusão |
| `ledger_entries` | soft | apagar histórico financeiro destrói a conciliação |
| `staff`, `ledger_categories` | soft | idem |
| `order_photos` | **hard** + limpeza do binário | o front remove de vez |
| `order_payments` | **nunca** | estorno é lançamento novo |
| `order_events`, `audit_logs` | **nunca** | append-only |
| `app_settings` | **nunca** | trigger recusa DELETE |

Todo `SELECT` de tabela com soft delete filtra `deleted_at IS NULL` **na policy** — não depende da
consulta lembrar.

## 6. Auditoria

`audit_logs`: quem (`actor_id` + `actor_name` congelado), o quê (`action`, `resource_type`,
`resource_id`), antes/depois (`jsonb`), quando.

Auditado: `app_settings`, `ledger_entries`, `ledger_categories`, `services`, `customers`, `staff`,
`profiles`, `role_modules`, `integrations`.

**Não** auditado: `orders` — já tem `order_events` (timeline completa e visível ao operador);
auditar cada arrasto do Kanban encheria a tabela sem informação nova.

Dois refinamentos que vieram de problema real:

- `trg_audit_app_settings` ignora mudança só de `order_next_number` — senão cada comanda criada
  gerava uma linha "o contador andou", enterrando as mudanças de configuração.
- `prevent_content_mutation` permite o `ON DELETE SET NULL` das FKs de autor. Sem isso,
  `DELETE FROM auth.users` falhava e o reset para produção abortava inteiro.

## 7. Triggers e automações

| Trigger | Regra |
|---|---|
| `set_updated_at` | em toda tabela mutável |
| `orders_sync_amount_paid` / `order_payments_recalc_order` | regra 13 — `amount_paid` = entrada + Σ pagamentos |
| `orders_guard_status` | regras 22 e 23 — `delivered_at` e trava de status final |
| `orders_after_status_change` | evento no histórico; entrega com saldo → `vencido`; cancelamento → `cancelado` |
| `orders_recalc_customer` | regra 27 — status do cliente derivado, preservando `bloqueado` |
| `customers_normalize` | regras 2, 3, 4 — telefone só dígitos, WhatsApp herdado, cidade padrão |
| `ledger_entries_validate` | regra 29 — categoria coerente com o tipo |
| `order_photos_cleanup_storage` | remove o binário quando a linha sai |
| `guard_integration_config` | nenhum segredo no banco |

`balance` e `is_settled` são colunas **GENERATED** — impossível dessincronizar.

## 8. Storage

Bucket **privado** `order-photos`, 10 MB, MIME restrito a imagem. Leitura por URL assinada (1 h).

Convenção `<order_id>/<uuid>.<ext>`, garantida dos dois lados: constraint
`order_photos_path_scoped` na tabela e as policies do bucket.

> Os limites do bucket são aplicados por `ensure_order_photos_bucket()` em
> `scripts/bootstrap-users.sh`: as colunas `public`/`file_size_limit`/`allowed_mime_types` só
> existem depois que o storage-api migra o schema, o que acontece **após** o db-init.

## 9. Realtime

Assinado em toda tela que duas pessoas olham ao mesmo tempo — não só chat e notificação:

| Tela | Tabelas |
|---|---|
| Produção (Kanban) | `orders`, `order_photos` |
| Comandas (lista) | `orders`, `order_photos` |
| ComandaDetalhe | `orders`, `order_photos`, `order_payments`, `order_events` |
| Dashboard / sino | `orders`, `ledger_entries` |
| Etiquetas (fila) | `orders` |
| Financeiro | `ledger_entries`, `order_payments` |
| Clientes / Serviços / Configurações | `customers`, `services`, `app_settings` |

`REPLICA IDENTITY FULL` nas 9 tabelas: sem isso o payload de UPDATE/DELETE traz só a PK e o front
não sabe se a linha ainda passa no filtro.

O Realtime aplica a RLS de SELECT a cada mensagem — **verificado**: um usuário `production` recebe
eventos de `orders` e **nenhum** de `ledger_entries`.

Rajadas são agrupadas em 250 ms (`agrupar()` em [src/lib/realtime.ts](../src/lib/realtime.ts)):
marcar 30 etiquetas em lote dispararia 30 recargas.

## 10. Padrão de listagem

Contrato único em [src/lib/listing.ts](../src/lib/listing.ts), usado por todas as listas:

```ts
Consulta { pagina, tamanho, busca?, ordem? }
Pagina<T> { linhas, total, pagina, tamanho, paginas, temMais }
```

- 30 itens por página; filtro, ordenação e **contagem** no banco.
- Desempate obrigatório por coluna única — sem isso a mesma linha aparece em duas páginas.
- Busca com `%` e `_` escapados (um cliente chamado "50%" viraria curinga) e mínimo de 2 caracteres.
- Trocar filtro volta para a página 1.
- Totais de rodapé vêm de agregação própria, nunca da soma da página.

## 11. Tipos TypeScript

[src/types/database.ts](../src/types/database.ts) — 1 810 linhas geradas do schema real
(22 tabelas, 4 views, todas as RPCs).

```bash
npm run db:types     # regenere depois de QUALQUER migration
npm run typecheck    # veja o que quebrou
```

## 12. Seeds e reset

| Arquivo | Conteúdo |
|---|---|
| [`seeds/seed_prod.sql`](../supabase/seeds/seed_prod.sql) | papéis, módulos, matriz, domínio, equipe, configuração, integrações (desabilitadas), 1 admin. **Zero** dado de operação. Idempotente. |
| [`seeds/seed_demo.sql`](../supabase/seeds/seed_demo.sql) | 80 clientes, 35 serviços, 120 comandas, 285 fotos, 281 lançamentos, 5 logins. Determinístico (`setseed`). |
| [`seeds/reset_to_prod.sql`](../supabase/seeds/reset_to_prod.sql) | zera dados, **sem DDL** |
| [`scripts/reset-to-prod.sh`](../scripts/reset-to-prod.sh) | reset + re-seed + 9 verificações |

A demo cobre **todos** os alertas do dashboard: 14 atrasadas, 9 sem foto, 4 entregues sem pagar,
34 etiquetas pendentes, os 10 status.

```bash
npm run db:reset:prod     # pede confirmação ("ZERAR")
```

Verificado: 0 comandas/clientes/serviços/lançamentos/fotos/auditoria/logins-demo · papéis,
permissões, equipe e admin preservados · numeração de volta em CF-0001.

## 13. Setup Docker

[docker-compose.yml](../docker-compose.yml) — db, auth, rest, realtime, storage, meta, studio, kong.

```bash
npm run keys      # gera .env com todos os segredos
npm run db:up     # sobe o stack (migrations + seeds na primeira vez)
npm run db:bootstrap
npm run dev
```

### As cinco pegadinhas do self-hosted (todas encontradas na prática)

| # | Sintoma | Causa | Onde está travado |
|---|---|---|---|
| 1 | Realtime conecta e não entrega nada, sem erro | `REALTIME_ENC_KEY` ≠ 16 caracteres (AES-128) | `scripts/gen-keys.mjs` valida o tamanho |
| 2 | idem | container com nome diferente de `realtime-dev.supabase-realtime` (o tenant vem do subdomínio) | compose + `docker/kong.yml` |
| 3 | idem | Postgres sem `wal_level=logical` | `command:` do serviço `db` |
| 4 | Realtime em loop, stack trace de Elixir | schema `_realtime` não existe (o container não o cria) | `zz-chaveiro-bootstrap.sh` |
| 5 | auth/rest/storage em loop com `password authentication failed`, mas o Postgres "saudável" | a imagem cria as roles de serviço **sem senha** | `zz-chaveiro-bootstrap.sh` |

E mais três descobertas próprias deste projeto:

| Sintoma | Causa |
|---|---|
| `schema "extensions" does not exist`, banco sem roles | montar volume sobre `/docker-entrypoint-initdb.d/migrations` apaga as migrations da imagem — nossos arquivos vão para `/chaveiro/` |
| idem, com o bootstrap rodando primeiro | o entrypoint ordena por ASCII, e dígito vem antes de letra: `99-` roda **antes** de `migrate.sh`. Daí o prefixo `zz-` |
| Kong: `mapping values are not allowed in this context` numa linha de comentário | o truque `eval "echo \"$(cat kong.yml)\""` remove as aspas dos valores. Substituição por `sed` |
| `must be owner of function` na segunda migration | `supautils` reatribui a posse para `supabase_admin`, e `postgres` não é membro. Migrations conectam como `supabase_admin` |

Endpoints: API `http://localhost:8000` · Studio `http://localhost:8000/` (basic auth) ·
Postgres `127.0.0.1:54322`.
