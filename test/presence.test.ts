import { describe, it, expect } from "vitest";
import { PresenceTracker } from "~/server/realtime/presence.js";

/** cp-support-inbox — agent presence drives the offline email fallback. */
describe("PresenceTracker", () => {
  it("reports no agent online initially", () => {
    const p = new PresenceTracker();
    expect(p.anyAgentOnline()).toBe(false);
    expect(p.onlineCount()).toBe(0);
  });

  it("tracks connect/disconnect", () => {
    const p = new PresenceTracker();
    p.agentConnected("agent-1");
    expect(p.anyAgentOnline()).toBe(true);
    expect(p.onlineCount()).toBe(1);
    p.agentDisconnected("agent-1");
    expect(p.anyAgentOnline()).toBe(false);
  });

  it("counts distinct agents", () => {
    const p = new PresenceTracker();
    p.agentConnected("a");
    p.agentConnected("b");
    p.agentConnected("a"); // dup
    expect(p.onlineCount()).toBe(2);
  });
});
