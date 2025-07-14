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
  isFinalCheck?: boolean;
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

    if (startTime && Date.now() - startTime > 30 * 60 * 1000) {
      console.log("30 minutes timeout reached, stopping progress check");
      await this.postToSlack(
        channel,
        threadId,
        `⏱️ Progress monitoring stopped after 30 minutes. The task may still be in progress.`,
        slackMessageTs
      );

      if (request.originalMessageTs) {
        await this.removeEyesEmoji(channel, request.originalMessageTs);
      }

      return { shouldContinue: false };
    }

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

    const latestComment = allComments[allComments.length - 1];

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

      const slackMessages = this.formatCommentForSlack(latestComment);

      let slackResponse = null;
      let newSlackTs = slackMessageTs;

      // For updates, we can only update with the first message
      if (hasBeenUpdated && slackMessages.length > 0) {
        // If the first message is too long for an update, post as new messages instead
        if (slackMessages[0].length > 3900) {
          // Leave some buffer for Slack metadata
          console.log(
            "Updated message too long, posting as new messages instead"
          );
          for (const message of slackMessages) {
            slackResponse = await this.postToSlack(channel, threadId, message);
          }
        } else {
          slackResponse = await this.postToSlack(
            channel,
            threadId,
            slackMessages[0],
            slackMessageTs
          );

          // Post remaining messages as new messages
          for (let i = 1; i < slackMessages.length; i++) {
            await this.postToSlack(channel, threadId, slackMessages[i]);
          }
        }
      } else {
        // For new comments, post all messages
        for (let i = 0; i < slackMessages.length; i++) {
          slackResponse = await this.postToSlack(
            channel,
            threadId,
            slackMessages[i]
          );
          // Save the timestamp of the first message
          if (i === 0) {
            newSlackTs = slackResponse?.ts || slackMessageTs;
          }
        }
      }

      if (this.github.isTaskFinished(latestComment.body)) {
        console.log("Task marked as finished, stopping progress check");

        if (request.originalMessageTs) {
          await this.removeEyesEmoji(channel, request.originalMessageTs);
        }

        // Do one final check to capture any last updates
        return {
          shouldContinue: true,
          nextRequest: {
            ...request,
            attemptCount: attemptCount + 1,
            lastCommentId: latestComment.id,
            slackMessageTs: newSlackTs,
            originalMessageTs: request.originalMessageTs,
            startTime: request.startTime,
            isFinalCheck: true,
          },
        };
      }

      // If this was the final check, stop now
      if (request.isFinalCheck) {
        console.log("Final check completed");
        return { shouldContinue: false };
      }

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

    return {
      shouldContinue: true,
      nextRequest: {
        ...request,
        attemptCount: attemptCount + 1,
      },
    };
  }

  private formatCommentForSlack(comment: any): string[] {
    const link = `<${comment.html_url}|View on GitHub>`;
    const body = markdownToSlack(comment.body);
    const maxLength = 3900; // Leave buffer for Slack metadata

    // If the message is short, return as single message
    if (body.length + link.length + 4 < maxLength) {
      return [`${body}\n\n${link}`];
    }

    // Split by double newlines (paragraphs)
    const paragraphs = body.split(/\n\n+/).filter((p) => p.trim());
    const messages: string[] = [];
    let currentMessage = "";

    for (let i = 0; i < paragraphs.length; i++) {
      let paragraph = paragraphs[i];

      // Handle paragraphs that are themselves too long
      while (paragraph.length > maxLength - 100) {
        // Leave room for formatting
        // Find a good breaking point (period, newline, or space)
        let breakPoint = maxLength - 100;
        const lastPeriod = paragraph.lastIndexOf(".", breakPoint);
        const lastNewline = paragraph.lastIndexOf("\n", breakPoint);
        const lastSpace = paragraph.lastIndexOf(" ", breakPoint);

        breakPoint = Math.max(lastPeriod, lastNewline, lastSpace);
        if (breakPoint <= 0) breakPoint = maxLength - 100;

        const chunk = paragraph.substring(0, breakPoint).trim();
        paragraph = paragraph.substring(breakPoint).trim();

        if (
          currentMessage &&
          (currentMessage + "\n\n" + chunk).length > maxLength
        ) {
          messages.push(currentMessage);
          currentMessage = chunk;
        } else {
          currentMessage = currentMessage
            ? `${currentMessage}\n\n${chunk}`
            : chunk;
        }
      }

      // Add the remaining paragraph
      if (paragraph) {
        if (
          currentMessage &&
          (currentMessage + "\n\n" + paragraph).length > maxLength
        ) {
          messages.push(currentMessage);
          currentMessage = paragraph;
        } else {
          currentMessage = currentMessage
            ? `${currentMessage}\n\n${paragraph}`
            : paragraph;
        }
      }
    }

    // Add any remaining content
    if (currentMessage) {
      messages.push(currentMessage);
    }

    // Add the link to the last message if it fits
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.length + link.length + 4 < maxLength) {
        messages[messages.length - 1] += `\n\n${link}`;
      } else {
        // If link doesn't fit, add it as a separate message
        messages.push(link);
      }
    }

    return messages.length > 0 ? messages : [link];
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
        console.log("Updating Slack message:", updateTs);
        return await slack.chat.update({
          channel,
          ts: updateTs,
          text,
        });
      } else {
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
}
