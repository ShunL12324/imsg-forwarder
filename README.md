# imsg-forwarder

Forward iMessages to a Cloudflare Worker + D1 database in real time using iOS Shortcuts.

An iOS Shortcut automation fires on every incoming message and POSTs it to a self-hosted Cloudflare Worker, where it is stored in a D1 (SQLite) database queryable over HTTP.

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
- [Bun](https://bun.sh) ≥ 1.0 (for building the management CLI from source)

## Installation

### Pre-built binary

Download the latest binary from [Releases](../../releases):

```bash
sudo cp imsg-forwarder /usr/local/bin/imsg-forwarder
sudo codesign --force --sign - /usr/local/bin/imsg-forwarder
```

> **Required after every binary update:** macOS AMFI invalidates trust when a binary is replaced. Re-signing with `-` (ad-hoc) restores it.

### Build from source

```bash
git clone https://github.com/ShunL12324/imsg-forwarder.git
cd imsg-forwarder
bun install
bun run build.ts
sudo cp dist/imsg-forwarder /usr/local/bin/imsg-forwarder
sudo codesign --force --sign - /usr/local/bin/imsg-forwarder
```

Output binaries:
- `dist/imsg-forwarder` — Apple Silicon (arm64)
- `dist/imsg-forwarder-x64` — Intel (x64)

## Configuration

```bash
mkdir -p ~/.imsg-forwarder
cp config.example.yaml ~/.imsg-forwarder/config.yaml
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

Config is searched in order:
1. `<binary directory>/config.yaml`
2. `./config.yaml`
3. `~/.imsg-forwarder/config.yaml`

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
imsg-forwarder --deploy
```

### Diagnostics

Checks config completeness, Cloudflare token validity, Workers/D1 permissions, and worker reachability.

```bash
imsg-forwarder --doctor
```

### Undeploy

Removes the Cloudflare Worker and D1 database.

```bash
imsg-forwarder --undeploy
```

## iOS Shortcut setup

1. Open **Shortcuts** → **Automation** → **+** → **Message**
2. Leave **Sender** and **Message Contains** blank — or set Message Contains to a single space `" "` if iOS requires a value
3. Turn off **Ask Before Running**
4. Add these actions:

| Action | Settings |
|---|---|
| **Get Contents of URL** | URL: `https://<worker>.workers.dev/messages`  Method: `POST`  Headers: `Authorization: Bearer <api_token>`  Body: JSON |
| ↳ JSON body | `text` → Shortcut Input → Content  `sender` → Shortcut Input → Sender  `chat_identifier` → Shortcut Input → Sender |
| **Get Dictionary from Input** | from URL result |
| **Get Dictionary Value** | key: `ok` |
| **If** value = `true` | Show Notification: "✓ Forwarded" |
| **Otherwise** | Show Notification: "✗ Failed" → body: URL result |

5. Enable these settings on iPhone:
   - **Settings → Shortcuts → Allow Access to Messages** → On
   - **Settings → Shortcuts → Allow Notifications** → On
   - **Settings → General → Background App Refresh** → On

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
