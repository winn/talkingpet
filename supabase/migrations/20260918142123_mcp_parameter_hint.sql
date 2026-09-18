-- Plain-language note of what the model should send when it calls the tool.
alter table public.mcp_servers
  add column if not exists parameter_hint text not null default '';
