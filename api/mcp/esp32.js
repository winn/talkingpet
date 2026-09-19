import { handleRpc } from "../../server/esp32-mcp.js";

/**
 * POST /api/mcp/esp32
 * Streamable HTTP MCP server for the ESP32-S3 kit REST API.
 * The kit address is ESP32_BASE_URL, or the Cloudflare tunnel from the kit docs.
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
    const responses = (await Promise.all(body.map((message) => handleRpc(message)))).filter(Boolean);
    return responses.length ? reply(responses) : accepted();
  }
  const response = await handleRpc(body);
  return response ? reply(response) : accepted();
}

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
