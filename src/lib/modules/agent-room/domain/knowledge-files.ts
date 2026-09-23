/** Sensitive runtime/config files must never become a shared search index. */
export function assertKnowledgePath(path: string): void {
  const parts = path.toLowerCase().split(/[\\/]/);
  if (parts.some(part => part === '..' || part === '.env' || part.startsWith('.env.') || ['.git', '.ssh', '.aws', '.gnupg', 'id_rsa', 'id_ed25519'].includes(part))
    || /(?:^|[\\/])\.orkestrai[\\/](?:workspace|runtime)\.json$/i.test(path)
    || /\.(?:p12|pfx|key)$/i.test(path)) throw new Error('knowledge_sensitive_source');
}
