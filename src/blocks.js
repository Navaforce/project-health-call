'use strict';

const STATUS_MAP = {
    '4bca81': { label: 'Green',  emoji: ':large_green_circle:' },
    'ffb75d': { label: 'Yellow', emoji: ':large_yellow_circle:' },
    'd4504c': { label: 'Red',    emoji: ':red_circle:' },
};

function progressBar(pct, width = 10) {
    const filled = Math.round((pct / 100) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function fmtDate(raw) {
    if (!raw) return '—';
    const d = new Date(raw + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtHrs(val) {
    if (val == null || val === 0) return '—';
    return `${Number(val).toFixed(1)} hrs`;
}

function buildProjectHealthBlocks(projects) {
    const blocks = [
        {
            type: 'header',
            text: { type: 'plain_text', text: '📊 Project Health — Top 3 by Completion', emoji: true },
        },
        {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: '_Data via Salesforce MCP · FLS and sharing rules enforced_' }],
        },
        { type: 'divider' },
    ];

    projects.forEach((p, i) => {
        const status = STATUS_MAP[p.statusHex] || { label: '—', emoji: ':white_circle:' };
        const bar = progressBar(p.pct);

        // Flags row
        const flags = [
            p.behindSchedule ? ':warning: Behind Schedule' : ':white_check_mark: On Track',
            p.overBudget     ? ':warning: Over Budget'     : ':white_check_mark: Within Budget',
            p.scopeExceeded  ? ':warning: Scope Exceeded'  : ':white_check_mark: In Scope',
        ].join('   ');

        blocks.push(
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${i + 1}. ${p.name}*\n${status.emoji} ${status.label}  ·  Phase: ${p.phase}  ·  PM: ${p.ownerName}`,
                },
            },
            {
                type: 'section',
                fields: [
                    { type: 'mrkdwn', text: `*Completion*\n\`${bar}\` ${p.pct}%` },
                    { type: 'mrkdwn', text: `*Due*\n${fmtDate(p.endDate)}` },
                    { type: 'mrkdwn', text: `*Est. Hours*\n${fmtHrs(p.estimatedHours)}` },
                    { type: 'mrkdwn', text: `*Actual Hours*\n${fmtHrs(p.actualHours)}` },
                ],
            },
            {
                type: 'context',
                elements: [{ type: 'mrkdwn', text: flags }],
            }
        );

        if (p.overdueCount > 0 || p.blockedCount > 0) {
            const details = [];
            if (p.overdueCount > 0) details.push(`${p.overdueCount} overdue task${p.overdueCount > 1 ? 's' : ''}`);
            if (p.blockedCount > 0) details.push(`${p.blockedCount} blocked task${p.blockedCount > 1 ? 's' : ''}`);
            blocks.push({
                type: 'context',
                elements: [{ type: 'mrkdwn', text: `:pushpin: ${details.join(' · ')}` }],
            });
        }

        if (i < projects.length - 1) blocks.push({ type: 'divider' });
    });

    return blocks;
}

module.exports = { buildProjectHealthBlocks };
