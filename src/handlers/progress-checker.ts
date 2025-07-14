import { GitHubService } from "../services/github";
import { CloudflareBindings } from "../types";
import { markdownToSlack } from "../utils/markdown";

interface ProgressCheckRequest {
  issueNumber: number;
  channel: string;
  threadId: string;
  attemptCount?: number;
  lastCommentId?: number;
  slackMessageTs?: string;
  originalMessageTs?: string;
  startTime?: number;
}

interface SlackClient {
  chat: {
    postMessage: (params: any) => Promise<any>;
    update: (params: any) => Promise<any>;
  };
  reactions: {
    remove: (params: any) => Promise<any>;
  };
}

export class ProgressChecker {
  private env: CloudflareBindings;
  private github: GitHubService;

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
      startTime,
    } = request;

    console.log("Checking progress:", {
      issueNumber,
      attemptCount,
      lastCommentId,
      slackMessageTs,
      startTime,
    });

    // Check if 30 minutes have passed
    if (startTime && Date.now() - startTime > 30 * 60 * 1000) {
      console.log("30 minutes timeout reached, stopping progress check");
      await this.postToSlack(
        channel,
        threadId,
        `⏱️ Progress monitoring stopped after 30 minutes. The task may still be in progress.`,
        slackMessageTs
      );

      // Remove the eyes emoji since we're stopping
      if (request.originalMessageTs) {
        await this.removeEyesEmoji(channel, request.originalMessageTs);
      }

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

        // Remove the eyes emoji from the original message
        if (request.originalMessageTs) {
          await this.removeEyesEmoji(channel, request.originalMessageTs);
        }

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
          originalMessageTs: request.originalMessageTs,
          startTime: request.startTime,
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
    const timestamp = new Date(comment.updated_at).toLocaleString();
    const link = `<${comment.html_url}|View on GitHub>`;

    // Convert GitHub markdown to Slack format
    let body = markdownToSlack(comment.body);

    // Truncate very long messages for Slack
    if (body.length > 3000) {
      body =
        body.substring(0, 2900) +
        "...\n\n_[Comment truncated. See full comment on GitHub]_";
    }

    // Format the complete message
    const header = `💬 *Comment from ${username}* (${timestamp})`;
    return `${header}\n\n${body}\n\n${link}`;
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
      reactions: {
        remove: async (params: any) => {
          const response = await fetch(
            "https://slack.com/api/reactions.remove",
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
      },
    };
  }

  private async removeEyesEmoji(
    channel: string,
    timestamp: string
  ): Promise<void> {
    try {
      const slack = await this.getSlackClient();
      await slack.reactions.remove({
        channel,
        timestamp,
        name: "eyes",
      });
      console.log("Removed eyes emoji from original message");
    } catch (error) {
      console.error("Failed to remove eyes emoji:", error);
    }
  }

  // Removed scheduleNextCheck - no longer needed with direct function calls
}
