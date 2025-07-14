import { Hono } from "hono";
import { SlackApp } from "slack-cloudflare-workers";
import { GitHubSlackHandler } from "./handlers/github-slack";
import { ProgressChecker } from "./handlers/progress-checker";
import { CloudflareBindings } from "./types";

const app = new Hono<{
  Bindings: CloudflareBindings;
  ExecutionContext: ExecutionContext;
}>();

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

  // Handle app_mention events - creates GitHub issues
  slackApp.event("app_mention", async ({ payload, context }) => {
    await handler.handleMention({
      text: payload.text,
      channel: payload.channel,
      thread_ts: payload.thread_ts,
      ts: payload.ts,
      context,
    });
  });

  // Handle message events in threads - adds comments to existing issues
  slackApp.event("message", async ({ payload, context }) => {
    // Type guard to check if this is a regular message with text
    if (
      "text" in payload &&
      payload.text &&
      "thread_ts" in payload &&
      payload.thread_ts
    ) {
      // Skip if this is a bot message
      if ("subtype" in payload && payload.subtype === "bot_message") {
        return;
      }

      // Skip if message contains a bot mention (handled by app_mention event)
      if (payload.text.includes(`<@${env.SLACK_BOT_USER_ID || ""}>`)) {
        return;
      }

      // Check if bot has created an issue for this thread
      const kvKey = `github_issue:${payload.channel}:${payload.thread_ts}`;
      const issueData = await c.env.KV.get(kvKey);

      // Only respond if we have an issue for this thread
      if (issueData) {
        await handler.handleReply({
          text: payload.text,
          channel: payload.channel,
          thread_ts: payload.thread_ts,
          ts: payload.ts,
          context,
        });
      }
    }
  });

  // Run the Slack app handler
  return await slackApp.run(c.req.raw, c.executionCtx);
});

// Progress checking endpoint
app.post("/check-progress", async (c) => {
  const body = await c.req.json();
  const checker = new ProgressChecker(c.env);

  console.log("Progress check request received:", body);

  try {
    const result = await checker.checkProgress(body);

    if (result.shouldContinue && result.nextRequest) {
      // Schedule the next check using waitUntil
      const baseUrl = new URL(c.req.url).origin;

      c.executionCtx.waitUntil(
        checker.scheduleNextCheck(result.nextRequest, baseUrl)
      );
    }

    return c.json({
      success: true,
      shouldContinue: result.shouldContinue,
      attemptCount: result.nextRequest?.attemptCount || body.attemptCount,
    });
  } catch (error) {
    console.error("Progress check error:", error);
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

export default app;
