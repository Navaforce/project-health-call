'use strict';

require('dotenv').config();

const { App, ExpressReceiver } = require('@slack/bolt');
const { router: authRouter, buildAuthUrl, getValidToken } = require('./auth');
const { fetchProjectHealth } = require('./mcpClient');
const { buildProjectHealthBlocks } = require('./blocks');

const receiver = new ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Mount OAuth callback on the underlying Express app
receiver.app.use('/auth', authRouter);

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver,
});

app.command('/projecthealth', async ({ command, ack, respond }) => {
    await ack();

    const slackUserId = command.user_id;
    const accessToken = await getValidToken(slackUserId);

    if (!accessToken) {
        const authUrl = buildAuthUrl(slackUserId);
        await respond({
            response_type: 'ephemeral',
            text: `Connect your Salesforce account to use /projecthealth.`,
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: ':salesforce: *Connect Salesforce*\nYou need to authorize access before running this command. Your permissions will be enforced — you\'ll only see projects you have access to.',
                    },
                },
                {
                    type: 'actions',
                    elements: [
                        {
                            type: 'button',
                            text: { type: 'plain_text', text: 'Connect Salesforce', emoji: true },
                            url: authUrl,
                            style: 'primary',
                        },
                    ],
                },
            ],
        });
        return;
    }

    // Immediately acknowledge with a loading message
    await respond({
        response_type: 'ephemeral',
        text: ':hourglass_flowing_sand: Fetching project health data…',
    });

    try {
        const projects = await fetchProjectHealth(accessToken);

        if (!projects.length) {
            await respond({
                response_type: 'in_channel',
                text: 'No projects found with completion data.',
            });
            return;
        }

        const blocks = buildProjectHealthBlocks(projects);
        await respond({
            response_type: 'in_channel',
            blocks,
            text: `Project Health — Top ${projects.length} by Completion`,
        });
    } catch (err) {
        console.error('Error fetching project health:', err);
        await respond({
            response_type: 'ephemeral',
            text: `:x: Failed to fetch project health: ${err.message}`,
        });
    }
});

(async () => {
    const port = process.env.PORT || 3000;
    await app.start(port);
    console.log(`⚡ Project Health bot running on port ${port}`);
    console.log(`   OAuth callback: ${process.env.APP_BASE_URL}/auth/callback`);
    console.log(`   Slash command:  /projecthealth`);
})();
