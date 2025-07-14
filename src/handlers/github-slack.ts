import { GitHubService } from "../services/github";
import { CloudflareBindings, MessageContext } from "../types";

const GITHUB_OWNER = "firstquadrant-ai";
const GITHUB_REPO = "firstquadrant.ai";

export class GitHubSlackHandler {
  private env: CloudflareBindings;
  private github: GitHubService;
  private kvPrefix = "github_issue:";
  private initialCheckDelayMs = 10000; // 10 seconds (was 60000 for 1 minute)

  constructor(env: CloudflareBindings) {
    console.log("Initializing GitHubSlackHandler with env vars:", {
      hasGithubToken: !!env.GITHUB_TOKEN,
      githubTokenLength: env.GITHUB_TOKEN?.length || 0,
      githubTokenPrefix: env.GITHUB_TOKEN?.substring(0, 4) || "none",
      githubOwner: env.GITHUB_OWNER || GITHUB_OWNER,
      githubRepo: env.GITHUB_REPO || GITHUB_REPO,
      usingDefaults: !env.GITHUB_OWNER || !env.GITHUB_REPO,
    });

    this.env = env;
    this.github = new GitHubService(
      env.GITHUB_TOKEN,
      env.GITHUB_OWNER || GITHUB_OWNER,
      env.GITHUB_REPO || GITHUB_REPO
    );
  }

  private getKVKey(channel: string, threadId: string): string {
    return `${this.kvPrefix}${channel}:${threadId}`;
  }

  private cleanMessage(text: string): string {
    return text
      .replace(/<@[A-Z0-9]+>/g, "")
      .replace("[DEBUG]", "")
      .trim();
  }

  async handleMention(context: MessageContext): Promise<void> {
    const {
      text,
      channel,
      thread_ts,
      ts,
      context: slackContext,
      executionCtx,
    } = context;
    const threadId = thread_ts || ts;
    const isDebugMode = text.includes("[DEBUG]");
    const debugInfo: string[] = [];

    if (isDebugMode) {
      debugInfo.push("🔍 *DEBUG MODE ENABLED*");
      debugInfo.push(`Channel: ${channel}`);
      debugInfo.push(`Thread TS: ${thread_ts || "None (new thread)"}`);
      debugInfo.push(`Message TS: ${ts}`);
      debugInfo.push(`Thread ID: ${threadId}`);
    }

    try {
      await slackContext.client.reactions.add({
        channel,
        timestamp: ts,
        name: "eyes",
      });

      const cleanedMessage = this.cleanMessage(text);

      if (isDebugMode) {
        debugInfo.push(`Original message: "${text}"`);
        debugInfo.push(`Cleaned message: "${cleanedMessage}"`);
      }

      // Check if an issue already exists for this thread
      const kvKey = this.getKVKey(channel, threadId);
      const existingIssue = await this.env.KV.get(kvKey);

      if (existingIssue) {
        const issueData = JSON.parse(existingIssue);

        if (isDebugMode) {
          debugInfo.push(
            `Found existing issue in KV: #${issueData.issueNumber}`
          );
        }

        const responseText = [
          `ℹ️ An issue already exists for this thread!`,
          ``,
          `*Issue #${issueData.issueNumber}*`,
          `*Link:* <${issueData.issueUrl}|View on GitHub>`,
          `*Created:* ${new Date(issueData.createdAt).toLocaleString()}`,
        ].join("\n");

        await slackContext.say({
          text: isDebugMode
            ? debugInfo.join("\n") + "\n\n---\n\n" + responseText
            : responseText,
          thread_ts: threadId,
        });

        await slackContext.client.reactions.remove({
          channel,
          timestamp: ts,
          name: "eyes",
        });
        return;
      }

      if (isDebugMode) {
        debugInfo.push("No existing issue found, creating new one...");
        debugInfo.push("Fetching thread history...");
      }

      const threadHistory = await this.fetchThreadHistory(
        { channel, thread_ts: thread_ts || ts, ts },
        slackContext
      );

      if (isDebugMode) {
        const historyLines = threadHistory.split("\n").length;
        debugInfo.push(`Thread history fetched: ${historyLines} lines`);
      }

      const issueBody = this.github.formatIssueBody(
        threadHistory,
        cleanedMessage
      );

      if (isDebugMode) {
        debugInfo.push("Creating GitHub issue...");
        debugInfo.push(`Owner: ${this.env.GITHUB_OWNER || GITHUB_OWNER}`);
        debugInfo.push(`Repo: ${this.env.GITHUB_REPO || GITHUB_REPO}`);
        debugInfo.push(`Title: "New feature request"`);
        debugInfo.push(`Labels: slack-request, feature-request`);
      }

      console.log("Creating GitHub issue from Slack message");
      const result = await this.github.createIssue(
        "New feature request",
        issueBody,
        ["slack-request", "feature-request"]
      );

      if ("error" in result) {
        if (isDebugMode) {
          debugInfo.push(`❌ Failed to create issue: ${result.error}`);
          debugInfo.push(`Status code: ${result.status}`);

          // Add more debug info for 401 errors
          if (result.status === 401) {
            debugInfo.push("⚠️ Authentication failed - possible causes:");
            debugInfo.push("- Invalid GitHub token");
            debugInfo.push("- Token lacks 'repo' scope");
            debugInfo.push("- Token expired");
            debugInfo.push(
              `Token info: ${this.env.GITHUB_TOKEN?.substring(0, 4)}... (${
                this.env.GITHUB_TOKEN?.length
              } chars)`
            );
          }

          // Add debug info for 404 errors
          if (result.status === 404) {
            debugInfo.push("⚠️ Repository not found - possible causes:");
            debugInfo.push(
              `- Repository ${this.env.GITHUB_OWNER || GITHUB_OWNER}/${
                this.env.GITHUB_REPO || GITHUB_REPO
              } doesn't exist`
            );
            debugInfo.push("- Token doesn't have access to this repository");
            debugInfo.push("- Repository is private and token lacks access");
            debugInfo.push("- Typo in owner or repo name");
          }
        }

        await slackContext.client.reactions.remove({
          channel,
          timestamp: ts,
          name: "eyes",
        });

        const errorMessage = isDebugMode
          ? debugInfo.join("\n") +
            `\n\nFailed to create GitHub issue: ${result.error} (Status: ${result.status})`
          : `Failed to create GitHub issue: ${result.error}`;

        await slackContext.say({
          text: errorMessage,
          thread_ts: threadId,
        });
        return;
      }

      if (isDebugMode) {
        debugInfo.push(`✅ Issue created successfully!`);
        debugInfo.push(`Issue ID: ${result.id}`);
        debugInfo.push(`Issue Number: #${result.number}`);
        debugInfo.push(`Issue URL: ${result.html_url}`);
      }

      // Save issue information to KV with prefix
      const kvData = {
        issueNumber: result.number,
        issueId: result.id,
        issueUrl: result.html_url,
        createdAt: new Date().toISOString(),
        channel,
        threadId,
      };

      try {
        await this.env.KV.put(kvKey, JSON.stringify(kvData), {
          expirationTtl: 86400 * 30, // 30 days TTL
        });

        if (isDebugMode) {
          debugInfo.push(`KV stored with key: ${kvKey}`);
          debugInfo.push(`KV TTL: 30 days`);
        }
      } catch (kvError) {
        console.error("Failed to store in KV:", kvError);
        if (isDebugMode) {
          debugInfo.push(`⚠️ Failed to store in KV: ${kvError}`);
        }
      }

      let responseText = [
        `✅ GitHub issue created successfully!`,
        ``,
        `*Issue #${result.number}:* ${result.title}`,
        `*Link:* <${result.html_url}|View on GitHub>`,
        ``,
        `The full thread context has been included in the issue description.`,
      ].join("\n");

      if (isDebugMode) {
        responseText = debugInfo.join("\n") + "\n\n---\n\n" + responseText;
      }

      await slackContext.say({
        text: responseText,
        thread_ts: threadId,
      });

      await slackContext.client.reactions.remove({
        channel,
        timestamp: ts,
        name: "eyes",
      });

      // Trigger progress checking after 1 minute
      await this.triggerProgressCheck(
        {
          issueNumber: result.number,
          channel,
          threadId,
        },
        executionCtx
      );
    } catch (error) {
      console.error("Error processing message:", error);

      if (isDebugMode) {
        debugInfo.push(
          `❌ Unexpected error: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        if (error instanceof Error && error.stack) {
          debugInfo.push(`Stack trace: ${error.stack}`);
        }
      }

      try {
        await slackContext.client.reactions.remove({
          channel,
          timestamp: ts,
          name: "eyes",
        });
      } catch (removeError) {
        console.error("Failed to remove reaction:", removeError);
      }

      const errorMessage = isDebugMode
        ? debugInfo.join("\n") +
          `\n\nError: ${error instanceof Error ? error.message : String(error)}`
        : `Error: ${error instanceof Error ? error.message : String(error)}`;

      await slackContext.say({
        text: errorMessage,
        thread_ts: threadId,
      });
    }
  }

  async handleReply(context: MessageContext): Promise<void> {
    const { text, channel, thread_ts, ts, context: slackContext } = context;
    const threadId = thread_ts || ts;
    const isDebugMode = text.includes("[DEBUG]");
    const debugInfo: string[] = [];

    if (isDebugMode) {
      debugInfo.push("🔍 *DEBUG MODE ENABLED - Reply Handler*");
      debugInfo.push(`Channel: ${channel}`);
      debugInfo.push(`Thread TS: ${thread_ts}`);
      debugInfo.push(`Message TS: ${ts}`);
    }

    try {
      await slackContext.client.reactions.add({
        channel,
        timestamp: ts,
        name: "eyes",
      });

      const cleanedMessage = this.cleanMessage(text);

      // Get issue data from KV
      const kvKey = this.getKVKey(channel, threadId);
      const issueDataStr = await this.env.KV.get(kvKey);

      if (!issueDataStr) {
        if (isDebugMode) {
          debugInfo.push("No issue found in KV for this thread");
        }
        // No issue exists for this thread, ignore the message
        await slackContext.client.reactions.remove({
          channel,
          timestamp: ts,
          name: "eyes",
        });
        return;
      }

      const issueData = JSON.parse(issueDataStr);

      if (isDebugMode) {
        debugInfo.push(`Found issue #${issueData.issueNumber} in KV`);
        debugInfo.push(`Creating comment on issue...`);
      }

      const timestamp = new Date().toLocaleString();
      const commentBody = this.github.formatCommentBody(
        cleanedMessage,
        timestamp
      );

      const result = await this.github.createIssueComment(
        issueData.issueNumber,
        commentBody
      );

      if ("error" in result) {
        if (isDebugMode) {
          debugInfo.push(`❌ Failed to create comment: ${result.error}`);
          debugInfo.push(`Status code: ${result.status}`);

          // Add more debug info for 401 errors
          if (result.status === 401) {
            debugInfo.push("⚠️ Authentication failed - possible causes:");
            debugInfo.push("- Invalid GitHub token");
            debugInfo.push("- Token lacks 'repo' scope");
            debugInfo.push("- Token expired");
            debugInfo.push(
              `Token info: ${this.env.GITHUB_TOKEN?.substring(0, 4)}... (${
                this.env.GITHUB_TOKEN?.length
              } chars)`
            );
          }

          // Add debug info for 404 errors
          if (result.status === 404) {
            debugInfo.push("⚠️ Repository not found - possible causes:");
            debugInfo.push(
              `- Repository ${this.env.GITHUB_OWNER || GITHUB_OWNER}/${
                this.env.GITHUB_REPO || GITHUB_REPO
              } doesn't exist`
            );
            debugInfo.push("- Token doesn't have access to this repository");
            debugInfo.push("- Repository is private and token lacks access");
            debugInfo.push("- Typo in owner or repo name");
          }
        }

        await slackContext.client.reactions.remove({
          channel,
          timestamp: ts,
          name: "eyes",
        });

        const errorMessage = isDebugMode
          ? debugInfo.join("\n") +
            `\n\nFailed to add comment: ${result.error} (Status: ${result.status})`
          : `Failed to add comment to issue #${issueData.issueNumber}: ${result.error}`;

        await slackContext.say({
          text: errorMessage,
          thread_ts: threadId,
        });
        return;
      }

      if (isDebugMode) {
        debugInfo.push(`✅ Comment added successfully!`);
        debugInfo.push(`Comment ID: ${result.id}`);
      }

      let responseText = [
        `💬 Comment added to GitHub issue #${issueData.issueNumber}`,
        ``,
        `*View issue:* <${issueData.issueUrl}|#${issueData.issueNumber}>`,
      ].join("\n");

      if (isDebugMode) {
        responseText = debugInfo.join("\n") + "\n\n---\n\n" + responseText;
      }

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
      console.error("Error processing reply:", error);

      if (isDebugMode) {
        debugInfo.push(
          `❌ Unexpected error: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      try {
        await slackContext.client.reactions.remove({
          channel,
          timestamp: ts,
          name: "eyes",
        });
      } catch (removeError) {
        console.error("Failed to remove reaction:", removeError);
      }

      const errorMessage = isDebugMode
        ? debugInfo.join("\n") +
          `\n\nError: ${error instanceof Error ? error.message : String(error)}`
        : `Error: ${error instanceof Error ? error.message : String(error)}`;

      await slackContext.say({
        text: errorMessage,
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

  private async triggerProgressCheck(
    params: {
      issueNumber: number;
      channel: string;
      threadId: string;
    },
    executionCtx?: ExecutionContext
  ): Promise<void> {
    try {
      console.log(
        "Scheduling progress check in 60 seconds for issue:",
        params.issueNumber
      );

      // Get the base URL from environment or use a default
      const baseUrl =
        this.env.WORKER_URL || "https://claude-code-slack.pabio.workers.dev";

      const checkProgress = async () => {
        try {
          // Wait for 1 minute before checking
          await new Promise((resolve) => setTimeout(resolve, 60000));

          console.log("Triggering progress check after delay");
          const response = await fetch(`${baseUrl}/check-progress`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              issueNumber: params.issueNumber,
              channel: params.channel,
              threadId: params.threadId,
              attemptCount: 0,
            }),
          });

          if (!response.ok) {
            console.error("Failed to trigger progress check:", response.status);
          } else {
            console.log("Progress check triggered successfully");
          }
        } catch (error) {
          console.error("Error triggering progress check:", error);
        }
      };

      if (executionCtx) {
        // Use waitUntil to run in background
        console.log("Using executionCtx.waitUntil for background processing");
        executionCtx.waitUntil(checkProgress());
      } else {
        // Fallback: trigger immediately without delay
        console.log("No executionCtx, triggering immediately");
        await fetch(`${baseUrl}/check-progress`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            issueNumber: params.issueNumber,
            channel: params.channel,
            threadId: params.threadId,
            attemptCount: 0,
          }),
        });
      }
    } catch (error) {
      console.error("Failed to schedule progress check:", error);
    }
  }
}
