import { Hono } from "hono";
import { SlackApp } from "slack-cloudflare-workers";
import { GitHubSlackHandler } from "./handlers/github-slack";
import { CloudflareBindings } from "./types";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// Slack events endpoint
app.all("/slack/events", async (c) => {
  const env = {
    ...c.env,
    SLACK_BOT_TOKEN: c.env.SLACK_BOT_USER_OAUTH_TOKEN,
  };
  const slackApp = new SlackApp({ env } as any);
  const handler = new GitHubSlackHandler(c.env);

  // Handle app_mention events - now creates GitHub issues
  slackApp.event("app_mention", async ({ payload, context }) => {
    await handler.handleMessage({
      text: payload.text,
      channel: payload.channel,
      thread_ts: payload.thread_ts,
      ts: payload.ts,
      context,
    });
  });

  // Note: Removed message event handler since we only respond to direct mentions now

  // Run the Slack app handler
  return await slackApp.run(c.req.raw, c.executionCtx);
});

export default app;
