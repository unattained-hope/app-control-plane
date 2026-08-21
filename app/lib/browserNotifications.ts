/**
 * Browser popup notification utilities (Web Notifications API).
 */

export type NotificationPermissionStatus = "granted" | "denied" | "default" | "unsupported";

function getGlobalScope(): typeof globalThis & { Notification?: typeof Notification } {
  if (typeof window !== "undefined" && typeof window.Notification !== "undefined") {
    return window;
  }
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as unknown as { Notification?: typeof Notification }).Notification !== "undefined"
  ) {
    return globalThis as typeof globalThis & { Notification?: typeof Notification };
  }
  return typeof window !== "undefined"
    ? window
    : (globalThis as typeof globalThis & { Notification?: typeof Notification });
}

/** Check if Web Notifications API is supported in the current environment. */
export function isNotificationSupported(): boolean {
  const g = getGlobalScope();
  return typeof g !== "undefined" && typeof g.Notification !== "undefined";
}

/** Get current notification permission status. */
export function getNotificationPermission(): NotificationPermissionStatus {
  const g = getGlobalScope();
  if (!isNotificationSupported() || !g.Notification) return "unsupported";
  return g.Notification.permission;
}

/** Request notification permission from the user. */
export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  const g = getGlobalScope();
  if (!isNotificationSupported() || !g.Notification) return "unsupported";
  try {
    const result = await g.Notification.requestPermission();
    return result;
  } catch {
    return g.Notification.permission;
  }
}

export interface BrowserNotificationOptions {
  readonly title: string;
  readonly body: string;
  readonly tag?: string;
  readonly icon?: string;
  readonly requireInteraction?: boolean;
  readonly autoCloseMs?: number;
  readonly onClick?: () => void;
}

const activeNotifications = new Map<string, Notification>();

/**
 * Display a browser popup notification if permissions are granted.
 */
export function showBrowserNotification(options: BrowserNotificationOptions): Notification | null {
  const g = getGlobalScope();
  if (!isNotificationSupported() || !g.Notification || g.Notification.permission !== "granted") {
    return null;
  }

  try {
    const { title, body, tag, icon, requireInteraction, autoCloseMs = 15000, onClick } = options;

    // If there's an existing notification with the same tag, close it first
    if (tag && activeNotifications.has(tag)) {
      try {
        activeNotifications.get(tag)?.close();
      } catch {
        // ignore
      }
      activeNotifications.delete(tag);
    }

    const NotificationConstructor = g.Notification;
    const notification = new NotificationConstructor(title, {
      body,
      tag,
      icon: icon ?? "/favicon.ico",
      requireInteraction: requireInteraction ?? false,
    });

    if (tag) {
      activeNotifications.set(tag, notification);
    }

    notification.onclick = (event) => {
      event?.preventDefault?.();
      try {
        if (typeof window !== "undefined") {
          window.focus();
        }
      } catch {
        // ignore
      }
      onClick?.();
      notification.close();
      if (tag) activeNotifications.delete(tag);
    };

    notification.onclose = () => {
      if (tag) activeNotifications.delete(tag);
    };

    if (autoCloseMs > 0) {
      setTimeout(() => {
        try {
          notification.close();
        } catch {
          // ignore
        }
        if (tag) activeNotifications.delete(tag);
      }, autoCloseMs);
    }

    return notification;
  } catch {
    return null;
  }
}

/** Close active notification by tag. */
export function closeBrowserNotification(tag: string): void {
  const notif = activeNotifications.get(tag);
  if (notif) {
    try {
      notif.close();
    } catch {
      // ignore
    }
    activeNotifications.delete(tag);
  }
}
