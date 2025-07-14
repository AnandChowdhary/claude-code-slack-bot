export interface CloudflareBindings {
  SLACK_BOT_USER_OAUTH_TOKEN: string;
  SLACK_BOT_USER_ID?: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  WORKER_URL?: string;
  KV: KVNamespace;
}

export interface MessageContext {
  text: string;
  channel: string;
  thread_ts: string | undefined;
  ts: string;
  context: any;
  executionCtx?: ExecutionContext;
}

export interface DebugInfo {
  isDebugMode: boolean;
  info: string[];
}
