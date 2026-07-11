import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Divider,
  Flex,
  Select,
  SelectItem,
  Text,
  TextInput,
  Title,
} from "@tremor/react";
import { trpc } from "~/lib/trpc.js";

/**
 * Assignment-rule editor (cp-conversation-routing). ADMIN-only: the `roles:manage`
 * ability gates the procedures server-side, so non-ADMIN gets FORBIDDEN and this
 * view renders an explicit "ADMIN only" message. Rules are evaluated first-match-
 * wins by `order` on new conversations.
 */

type MatchField = "KEYWORD" | "PLAN" | "PRIORITY" | "SHOP";
type Priority = "URGENT" | "HIGH" | "NORMAL" | "LOW" | "NONE";

const MATCH_FIELDS: readonly MatchField[] = ["KEYWORD", "PLAN", "PRIORITY", "SHOP"];
const PRIORITIES: readonly Priority[] = ["NONE", "LOW", "NORMAL", "HIGH", "URGENT"];

function RuleForm({ onCreated }: { readonly onCreated: () => void }) {
  const [order, setOrder] = useState("1");
  const [matchField, setMatchField] = useState<MatchField>("KEYWORD");
  const [matchValue, setMatchValue] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [setPriority, setSetPriority] = useState<Priority>("NONE");

  const create = trpc.routing.createRule.useMutation({
    onSuccess: () => {
      setMatchValue("");
      setAssignTo("");
      onCreated();
    },
  });

  const orderNum = Number.parseInt(order, 10);
  const canSubmit =
    Number.isFinite(orderNum) && matchValue.trim().length > 0 && !create.isPending;

  return (
    <Card aria-label="Add assignment rule">
      <Title>Add rule</Title>
      <form
        className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          create.mutate({
            order: orderNum,
            matchField,
            matchValue: matchValue.trim(),
            assignTo: assignTo.trim() || undefined,
            setPriority: setPriority === "NONE" ? undefined : setPriority,
          });
        }}
      >
        <div>
          <label htmlFor="rule-order" className="text-xs text-tremor-content-subtle">
            Order (lower runs first)
          </label>
          <TextInput id="rule-order" value={order} onValueChange={setOrder} aria-label="Rule order" />
        </div>
        <div>
          <label htmlFor="rule-field" className="text-xs text-tremor-content-subtle">
            Match field
          </label>
          <Select id="rule-field" value={matchField} onValueChange={(v) => setMatchField(v as MatchField)} enableClear={false}>
            {MATCH_FIELDS.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="rule-value" className="text-xs text-tremor-content-subtle">
            Match value
          </label>
          <TextInput id="rule-value" value={matchValue} onValueChange={setMatchValue} placeholder="e.g. billing" aria-label="Match value" />
        </div>
        <div>
          <label htmlFor="rule-assign" className="text-xs text-tremor-content-subtle">
            Assign to (agent user id, optional)
          </label>
          <TextInput id="rule-assign" value={assignTo} onValueChange={setAssignTo} aria-label="Assign to agent" />
        </div>
        <div>
          <label htmlFor="rule-priority" className="text-xs text-tremor-content-subtle">
            Set priority (optional)
          </label>
          <Select id="rule-priority" value={setPriority} onValueChange={(v) => setSetPriority(v as Priority)} enableClear={false}>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </Select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={!canSubmit} loading={create.isPending}>
            Add rule
          </Button>
        </div>
      </form>
      {create.isError ? (
        <Text className="mt-2 text-xs text-cp-danger" role="alert">
          {create.error.message}
        </Text>
      ) : null}
    </Card>
  );
}

export default function RoutingRules() {
  const rulesQuery = trpc.routing.rules.useQuery(undefined, {
    retry: (failureCount, error) => (error.data?.code === "FORBIDDEN" ? false : failureCount < 1),
  });
  const utils = trpc.useUtils();
  const toggle = trpc.routing.setRuleActive.useMutation({
    onSuccess: () => void utils.routing.rules.invalidate(),
  });

  if (rulesQuery.error?.data?.code === "FORBIDDEN") {
    return (
      <main className="p-6" aria-label="Routing rules">
        <Title>Routing rules</Title>
        <Card className="mt-4" role="alert" aria-label="Routing access denied">
          <Text className="font-medium">ADMIN only</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            Managing assignment rules requires the <code>roles:manage</code> permission.
          </Text>
        </Card>
      </main>
    );
  }

  const rules = rulesQuery.data ?? [];

  return (
    <main className="p-6" aria-label="Routing rules">
      <Title>Routing rules</Title>
      <Text className="mt-1 text-tremor-content-subtle">
        Auto-assign new conversations by keyword, plan, priority, or shop. First matching rule wins.
      </Text>

      <div className="mt-4">
        <RuleForm onCreated={() => void utils.routing.rules.invalidate()} />
      </div>

      <Divider className="my-4" />

      <Card aria-label="Assignment rules">
        <Title>Rules</Title>
        {rulesQuery.isLoading ? (
          <Text className="mt-2" role="status">
            Loading rules…
          </Text>
        ) : rules.length === 0 ? (
          <Text className="mt-2 text-tremor-content-subtle" role="status">
            No rules yet.
          </Text>
        ) : (
          <ul className="mt-3 flex flex-col gap-2" aria-label="Rule list">
            {rules.map((r) => (
              <li key={r.id} className="rounded border border-tremor-border px-3 py-2">
                <Flex justifyContent="between" alignItems="center" className="gap-2">
                  <div>
                    <Text className="font-medium text-tremor-content-strong">
                      #{r.order} · {r.matchField} = "{r.matchValue}"
                    </Text>
                    <Text className="text-xs text-tremor-content-subtle">
                      {r.assignTo ? `assign → ${r.assignTo}` : "no assignment"}
                      {r.setPriority ? ` · priority → ${r.setPriority}` : ""}
                    </Text>
                  </div>
                  <Flex justifyContent="end" alignItems="center" className="gap-2" style={{ width: "auto" }}>
                    <Badge color={r.active ? "emerald" : "gray"}>{r.active ? "Active" : "Inactive"}</Badge>
                    <Button
                      size="xs"
                      variant="secondary"
                      type="button"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ id: r.id, active: !r.active })}
                    >
                      {r.active ? "Disable" : "Enable"}
                    </Button>
                  </Flex>
                </Flex>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
