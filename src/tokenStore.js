'use strict';

// In-memory token store keyed by Slack user_id.
// Replace with Redis or a DB for multi-instance deployments.
const store = new Map();

function save(slackUserId, tokens) {
    store.set(slackUserId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        instanceUrl: tokens.instance_url,
        expiresAt: Date.now() + (tokens.expires_in || 7200) * 1000,
    });
}

function get(slackUserId) {
    return store.get(slackUserId) || null;
}

function remove(slackUserId) {
    store.delete(slackUserId);
}

function isExpired(entry) {
    // Treat as expired 60s before actual expiry to avoid races
    return Date.now() > entry.expiresAt - 60_000;
}

module.exports = { save, get, remove, isExpired };
