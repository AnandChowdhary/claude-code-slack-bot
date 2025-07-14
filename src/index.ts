import { Hono } from "hono";
import { SlackApp } from "slack-cloudflare-workers";
import { GitHubSlackHandler } from "./handlers/github-slack";
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
      executionCtx: c.executionCtx,
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
          executionCtx: c.executionCtx,
        });
      }
    }
  });

  // Run the Slack app handler
  return await slackApp.run(c.req.raw, c.executionCtx);
});

// Progress checking endpoint - no longer needed since we use direct function calls
// Keeping it commented in case you want to use it for manual testing
/*
app.post("/check-progress", async (c) => {
  console.log("Check-progress endpoint hit");
  const body = await c.req.json();
  const checker = new ProgressChecker(c.env);

  console.log("Progress check request received:", body);

  try {
    const result = await checker.checkProgress(body);

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
*/

export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch, env: CloudflareBindings) => {
    // Import ProgressChecker inside the handler to avoid circular dependencies
    const { ProgressChecker } = await import("./handlers/progress-checker");
    const checker = new ProgressChecker(env);

    for (const message of batch.messages) {
      const payload = message.body as any;
      console.log("Processing queue message:", payload);

      try {
        const result = await checker.checkProgress(payload);

        if (result.shouldContinue && result.nextRequest) {
          // Re-queue the next check with a delay
          await env.PROGRESS_QUEUE.send(result.nextRequest, {
            delaySeconds: 10, // 10 second delay between checks
          });
        }

        // Acknowledge the message
        message.ack();
      } catch (error) {
        console.error("Error processing queue message:", error);
        // Retry the message
        message.retry();
      }
    }
  },
};
