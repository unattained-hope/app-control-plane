import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import { stubValidEnv } from "./helpers/env.js";
import { FakeDb } from "./helpers/fakeDb.js";
import {
  playNotificationSound,
  startCallRinger,
  stopCallRinger,
  isRingerActive,
  getAudioContext,
  isSoundEnabled,
  setSoundEnabled,
  unlockAudio,
} from "~/lib/chatAudio.js";
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  showBrowserNotification,
  closeBrowserNotification,
} from "~/lib/browserNotifications.js";

beforeAll(() => stubValidEnv());

const { ConversationService } = await import("~/server/services/conversationService.js");

describe("chatAudio (Web Audio call ringer & notification chime)", () => {
  let originalAudioContext: unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    originalAudioContext = (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  });

  afterEach(() => {
    stopCallRinger();
    vi.clearAllTimers();
    vi.useRealTimers();
    (globalThis as unknown as { AudioContext?: unknown }).AudioContext = originalAudioContext;
  });

  it("handles non-browser or missing AudioContext safely without throwing", () => {
    expect(isRingerActive()).toBe(false);
    playNotificationSound();
    const stop = startCallRinger({ durationSec: 5 });
    expect(isRingerActive()).toBe(true);
    stop();
    expect(isRingerActive()).toBe(false);
  });

  it("respects sound enabled / muted state", () => {
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);

    let stopped = false;
    startCallRinger({
      durationSec: 5,
      onStop: () => {
        stopped = true;
      },
    });

    expect(isRingerActive()).toBe(false);
    expect(stopped).toBe(true);

    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });

  it("stops call ringer immediately when stopCallRinger() is called", () => {
    let stopped = false;
    startCallRinger({
      durationSec: 30,
      onStop: () => {
        stopped = true;
      },
    });

    expect(isRingerActive()).toBe(true);

    // Stop after 5 seconds
    vi.advanceTimersByTime(5000);
    stopCallRinger();

    expect(stopped).toBe(true);
    expect(isRingerActive()).toBe(false);
  });

  it("synthesizes audio with AudioContext mock when available", () => {
    const mockOscillator = {
      type: "sine",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
    };
    const mockGain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const mockAudioContext = {
      state: "running",
      currentTime: 10,
      destination: {},
      createOscillator: vi.fn(() => mockOscillator),
      createGain: vi.fn(() => mockGain),
      resume: vi.fn().mockResolvedValue(undefined),
    };

    (globalThis as unknown as { AudioContext: unknown }).AudioContext = vi.fn(() => mockAudioContext);

    // Notification sound test
    playNotificationSound();

    // Call ringer test
    startCallRinger({ durationSec: 10 });
    expect(isRingerActive()).toBe(true);

    // Trigger ring pulse timer
    vi.advanceTimersByTime(100);

    stopCallRinger();
    expect(isRingerActive()).toBe(false);
  });
});

describe("browserNotifications", () => {
  let originalNotification: unknown;

  beforeEach(() => {
    originalNotification = (globalThis as unknown as { Notification?: unknown }).Notification;
  });

  afterEach(() => {
    (globalThis as unknown as { Notification?: unknown }).Notification = originalNotification;
  });

  it("reports unsupported when Notification is absent", () => {
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
    expect(isNotificationSupported()).toBe(false);
    expect(getNotificationPermission()).toBe("unsupported");
    expect(showBrowserNotification({ title: "Hi", body: "Test" })).toBeNull();
  });

  it("creates and closes browser notifications when permission is granted", async () => {
    const mockClose = vi.fn();
    const mockNotificationConstructor = vi.fn().mockImplementation(function (
      this: { close: () => void; onclick?: (ev: unknown) => void; onclose?: () => void },
      title: string,
      options: unknown,
    ) {
      this.close = mockClose;
    });
    (mockNotificationConstructor as unknown as { permission: string; requestPermission: () => Promise<string> }).permission = "granted";
    (mockNotificationConstructor as unknown as { requestPermission: () => Promise<string> }).requestPermission = vi.fn().mockResolvedValue("granted");

    (globalThis as unknown as { Notification: unknown }).Notification = mockNotificationConstructor;

    expect(isNotificationSupported()).toBe(true);
    expect(getNotificationPermission()).toBe("granted");

    const perm = await requestNotificationPermission();
    expect(perm).toBe("granted");

    let clicked = false;
    const notif = showBrowserNotification({
      title: "Incoming Chat: dev-shop.myshopify.com",
      body: "Hello, I need help",
      tag: "call-c123",
      onClick: () => {
        clicked = true;
      },
    });

    expect(notif).toBeTruthy();
    expect(mockNotificationConstructor).toHaveBeenCalledWith(
      "Incoming Chat: dev-shop.myshopify.com",
      expect.objectContaining({
        body: "Hello, I need help",
        tag: "call-c123",
      }),
    );

    // Test click handler
    notif?.onclick?.({ preventDefault: vi.fn() } as never);
    expect(clicked).toBe(true);
    expect(mockClose).toHaveBeenCalled();

    // Test close by tag
    closeBrowserNotification("call-c123");
  });
});

describe("ConversationService.getOrCreateForShop & getById", () => {
  it("flags isNew: true when creating a new conversation and isNew: false for existing", async () => {
    const db = new FakeDb();
    const svc = new ConversationService(db as never);

    const first = await svc.getOrCreateForShop("saleswitch", "test-shop.myshopify.com");
    expect(first.id).toBeTruthy();
    expect(first.isNew).toBe(true);

    const second = await svc.getOrCreateForShop("saleswitch", "test-shop.myshopify.com");
    expect(second.id).toBe(first.id);
    expect(second.isNew).toBe(false);
  });

  it("fetches conversation details by id via getById()", async () => {
    const db = new FakeDb();
    const svc = new ConversationService(db as never);

    const { id } = await svc.getOrCreateForShop("saleswitch", "alpha.myshopify.com");
    const found = await svc.getById(id);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(id);
    expect(found?.shop).toBe("alpha.myshopify.com");
    expect(found?.appKey).toBe("saleswitch");
    expect(found?.status).toBe("OPEN");

    const notFound = await svc.getById("non-existent-id");
    expect(notFound).toBeNull();
  });

  it("auto-assigns unassigned conversation to agent when received/opened", async () => {
    const db = new FakeDb();
    const convoSvc = new ConversationService(db as never);

    const { id } = await convoSvc.getOrCreateForShop("saleswitch", "support-buyer.myshopify.com");
    const before = await convoSvc.getById(id);
    expect(before?.assignedTo).toBeNull();

    // Agent joins / opens conversation -> auto-assigns to this agent
    await convoSvc.assign(
      {
        actorUserId: "agent_42",
        actorEmail: "agent42@apoaap.com",
        appKey: "saleswitch",
        ip: null,
        userAgent: null,
      },
      id,
      "agent_42",
    );

    const after = await convoSvc.getById(id);
    expect(after?.assignedTo).toBe("agent_42");

    const audit = db.store.auditLog.find((a) => a.action === "conversation.assigned" && a.target === id);
    expect(audit).toBeTruthy();
    expect(audit?.after).toEqual({ assignedTo: "agent_42" });
  });
});
