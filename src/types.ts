export interface CloudflareBindings {
  SLACK_BOT_USER_OAUTH_TOKEN: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  KV: KVNamespace;
}

export interface MessageContext {
  text: string;
  channel: string;
  thread_ts: string | undefined;
  ts: string;
  context: any;
}

export interface DebugInfo {
  isDebugMode: boolean;
  info: string[];
}
