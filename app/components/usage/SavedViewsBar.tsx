import { useMemo, useState } from "react";
import { Button, Select, SelectItem, Text, TextInput } from "@tremor/react";
import { trpc } from "~/lib/trpc.js";

/**
 * Per-admin saved-view controls for the shop explorer (cp usage-saved-views, P5). Save the
 * current explorer state under a name, select a saved preset to RESTORE that exact state,
 * rename it, or delete it. Presets are private to the acting admin (owner-scoped server-
 * side); this bar only renders the admin's own. The `params` blob is opaque here — the
 * page hands it in via `currentParams` and receives it back through `onRestore`, so this
 * component knows nothing about the explorer's specific axes/filters.
 */

/** Opaque JSON blob of explorer state. The page owns the concrete shape + coerces on restore. */
export type SavedViewParams = Record<string, unknown>;

/**
 * The subset of a saved-view row this bar renders. Declared locally (rather than inferred
 * from the tRPC router output) so the JSON `params` field doesn't drag the recursive
 * JsonValue type through inference — which trips "type instantiation is excessively deep".
 */
interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly params: unknown;
}

export function SavedViewsBar({
  currentParams,
  onRestore,
}: {
  /** The explorer's current serializable state — saved verbatim, restored verbatim. */
  readonly currentParams: SavedViewParams;
  /** Called with a preset's stored params when the admin selects it. */
  readonly onRestore: (params: SavedViewParams) => void;
}) {
  const listQuery = trpc.usageManagement.savedViews.list.useQuery();
  const utils = trpc.useUtils();
  const invalidate = () => utils.usageManagement.savedViews.list.invalidate();

  const create = trpc.usageManagement.savedViews.create.useMutation({ onSuccess: invalidate });
  const update = trpc.usageManagement.savedViews.update.useMutation({ onSuccess: invalidate });
  const remove = trpc.usageManagement.savedViews.remove.useMutation({ onSuccess: invalidate });

  // Cast via unknown so the recursive JSON `params` type isn't structurally re-checked
  // against SavedView (the source of the "excessively deep" instantiation).
  const views = useMemo<readonly SavedView[]>(
    () => (listQuery.data ?? []) as unknown as readonly SavedView[],
    [listQuery.data],
  );

  const [selectedId, setSelectedId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const selected = views.find((v) => v.id === selectedId) ?? null;

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setRenaming(false);
    const view = views.find((v) => v.id === id);
    if (view) onRestore((view.params ?? {}) as SavedViewParams);
  };

  const anyError = create.error ?? update.error ?? remove.error;

  return (
    <div className="flex flex-col gap-2" aria-label="Saved views">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-56">
          <Text className="mb-1 text-xs text-tremor-content-subtle">Saved views</Text>
          <Select
            value={selectedId}
            onValueChange={handleSelect}
            enableClear={false}
            placeholder={views.length === 0 ? "No saved views" : "Select a view…"}
            aria-label="Select a saved view"
            disabled={views.length === 0}
          >
            {views.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </Select>
        </div>

        {/* Save the CURRENT state as a new named view. */}
        <form
          className="flex items-end gap-2"
          aria-label="Save current view"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim() || create.isPending) return;
            create.mutate(
              { name: newName.trim(), params: currentParams },
              {
                onSuccess: (v) => {
                  setNewName("");
                  setSelectedId(v.id);
                },
              },
            );
          }}
        >
          <div className="w-44">
            <label htmlFor="saved-view-name" className="sr-only">
              New view name
            </label>
            <TextInput
              id="saved-view-name"
              placeholder="Name this view"
              value={newName}
              onValueChange={setNewName}
              aria-label="New view name"
            />
          </div>
          <Button type="submit" size="xs" disabled={!newName.trim()} loading={create.isPending}>
            Save current
          </Button>
        </form>

        {/* Rename / delete the selected view. */}
        {selected ? (
          renaming ? (
            <form
              className="flex items-end gap-2"
              aria-label="Rename view"
              onSubmit={(e) => {
                e.preventDefault();
                if (!renameValue.trim() || update.isPending) return;
                update.mutate(
                  { id: selected.id, name: renameValue.trim() },
                  { onSuccess: () => setRenaming(false) },
                );
              }}
            >
              <div className="w-44">
                <label htmlFor="saved-view-rename" className="sr-only">
                  Rename view
                </label>
                <TextInput
                  id="saved-view-rename"
                  value={renameValue}
                  onValueChange={setRenameValue}
                  aria-label="Rename view"
                />
              </div>
              <Button type="submit" size="xs" disabled={!renameValue.trim()} loading={update.isPending}>
                Save name
              </Button>
              <Button type="button" size="xs" variant="light" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex items-end gap-2">
              <Button
                size="xs"
                variant="secondary"
                aria-label={`Update "${selected.name}" to current state`}
                loading={update.isPending}
                onClick={() =>
                  update.mutate({
                    id: selected.id,
                    params: currentParams,
                  })
                }
              >
                Update to current
              </Button>
              <Button
                size="xs"
                variant="light"
                aria-label={`Rename "${selected.name}"`}
                onClick={() => {
                  setRenameValue(selected.name);
                  setRenaming(true);
                }}
              >
                Rename
              </Button>
              <Button
                size="xs"
                variant="light"
                color="rose"
                aria-label={`Delete "${selected.name}"`}
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(
                    { id: selected.id },
                    { onSuccess: () => setSelectedId("") },
                  )
                }
              >
                Delete
              </Button>
            </div>
          )
        ) : null}
      </div>

      {anyError ? (
        <Text className="text-xs text-cp-danger" role="alert">
          {anyError.message}
        </Text>
      ) : null}
    </div>
  );
}
