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
