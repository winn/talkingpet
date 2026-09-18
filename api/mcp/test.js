import { json, jsonError, readJson } from "../../server/http.js";
import { userFromRequest } from "../../server/supabase.js";
import { normalizeParameters } from "../../server/mcp.js";
import { runMcpTest } from "../../server/mcp-test.js";

/**
 * POST /api/mcp/test
 * Body: { url, description, parameters, sample, authHeader, authValue }
 * Tries the MCP server from the form, without saving it.
 */
export async function POST(request) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("sign_in", "Sign in first.", 401);

  const body = await readJson(request);
  const url = String(body.url || "").trim();
  if (!url) return jsonError("bad_request", "url is required.", 400);
  let parameters = { type: "object", properties: {}, required: [] };
  try {
    if (body.parameters) parameters = normalizeParameters(body.parameters);
  } catch (err) {
    return jsonError("bad_parameters", err instanceof Error ? err.message : "Parameters must be JSON.", 400);
  }
  const sample = {};
  if (body.sample && typeof body.sample === "object" && !Array.isArray(body.sample)) {
    for (const [key, value] of Object.entries(body.sample).slice(0, 20)) {
      sample[String(key).slice(0, 40)] = String(value ?? "").slice(0, 200);
    }
  }
  try {
    const result = await runMcpTest({
      url,
      description: String(body.description || "").slice(0, 500),
      parameters,
      sample,
      authHeader: String(body.authHeader || body.auth_header || "").slice(0, 80),
      authValue: String(body.authValue || body.auth_value || "").slice(0, 2000),
    });
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach the MCP server.";
    console.warn("[mcp-test]", message);
    return jsonError("mcp_test", message, 502);
  }
}
