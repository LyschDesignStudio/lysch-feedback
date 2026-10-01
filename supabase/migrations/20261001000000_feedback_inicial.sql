-- =====================================================================
-- Migração inicial: banco completo da ferramenta de feedback (estado de 01/10/2026).
-- Aplicada sozinha pela integração GitHub do Supabase (ou rode uma vez no SQL Editor de um projeto vazio).
-- Gerado a partir do banco em produção (pxmwnesytlwtdxcalmux): substitui as
-- migrações 001–020. O NOVO_REF (função fb_notify_slack) é trocado pelo
-- scripts/configurar.mjs; não aplique antes de configurar.
-- =====================================================================

-- Trava: só aplica depois do scripts/configurar.mjs (que troca o endereço abaixo pelo do projeto)
do $$ begin
  if 'https://NOVO_REF.supabase.co/functions' like '%NOVO\_REF%' then
    raise exception 'Rode  node scripts/configurar.mjs <ref> <chave publicável>  e faça push antes de aplicar esta migração';
  end if;
end $$;

create extension if not exists pgcrypto;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table if not exists public.fb_studios (
  id text not null,
  name text not null,
  allowed_domains text[] default array['*.webflow.io'::text, '*.framer.app'::text, '*.framer.website'::text] not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  panel_key_hash text
);

create table if not exists public.fb_projects (
  id text not null,
  name text not null,
  domains text[] default '{}'::text[] not null,
  review_tokens text[] default '{}'::text[] not null,
  paused boolean default false not null,
  created_at timestamp with time zone default now() not null,
  studio_id text,
  slack_webhook text,
  slack_notify boolean default false not null,
  archived_at timestamp with time zone,
  agent_target jsonb
);

create table if not exists public.fb_reviewers (
  token text not null,
  project_id text not null,
  name text not null,
  org text,
  email text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  code_hash text,
  invite_sent_at timestamp with time zone,
  invite_error text,
  code_fails integer default 0 not null,
  code_locked_until timestamp with time zone,
  verified_at timestamp with time zone
);

create table if not exists public.fb_reviewer_passes (
  pass_hash text not null,
  token text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '30 days'::interval) not null,
  last_used_at timestamp with time zone
);

create table if not exists public.fb_rounds (
  id uuid default gen_random_uuid() not null,
  project_id text not null,
  number integer not null,
  status text default 'open'::text not null,
  started_at timestamp with time zone,
  closed_at timestamp with time zone,
  summary jsonb,
  name text
);

create table if not exists public.fb_comments (
  id uuid default gen_random_uuid() not null,
  project_id text not null,
  path text not null,
  text text not null,
  author text default 'Convidado'::text not null,
  status text default 'open'::text not null,
  anchor jsonb not null,
  viewport jsonb,
  device text,
  user_agent text,
  created_at timestamp with time zone default now() not null,
  author_email text,
  reviewer_token text,
  screenshot_url text,
  author_key_hash text,
  edited_at timestamp with time zone,
  notified_at timestamp with time zone,
  round_id uuid,
  ai_priority text,
  ai_rank integer,
  ai_reason text,
  ai_group text,
  ai_at timestamp with time zone,
  agent_status text,
  agent_note text,
  agent_at timestamp with time zone
);

create table if not exists public.fb_replies (
  id uuid default gen_random_uuid() not null,
  comment_id uuid not null,
  project_id text not null,
  text text not null,
  author text default 'Convidado'::text not null,
  author_email text,
  reviewer_token text,
  created_at timestamp with time zone default now() not null,
  author_key_hash text
);

create table if not exists public.fb_approvals (
  id uuid default gen_random_uuid() not null,
  project_id text not null,
  path text not null,
  author text default 'Convidado'::text not null,
  author_email text,
  reviewer_token text,
  author_key_hash text,
  created_at timestamp with time zone default now() not null,
  notified_at timestamp with time zone
);

create table if not exists public.fb_sessions (
  id text not null,
  project_id text not null,
  via text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '7 days'::interval) not null,
  reviewer_token text
);

create table if not exists public.fb_panel_sessions (
  id text not null,
  studio_id text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '30 days'::interval) not null
);

create table if not exists public.fb_suggestions (
  id uuid default gen_random_uuid() not null,
  studio_id text not null,
  kind text default 'melhoria'::text not null,
  text text not null,
  author text,
  context jsonb,
  status text default 'recebida'::text not null,
  reply text,
  priority text,
  internal_note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.fb_assets (
  name text not null,
  content text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.fb_admin (
  id integer default 1 not null,
  upload_key_hash text not null,
  admin_key_hash text,
  admin_fail_count integer default 0 not null,
  admin_fail_at timestamp with time zone
);

create table if not exists public.fb_admin_sessions (
  id text not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '14 days'::interval) not null
);

-- ---------------------------------------------------------------------
-- Chaves, regras e ligações
-- ---------------------------------------------------------------------
alter table public.fb_admin add constraint fb_admin_pkey PRIMARY KEY (id);
alter table public.fb_admin_sessions add constraint fb_admin_sessions_pkey PRIMARY KEY (id);
alter table public.fb_approvals add constraint fb_approvals_pkey PRIMARY KEY (id);
alter table public.fb_assets add constraint fb_assets_pkey PRIMARY KEY (name);
alter table public.fb_comments add constraint fb_comments_pkey PRIMARY KEY (id);
alter table public.fb_panel_sessions add constraint fb_panel_sessions_pkey PRIMARY KEY (id);
alter table public.fb_projects add constraint fb_projects_pkey PRIMARY KEY (id);
alter table public.fb_replies add constraint fb_replies_pkey PRIMARY KEY (id);
alter table public.fb_reviewer_passes add constraint fb_reviewer_passes_pkey PRIMARY KEY (pass_hash);
alter table public.fb_reviewers add constraint fb_reviewers_pkey PRIMARY KEY (token);
alter table public.fb_rounds add constraint fb_rounds_pkey PRIMARY KEY (id);
alter table public.fb_sessions add constraint fb_sessions_pkey PRIMARY KEY (id);
alter table public.fb_studios add constraint fb_studios_pkey PRIMARY KEY (id);
alter table public.fb_suggestions add constraint fb_suggestions_pkey PRIMARY KEY (id);
alter table public.fb_rounds add constraint fb_rounds_project_id_number_key UNIQUE (project_id, number);

alter table public.fb_admin add constraint fb_admin_id_check CHECK ((id = 1));
alter table public.fb_approvals add constraint fb_approvals_path_check CHECK (((char_length(path) >= 1) AND (char_length(path) <= 500)));
alter table public.fb_comments add constraint fb_comments_agent_status_check CHECK ((agent_status = ANY (ARRAY['queued'::text, 'review'::text, 'blocked'::text])));
alter table public.fb_comments add constraint fb_comments_ai_priority_check CHECK ((ai_priority = ANY (ARRAY['alta'::text, 'media'::text, 'baixa'::text])));
alter table public.fb_comments add constraint fb_comments_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])));
alter table public.fb_comments add constraint fb_comments_text_check CHECK (((char_length(text) >= 1) AND (char_length(text) <= 5000)));
alter table public.fb_replies add constraint fb_replies_text_check CHECK (((char_length(text) >= 1) AND (char_length(text) <= 5000)));
alter table public.fb_rounds add constraint fb_rounds_name_check CHECK (((name IS NULL) OR (char_length(name) <= 60)));
alter table public.fb_rounds add constraint fb_rounds_status_check CHECK ((status = ANY (ARRAY['open'::text, 'pending'::text, 'closed'::text])));
alter table public.fb_suggestions add constraint fb_suggestions_author_check CHECK (((author IS NULL) OR (char_length(author) <= 80)));
alter table public.fb_suggestions add constraint fb_suggestions_kind_check CHECK ((kind = ANY (ARRAY['melhoria'::text, 'problema'::text, 'ideia'::text])));
alter table public.fb_suggestions add constraint fb_suggestions_priority_check CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['alta'::text, 'media'::text, 'baixa'::text]))));
alter table public.fb_suggestions add constraint fb_suggestions_reply_check CHECK (((reply IS NULL) OR (char_length(reply) <= 1000)));
alter table public.fb_suggestions add constraint fb_suggestions_status_check CHECK ((status = ANY (ARRAY['recebida'::text, 'planejada'::text, 'em_andamento'::text, 'feita'::text, 'nao_vamos_fazer'::text])));
alter table public.fb_suggestions add constraint fb_suggestions_text_check CHECK (((char_length(text) >= 3) AND (char_length(text) <= 2000)));

alter table public.fb_approvals add constraint fb_approvals_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.fb_projects(id) ON DELETE CASCADE;
alter table public.fb_approvals add constraint fb_approvals_reviewer_token_fkey FOREIGN KEY (reviewer_token) REFERENCES public.fb_reviewers(token) ON DELETE SET NULL;
alter table public.fb_comments add constraint fb_comments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.fb_projects(id) ON DELETE CASCADE;
alter table public.fb_comments add constraint fb_comments_reviewer_token_fkey FOREIGN KEY (reviewer_token) REFERENCES public.fb_reviewers(token) ON DELETE SET NULL;
alter table public.fb_comments add constraint fb_comments_round_id_fkey FOREIGN KEY (round_id) REFERENCES public.fb_rounds(id) ON DELETE SET NULL;
alter table public.fb_panel_sessions add constraint fb_panel_sessions_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.fb_studios(id) ON DELETE CASCADE;
alter table public.fb_projects add constraint fb_projects_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.fb_studios(id) ON DELETE SET NULL;
alter table public.fb_replies add constraint fb_replies_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES public.fb_comments(id) ON DELETE CASCADE;
alter table public.fb_replies add constraint fb_replies_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.fb_projects(id) ON DELETE CASCADE;
alter table public.fb_replies add constraint fb_replies_reviewer_token_fkey FOREIGN KEY (reviewer_token) REFERENCES public.fb_reviewers(token) ON DELETE SET NULL;
alter table public.fb_reviewer_passes add constraint fb_reviewer_passes_token_fkey FOREIGN KEY (token) REFERENCES public.fb_reviewers(token) ON DELETE CASCADE;
alter table public.fb_reviewers add constraint fb_reviewers_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.fb_projects(id) ON DELETE CASCADE;
alter table public.fb_rounds add constraint fb_rounds_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.fb_projects(id) ON DELETE CASCADE;
alter table public.fb_sessions add constraint fb_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.fb_projects(id) ON DELETE CASCADE;
alter table public.fb_sessions add constraint fb_sessions_reviewer_token_fkey FOREIGN KEY (reviewer_token) REFERENCES public.fb_reviewers(token) ON DELETE SET NULL;
alter table public.fb_suggestions add constraint fb_suggestions_studio_id_fkey FOREIGN KEY (studio_id) REFERENCES public.fb_studios(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------
create index if not exists fb_sessions_project_idx on public.fb_sessions using btree (project_id);
create index if not exists fb_suggestions_studio_idx on public.fb_suggestions using btree (studio_id, created_at desc);
create index if not exists fb_suggestions_status_idx on public.fb_suggestions using btree (status, created_at desc);
create index if not exists fb_approvals_project_idx on public.fb_approvals using btree (project_id, path);
create index if not exists fb_comments_agent_idx on public.fb_comments using btree (agent_status) where (agent_status is not null);
create index if not exists fb_comments_project_path_idx on public.fb_comments using btree (project_id, path);
create index if not exists fb_comments_round_idx on public.fb_comments using btree (round_id);
create index if not exists fb_projects_studio_idx on public.fb_projects using btree (studio_id);
create index if not exists fb_reviewers_project_idx on public.fb_reviewers using btree (project_id);
create index if not exists fb_reviewer_passes_token on public.fb_reviewer_passes using btree (token);
create index if not exists fb_replies_comment_idx on public.fb_replies using btree (comment_id, created_at);

-- ---------------------------------------------------------------------
-- Segurança: RLS ligado em tudo e sem políticas (só as Edge Functions,
-- com service role, leem e gravam)
-- ---------------------------------------------------------------------
alter table public.fb_studios enable row level security;
alter table public.fb_projects enable row level security;
alter table public.fb_reviewers enable row level security;
alter table public.fb_reviewer_passes enable row level security;
alter table public.fb_rounds enable row level security;
alter table public.fb_comments enable row level security;
alter table public.fb_replies enable row level security;
alter table public.fb_approvals enable row level security;
alter table public.fb_sessions enable row level security;
alter table public.fb_panel_sessions enable row level security;
alter table public.fb_suggestions enable row level security;
alter table public.fb_assets enable row level security;
alter table public.fb_admin enable row level security;
alter table public.fb_admin_sessions enable row level security;

-- ---------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------

-- Rodada vigente (aberta ou aguardando); cria a Rodada 1 se não houver
create or replace function public.fb_current_round(p_project text) returns uuid
language plpgsql security definer set search_path = public as $$
declare r uuid; n int;
begin
  select id into r from fb_rounds where project_id = p_project and status in ('open', 'pending') order by number desc limit 1;
  if r is not null then return r; end if;
  select coalesce(max(number), 0) + 1 into n from fb_rounds where project_id = p_project;
  insert into fb_rounds (project_id, number, status, started_at) values (p_project, n, 'open', now())
    on conflict (project_id, number) do nothing;
  select id into r from fb_rounds where project_id = p_project and status in ('open', 'pending') order by number desc limit 1;
  return r;
end; $$;

-- Fecha a rodada aberta; a próxima fica aguardando
create or replace function public.fb_close_round(p_project text, p_carry boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur fb_rounds; nxt uuid; t int; res int; op int;
begin
  select * into cur from fb_rounds where id = fb_current_round(p_project);
  if cur.status <> 'open' then raise exception 'not_open'; end if;
  select count(*), count(*) filter (where status = 'resolved'), count(*) filter (where status <> 'resolved')
    into t, res, op from fb_comments where round_id = cur.id;
  update fb_rounds set status = 'closed', closed_at = now(),
    summary = jsonb_build_object('total', t, 'resolved', res, 'open', op, 'carried', case when p_carry then op else 0 end)
    where id = cur.id;
  insert into fb_rounds (project_id, number, status, started_at) values (p_project, cur.number + 1, 'pending', null)
    returning id into nxt;
  if p_carry then update fb_comments set round_id = nxt where round_id = cur.id and status <> 'resolved'; end if;
  return jsonb_build_object('closed', cur.number, 'next', cur.number + 1,
    'total', t, 'resolved', res, 'open', op, 'carried', case when p_carry then op else 0 end);
end; $$;

-- Abre a rodada que está aguardando
create or replace function public.fb_open_round(p_project text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r fb_rounds;
begin
  update fb_rounds set status = 'open', started_at = now()
    where project_id = p_project and status = 'pending' returning * into r;
  if r.id is null then raise exception 'no_pending'; end if;
  return jsonb_build_object('opened', r.number);
end; $$;

-- Comentário novo entra na rodada vigente; reaberto volta para a rodada vigente
create or replace function public.fb_comments_round() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.round_id is null then new.round_id := fb_current_round(new.project_id); end if;
  elsif new.status = 'open' and old.status = 'resolved' then
    if exists (select 1 from fb_rounds where id = new.round_id and status = 'closed') or new.round_id is null then
      new.round_id := fb_current_round(new.project_id);
    end if;
  end if;
  return new;
end; $$;

-- Aviso automático no Slack: chama a função "painel" (rota /hook) pelo pg_net
-- (o endereço é ajustado pelo scripts/configurar.mjs)
create or replace function public.fb_notify_slack() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from fb_projects where id = new.project_id and slack_notify and slack_webhook is not null) then
    perform net.http_post(
      url := 'https://NOVO_REF.supabase.co/functions/v1/painel/hook',
      body := jsonb_build_object('kind', tg_argv[0], 'id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
  return null;
end; $$;

-- Tempo real: avisa o canal "fb-<projeto>" que algo mudou (sem conteúdo)
create or replace function public.fb_rt_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid text;
begin
  pid := coalesce(new.project_id, old.project_id);
  perform realtime.send(jsonb_build_object('t', tg_table_name, 'op', tg_op), 'changed', 'fb-' || pid, false);
  return null;
exception when others then
  return null;
end; $$;

create or replace function public.fb_suggestions_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- Publicação dos arquivos do site por chave (alternativa ao publicar.js com service role)
create or replace function public.fb_put_asset(p_name text, p_content text, p_key text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_name not in ('loader.js', 'overlay.js', 'modern-screenshot.js', 'painel.js', 'gate.js') then raise exception 'invalid_name'; end if;
  if not exists (select 1 from public.fb_admin
                 where upload_key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')) then
    raise exception 'unauthorized';
  end if;
  insert into public.fb_assets (name, content, updated_at) values (p_name, p_content, now())
  on conflict (name) do update set content = excluded.content, updated_at = now();
  return 'ok ' || length(p_content);
end; $$;

-- Acesso das Edge Functions (service role) às tabelas e funções
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant execute on function public.fb_current_round(text), public.fb_close_round(text, boolean), public.fb_open_round(text) to service_role;

revoke execute on function public.fb_current_round(text) from public, anon, authenticated;
revoke execute on function public.fb_close_round(text, boolean) from public, anon, authenticated;
revoke execute on function public.fb_open_round(text) from public, anon, authenticated;
revoke execute on function public.fb_comments_round() from public, anon, authenticated;
revoke execute on function public.fb_notify_slack() from public, anon, authenticated;
revoke execute on function public.fb_rt_notify() from public, anon, authenticated;
revoke execute on function public.fb_suggestions_touch() from public, anon, authenticated;
revoke all on function public.fb_put_asset(text, text, text) from public;
grant execute on function public.fb_put_asset(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Gatilhos
-- ---------------------------------------------------------------------
create trigger fb_comments_round before insert or update of status on public.fb_comments
  for each row execute function public.fb_comments_round();
create trigger fb_comments_slack after insert on public.fb_comments
  for each row execute function public.fb_notify_slack('comment');
create trigger fb_approvals_slack after insert on public.fb_approvals
  for each row execute function public.fb_notify_slack('approval');
create trigger fb_comments_rt_ins after insert or delete on public.fb_comments
  for each row execute function public.fb_rt_notify();
create trigger fb_comments_rt_upd after update of status, text, screenshot_url, round_id, edited_at, agent_status, agent_note on public.fb_comments
  for each row execute function public.fb_rt_notify();
create trigger fb_replies_rt after insert or delete on public.fb_replies
  for each row execute function public.fb_rt_notify();
create trigger fb_approvals_rt after insert or delete on public.fb_approvals
  for each row execute function public.fb_rt_notify();
create trigger fb_suggestions_touch before update on public.fb_suggestions
  for each row execute function public.fb_suggestions_touch();

-- ---------------------------------------------------------------------
-- Dados iniciais
-- ---------------------------------------------------------------------
-- Bucket público dos prints (só as funções gravam)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fb-shots', 'fb-shots', true, 2097152, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png'];

-- Linha de administração. A chave de publicação começa com um valor aleatório
-- (ninguém sabe): para usar fb_put_asset, grave o hash de uma chave sua.
-- A senha da área de sugestões (?painel=sugestoes) fica vazia até ser definida.
insert into public.fb_admin (id, upload_key_hash) values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;
