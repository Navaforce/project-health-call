# Slack → Salesforce MCP: Production Checklist

---

## Salesforce Setup

- [ ] Create an External Client App (not a Connected App)
  - Auth flow: Authorization Code + PKCE
  - `isConsumerSecretOptional: true` (public client — no secret in the bot)
  - Scopes: `api`, `mcp_api`, `refresh_token`
  - Permitted users: `AdminApprovedPreAuthorized`
  - Callback URL: your deployed bot's `/auth/callback` URL
- [ ] Activate the MCP server(s) you need in Setup → Integrations → API Catalog → MCP Servers
- [ ] Grant ECA access to each user via `SetupEntityAccess` or a Permission Set
- [ ] Confirm `MCPService` is in the JWT `sfap_op` claim after first token request

---

## Bot Infrastructure

- [ ] Deploy Node.js bot to a permanent host (Railway, Render, Fly.io, etc.)
- [ ] Set all env vars on the host (no `.env` file in production):
  - `SF_CLIENT_ID`, `SF_ORG_URL`, `SF_MCP_URL`
  - `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`
  - `APP_BASE_URL` (your permanent deployed URL)
- [ ] Replace in-memory token store with Redis or a database (tokens must survive restarts)
- [ ] Enable refresh token rotation on the ECA (`isRefreshTokenRotationEnabled: true`)
- [ ] Add HTTPS (most hosts provide this automatically)

---

## Slack App

- [ ] Create Slack app at api.slack.com → From scratch
- [ ] Add bot scopes: `commands`, `chat:write`
- [ ] Register slash command → Request URL: `https://your-domain.com/slack/events`
- [ ] Install to workspace
- [ ] For multi-workspace: enable OAuth distribution and handle per-workspace bot tokens

---

## Security Hardening

- [ ] Store `SF_CLIENT_SECRET` in a secrets manager (Vault, AWS Secrets Manager, Railway secrets) — never in code or `.env` committed to git
- [ ] Set refresh token validity limit on ECA (30 days recommended, with rotation)
- [ ] Restrict ECA callback URLs to your production domain only
- [ ] Verify Slack request signatures on every inbound webhook (`SLACK_SIGNING_SECRET`)
- [ ] Scope MCP server to read-only tools unless write access is explicitly required

---

## Go-Live Validation

- [ ] Run `/projecthealth` as a non-admin user — confirm FLS restricts their view correctly
- [ ] Restart the bot — confirm users don't need to re-auth (persistent token store working)
- [ ] Rotate consumer secret — confirm bot continues working (refresh token path)
- [ ] Check MCP server URL uses My Domain format: `api.salesforce.com/platform/mcp/v1/d/{mydomainname}/sandbox/{servername}`
