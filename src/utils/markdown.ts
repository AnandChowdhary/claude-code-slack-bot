export function markdownToSlack(markdown: string): string {
  let text = markdown;

  // Remove HTML image tags (Slack doesn't support inline images)
  text = text.replace(/<img[^>]*>/g, "");

  // First handle bold text (including at start of lines)
  text = text
    .replace(/\*\*([^*]+)\*\*/g, "*$1*")
    .replace(/__([^_]+)__/g, "*$1*");

  // Then convert headers
  text = text
    .replace(/^### (.+)$/gm, "*$1*")
    .replace(/^## (.+)$/gm, "*$1*")
    .replace(/^# (.+)$/gm, "*$1*");

  // Convert checkbox lists
  text = text
    .replace(/^- \[x\] (.+)$/gm, "✓ $1")
    .replace(/^- \[ \] (.+)$/gm, "☐ $1");

  // Convert lists - must be done before converting remaining single asterisks
  text = text
    .replace(/^[\*\-] (.+)$/gm, "• $1")
    .replace(/^\d+\. (.+)$/gm, "• $1");

  // Convert the rest
  text = text
    // Italic (only for single asterisks/underscores not at start of line)
    .replace(/(?<!^)\*([^*\n]+)\*/g, "_$1_")
    .replace(/(?<!^)_([^_\n]+)_/g, "_$1_")
    // Strikethrough
    .replace(/~~(.+?)~~/g, "~$1~")
    // Code blocks
    .replace(/```[\s\S]*?```/g, (match) => {
      return match.replace(/```(\w+)?\n?/g, "```");
    })
    // Inline code
    .replace(/`(.+?)`/g, "`$1`")
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
    // Blockquotes
    .replace(/^> (.+)$/gm, "> $1")
    // Remove excessive newlines
    .replace(/\n{3,}/g, "\n\n");

  return text;
}
