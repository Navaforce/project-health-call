'use strict';

const crypto = require('crypto');
const express = require('express');
const https = require('https');
const { URLSearchParams } = require('url');
const tokenStore = require('./tokenStore');

const router = express.Router();

// Pending PKCE challenges keyed by OAuth state param
const pendingAuth = new Map();

function base64url(buf) {
    return buf.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function generatePKCE() {
    const verifier = base64url(crypto.randomBytes(32));
    const challenge = base64url(
        crypto.createHash('sha256').update(verifier).digest()
    );
    return { verifier, challenge };
}

// Called by the Slack slash command when no token exists for the user.
// Returns a URL the user should open in their browser.
function buildAuthUrl(slackUserId) {
    const { verifier, challenge } = generatePKCE();
    const state = base64url(crypto.randomBytes(16));

    pendingAuth.set(state, { slackUserId, verifier, createdAt: Date.now() });

    // Clean up stale pending entries older than 10 minutes
    for (const [k, v] of pendingAuth) {
        if (Date.now() - v.createdAt > 600_000) pendingAuth.delete(k);
    }

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.SF_CLIENT_ID,
        redirect_uri: `${process.env.APP_BASE_URL}/auth/callback`,
        scope: 'api mcp_api refresh_token',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    });

    return `${process.env.SF_ORG_URL}/services/oauth2/authorize?${params}`;
}

// OAuth callback — Salesforce redirects here with ?code=&state=
router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
        return res.send(`Authorization failed: ${error}`);
    }

    const pending = pendingAuth.get(state);
    if (!pending) {
        return res.status(400).send('Invalid or expired state parameter.');
    }
    pendingAuth.delete(state);

    try {
        const tokens = await exchangeCode(code, pending.verifier);
        tokenStore.save(pending.slackUserId, tokens);
        res.send('✅ Salesforce connected. Return to Slack and run /projecthealth again.');
    } catch (err) {
        console.error('Token exchange failed:', err.message);
        res.status(500).send('Token exchange failed. Please try again.');
    }
});

async function exchangeCode(code, verifier) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: process.env.SF_CLIENT_ID,
        redirect_uri: `${process.env.APP_BASE_URL}/auth/callback`,
        code_verifier: verifier,
        // No client_secret — PKCE public client flow
    });

    const url = new URL(`${process.env.SF_ORG_URL}/services/oauth2/token`);
    return jsonPost(url, body.toString());
}

async function refreshAccessToken(refreshToken) {
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.SF_CLIENT_ID,
    });

    const url = new URL(`${process.env.SF_ORG_URL}/services/oauth2/token`);
    return jsonPost(url, body.toString());
}

function jsonPost(url, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(body),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error) reject(new Error(`${parsed.error}: ${parsed.error_description}`));
                        else resolve(parsed);
                    } catch (e) {
                        reject(new Error(`Non-JSON response: ${data}`));
                    }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Returns a valid access token for a Slack user, refreshing if needed.
async function getValidToken(slackUserId) {
    const entry = tokenStore.get(slackUserId);
    if (!entry) return null;

    if (tokenStore.isExpired(entry) && entry.refreshToken) {
        try {
            const refreshed = await refreshAccessToken(entry.refreshToken);
            tokenStore.save(slackUserId, {
                ...refreshed,
                refresh_token: refreshed.refresh_token || entry.refreshToken,
            });
            return tokenStore.get(slackUserId).accessToken;
        } catch (err) {
            console.error('Token refresh failed:', err.message);
            tokenStore.remove(slackUserId);
            return null;
        }
    }

    return entry.accessToken;
}

module.exports = { router, buildAuthUrl, getValidToken };
