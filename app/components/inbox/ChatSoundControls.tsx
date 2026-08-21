import { Bell, BellOff, Volume2, VolumeX, Music, PhoneIncoming } from "lucide-react";
import { useAgentChatSocket } from "~/lib/agentChatSocket.js";

export function ChatSoundControls() {
  const {
    soundEnabled,
    toggleSound,
    testNotificationSound,
    testCallRinger,
    notificationPermission,
    requestNotifications,
  } = useAgentChatSocket();

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Chat sound and notification settings">
      {/* Sound Enabled / Muted Toggle */}
      <button
        type="button"
        onClick={toggleSound}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border transition-colors ${
          soundEnabled
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
            : "border-slate-500/30 bg-slate-500/10 text-slate-500 hover:bg-slate-500/20"
        }`}
        title={soundEnabled ? "Sound alerts enabled — click to mute" : "Sound alerts muted — click to unmute"}
        aria-label={soundEnabled ? "Mute notification sounds" : "Unmute notification sounds"}
      >
        {soundEnabled ? (
          <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span>{soundEnabled ? "Sound On" : "Muted"}</span>
      </button>

      {/* Test Message Sound Button */}
      <button
        type="button"
        onClick={testNotificationSound}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
        title="Test message notification chime sound"
        aria-label="Test message sound"
      >
        <Music className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Test Chime</span>
      </button>

      {/* Test Call Ringer Button */}
      <button
        type="button"
        onClick={() => testCallRinger(5)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
        title="Test incoming call ringer (5 seconds)"
        aria-label="Test call ringer"
      >
        <PhoneIncoming className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Test Ring</span>
      </button>

      {/* Desktop Notifications Permission Toggle */}
      {notificationPermission === "default" ? (
        <button
          type="button"
          onClick={() => void requestNotifications()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors"
          title="Enable browser desktop notifications for new chats and messages"
        >
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Enable Popups</span>
        </button>
      ) : notificationPermission === "denied" ? (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs text-slate-400"
          title="Browser notifications are blocked in your browser site settings"
        >
          <BellOff className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span>Popups Blocked</span>
        </span>
      ) : null}
    </div>
  );
}
