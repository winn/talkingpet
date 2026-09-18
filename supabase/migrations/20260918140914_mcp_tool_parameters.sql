-- Parameters the language model fills in when it calls an MCP tool.
alter table public.mcp_servers
  add column if not exists parameters jsonb not null
  default '{"type":"object","properties":{},"required":[]}'::jsonb;
