/**
 * Agent presence (cp-support-inbox AC7.6). Tracks which agents are online so the
 * realtime gateway can decide between live delivery and the offline email fallback.
 * In-memory for a single instance; backed by the Redis adapter for fan-out across
 * instances in production.
 */
export class PresenceTracker {
  private readonly online = new Set<string>();

  agentConnected(agentUserId: string): void {
    this.online.add(agentUserId);
  }
  agentDisconnected(agentUserId: string): void {
    this.online.delete(agentUserId);
  }
  anyAgentOnline(): boolean {
    return this.online.size > 0;
  }
  /** Whether a specific agent is online — drives presence-aware routing. */
  isOnline(agentUserId: string): boolean {
    return this.online.has(agentUserId);
  }
  onlineCount(): number {
    return this.online.size;
  }
}

let instance: PresenceTracker | null = null;
export function getPresence(): PresenceTracker {
  if (!instance) instance = new PresenceTracker();
  return instance;
}
