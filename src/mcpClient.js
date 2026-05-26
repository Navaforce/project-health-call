'use strict';

const https = require('https');

const MCP_URL = new URL(process.env.SF_MCP_URL || 'https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-all');

// SOQL query: top 3 projects by completion %, excluding nulls
const PROJECT_QUERY = `
  SELECT Id, Name,
    TASKRAY__trCompletionPercentage__c,
    TASKRAY__trStatus__c,
    Project_Phase__c,
    TASKRAY__Project_Start__c,
    TASKRAY__Project_End__c,
    Owner.Name
  FROM TASKRAY__Project__c
  WHERE TASKRAY__trCompletionPercentage__c != null
  ORDER BY TASKRAY__trCompletionPercentage__c DESC
  LIMIT 3
`.replace(/\s+/g, ' ').trim();

// Per-project health query — overdue and blocked task counts
const HEALTH_QUERY = (id) => `
  SELECT
    COUNT(Id) total,
    SUM(TASKRAY__trEstimatedHours__c) estHrs,
    SUM(TASKRAY__trTotalTimeOnTask__c) actualHrs
  FROM TASKRAY__Project_Task__c
  WHERE TASKRAY__Project__c = '${id}'
  AND TASKRAY__Archived__c = false
`.replace(/\s+/g, ' ').trim();

const OVERDUE_QUERY = (id) =>
    `SELECT COUNT(Id) cnt FROM TASKRAY__Project_Task__c WHERE TASKRAY__Project__c = '${id}' AND Overdue__c = true AND TASKRAY__trCompleted__c = false AND TASKRAY__Archived__c = false`
        .replace(/\s+/g, ' ').trim();

const BLOCKED_QUERY = (id) =>
    `SELECT COUNT(Id) cnt FROM TASKRAY__Project_Task__c WHERE TASKRAY__Project__c = '${id}' AND TASKRAY__Blocked__c = true AND TASKRAY__Archived__c = false`
        .replace(/\s+/g, ' ').trim();

async function fetchProjectHealth(accessToken) {
    const sessionId = await initSession(accessToken);
    const projects = await soqlQuery(accessToken, sessionId, PROJECT_QUERY);

    const enriched = await Promise.all(
        projects.map(async (p) => {
            const [health, overdue, blocked] = await Promise.all([
                soqlQuery(accessToken, sessionId, HEALTH_QUERY(p.Id)),
                soqlQuery(accessToken, sessionId, OVERDUE_QUERY(p.Id)),
                soqlQuery(accessToken, sessionId, BLOCKED_QUERY(p.Id)),
            ]);

            const agg = health[0] || {};
            const estHrs = agg.estHrs || 0;
            const actualHrs = agg.actualHrs || 0;

            return {
                id: p.Id,
                name: p.Name,
                pct: Math.round(p.TASKRAY__trCompletionPercentage__c || 0),
                statusHex: (p.TASKRAY__trStatus__c || '').toLowerCase(),
                phase: p.Project_Phase__c || '—',
                startDate: p.TASKRAY__Project_Start__c,
                endDate: p.TASKRAY__Project_End__c,
                ownerName: p.Owner?.Name || '—',
                behindSchedule: (overdue[0]?.cnt || 0) > 0,
                overBudget: estHrs > 0 && actualHrs > estHrs,
                scopeExceeded: (blocked[0]?.cnt || 0) > 0,
                overdueCount: overdue[0]?.cnt || 0,
                blockedCount: blocked[0]?.cnt || 0,
                estimatedHours: estHrs,
                actualHours: actualHrs,
            };
        })
    );

    return enriched;
}

async function initSession(accessToken) {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'project-health-call', version: '1.0' },
        },
    });

    const headers = await mcpRequest(accessToken, body, null);
    const sessionId = headers['mcp-session-id'];
    if (!sessionId) throw new Error('No mcp-session-id in initialize response');

    // Send initialized notification
    await mcpRequest(
        accessToken,
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
        sessionId
    );

    return sessionId;
}

async function soqlQuery(accessToken, sessionId, query) {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
            name: 'soqlQuery',
            arguments: { q: query },
        },
    });

    const { body: responseBody } = await mcpRequestFull(accessToken, body, sessionId);
    const result = responseBody?.result;

    // soqlQuery returns content[0].text as JSON string
    const text = result?.content?.[0]?.text;
    if (!text) return [];

    try {
        const parsed = JSON.parse(text);
        return parsed.records || parsed.totalSize !== undefined ? (parsed.records || []) : parsed;
    } catch {
        return [];
    }
}

// Returns { sessionId (from headers), body (parsed JSON) }
function mcpRequestFull(accessToken, body, sessionId) {
    return new Promise((resolve, reject) => {
        const reqHeaders = {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'Content-Length': Buffer.byteLength(body),
        };
        if (sessionId) reqHeaders['mcp-session-id'] = sessionId;

        const req = https.request(
            {
                hostname: MCP_URL.hostname,
                path: MCP_URL.pathname,
                method: 'POST',
                headers: reqHeaders,
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    // 202 with empty body = notification acknowledged (no response expected)
                    // 200 with empty body = SSE stream already closed (result was streamed)
                    if (!data.trim()) {
                        resolve({ headers: res.headers, body: null });
                        return;
                    }
                    // SSE format: lines starting with "data: "
                    if (data.includes('data: ')) {
                        const lines = data.split('\n').filter(l => l.startsWith('data: '));
                        const lastLine = lines[lines.length - 1];
                        try {
                            const parsed = JSON.parse(lastLine.slice(6));
                            if (parsed.error) reject(new Error(`MCP error ${parsed.error.code}: ${parsed.error.message}`));
                            else resolve({ headers: res.headers, body: parsed });
                            return;
                        } catch {}
                    }
                    try {
                        const parsedBody = JSON.parse(data);
                        if (parsedBody.error) {
                            reject(new Error(`MCP error ${parsedBody.error.code}: ${parsedBody.error.message}`));
                        } else {
                            resolve({ headers: res.headers, body: parsedBody });
                        }
                    } catch (e) {
                        console.error(`[MCP] HTTP ${res.statusCode} non-JSON response:`, data.slice(0, 500));
                        reject(new Error(`Non-JSON MCP response (HTTP ${res.statusCode}): ${data.slice(0, 200)}`));
                    }
                });
            }
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Returns response headers map (used to extract mcp-session-id from initialize)
async function mcpRequest(accessToken, body, sessionId) {
    const { headers } = await mcpRequestFull(accessToken, body, sessionId);
    return headers;
}

module.exports = { fetchProjectHealth };
