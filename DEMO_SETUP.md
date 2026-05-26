# Demo Setup Checklist

Run through this top to bottom every time you set up for a demo.
The cloudflared tunnel URL changes on every restart — that's the main thing that cascades.

---

## Before You Start

- [ ] Rotate credentials if any were exposed:
  - Slack bot token → api.slack.com → Project Health → OAuth & Permissions → Regenerate
  - Salesforce consumer secret → Setup → External Client Apps → HXL Dev ECA → OAuth Settings → Rotate Secret
  - ngrok authtoken (if used) → dashboard.ngrok.com/tunnels/authtokens

---

## Step 1 — Start the tunnel

Open a terminal and run:

```bash
cloudflared tunnel --url http://localhost:3000
```

Wait for the line:
```
Your quick Tunnel has been created! Visit it at:
https://<something>.trycloudflare.com
```

**Copy this URL.** You'll need it in Steps 2, 3, and 4.

---

## Step 2 — Update .env

Open `/Users/dnava/project-health-call/.env` and update:

```
APP_BASE_URL=https://<your-new-tunnel-url>.trycloudflare.com
```

Save the file.

Confirm these values are still correct (they don't change between sessions):

```
SF_CLIENT_ID=3MVG9o0Rj_GRmEujTLx5b.PNfBoR1n3S7IgdZZ8lOTkpodXfieRwG738zyhTb3V2kkFn_R2cpm_E9QCGTAWw3
SF_ORG_URL=https://navy-program-management--fullcopy.sandbox.my.salesforce.com
SF_MCP_URL=https://api.salesforce.com/platform/mcp/v1/d/navy-program-management--fullcopy/sandbox/platform/sobject-all
```

---

## Step 3 — Update Slack slash command URL

1. Go to **api.slack.com/apps** → **Project Health**
2. Left sidebar → **Slash Commands** → `/projecthealth` → **Edit**
3. Set Request URL to:
   ```
   https://<your-new-tunnel-url>.trycloudflare.com/slack/events
   ```
4. Click **Save**
5. Left sidebar → **Install App** → **Reinstall to Workspace** → **Allow**

---

## Step 4 — Update ECA callback URL in Salesforce

1. Log into FullCopy sandbox:
   `https://navy-program-management--fullcopy.sandbox.my.salesforce.com`
2. **Setup → Apps → External Client Apps → External Client App Manager**
3. Click **HXL Dev ECA** → **Edit**
4. Set Callback URL to:
   ```
   https://<your-new-tunnel-url>.trycloudflare.com/auth/callback
   ```
5. Click **Save**

---

## Step 5 — Start the bot

Open a second terminal and run:

```bash
cd ~/project-health-call && npm start
```

You should see:
```
⚡ Project Health bot running on port 3000
   OAuth callback: https://<your-tunnel-url>.trycloudflare.com/auth/callback
   Slash command:  /projecthealth
```

Confirm the OAuth callback URL matches your tunnel URL.

---

## Step 6 — Test the flow

In your Slack sandbox workspace:

1. Type `/projecthealth`
2. First run: click **Connect Salesforce** → log in as `dnava@navy-pm.demo.fullcopy` → you'll be redirected back to Slack
3. Run `/projecthealth` again → you should see the 3-project health widget

If it worked in a previous session, your token is stored in memory — skip to step 3 directly. If the bot was restarted, tokens are cleared and you'll need to re-auth.

---

## Step 7 — Demo governance moment (optional but recommended)

To show per-user FLS enforcement live:

1. First run as `dnava` (System Administrator) — shows all 3 projects
2. Then grant `jfogg@navy-pm.demo.fullcopy` access to the ECA:
   - FullCopy Setup → Permission Sets → create or find a perm set → assign to jfogg
   - Or: SetupEntityAccess via the same method used for dnava
3. Have jfogg run `/projecthealth` — if sharing rules restrict their view, they'll see fewer or different projects

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/projecthealth` → "Unknown command" | Reinstall the Slack app (Step 3, bullet 5) |
| "Connect Salesforce" link → "site can't be reached" | Tunnel died — restart cloudflared, update all 3 URLs |
| "Token exchange failed: invalid_client" | ECA callback URL doesn't match tunnel URL — check Step 4 |
| Widget shows but all fields are `—` | Token expired — run `/projecthealth`, re-auth via Connect button |
| Bot terminal shows nothing after `/projecthealth` | Slack URL not updated — redo Step 3 |
| `Non-JSON MCP response` | MCP token expired — restart bot to force fresh token on next call |

---

## Key Credentials (rotate after any public exposure)

| Credential | Where to rotate |
|---|---|
| Slack Bot Token (`xoxb-...`) | api.slack.com → Project Health → OAuth & Permissions |
| Slack Signing Secret | api.slack.com → Project Health → Basic Information |
| SF Consumer Secret | FullCopy Setup → External Client Apps → HXL Dev ECA → OAuth Settings |
| SF Consumer Key | Stays fixed unless you recreate the ECA |

---

## Architecture Summary (for demo narration)

```
Slack user → /projecthealth
  → Slack bot checks: does this user have a stored SF token?
  → If no: OAuth 2.0 Authorization Code + PKCE flow
           User logs into Salesforce → access token stored per Slack user_id
  → MCP session initialized against:
    https://api.salesforce.com/platform/mcp/v1/d/navy-program-management--fullcopy/sandbox/platform/sobject-all
  → soqlQuery tool called 7x (3 projects + 4 health aggregates)
  → All queries execute under the authenticated user's FLS + sharing rules
  → Results formatted as Block Kit and posted to Slack
```

**The agent does not bypass the platform. It operates through it.**
