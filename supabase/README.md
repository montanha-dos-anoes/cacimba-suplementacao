# supabase/

Espelho versionado dos scripts SQL. **SQL puro, sem cabeçalho** — a versão comentada, com "o que faz / por que / rollback / onde rodar", fica em `docs/scripts/new-scripts/` (fora deste repo) e é a que o cliente executa.

Os dois arquivos de cada par têm o mesmo corpo executável. Se divergirem, `docs/scripts/new-scripts/` é a fonte de verdade — este diretório é regerado a partir dela removendo só o bloco de comentário do topo.

## Mapa de numeração

As mensagens `PARE:` dentro dos scripts citam a numeração de `new-scripts/`, não a daqui. Use esta tabela para traduzir.

| aqui | `docs/scripts/new-scripts/` | o que faz |
|---|---|---|
| `rename-legadas.sql` | `02-rename-legadas-suplementacao.sql` | renomeia as 4 tabelas legadas para `suplementacao_*` e recria as 9 funções |
| `00-schema.sql` | `04-schema-insumos-formulas-producao.sql` | cria insumos, fórmulas, produções, movimentos |
| `01-rls.sql` | `05-rls-insumos-formulas-producao.sql` | RLS das tabelas criadas pelo 00 |
| `02-feeding-stock.sql` | `10-feeding-stock.sql` | gatilho de trato → baixa no estoque |
| `03-schema-alt-unit.sql` | `12-schema-alt-unit-insumos.sql` | unidade alternativa no insumo |
| `04-unificar-estoque.sql` | `13-unificar-estoque.sql` | funde insumo e produto num catálogo só |
| `05-unidades-e-saldo-negativo.sql` | `14-unidades-e-saldo-negativo.sql` | unidade de exibição; saldo negativo com confirmação |
| `06-unidade-padrao-de-exibicao.sql` | `15-unidade-padrao-de-exibicao.sql` | `display_unit_primary` |
| `07-gatilho-trato-estoque.sql` | `16-gatilho-trato-estoque.sql` | recria o gatilho de trato + backfill |
| `08-trava-razao-estoque.sql` | `19-trava-razao-estoque.sql` | razão append-only + RPC de correção de custo |
| `09-lock-concorrencia.sql` | `20-lock-concorrencia.sql` | `pg_advisory_xact_lock` nas 4 RPCs de saldo |
| `10-rpc-salvar-formula.sql` | `22-rpc-salvar-formula.sql` | salvar fórmula numa transação só |
| `11-rls-legadas.sql` | `23-rls-legadas.sql` | RLS das 4 tabelas legadas (13 policies) |
| `12-corrigir-trato-e-limpeza.sql` | `24-corrigir-trato-e-limpeza.sql` | correção de trato e limpeza |
| `13-lotes-versionados.sql` | `25-lotes-versionados.sql` | lote com composição versionada; produto da categoria vira FK do estoque |
| `14-trato-zero.sql` | — | trato de 0 kg deixa de gerar movimento de estoque (era recusado pelo check `quantity_kg <> 0`) |
| `15-corrigir-custo-fabricacao.sql` | `26-corrigir-custo-fabricacao.sql` | sincroniza o custo unitário da fabricação e corrige movimentos existentes |
| — | `17-preflight-prod.sql` | diagnóstico, só leitura |
| — | `18-limpar-dados-teste.sql` | operacional, não faz parte do schema |
| — | `21-dump-rls-legadas.sql` | diagnóstico, só leitura |

`database-functions/<nome>/function.sql` são cópias por função das RPCs, para leitura. O corpo autoritativo é o da migração que a criou por último (`05-…` e `09-…`).

## Ordem de execução num banco vazio

```
rename-legadas → 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15
```

Cada script começa com um bloco `do $$` que verifica o estado do banco e aborta com `PARE: …` se a ordem estiver errada, **antes** de tocar em qualquer coisa. Todos rodam dentro de `begin; … commit;` — falha no meio não deixa estado parcial.

## RLS das tabelas legadas

Resolvido em 14/09/2026: `11-rls-legadas.sql` traz as 13 policies de `suplementacao_profiles`, `suplementacao_lots`, `suplementacao_products` e `suplementacao_feeding_records`, transcritas do dump do **DEV**.

⚠️ Foi montado a partir do DEV. O PROD ainda não tinha passado pelo rename quando o dump foi coletado, então os dois bancos **nunca foram comparados**. Em PROD: rode o rename (ele leva as policies junto), rode `21-dump-rls-legadas.sql` de novo, compare com este arquivo, e só então decida se precisa aplicar o `11`.

## Edge Function `admin-users`

`edge-functions/admin-users/index.ts` é a função que a tela **Sistema → Usuários e acessos** chama para criar usuário, ativar/desativar e trocar perfil. Ela roda no Supabase (não no navegador) porque precisa da `service_role`, que nunca pode ir para o front.

**Sintoma de que ela não está publicada:** "Cadastrar usuário" falha com erro de `fetch`. O preflight `OPTIONS` bate num endpoint que não existe, volta 404 sem cabeçalho de CORS, e o navegador derruba a chamada antes de qualquer resposta chegar ao app. O DEV foi clonado do PROD por dump de banco — **dump de banco não leva Edge Function junto**, então o DEV fica sem ela até alguém publicar.

### Publicar

Pelo painel: **Edge Functions → Deploy a new function → Via Editor**, nome `admin-users`, cole o conteúdo de `edge-functions/admin-users/index.ts` e publique.

Pela CLI:

```
supabase functions deploy admin-users --project-ref <ref-do-projeto>
```

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já vêm prontas no ambiente da função; não precisa cadastrar segredo.

### Contrato

| `action` | corpo | quem pode |
|---|---|---|
| `create` | `full_name`, `login_name`, `password` (PIN), `role` | só `owner` |
| `reset_password` | `user_id`, `password` (PIN provisório) | só `owner` |
| `toggle` | `user_id` | só `owner` |
| `role` | `user_id`, `role` | só `owner` |
| `delete` | `user_id` | só `owner` (soft delete + ban + e-mail `@cacimba.invalid`) |
| `change_password` | `password` (PIN novo) | o próprio usuário, menos `owner` |

O login sem `@` vira `<login>@cacimba.local`, igual ao `loginEmail()` do front (a função ainda corta em 40 caracteres; o front não — login com mais de 40 chars gera e-mails diferentes dos dois lados). `protected_owner` não é desativado, rebaixado, excluído nem tem senha redefinida por aqui.

A função **não insere** a linha de perfil. `auth.admin.createUser` grava em `auth.users`, o gatilho `handle_new_auth_user` insere em `suplementacao_profiles`, e só aí a função faz `update` para gravar `login_name`, `role` e `must_change_password`.

### ⚠️ A senha gravada não é o PIN

```ts
const pinPassword=(pin:string)=>`Cc${pin}`
```

O PIN `1234` vira a senha `Cc1234` no `auth.users`. Isso existe porque o Supabase Auth exige senha de 6 caracteres e a função aceita PIN de 4 — tirar o prefixo quebra a criação de qualquer PIN de 4 ou 5 dígitos.

Consequência: **o front tem que aplicar o mesmo prefixo no login**, senão dá `invalid_credentials` com a senha certa. Mas o Proprietário nasceu por `firstOwner()` → `signUp` com senha crua, **sem** prefixo — por isso a própria função recusa `change_password` para `owner`. Os dois formatos convivem e o front não sabe o perfil antes de autenticar, então `signIn()` em `src/auth.js` tenta os dois: prefixado primeiro quando o campo é um login, cru primeiro quando é um e-mail. Mexer num lado sem o outro tranca gente pra fora.

`must_change_password` é gravado como `true` em `create` e `reset_password`. O `boot()` em `src/auth.js` lê a coluna e desvia para `#passwordView` antes de montar o app, e `submitNewPassword()` chama `change_password` — então quem é criado pelo Proprietário troca o PIN provisório na primeira entrada. O gate pula `owner` de propósito: a função recusa `change_password` para esse perfil, e barrar sem saída trancaria o Proprietário fora do sistema.

Ainda sem botão na tela: `reset_password` e `delete`. Quem esquece o PIN depende de alguém mexer direto no banco.

Este arquivo é a função que está publicada, com `profiles` já trocado por `suplementacao_profiles` (a versão original apontava para a tabela antiga e parava de funcionar depois do `rename-legadas.sql`). Mesmo assim, confira o que está no ar em PROD antes de sobrescrever.
