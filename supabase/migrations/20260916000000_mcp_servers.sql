-- MCP servers a Talking Momo account wants its pets' Botnoi agents to use.
-- Rows are synced to Botnoi via POST /platform-config/tools (tool_type = mcp).
-- Writes go through server API routes (service role) so auth_value stays secret.
create table if not exists public.mcp_servers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  url text not null,
  auth_header text,
  auth_value text,
  botnoi_tool_id text,
  botnoi_tool_name text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists mcp_servers_user_id_idx on public.mcp_servers (user_id);

alter table public.mcp_servers enable row level security;

drop policy if exists "owner reads mcp servers" on public.mcp_servers;
create policy "owner reads mcp servers"
  on public.mcp_servers for select
  to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.mcp_servers from authenticated, anon;
grant select on public.mcp_servers to authenticated;
