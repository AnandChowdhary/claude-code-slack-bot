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
  private token: string;
  private owner: string;
  private repo: string;
  private apiUrl = "https://api.github.com";

  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
  }

  async createIssue(
    title: string,
    body: string,
    labels?: string[]
  ): Promise<GitHubIssueResponse | GitHubError> {
    try {
      const response = await fetch(
        `${this.apiUrl}/repos/${this.owner}/${this.repo}/issues`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            body,
            labels: labels || [],
          }),
        }
      );

      if (!response.ok) {
        const errorData = (await response.json()) as { message: string };
        return {
          error: errorData.message || "Failed to create issue",
          status: response.status,
        };
      }

      const data = await response.json();
      return data as GitHubIssueResponse;
    } catch (error) {
      console.error("Error creating GitHub issue:", error);
      return {
        error: error instanceof Error ? error.message : String(error),
        status: 500,
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
}
