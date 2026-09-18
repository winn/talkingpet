-- MCP rows are written by the signed-in user through /api/mcp/servers.
-- The service role is optional; owner policies cover insert/update/delete.
grant insert, update, delete on public.mcp_servers to authenticated;

drop policy if exists "owner inserts mcp servers" on public.mcp_servers;
create policy "owner inserts mcp servers"
  on public.mcp_servers for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "owner updates mcp servers" on public.mcp_servers;
create policy "owner updates mcp servers"
  on public.mcp_servers for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "owner deletes mcp servers" on public.mcp_servers;
create policy "owner deletes mcp servers"
  on public.mcp_servers for delete
  to authenticated
  using (user_id = auth.uid());
