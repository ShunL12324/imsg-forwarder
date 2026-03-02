# imsg-mcp

Forward iMessages to a Cloudflare Worker + D1 database via iOS Shortcuts, with an MCP server for AI access.

## Architecture

```
iPhone (incoming message)
  └── iOS Shortcut automation
        └── POST /messages  ──►  Cloudflare Worker
                                        └── D1 Database
                                              └── GET /messages
```

- **iOS Shortcut** — triggers on every incoming message, sends sender + text to the worker
- **Worker** — Cloudflare Worker (TypeScript), authenticated with a Bearer token, stores messages with a server-side timestamp
- **Database** — Cloudflare D1 (SQLite), queryable by sender or timestamp

## Requirements

- iPhone running iOS 17+
- Cloudflare account (free tier is sufficient)
- [Bun](https://bun.sh) ≥ 1.0

## Setup

```bash
git clone https://github.com/ShunL12324/imsg-mcp.git
cd imsg-forwarder
bun install
```

## Configuration

```bash
cp config.example.yaml config.yaml
```

Edit `config.yaml`:

```yaml
cloudflare:
  account_id: ""       # Cloudflare account ID (dash.cloudflare.com → right sidebar)
  api_token: ""        # API token with Workers:Edit + D1:Edit permissions
  worker_name: "imsg-forwarder"
  db_name: "imsg-forwarder"

api_token: ""          # Shared secret for Shortcut → worker auth (openssl rand -hex 32)
```

Config location: `config.yaml` in the repo root (next to `package.json`).

### Cloudflare API token

Create a token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with:

| Permission | Level |
|---|---|
| Workers Scripts — Edit | Account |
| D1 — Edit | Account |

## CLI usage

### Deploy

Provisions the Cloudflare Worker and D1 database.

```bash
bun run deploy
```

### Diagnostics

Checks config completeness, Cloudflare token validity, Workers/D1 permissions, and worker reachability.

```bash
bun run doctor
```

### Undeploy

Removes the Cloudflare Worker and D1 database.

```bash
bun run undeploy
```

## iOS Shortcut setup

### 1. Enable required permissions

Before creating the automation, enable these on your iPhone:

- **Settings → Shortcuts → Allow Access to Messages** → On
- **Settings → Shortcuts → Allow Notifications** → On
- **Settings → General → Background App Refresh** → On

### 2. Create the automation

1. Open the **Shortcuts** app → tap **Automation** (bottom tab)
2. Tap **+** → **New Automation** → scroll to **Message** under Communication
3. **Sender** — leave blank (any sender)
4. **Message Contains** — type a single space `" "` (required by iOS to enable Run Immediately)
5. Toggle **Run Immediately** → On (tap "Don't Ask" to confirm)
6. Tap **Next**

### 3. Add actions

Add the following actions in order:

**Action 1 — Send the message to your worker**

- Add **Get Contents of URL**
- URL: `https://<your-worker>.workers.dev/messages`
- Method: `POST`
- Headers: add one header
  - Key: `Authorization`
  - Value: `Bearer <your-api-token>`
- Request Body: `JSON`
  - Add three fields:
    | Key | Value |
    |---|---|
    | `text` | Shortcut Input → **Content** |
    | `sender` | Shortcut Input → **Sender** |
    | `chat_identifier` | Shortcut Input → **Sender** |

**Action 2 — Parse the response**

- Add **Get Dictionary from Input**
  - Input: result of the URL action

- Add **Get Dictionary Value**
  - Key: `ok`
  - Dictionary: result of previous action

**Action 3 — Show result**

- Add **If**
  - Condition: Dictionary Value `is` `true`
  - Add **Show Notification** inside If block:
    - Title: `✓ Message forwarded`
  - Add **Otherwise** block:
  - Add **Show Notification** inside Otherwise block:
    - Title: `✗ Forward failed`
    - Body: Contents of URL (the raw error response)

### 4. Save and test

Tap **Done**. Send yourself a message from another device — you should see a "✓ Message forwarded" notification and the message appear in your D1 database.

Verify with:

```bash
curl -H "Authorization: Bearer <api_token>" \
  https://<worker>.workers.dev/messages
```

## MCP setup

imsg-mcp exposes an MCP server at `/mcp` for use with Claude Code or any MCP-compatible client.

Copy the example and fill in your values:

```bash
cp .mcp.json.example .mcp.json
```

`.mcp.json`:

```json
{
  "mcpServers": {
    "imsg-mcp": {
      "type": "http",
      "url": "https://<your-worker>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-token>"
      }
    }
  }
}
```

`.mcp.json` is gitignored — it contains your credentials.

### Available tools

| Tool | Description |
|---|---|
| `get_messages(count?)` | Get the most recent iMessages (default 1, max 50) |

## Querying messages

```bash
# Fetch latest 50 messages
curl -H "Authorization: Bearer <api_token>" \
  https://<worker>.workers.dev/messages

# Filter by sender
curl -H "Authorization: Bearer <api_token>" \
  "https://<worker>.workers.dev/messages?sender=%2B15555550123"

# Paginate (before Unix timestamp)
curl -H "Authorization: Bearer <api_token>" \
  "https://<worker>.workers.dev/messages?before=1700000000&limit=100"
```

### Response schema

```json
{
  "messages": [
    {
      "id": 1,
      "text": "Hello",
      "sender": "+15555550123",
      "chat_identifier": "+15555550123",
      "received_at": 1700000000
    }
  ]
}
```

## Database schema

```sql
CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  text            TEXT,
  sender          TEXT,
  chat_identifier TEXT,
  received_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
```

## License

MIT
