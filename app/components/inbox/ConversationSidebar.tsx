import { useState } from "react";
import type { Role } from "@prisma/client";
import { Badge, Button, Select, SelectItem, Text, TextInput } from "@tremor/react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { trpc } from "~/lib/trpc.js";
import { StoreAvatar } from "~/components/StoreAvatar.js";
import type { Conversation, Priority } from "./types.js";
import { PRIORITIES, STATUSES, STATUS_LABEL, formatPriorityLabel } from "./format.js";
import { canCompose } from "./ConversationComposer.js";

function Merchant360Card({ shop }: { readonly shop: string }) {
  return (
    <div className="apoaap-inbox-sidebar-section">
      <div className="flex items-center justify-between mb-2">
        <span className="apoaap-inbox-sidebar-label">Merchant Overview</span>
        <a
          href={`https://${shop}`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-cp-accent hover:underline flex items-center gap-1"
          title="Open storefront"
        >
          Store <ExternalLink size={11} />
        </a>
      </div>
      <div className="p-3 rounded-lg bg-cp-surface-2 border border-cp-border space-y-2 text-xs">
        <div className="flex items-center gap-2.5 pb-2 border-b border-cp-border/50">
          <StoreAvatar shop={shop} size="sm" />
          <div className="min-w-0 flex-1">
            <span className="text-cp-text font-mono text-[11px] font-semibold truncate block" title={shop}>
              {shop}
            </span>
          </div>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-cp-text-muted">Account Health</span>
          <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold border border-emerald-500/20 flex items-center gap-1">
            <ShieldCheck size={11} /> HEALTHY
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-cp-text-muted">Active App</span>
          <span className="font-semibold text-cp-text font-mono">SaleSwitch / Badgy</span>
        </div>
      </div>
    </div>
  );
}

function StatusSelect({
  conversation,
  onChanged,
}: {
  readonly conversation: Conversation;
  readonly onChanged: () => void;
}) {
  const setStatus = trpc.chat.setStatus.useMutation({ onSuccess: onChanged });
  return (
    <div className="apoaap-inbox-sidebar-section">
      <label htmlFor="inbox-status" className="apoaap-inbox-sidebar-label">
        Status
      </label>
      <Select
        id="inbox-status"
        value={conversation.status}
        onValueChange={(v) =>
          setStatus.mutate({ conversationId: conversation.id, status: v as Conversation["status"] })
        }
        aria-label="Set conversation status"
        enableClear={false}
      >
        {STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {STATUS_LABEL[s]}
          </SelectItem>
        ))}
      </Select>
      {setStatus.isError ? (
        <Text className="apoaap-inbox-sidebar-error" role="alert">
          {setStatus.error.message}
        </Text>
      ) : null}
    </div>
  );
}

function PrioritySelect({
  conversation,
  onChanged,
}: {
  readonly conversation: Conversation;
  readonly onChanged: () => void;
}) {
  const setPriority = trpc.chat.setPriority.useMutation({ onSuccess: onChanged });
  return (
    <div className="apoaap-inbox-sidebar-section">
      <label htmlFor="inbox-priority" className="apoaap-inbox-sidebar-label">
        Priority
      </label>
      <Select
        id="inbox-priority"
        value={conversation.priority}
        onValueChange={(v) =>
          setPriority.mutate({ conversationId: conversation.id, priority: v as Priority })
        }
        aria-label="Set conversation priority"
        enableClear={false}
      >
        {PRIORITIES.map((p) => (
          <SelectItem key={p} value={p}>
            {formatPriorityLabel(p)}
          </SelectItem>
        ))}
      </Select>
      {setPriority.isError ? (
        <Text className="apoaap-inbox-sidebar-error" role="alert">
          {setPriority.error.message}
        </Text>
      ) : null}
    </div>
  );
}

function ConversationTags({
  conversationId,
}: {
  readonly conversationId: string;
}) {
  const [label, setLabel] = useState("");
  const utils = trpc.useUtils();
  const tagsQuery = trpc.chat.tags.useQuery({ conversationId });
  const invalidate = () => void utils.chat.tags.invalidate({ conversationId });
  const addTag = trpc.chat.addTag.useMutation({
    onSuccess: () => {
      setLabel("");
      invalidate();
    },
  });
  const removeTag = trpc.chat.removeTag.useMutation({ onSuccess: invalidate });

  const tags = tagsQuery.data ?? [];

  return (
    <div className="apoaap-inbox-sidebar-section" aria-label="Conversation tags">
      <span className="apoaap-inbox-sidebar-label">Tags</span>
      <div className="apoaap-inbox-tags">
        {tags.length === 0 ? (
          <Text className="text-xs text-cp-text-subtle">No tags.</Text>
        ) : (
          tags.map((t) => (
            <Badge key={t} aria-label={`Tag ${t}`}>
              {t}
              <button
                type="button"
                className="apoaap-inbox-tag-remove"
                aria-label={`Remove tag ${t}`}
                onClick={() => removeTag.mutate({ conversationId, label: t })}
              >
                ×
              </button>
            </Badge>
          ))
        )}
      </div>
      <form
        className="apoaap-inbox-tag-form"
        aria-label="Add conversation tag"
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) return;
          addTag.mutate({ conversationId, label: label.trim() });
        }}
      >
        <TextInput placeholder="Add tag…" value={label} onValueChange={setLabel} aria-label="Tag label" />
        <Button size="xs" type="submit" disabled={!label.trim() || addTag.isPending}>
          Add
        </Button>
      </form>
    </div>
  );
}

function CannedReplyPicker({
  shop,
  onInsert,
}: {
  readonly shop: string;
  readonly onInsert: (body: string) => void;
}) {
  const listQuery = trpc.canned.list.useQuery();
  const utils = trpc.useUtils();
  const replies = listQuery.data ?? [];

  async function handleInsert(id: string) {
    const rendered = await utils.canned.render.fetch({ id, shop });
    onInsert(rendered.body);
  }

  return (
    <div className="apoaap-inbox-sidebar-section" aria-label="Canned replies">
      <span className="apoaap-inbox-sidebar-label">Canned replies</span>
      {replies.length === 0 ? (
        <Text className="text-xs text-cp-text-subtle">No canned replies yet.</Text>
      ) : (
        <div className="apoaap-inbox-canned-buttons">
          {replies.map((r) => (
            <Button
              key={r.id}
              size="xs"
              variant="secondary"
              type="button"
              onClick={() => void handleInsert(r.id)}
              aria-label={`Insert canned reply ${r.shortcut}`}
            >
              {r.shortcut}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function AssignControl({
  conversation,
  userId,
  onChanged,
}: {
  readonly conversation: Conversation;
  readonly userId: string;
  readonly onChanged: () => void;
}) {
  const assign = trpc.chat.assign.useMutation({ onSuccess: onChanged });
  const isAssignedToMe = conversation.assignedTo === userId;

  return (
    <div className="apoaap-inbox-sidebar-section" aria-label="Assignment">
      <span className="apoaap-inbox-sidebar-label">Assignment</span>
      <Text className="text-xs text-cp-text-muted">
        {conversation.assignedTo ? `Assigned to ${conversation.assignedTo}` : "Unassigned"}
      </Text>
      {!isAssignedToMe ? (
        <Button
          size="xs"
          variant="secondary"
          type="button"
          className="mt-2"
          disabled={assign.isPending}
          onClick={() => assign.mutate({ conversationId: conversation.id, agentUserId: userId })}
          aria-label="Assign this conversation to me"
        >
          Assign to me
        </Button>
      ) : (
        <Text className="mt-1 text-xs text-cp-accent font-semibold">You are assigned</Text>
      )}
      {assign.isError ? (
        <Text className="apoaap-inbox-sidebar-error" role="alert">
          {assign.error.message}
        </Text>
      ) : null}
    </div>
  );
}

export function ConversationSidebar({
  conversation,
  userId,
  role,
  onChanged,
  onInsertCanned,
}: {
  readonly conversation: Conversation;
  readonly userId: string;
  readonly role: Role;
  readonly onChanged: () => void;
  readonly onInsertCanned: (body: string) => void;
}) {
  const composeAllowed = canCompose(role);

  return (
    <aside className="apoaap-inbox-sidebar" aria-label="Conversation tools">
      <span className="apoaap-inbox-sidebar-heading">Triage & Context</span>

      {composeAllowed ? (
        <>
          <Merchant360Card shop={conversation.shop} />
          <StatusSelect conversation={conversation} onChanged={onChanged} />
          <PrioritySelect conversation={conversation} onChanged={onChanged} />
          <ConversationTags conversationId={conversation.id} />
          <CannedReplyPicker shop={conversation.shop} onInsert={onInsertCanned} />
          <AssignControl conversation={conversation} userId={userId} onChanged={onChanged} />
        </>
      ) : (
        <Text className="text-xs text-cp-text-muted">
          View-only — triage controls are hidden for your role.
        </Text>
      )}
    </aside>
  );
}
