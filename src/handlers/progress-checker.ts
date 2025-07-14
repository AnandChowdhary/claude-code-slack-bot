import { GitHubService } from "../services/github";
import { CloudflareBindings } from "../types";

interface ProgressCheckRequest {
  issueNumber: number;
  channel: string;
  threadId: string;
  attemptCount?: number;
  lastCommentId?: number;
  slackMessageTs?: string;
}

interface SlackClient {
  chat: {
    postMessage: (params: any) => Promise<any>;
    update: (params: any) => Promise<any>;
  };
}

export class ProgressChecker {
  private env: CloudflareBindings;
  private github: GitHubService;
  private maxAttempts = 100;
  private delayMs = 10000;

  constructor(env: CloudflareBindings) {
    this.env = env;
    this.github = new GitHubService(
      env.GITHUB_TOKEN,
      env.GITHUB_OWNER || "firstquadrant-ai",
      env.GITHUB_REPO || "firstquadrant.ai"
    );
  }

  async checkProgress(request: ProgressCheckRequest): Promise<{
    shouldContinue: boolean;
    nextRequest?: ProgressCheckRequest;
  }> {
    const {
      issueNumber,
      channel,
      threadId,
      attemptCount = 0,
      lastCommentId,
      slackMessageTs,
    } = request;

    console.log("Checking progress:", {
      issueNumber,
      attemptCount,
      lastCommentId,
      slackMessageTs,
    });

    // Check if we've exceeded max attempts
    if (attemptCount >= this.maxAttempts) {
      console.log("Max attempts reached, stopping progress check");
      await this.postToSlack(
        channel,
        threadId,
        `⏱️ No new comments found. The check has timed out after ${
          (this.maxAttempts * this.delayMs) / 1000
        } seconds.`,
        slackMessageTs
      );
      return { shouldContinue: false };
    }

    // Fetch comments from GitHub
    const comments = await this.github.getIssueComments(issueNumber);

    if ("error" in comments) {
      console.error("Failed to fetch comments:", comments);
      await this.postToSlack(
        channel,
        threadId,
        `❌ Failed to check for new comments: ${comments.error}`,
        slackMessageTs
      );
      return { shouldContinue: false };
    }

    // Get all comments
    const allComments = this.github.getAllComments(comments);

    if (allComments.length === 0) {
      console.log("No comments found yet");
      return {
        shouldContinue: true,
        nextRequest: {
          ...request,
          attemptCount: attemptCount + 1,
        },
      };
    }

    // Get the latest comment
    const latestComment = allComments[allComments.length - 1];

    // Check if this is a new comment or an update
    const isNewComment = !lastCommentId || latestComment.id > lastCommentId;
    const hasBeenUpdated =
      lastCommentId === latestComment.id &&
      new Date(latestComment.updated_at) > new Date(latestComment.created_at);

    if (isNewComment || hasBeenUpdated) {
      console.log(`Comment ${isNewComment ? "created" : "updated"}:`, {
        id: latestComment.id,
        user: latestComment.user.login,
        updated_at: latestComment.updated_at,
      });

      // Format the comment for Slack
      const slackMessage = this.formatCommentForSlack(latestComment);

      // Post or update in Slack
      const slackResponse = await this.postToSlack(
        channel,
        threadId,
        slackMessage,
        hasBeenUpdated ? slackMessageTs : undefined
      );

      // Extract message timestamp from response
      const newSlackTs = slackResponse?.ts || slackMessageTs;

      // Check if task is finished
      if (this.github.isTaskFinished(latestComment.body)) {
        console.log("Task marked as finished, stopping progress check");
        return { shouldContinue: false };
      }

      // Continue checking for updates
      return {
        shouldContinue: true,
        nextRequest: {
          ...request,
          attemptCount: attemptCount + 1,
          lastCommentId: latestComment.id,
          slackMessageTs: newSlackTs,
        },
      };
    }

    // No new updates, continue checking
    return {
      shouldContinue: true,
      nextRequest: {
        ...request,
        attemptCount: attemptCount + 1,
      },
    };
  }

  private formatCommentForSlack(comment: any): string {
    const username = comment.user.login;
    const header = `💬 *Comment from ${username}*`;
    const timestamp = new Date(comment.updated_at).toLocaleString();
    const link = `<${comment.html_url}|View on GitHub>`;

    // Truncate very long messages for Slack
    let body = comment.body;
    if (body.length > 3000) {
      body =
        body.substring(0, 2900) +
        "...\n\n_[Comment truncated. See full comment on GitHub]_";
    }

    return `${header} (${timestamp})\n\n${body}\n\n${link}`;
  }

  private async postToSlack(
    channel: string,
    threadId: string,
    text: string,
    updateTs?: string
  ): Promise<any> {
    try {
      const slack = await this.getSlackClient();

      if (updateTs) {
        // Update existing message
        console.log("Updating Slack message:", updateTs);
        return await slack.chat.update({
          channel,
          ts: updateTs,
          text,
        });
      } else {
        // Post new message
        console.log("Posting new Slack message");
        return await slack.chat.postMessage({
          channel,
          thread_ts: threadId,
          text,
        });
      }
    } catch (error) {
      console.error("Failed to post to Slack:", error);
      return null;
    }
  }

  private async getSlackClient(): Promise<SlackClient> {
    // Using fetch to call Slack API directly since we're in Cloudflare Workers
    const token = this.env.SLACK_BOT_USER_OAUTH_TOKEN;

    return {
      chat: {
        postMessage: async (params: any) => {
          const response = await fetch(
            "https://slack.com/api/chat.postMessage",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(params),
            }
          );

          const data = (await response.json()) as any;
          if (!data.ok) {
            throw new Error(`Slack API error: ${data.error}`);
          }
          return data;
        },
        update: async (params: any) => {
          const response = await fetch("https://slack.com/api/chat.update", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(params),
          });

          const data = (await response.json()) as any;
          if (!data.ok) {
            throw new Error(`Slack API error: ${data.error}`);
          }
          return data;
        },
      },
    };
  }

  // Removed scheduleNextCheck - no longer needed with direct function calls
}
