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
      const response = await this.octokit.issues.create({
        owner: this.owner,
        repo: this.repo,
        title,
        body,
        labels: labels || [],
      });

      return {
        id: response.data.id,
        number: response.data.number,
        html_url: response.data.html_url,
        title: response.data.title,
        state: response.data.state,
      };
    } catch (error: any) {
      console.error("Error creating GitHub issue:", error);
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
      const response = await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body,
      });

      return {
        id: response.data.id,
        html_url: response.data.html_url,
      };
    } catch (error: any) {
      console.error("Error creating GitHub comment:", error);
      return {
        error: error.message || "Failed to create comment",
        status: error.status || 500,
      };
    }
  }

  formatIssueBody(threadHistory: string, userMessage: string): string {
    const sections = [
      "## Issue Description",
      userMessage,
      "",
      "## Slack Thread Context",
      "```",
      threadHistory,
      "```",
      "",
      "---",
      "_This issue was automatically created from a Slack conversation._",
    ];

    return sections.join("\n");
  }

  formatCommentBody(userMessage: string, timestamp: string): string {
    const sections = [
      `**New message from Slack thread** (${timestamp})`,
      "",
      userMessage,
      "",
      "---",
      "_This comment was automatically added from the Slack conversation._",
    ];

    return sections.join("\n");
  }
}
