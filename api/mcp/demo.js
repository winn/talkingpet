import { handleRpc } from "../../server/mcp-demo.js";

/**
 * Public demo MCP server (Streamable HTTP, no auth) for testing pet tools.
 *
 * POST /api/mcp/demo — JSON-RPC: initialize, tools/list, tools/call
 * Tools: get_weather, roll_dice, get_secret_word
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, authorization, mcp-session-id, mcp-protocol-version",
};

export async function POST(request) {
  let body;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m) => handleRpc(m)))).filter(Boolean);
    return responses.length ? reply(responses) : accepted();
  }
  const response = await handleRpc(body);
  return response ? reply(response) : accepted();
}

// No server-initiated stream; the spec allows 405 here.
export function GET() {
  return new Response("Use POST for MCP JSON-RPC.", {
    status: 405,
    headers: { allow: "POST, OPTIONS", ...CORS },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
    },
  });
}

function accepted() {
  return new Response(null, { status: 202, headers: CORS });
}
