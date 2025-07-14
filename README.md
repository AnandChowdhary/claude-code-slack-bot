# 🤖 Claude Code Slack integration

Seamlessly connect Slack with Claude Code to turn your team's feature requests and bug reports into GitHub issues with AI-powered implementation. Built with Cloudflare Workers, Hono, and TypeScript on top of [Claude Code Action](https://github.com/anthropics/claude-code-action).

## 📸 How it works

### 1. Request a feature in Slack

When you mention the bot, it acknowledges your request and creates a GitHub issue:

<img width="600" alt="Slack request asking Claude Code to update README with a reply that its started work" src="https://github.com/user-attachments/assets/01f1fe0c-86f7-4179-aad4-6d86cfb02611" />

### 2. Get real-time progress updates

As Claude Code works on your request, you'll see progress updates in the Slack thread:

<img width="600" alt="Slack thread showing progress of Claude Code updating README" src="https://github.com/user-attachments/assets/115ccaaa-9362-4567-b534-f262a284aed3" />

### 3. Behind the scenes

The bot creates a GitHub issue with full context from your Slack conversation:

<img width="600" alt="Initial GitHub comment" src="https://github.com/user-attachments/assets/e719223c-94c6-484f-aba8-35a8870866e3" />

## 🚀 Setup instructions

### 📋 Prerequisites

- Claude Code Action installed in your repository
- Cloudflare account with Workers enabled
- Slack workspace with admin access
- GitHub repository with Claude Code configured
- GitHub personal access token with `repo` scope
- Node.js 18+ and npm/yarn

### 1. Clone and install

```bash
git clone https://github.com/your-org/claude-code-slack
cd claude-code-slack
npm install
```

### 2. Configure Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Choose "From scratch" and select your workspace
3. Navigate to **OAuth & Permissions** and add these scopes:

   **Bot token scopes:**

   - `app_mentions:read` - Read messages that mention your app
   - `chat:write` - Send messages as the bot
   - `reactions:write` - Add emoji reactions
   - `reactions:read` - View emoji reactions
   - `channels:history` - View messages in public channels
   - `groups:history` - View messages in private channels
   - `im:history` - View messages in DMs
   - `mpim:history` - View messages in group DMs

4. Install the app to your workspace and copy the **Bot user OAuth token**

### 3. Configure event subscriptions

1. In your Slack app settings, go to **Event Subscriptions**
2. Enable Events and add your Worker URL: `https://your-worker.workers.dev/slack/events`
3. Subscribe to these bot events:
   - `app_mention` - When someone mentions your bot
   - `message.channels` - Messages in public channels (for thread replies)
   - `message.groups` - Messages in private channels (for thread replies)
   - `message.im` - Direct messages
   - `message.mpim` - Group direct messages

### 4. Set environment variables

Create a `.dev.vars` file for local development:

```env
SLACK_BOT_USER_OAUTH_TOKEN=xoxb-your-token
GITHUB_TOKEN=ghp_your_token
GITHUB_OWNER=your-org
GITHUB_REPO=your-repo
```

### 5. Configure Cloudflare resources

#### KV namespace

Create a KV namespace for storing issue-thread mappings:

```bash
wrangler kv:namespace create "KV"
```

#### Queue

Create a queue for handling progress checks:

```bash
wrangler queues create progress-checks
```

Update `wrangler.jsonc` with your resource IDs:

```json
{
  "name": "claude-code-slack",
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "your-kv-namespace-id"
    }
  ],
  "queues": {
    "producers": [{ "binding": "PROGRESS_QUEUE", "queue": "progress-checks" }],
    "consumers": [{ "queue": "progress-checks" }]
  }
}
```

### 6. Deploy to Cloudflare

```bash
# Deploy to production
npm run deploy

# Or for development
npm run dev
```

## ⚙️ Configuration

### Environment variables

| Variable                     | Description                                    | Required |
| ---------------------------- | ---------------------------------------------- | -------- |
| `SLACK_BOT_USER_OAUTH_TOKEN` | Slack bot OAuth token                          | ✅       |
| `GITHUB_TOKEN`               | GitHub personal access token with `repo` scope | ✅       |
| `GITHUB_OWNER`               | GitHub organization or username                | ✅       |
| `GITHUB_REPO`                | GitHub repository name                         | ✅       |

### KV storage

The bot uses Cloudflare KV to store:

- Issue-to-thread mappings (30-day TTL)
- Enables persistent connection between Slack threads and GitHub issues

### Queue system

Uses Cloudflare Queues to:

- Handle progress monitoring asynchronously
- Check for GitHub updates every 10 seconds
- Automatically stop monitoring after 30 minutes or when work is complete

## 🧪 Testing & debugging

### Debug mode

Add `[DEBUG]` to any message to see detailed information:

- Channel and thread details
- KV storage operations
- GitHub API calls
- Queue processing steps

Example:

```
@claude-bot [DEBUG] Can you help me fix the login button?
```

### Common issues

1. **Bot not responding**:

   - Verify OAuth scopes include all required permissions
   - Check event subscriptions are properly configured
   - Ensure bot is added to the channel

2. **No GitHub issue created**:

   - Confirm GitHub token has `repo` scope
   - Verify GITHUB_OWNER and GITHUB_REPO are correct
   - Check for API rate limits

3. **Progress updates not appearing**:
   - Ensure queue is properly configured in wrangler.jsonc
   - Check queue consumer is running
   - Verify KV namespace is accessible

## 🔧 How it works

1. **User mentions bot** → Bot adds 👀 reaction and creates GitHub issue
2. **Issue created** → Claude Code starts working, queue monitors progress
3. **Progress updates** → Every 10 seconds, check for new GitHub comments
4. **Updates posted** → Convert GitHub markdown to Slack format and post
5. **Completion detected** → When "[Create PR ➔]" appears or 30 minutes pass, remove 👀

## 📝 License

[MIT](./LICENSE)
