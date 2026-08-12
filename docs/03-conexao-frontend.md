# Etapa 3 — Conexão do Frontend

O front não fala mais com mock nenhum. Arquivos removidos do projeto:

| Removido | Substituído por |
|---|---|
| `src/data/seed.ts` (571 linhas de dataset fictício) | `supabase/seeds/seed_demo.sql` |
| `src/store/useApp.ts` (444 linhas de store em memória) | `src/store/useSessao.ts` + `src/lib/api/*` |
| `src/lib/metricas.ts` (360 linhas de cálculo no cliente) | 10 RPCs de agregação |
| `useCarregando(420)` (latência falsa) | `useAsync` / `useLista` com estado real |
| `PERFIS`, `RESPONSAVEIS`, `CATEGORIAS`, `STATUS`, … em `constants.ts` | tabelas de domínio via `useDominioMaps()` |

Confirmado: `find src -iname "*mock*" -o -iname "*fixture*" -o -iname "seed*"` → vazio.
`npm run typecheck` e `npm run build` passam.

---

## 1. Camadas

```
telas (src/pages, src/components)
   │  useAsync / useLista / useAcao          ← src/lib/hooks.ts
   ▼
acesso a dados (src/lib/api/*.ts)
   │  mappers banco→front                   ← src/lib/mappers.ts
   ▼
client do Supabase (src/lib/supabase.ts)
   │
   ▼
Kong → PostgREST / GoTrue / Realtime / Storage
```

Nenhuma tela conhece nome de coluna do banco: a tradução inglês/snake_case → português fica toda em
`mappers.ts`.

| Módulo | Responsabilidade |
|---|---|
| `api/dominio.ts` | catálogo de domínio (1 carga por sessão) |
| `api/sessao.ts` | login, perfil, permissões, configuração, integrações |
| `api/clientes.ts` | CRUD + busca de balcão + listagem paginada |
| `api/servicos.ts` | catálogo + duplicar + arquivar |
| `api/comandas.ts` | listagem, detalhe, RPCs de escrita |
| `api/financeiro.ts` | lançamentos + totais agregados |
| `api/relatorios.ts` | KPIs, alertas e séries |
| `api/fotos.ts` | upload no bucket privado + URLs assinadas |
| `api/integracoes.ts` | administração + adapters |

## 2. Estados de UI

Com mock, nenhuma tela falhava. Contra o banco real toda leitura pode falhar — rede caiu, RLS negou,
sessão expirou — e o operador precisa ver o motivo, não uma tela em branco.

Todo hook devolve o mesmo trio: `carregando`, `erro`, `recarregar`.

| Estado | Componente | Comportamento |
|---|---|---|
| carregando | `SkelCards` / `SkelLinhas` | esqueleto só na **primeira** carga; recarga mantém o conteúdo com opacidade |
| erro | `<Erro>` | mensagem em português + "Tentar novamente" |
| vazio | `<Vazio>` | distingue "nada cadastrado" de "nada encontrado com esse filtro" — textos e ações diferentes |
| enviando | `useAcao` | botão desabilitado; dois cliques em "Confirmar pagamento" não criam dois pagamentos |
| sem permissão | — | o botão não aparece (lê a mesma `role_modules` da RLS) |

Erros do Postgres viram frase útil (`mensagemErro`): `42501` → "Você não tem permissão para esta
ação"; as RPCs já devolvem mensagem de negócio em português ("Comanda 1325 está finalizada e não
pode mudar de status").

Um caso mereceu tratamento próprio: os KPIs financeiros vêm `NULL` para quem não tem o módulo, e a
tela **esconde** o indicador. Antes mostrava "Recebido hoje: R$ 0,00" — zero é uma afirmação
("não entrou nada"), não uma ausência.

## 3. Ordem de implementação seguida

1. **Auth** — `supabase.ts`, `api/sessao.ts`, `Login.tsx`. O login antigo aceitava qualquer e-mail e
   deixava o usuário **escolher o próprio papel** numa grade de botões.
2. **Perfis e permissões** — `useSessao`, `usePodeVer/usePodeEditar`, guard de `App.tsx`, NAV do
   `Layout` vindo de `modules` ∩ `role_modules`.
3. **Domínio** — `useDominioMaps()`, no lugar dos mapas constantes.
4. **Módulos core, em ordem de dependência** — clientes → serviços → comandas (+ fotos, pagamentos,
   histórico) → produção → etiquetas → financeiro → dashboard/relatórios.
5. **Automações** — triggers e RPCs no banco; Realtime nas telas compartilhadas.
6. **Integrações — por último.** Só depois de todos os módulos prontos dava para saber quais APIs
   externas o sistema precisa. A lista veio dos pontos "(simulado)" do front, não de suposição.

## 4. Como testar cada papel

Suba o ambiente:

```bash
npm run keys          # gera .env (guarde a senha do admin que ele imprime)
npm run db:up         # migrations + seeds na primeira subida
npm run db:bootstrap  # cria os logins
npm run dev
```

Logins de demonstração — senha **`demo1234`** em todos:

| E-mail | Papel | Deve ver | **Não** deve ver |
|---|---|---|---|
| `wallace@demo.chaveiroformiga.com.br` | Responsável | os 10 módulos | — |
| `camila@demo.chaveiroformiga.com.br` | Atendimento | Dashboard, Atendimento, Clientes, Comandas, Produção, Etiquetas | Serviços, **Financeiro**, Relatórios, Configurações |
| `diego@demo.chaveiroformiga.com.br` | Produção | Dashboard, Comandas, Produção, Serviços, Etiquetas | Atendimento, Clientes, **Financeiro**, Relatórios, Configurações |
| `sandra@demo.chaveiroformiga.com.br` | Financeiro | Dashboard, Clientes, Comandas, Financeiro, Relatórios | Atendimento, Produção, Serviços, Etiquetas, Configurações |
| `consulta@demo.chaveiroformiga.com.br` | Consulta | Dashboard, Comandas, Produção, Relatórios (**só leitura**) | tudo mais; **nenhum** botão de ação |

### Roteiro por papel

**Camila (atendimento)**
1. Menu tem 6 itens; Financeiro e Configurações ausentes.
2. Atendimento → "Novo atendimento": 8 etapas, cadastre um cliente novo na etapa 1, anexe uma foto
   (upload real), confirme. Deve abrir a comanda com o preview de impressão.
3. Na comanda: "Alterar status" e "Anexar foto" aparecem; **"Registrar pagamento" também** (o balcão
   recebe a entrada).
4. Digite `/financeiro` na barra de endereço → redireciona para o dashboard.
5. Dashboard: o indicador "Recebido hoje" **não aparece** (sem acesso ao financeiro).

**Diego (produção)**
1. Produção → arraste um card entre colunas. O toast confirma e o histórico registra "Diego".
2. Abra a mesma comanda em outra aba com outro papel: o card se move **sem recarregar**.
3. Comandas → o botão "Nova comanda" some (produção não abre comanda).
4. Serviços → aparece e permite editar (produção mantém o catálogo).

**Sandra (financeiro)**
1. Financeiro → gráficos com dados, rodapé com totais do período (agregados, não da página).
2. "Registrar pagamento" → escolha uma comanda com saldo, tente pagar mais que o saldo: o valor é
   **limitado ao saldo** e o recibo mostra "Quitado".
3. Na comanda, "Alterar status" **não aparece** (ver ambiguidade A3).
4. Lançamentos gerados pela comanda têm um **cadeado** em vez da lixeira — quem zera o valor é o
   cancelamento da comanda.

**Visitante (consulta)**
1. Menu com 4 itens; o botão "Criar" do topo **não existe**.
2. Produção → os cards **não arrastam**; o drawer mostra "Seu perfil acompanha a produção, mas não
   altera comandas".
3. Comanda → nenhum botão de ação, só leitura.

**Wallace (responsável)**
1. Configurações → 7 abas. Empresa, Comandas e Etiquetas salvam e refletem na impressão.
2. Configurações → Integrações (última aba): tente ativar sem informar o nome da variável do segredo
   → o botão fica desabilitado. Cole `{"api_key":"x"}` na config → o banco **recusa**.
3. Ative "WhatsApp — avisar cliente" com `WHATSAPP_API_TOKEN` → o botão "Avisar cliente" nas outras
   telas muda de "não configurado" para ação.

### Teste do Realtime

Com a Produção aberta no navegador, escreva **direto no banco**:

```bash
docker compose exec db psql -U supabase_admin -d postgres -c \
  "UPDATE public.orders SET status_key='pronta' WHERE number=1250;"
```

O card deve trocar de coluna sem recarregar a página.

### Teste do reset para produção

```bash
npm run db:reset:prod    # digite ZERAR
```

Depois: entre com o **admin real** (`wallace@chaveiroformiga.com.br`), confirme que todas as telas
mostram estado vazio com a mensagem certa, e cadastre o primeiro cliente, serviço, comanda e
lançamento. A primeira comanda deve ser **CF-0001**.

## 5. O que foi verificado nesta sessão, e como

| Item | Como | Resultado |
|---|---|---|
| Migrations em banco limpo | 19 arquivos via `docker compose down -v` + `up` | ✅ 19/19 |
| Seeds | prod (idempotente, 2×) + demo | ✅ |
| RLS por papel | login HTTP real + contagem por tabela | ✅ tabela na [§2 do backend](02-backend.md) |
| Regras de negócio | `create_order`, pagamento acima do saldo, trava de status final, `delivered_at`, baixa de pendência | ✅ |
| Negativas de permissão | viewer criando comanda, finance mudando status | ✅ recusadas com mensagem em português |
| Guarda antissegredo | `{"api_key": "..."}` e ativar sem `secret_ref` | ✅ recusados |
| Realtime | escrita direta no banco → cliente assinado | ✅ evento entregue; `ledger_entries` **não** vazou para `production` |
| Reset para produção | script completo + 9 verificações | ✅ |
| App sobre banco zerado | login, telas vazias, primeiro registro de cada módulo | ✅ comanda CF-0001 |
| Rebuild do zero | `down -v` + `up` sem intervenção | ✅ |
| Typecheck + build | `tsc -b` e `vite build` sem mock no projeto | ✅ |
| `.env` fora do git | `git check-ignore -v .env` | ✅ ignorado; `.env.example` versionável |

**Falta a validação visual no navegador, tela a tela, com um usuário de cada papel** (critério 2 da
definição de pronto). Esta sessão não tem ferramenta de navegador; tudo acima foi verificado na
camada de API/RLS/Realtime, que é onde os erros de configuração aparecem — mas layout, menu e
redirecionamento precisam do olho humano. Use os roteiros da §4 acima.
