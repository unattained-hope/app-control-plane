import { useEffect, useState } from "react";
import { Phone, PhoneCall, VolumeX, MessageSquare } from "lucide-react";
import { useAgentChatSocket } from "~/lib/agentChatSocket.js";
import { StoreAvatar } from "~/components/StoreAvatar.js";

export function IncomingCallBanner() {
  const { activeIncomingCall, answerIncomingCall, dismissIncomingCall } = useAgentChatSocket();
  const [remainingSec, setRemainingSec] = useState(30);

  useEffect(() => {
    if (!activeIncomingCall) return;

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - activeIncomingCall.startedAt) / 1000);
      const left = Math.max(0, 30 - elapsed);
      setRemainingSec(left);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 500);
    return () => clearInterval(interval);
  }, [activeIncomingCall]);

  if (!activeIncomingCall) return null;

  const progressPercent = Math.max(0, Math.min(100, (remainingSec / 30) * 100));

  return (
    <aside
      className="apoaap-incoming-call-overlay"
      role="alert"
      aria-live="assertive"
      aria-label={`Incoming chat from ${activeIncomingCall.shop}`}
    >
      <div className="apoaap-incoming-call-card">
        {/* Animated 30-second progress countdown bar */}
        <div
          className="apoaap-incoming-call-progress"
          style={{ width: `${progressPercent}%` }}
          aria-hidden="true"
        />

        <div className="apoaap-incoming-call-body">
          <div className="apoaap-incoming-call-avatar-wrapper">
            <div className="apoaap-incoming-call-pulse" aria-hidden="true" />
            <div className="apoaap-incoming-call-avatar">
              <StoreAvatar shop={activeIncomingCall.shop} size="md" />
            </div>
          </div>

          <div className="apoaap-incoming-call-content">
            <div className="apoaap-incoming-call-header">
              <span className="apoaap-incoming-call-badge">
                <Phone className="h-3 w-3 animate-bounce text-emerald-400" aria-hidden="true" />
                <span>New Incoming Chat</span>
              </span>
              <span className="apoaap-incoming-call-timer" aria-label={`${remainingSec} seconds remaining`}>
                {remainingSec}s
              </span>
            </div>

            <h3 className="apoaap-incoming-call-shop truncate" title={activeIncomingCall.shop}>
              {activeIncomingCall.shop}
            </h3>

            {activeIncomingCall.messageText ? (
              <p className="apoaap-incoming-call-preview">
                <MessageSquare className="h-3 w-3 shrink-0 inline mr-1 text-slate-400" aria-hidden="true" />
                <span className="truncate">{activeIncomingCall.messageText}</span>
              </p>
            ) : (
              <p className="apoaap-incoming-call-preview text-slate-400">
                Merchant initiated a live chat
              </p>
            )}
          </div>

          <div className="apoaap-incoming-call-actions">
            <button
              type="button"
              className="apoaap-incoming-call-answer-btn"
              onClick={() => answerIncomingCall(activeIncomingCall.conversationId)}
              aria-label={`Answer chat with ${activeIncomingCall.shop}`}
            >
              <PhoneCall className="h-4 w-4" aria-hidden="true" />
              <span>Answer</span>
            </button>

            <button
              type="button"
              className="apoaap-incoming-call-dismiss-btn"
              onClick={dismissIncomingCall}
              title="Silence ringer"
              aria-label="Silence ringer"
            >
              <VolumeX className="h-4 w-4" aria-hidden="true" />
              <span>Silence</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
