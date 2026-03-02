import type { D1Database } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  API_TOKEN: string;
}

interface MessagePayload {
  text: string | null;
  sender: string | null;
  chat_identifier: string | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  const auth = request.headers.get("Authorization") ?? "";
  return auth === `Bearer ${env.API_TOKEN}`;
}

// ── /messages ─────────────────────────────────────────────────────────────────

async function handlePost(request: Request, env: Env): Promise<Response> {
  let msg: MessagePayload;
  try {
    msg = (await request.json()) as MessagePayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const result = await env.DB.prepare(
    `INSERT INTO messages (text, sender, chat_identifier) VALUES (?, ?, ?)`
  )
    .bind(msg.text ?? null, msg.sender ?? null, msg.chat_identifier ?? null)
    .run();

  return json({ ok: true, id: result.meta.last_row_id });
}

async function handleGet(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
  const before = url.searchParams.get("before");
  const sender = url.searchParams.get("sender");

  let query = "SELECT * FROM messages";
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (before) { conditions.push("received_at < ?"); bindings.push(parseInt(before)); }
  if (sender) { conditions.push("sender = ?"); bindings.push(sender); }

  if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
  query += " ORDER BY received_at DESC LIMIT ?";
  bindings.push(limit);

  const { results } = await env.DB.prepare(query).bind(...bindings).all();
  return json({ messages: results });
}

// ── MCP /mcp ──────────────────────────────────────────────────────────────────

const MCP_TOOL = {
  name: "get_messages",
  description: "Get the most recent iMessages received on the paired iPhone.",
  inputSchema: {
    type: "object",
    properties: {
      count: {
        type: "integer",
        description: "Number of messages to return (default 1, max 50)",
        default: 1,
      },
    },
  },
};

function rpcResult(id: unknown, result: unknown): Response {
  return json({ jsonrpc: "2.0", id, result });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return json({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  let body: { jsonrpc: string; id?: unknown; method: string; params?: unknown };
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const { id, method, params } = body;

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "imsg-forwarder", version: "1.0.0" },
      });

    case "notifications/initialized":
      return new Response(null, { status: 202 });

    case "tools/list":
      return rpcResult(id, { tools: [MCP_TOOL] });

    case "tools/call": {
      const { name, arguments: args } = params as { name: string; arguments: Record<string, unknown> };
      if (name !== "get_messages") {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      const count = Math.min(Math.max(parseInt(String(args?.count ?? 1)), 1), 50);
      const { results } = await env.DB.prepare(
        "SELECT * FROM messages ORDER BY received_at DESC LIMIT ?"
      ).bind(count).all();

      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      });
    }

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ── router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isAuthorized(request, env)) return unauthorized();

    const { method } = request;
    const path = new URL(request.url).pathname;

    if (path === "/messages") {
      if (method === "POST") return handlePost(request, env);
      if (method === "GET")  return handleGet(request, env);
    }

    if (path === "/mcp" && method === "POST") return handleMcp(request, env);

    return new Response("Not Found", { status: 404 });
  },
};
