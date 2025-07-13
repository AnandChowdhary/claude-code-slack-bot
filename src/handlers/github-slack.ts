import { GitHubService } from "../services/github";
import { CloudflareBindings, MessageContext } from "../types";

export class GitHubSlackHandler {
  private env: CloudflareBindings;
  private github: GitHubService;

  constructor(env: CloudflareBindings) {
    this.env = env;
    this.github = new GitHubService(
      env.GITHUB_TOKEN,
      env.GITHUB_OWNER,
      env.GITHUB_REPO
    );
  }

  private cleanMessage(text: string): string {
    return text.replace(/<@[A-Z0-9]+>/g, "").trim();
  }

  async handleMessage(context: MessageContext): Promise<void> {
    const { text, channel, thread_ts, ts, context: slackContext } = context;
    const threadId = thread_ts || ts;

    try {
      await slackContext.client.reactions.add({
        channel,
        timestamp: ts,
        name: "eyes",
      });

      const cleanedMessage = this.cleanMessage(text);

      const threadHistory = await this.fetchThreadHistory(
        { channel, thread_ts: thread_ts || ts, ts },
        slackContext
      );

      const issueBody = this.github.formatIssueBody(
        threadHistory,
        cleanedMessage
      );

      console.log("Creating GitHub issue from Slack message");
      const result = await this.github.createIssue(
        "New feature request",
        issueBody,
        ["slack-request", "feature-request"]
      );

      if ("error" in result) {
        await slackContext.client.reactions.remove({
          channel,
          timestamp: ts,
          name: "eyes",
        });
        await slackContext.say({
          text: `Failed to create GitHub issue: ${result.error}`,
          thread_ts: threadId,
        });
        return;
      }

      const responseText = [
        `✅ GitHub issue created successfully!`,
        ``,
        `*Issue #${result.number}:* ${result.title}`,
        `*Link:* <${result.html_url}|View on GitHub>`,
        ``,
        `The full thread context has been included in the issue description.`,
      ].join("\n");

      await slackContext.say({
        text: responseText,
        thread_ts: threadId,
      });

      await slackContext.client.reactions.remove({
        channel,
        timestamp: ts,
        name: "eyes",
      });
    } catch (error) {
      console.error("Error processing message:", error);

      try {
        await slackContext.client.reactions.remove({
          channel,
          timestamp: ts,
          name: "eyes",
        });
      } catch (removeError) {
        console.error("Failed to remove reaction:", removeError);
      }

      await slackContext.say({
        text: `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
        thread_ts: threadId,
      });
    }
  }

  async fetchThreadHistory(payload: any, context: any): Promise<string> {
    try {
      const threadMessages = await context.client.conversations.replies({
        channel: payload.channel,
        ts: payload.thread_ts || payload.ts,
        limit: 100,
      });

      if (threadMessages.messages && threadMessages.messages.length > 0) {
        const history = threadMessages.messages
          .map((msg: any) => {
            const sender = msg.bot_id ? "Bot" : "User";
            const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
            return `[${timestamp}] ${sender}: ${msg.text || "(no text)"}`;
          })
          .join("\n");

        return history;
      }

      return "No thread history available";
    } catch (error) {
      console.error("Failed to fetch thread history:", error);
      return "Failed to fetch thread history";
    }
  }
}
