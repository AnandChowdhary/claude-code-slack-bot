import { Octokit } from "@octokit/rest";

interface GitHubIssueResponse {
  id: number;
  number: number;
  html_url: string;
  title: string;
  state: string;
}

interface GitHubError {
  error: string;
  status: number;
}

export class GitHubService {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.octokit = new Octokit({
      auth: token,
    });
    this.owner = owner;
    this.repo = repo;
  }

  async createIssue(
    title: string,
    body: string,
    labels?: string[]
  ): Promise<GitHubIssueResponse | GitHubError> {
    try {
      console.log("Creating GitHub issue with params:", {
        owner: this.owner,
        repo: this.repo,
        title,
        bodyLength: body?.length || 0,
        labels,
      });

      const response = await this.octokit.issues.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        labels: labels || [],
      });

      console.log("GitHub issue created successfully:", {
        id: response.data.id,
        number: response.data.number,
        url: response.data.html_url,
      });

      return {
        id: response.data.id,
        number: response.data.number,
        html_url: response.data.html_url,
        title: response.data.title,
        state: response.data.state,
      };
    } catch (error: any) {
      console.error("Error creating GitHub issue:", {
        message: error.message,
        status: error.status,
        response: error.response?.data,
        headers: error.response?.headers,
      });
      return {
        error: error.message || "Failed to create issue",
        status: error.status || 500,
      };
    }
  }

  async createIssueComment(
    issueNumber: number,
    body: string
  ): Promise<{ id: number; html_url: string } | GitHubError> {
    try {
      console.log("Creating GitHub comment with params:", {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        bodyLength: body?.length || 0,
      });

      const response = await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body,
      });

      console.log("GitHub comment created successfully:", {
        id: response.data.id,
        url: response.data.html_url,
      });

      return {
        id: response.data.id,
        html_url: response.data.html_url,
      };
    } catch (error: any) {
      console.error("Error creating GitHub comment:", {
        message: error.message,
        status: error.status,
        response: error.response?.data,
        headers: error.response?.headers,
      });
      return {
        error: error.message || "Failed to create comment",
        status: error.status || 500,
      };
    }
  }

  formatIssueBody(threadHistory: string, userMessage: string): string {
    const sections = [
      "@claude, this is a request from a user that came through our Slack workspace.",
      "",
      "**Important Context:**",
      "- This request is from a Slack conversation and may be from a non-technical user",
      "- The user might be reporting a bug or requesting a new feature",
      "- The description might not include technical details or specific file/function names",
      "- You may need to search thoroughly through the codebase to find where the relevant functionality is implemented",
      "- Consider that the user's description might use different terminology than what's in the code",
      "",
      "## User's Request",
      userMessage,
      "",
      "## Full Slack Thread Context",
      "The following is the complete conversation from Slack that led to this issue:",
      "```",
      threadHistory,
      "```",
      "",
      "---",
      "_This issue was automatically created from a Slack conversation. Please analyze the request carefully and search the codebase as needed to understand and implement the user's needs._",
    ];

    return sections.join("\n");
  }

  async getIssueComments(
    issueNumber: number,
    since?: string
  ): Promise<
    | {
        id: number;
        user: { login: string };
        body: string;
        created_at: string;
        updated_at: string;
        html_url: string;
      }[]
    | GitHubError
  > {
    try {
      console.log("Fetching issue comments:", {
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        since,
      });

      const response = await this.octokit.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        since,
        per_page: 100,
      });

      console.log(`Found ${response.data.length} comments`);

      return response.data.map((comment) => ({
        id: comment.id,
        user: { login: comment.user?.login || "" },
        body: comment.body || "",
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        html_url: comment.html_url,
      }));
    } catch (error: any) {
      console.error("Error fetching issue comments:", {
        message: error.message,
        status: error.status,
      });
      return {
        error: error.message || "Failed to fetch comments",
        status: error.status || 500,
      };
    }
  }

  getAllComments(comments: any[]): any[] {
    console.log(`Found ${comments.length} total comments`);
    return comments;
  }

  isTaskFinished(commentBody: string): boolean {
    // Check if the comment contains the "Create PR" button/link
    if (commentBody.includes("[Create PR ➔]")) {
      return true;
    }

    // Also check for other completion patterns
    const finishedPatterns = [
      "claude finished",
      "implementation complete",
      "task completed",
      "done implementing",
      "finished implementing",
      "completed the implementation",
      "all changes have been made",
      "implementation is complete",
      "resolved",
      "fixed",
      "closing this issue",
    ];

    const lowerBody = commentBody.toLowerCase();
    return finishedPatterns.some((pattern) => lowerBody.includes(pattern));
  }

  formatCommentBody(userMessage: string, timestamp: string): string {
    const sections = [
      "@claude, there's an update from the user in the Slack thread:",
      "",
      `**New message** (${timestamp})`,
      "",
      userMessage,
      "",
      "---",
      "_This comment was automatically added from the ongoing Slack conversation. Please consider this additional context when working on the issue._",
    ];

    return sections.join("\n");
  }
}
