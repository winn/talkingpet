/** Helpers for Talking Momo MCP rows synced to Botnoi tools. */
export async function activeToolNamesForUser(admin, userId) {
  if (!admin || !userId) return [];
  const { data } = await admin
    .from("mcp_servers")
    .select("botnoi_tool_name, status")
    .eq("user_id", userId)
    .eq("status", "active");
  return (data || []).map((row) => row.botnoi_tool_name).filter(Boolean);
}
