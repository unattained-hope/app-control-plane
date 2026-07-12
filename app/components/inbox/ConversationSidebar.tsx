import { useState } from "react";
import type { Role } from "@prisma/client";
import { Badge, Button, Select, SelectItem, Text, TextInput } from "@tremor/react";
import { trpc } from "~/lib/trpc.js";
import type { Conversation, Priority } from "./types.js";
import { PRIORITIES, formatPriorityLabel } from "./format.js";
import { canCompose } from "./ConversationComposer.js";

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
          <Text className="text-xs text-tremor-content">No tags.</Text>
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
        <Text className="text-xs text-tremor-content">No canned replies yet.</Text>
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
      <Text className="text-xs text-tremor-content">
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
        <Text className="mt-1 text-xs text-tremor-content-subtle">You are assigned</Text>
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
      <span className="apoaap-inbox-sidebar-heading">Triage</span>

      {composeAllowed ? (
        <>
          <PrioritySelect conversation={conversation} onChanged={onChanged} />
          <ConversationTags conversationId={conversation.id} />
          <CannedReplyPicker shop={conversation.shop} onInsert={onInsertCanned} />
          <AssignControl conversation={conversation} userId={userId} onChanged={onChanged} />
        </>
      ) : (
        <Text className="text-xs text-tremor-content">
          View-only — triage controls are hidden for your role.
        </Text>
      )}
    </aside>
  );
}
