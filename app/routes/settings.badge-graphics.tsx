import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Button,
  Card,
  Select,
  SelectItem,
  Text,
  TextInput,
  Title,
} from "@tremor/react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "~/lib/trpc.js";
import type { AppRouter } from "~/server/trpc/root.js";
import { useAppContext } from "~/lib/appContext.js";
import {
  BADGE_GRAPHIC_THEMES,
  BADGE_GRAPHIC_TYPES,
} from "~/lib/badgeGraphicTypes.js";
import { ConfirmDangerModal } from "~/components/ConfirmDangerModal.js";
import { Archive, Check, Copy, Pencil, Star, Trash2 } from "lucide-react";

type Graphic = inferRouterOutputs<AppRouter>["badgeGraphics"]["list"][number];

const THEME_LABELS: Record<string, string> = {
  MINIMAL: "Minimal",
  RETRO: "Retro",
  ELEGANT: "Elegant",
  RUSTIC: "Rustic",
  ECO: "Eco",
};

const TYPE_LABELS: Record<string, string> = {
  OCCASION: "Occasion",
  OFFER: "Offer",
  TRUST: "Trust",
  VALUES: "Values",
  URGENCY: "Urgency",
  BLANK: "Blank",
};

function formatFileSizeKb(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 10) return `${kb.toFixed(1)} KB`;
  return `${Math.round(kb)} KB`;
}

/** Decode an image blob and re-encode as PNG for clipboard compatibility. */
async function blobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (out) => (out ? resolve(out) : reject(new Error("Encode failed"))),
        "image/png",
      );
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Badge graphic gallery admin UI (cp-app-settings). `settings:manage`-gated (ADMIN)
 * server-side; non-ADMIN gets FORBIDDEN surfaced here.
 */
export default function SettingsBadgeGraphics() {
  const { appKey } = useAppContext();
  const [search, setSearch] = useState("");
  const [themeFilter, setThemeFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Graphic | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replacingGraphicRef = useRef<Graphic | null>(null);

  const [form, setForm] = useState({
    slug: "",
    label: "",
    imagePath: "",
    textBaked: true,
    theme: "MINIMAL",
    graphicType: "OFFER",
    sortOrder: 0,
  });
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imagePreviewVersion, setImagePreviewVersion] = useState(0);
  const [replaceBusyId, setReplaceBusyId] = useState<string | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Graphic | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [fileSizes, setFileSizes] = useState<Record<string, string>>({});

  const hasActiveFilters =
    search.trim() !== "" || themeFilter !== "all" || typeFilter !== "all";

  const listQuery = trpc.badgeGraphics.list.useQuery(
    {
      search: search.trim() || undefined,
      theme: themeFilter === "all" ? undefined : (themeFilter as (typeof BADGE_GRAPHIC_THEMES)[number]),
      graphicType:
        typeFilter === "all" ? undefined : (typeFilter as (typeof BADGE_GRAPHIC_TYPES)[number]),
    },
    {
      enabled: hasActiveFilters,
      retry: (failureCount: number, error: { data?: { code?: string } | null }) =>
        error.data?.code === "FORBIDDEN" ? false : failureCount < 1,
    },
  );

  const utils = trpc.useUtils();
  const invalidate = () => {
    void utils.badgeGraphics.list.invalidate();
    void utils.badgeGraphics.defaultSettings.invalidate();
  };

  const create = trpc.badgeGraphics.create.useMutation({
    onSuccess: () => {
      invalidate();
      resetForm();
    },
  });
  const update = trpc.badgeGraphics.update.useMutation({
    onSuccess: () => {
      invalidate();
      resetForm();
    },
  });
  const archive = trpc.badgeGraphics.archive.useMutation({ onSuccess: invalidate });
  const remove = trpc.badgeGraphics.remove.useMutation({
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
      void defaultSettingsQuery.refetch();
    },
  });

  const defaultSettingsQuery = trpc.badgeGraphics.defaultSettings.useQuery(undefined, {
    retry: (failureCount: number, error: { data?: { code?: string } | null }) =>
      error.data?.code === "FORBIDDEN" ? false : failureCount < 1,
  });
  const [defaultSlugDraft, setDefaultSlugDraft] = useState("");
  const setDefault = trpc.badgeGraphics.setDefault.useMutation({
    onSuccess: (data) => {
      setDefaultSlugDraft(data.defaultSlug);
      void defaultSettingsQuery.refetch();
      invalidate();
    },
  });

  useEffect(() => {
    if (defaultSettingsQuery.data?.defaultSlug) {
      setDefaultSlugDraft(defaultSettingsQuery.data.defaultSlug);
    }
  }, [defaultSettingsQuery.data?.defaultSlug]);

  const graphics: readonly Graphic[] = useMemo(() => {
    if (hasActiveFilters) return listQuery.data ?? [];
    return defaultSettingsQuery.data?.graphics ?? [];
  }, [hasActiveFilters, listQuery.data, defaultSettingsQuery.data?.graphics]);

  const galleryLoading = hasActiveFilters
    ? listQuery.isLoading
    : defaultSettingsQuery.isLoading;

  useEffect(() => {
    if (graphics.length === 0) {
      setFileSizes({});
      return;
    }

    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        graphics.map(async (g) => {
          try {
            const res = await fetch(g.imagePath, { method: "HEAD" });
            if (!res.ok) return;
            const len = res.headers.get("content-length");
            if (!len) return;
            next[g.id] = formatFileSizeKb(Number(len));
          } catch {
            // Ignore per-card size lookup failures.
          }
        }),
      );
      if (!cancelled) setFileSizes(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [graphics]);

  const defaultSlug = defaultSettingsQuery.data?.defaultSlug ?? defaultSlugDraft;
  const defaultGraphic = defaultSettingsQuery.data?.defaultGraphic ?? null;
  const activeGraphicsForDefault = useMemo(
    () => defaultSettingsQuery.data?.graphics ?? graphics,
    [defaultSettingsQuery.data?.graphics, graphics],
  );
  const previewGraphic = useMemo(() => {
    const slug = defaultSlugDraft || defaultSlug;
    if (!slug) return defaultGraphic;
    if (defaultGraphic?.slug === slug) return defaultGraphic;
    return activeGraphicsForDefault.find((g) => g.slug === slug) ?? defaultGraphic;
  }, [defaultSlugDraft, defaultSlug, defaultGraphic, activeGraphicsForDefault]);
  const isForbidden =
    listQuery.error?.data?.code === "FORBIDDEN" ||
    defaultSettingsQuery.error?.data?.code === "FORBIDDEN";

  function resetForm() {
    setShowForm(false);
    setEditing(null);
    setForm({
      slug: "",
      label: "",
      imagePath: "",
      textBaked: true,
      theme: "MINIMAL",
      graphicType: "OFFER",
      sortOrder: 0,
    });
    setUploadError(null);
    setImagePreviewVersion(0);
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(g: Graphic) {
    setUploadError(null);
    setReplaceError(null);
    setEditing(g);
    setForm({
      slug: g.slug,
      label: g.label,
      imagePath: g.imagePath,
      textBaked: g.textBaked,
      theme: g.theme,
      graphicType: g.graphicType,
      sortOrder: g.sortOrder,
    });
    setImagePreviewVersion(0);
    setShowForm(true);
  }

  function startImageReplace(g: Graphic) {
    setReplaceError(null);
    replacingGraphicRef.current = g;
    replaceInputRef.current?.click();
  }

  async function uploadBadgeImage(file: File, slug?: string): Promise<string> {
    const body = new FormData();
    body.append("file", file);
    const params = new URLSearchParams({ app: appKey });
    if (slug) params.set("slug", slug);
    const res = await fetch(`/api/badge-graphics/upload?${params.toString()}`, {
      method: "POST",
      body,
      credentials: "include",
    });
    const json = (await res.json()) as { imagePath?: string; error?: string };
    if (!res.ok || !json.imagePath) {
      throw new Error(json.error ?? "Upload failed");
    }
    return json.imagePath;
  }

  async function handleReplaceImage(file: File) {
    const g = replacingGraphicRef.current;
    if (!g) return;

    setReplaceBusyId(g.id);
    setReplaceError(null);
    try {
      const imagePath = await uploadBadgeImage(file, g.slug);
      await update.mutateAsync({
        id: g.id,
        label: g.label,
        imagePath,
        textBaked: g.textBaked,
        theme: g.theme,
        graphicType: g.graphicType,
        sortOrder: g.sortOrder,
      });
    } catch (err) {
      setReplaceError(err instanceof Error ? err.message : "Image replace failed");
    } finally {
      setReplaceBusyId(null);
      replacingGraphicRef.current = null;
      if (replaceInputRef.current) replaceInputRef.current.value = "";
    }
  }

  async function handleCopyImage(g: Graphic) {
    setCopyError(null);
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("Clipboard image copy is not supported in this browser");
      }
      const res = await fetch(g.imagePath, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load image");
      const source = await res.blob();
      // Clipboard image write is reliably supported for PNG only, so normalize
      // via a canvas regardless of the source format (avif/webp/png).
      const png = await blobToPng(source);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setCopiedId(g.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === g.id ? null : current));
      }, 1500);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : "Copy failed");
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const imagePath = await uploadBadgeImage(file, editing?.slug);
      setForm((f) => ({ ...f, imagePath }));
      setImagePreviewVersion((v) => v + 1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (isForbidden) {
    return (
      <main className="apoaap-settings p-6" aria-label="Badge graphics settings">
        <Title>Badge graphics</Title>
        <Card className="mt-4" role="alert">
          <Text className="font-medium">Admin access required</Text>
          <Text className="mt-1 text-xs text-tremor-content-subtle">
            This view needs the <code>settings:manage</code> permission.
          </Text>
        </Card>
      </main>
    );
  }

  return (
    <main className="apoaap-settings p-6" aria-label="Badge graphics settings">
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/avif,image/webp,image/png,image/jpeg,image/gif"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleReplaceImage(f);
        }}
      />
      <Link to="/settings" className="text-sm text-tremor-content-subtle hover:underline">
        ← Settings
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Title>Badge graphics</Title>
        <Button onClick={openCreate} disabled={showForm && !editing}>
          Add graphic
        </Button>
      </div>
      <Text className="mt-1 text-sm text-tremor-content-subtle">
        Portfolio-wide IMAGE badge presets for {appKey}.
      </Text>

      <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start">
        <Card className="h-fit w-full self-start lg:w-[40%]" aria-label="Default image badge">
          <Title className="text-base">Default image badge</Title>
          <Text className="mt-1 text-sm text-tremor-content-subtle">
            Auto-selected in SaleSwitch when a merchant first switches to Image badge.
          </Text>
          <div className="mt-3 space-y-3">
            <div
              className="apoaap-badge-graphic-default-preview apoaap-transparency-checkerboard"
              aria-hidden={!previewGraphic && !defaultSettingsQuery.isLoading}
            >
              {previewGraphic?.imagePath ? (
                <img
                  src={previewGraphic.imagePath}
                  alt={previewGraphic.label}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                />
              ) : defaultSettingsQuery.isLoading ? (
                <span className="text-sm text-tremor-content-subtle">Loading preview…</span>
              ) : (
                <span className="text-sm text-tremor-content-subtle">No preview</span>
              )}
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="default-badge-select">
                Default graphic
              </label>
              <Select
                id="default-badge-select"
                className="mt-1"
                value={defaultSlugDraft || defaultSlug || ""}
                onValueChange={setDefaultSlugDraft}
                disabled={defaultSettingsQuery.isLoading || activeGraphicsForDefault.length === 0}
              >
                {activeGraphicsForDefault.map((g) => (
                  <SelectItem key={g.slug} value={g.slug}>
                    {g.label}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <Button
              onClick={() => {
                if (defaultSlugDraft) setDefault.mutate({ slug: defaultSlugDraft });
              }}
              disabled={
                !defaultSlugDraft ||
                defaultSlugDraft === defaultSlug ||
                setDefault.isPending ||
                activeGraphicsForDefault.length === 0
              }
              loading={setDefault.isPending}
            >
              Save default
            </Button>
          </div>
          {setDefault.error ? (
            <Text className="mt-2 text-sm text-red-600">{setDefault.error.message}</Text>
          ) : null}
        </Card>

        <Card
          className="apoaap-badge-graphic-gallery w-full lg:w-[60%]"
          aria-label="Badge graphics gallery"
        >
          <div className="apoaap-badge-graphic-filters-bar flex flex-col gap-2">
            <TextInput
              placeholder="Search…"
              value={search}
              onValueChange={setSearch}
              aria-label="Search badge graphics"
            />
            <div className="flex gap-2">
              <Select
                className="min-w-0 flex-1"
                value={themeFilter}
                onValueChange={setThemeFilter}
                aria-label="Filter by theme"
              >
                <SelectItem value="all">All themes</SelectItem>
                {BADGE_GRAPHIC_THEMES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {THEME_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </Select>
              <Select
                className="min-w-0 flex-1"
                value={typeFilter}
                onValueChange={setTypeFilter}
                aria-label="Filter by type"
              >
                <SelectItem value="all">All types</SelectItem>
                {BADGE_GRAPHIC_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </Select>
            </div>
          </div>

          <div className="apoaap-badge-graphic-grid mt-3">
            {galleryLoading ? (
              <Card className="col-span-full">
                <Text>Loading…</Text>
              </Card>
            ) : graphics.length === 0 ? (
              <Card className="col-span-full">
                <Text>No badge graphics match your filters.</Text>
              </Card>
            ) : (
              graphics.map((g) => {
                const metaParts = [
                  THEME_LABELS[g.theme] ?? g.theme,
                  TYPE_LABELS[g.graphicType] ?? g.graphicType,
                  !g.textBaked ? "Blank" : null,
                  g.slug === defaultSlug ? "Default" : null,
                  fileSizes[g.id] ?? null,
                ].filter((part): part is string => Boolean(part));

                return (
                <Card key={g.id} className="apoaap-badge-graphic-card">
                  <div className="apoaap-badge-graphic-thumb apoaap-transparency-checkerboard">
                    <img src={g.imagePath} alt={g.label} title={g.slug} />
                  </div>
                  <p
                    className="apoaap-badge-graphic-label apoaap-badge-graphic-label--editable"
                    title={`${g.label} — click to edit details`}
                    onClick={() => openEdit(g)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openEdit(g);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {g.label}
                  </p>
                  <p className="apoaap-badge-graphic-meta" title={metaParts.join(" · ")}>
                    {metaParts.join(" · ")}
                  </p>
                  <div className="apoaap-badge-graphic-actions">
                    <button
                      type="button"
                      title="Copy image to clipboard"
                      aria-label={`Copy ${g.label} image to clipboard`}
                      onClick={() => void handleCopyImage(g)}
                    >
                      {copiedId === g.id ? (
                        <Check aria-hidden size={14} />
                      ) : (
                        <Copy aria-hidden size={14} />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Replace image"
                      aria-label={`Replace ${g.label} image`}
                      disabled={replaceBusyId === g.id || update.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        startImageReplace(g);
                      }}
                    >
                      {replaceBusyId === g.id ? (
                        <span className="apoaap-badge-graphic-spinner" aria-hidden />
                      ) : (
                        <Pencil aria-hidden size={14} />
                      )}
                    </button>
                    {g.slug !== defaultSlug ? (
                      <button
                        type="button"
                        title="Set as default"
                        aria-label={`Set ${g.label} as default`}
                        disabled={setDefault.isPending}
                        onClick={() => setDefault.mutate({ slug: g.slug })}
                      >
                        <Star aria-hidden size={14} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="is-danger"
                      title="Archive"
                      aria-label={`Archive ${g.label}`}
                      disabled={archive.isPending}
                      onClick={() => {
                        if (window.confirm(`Archive "${g.label}"?`)) {
                          archive.mutate({ id: g.id });
                        }
                      }}
                    >
                      <Archive aria-hidden size={14} />
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      title="Delete"
                      aria-label={`Delete ${g.label}`}
                      disabled={remove.isPending}
                      onClick={() => setPendingDelete(g)}
                    >
                      <Trash2 aria-hidden size={14} />
                    </button>
                  </div>
                </Card>
                );
              })
            )}
          </div>

          {copyError || replaceError ? (
            <Text className="mt-2 text-xs text-cp-danger" role="alert">
              {replaceError ?? copyError}
            </Text>
          ) : null}
        </Card>
      </div>

      {showForm ? (
        <div
          className="apoaap-modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!create.isPending && !update.isPending) resetForm();
          }}
        >
          <div
            className="apoaap-modal apoaap-modal--wide"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? "Edit badge graphic" : "Add badge graphic"}
            onClick={(e) => e.stopPropagation()}
          >
            <Title className="text-base">
              {editing ? `Edit “${editing.label}”` : "Add badge graphic"}
            </Title>
            {editing ? (
              <Text className="mt-1 text-sm text-tremor-content-subtle">
                Upload a new image to replace the artwork, or change the fields below.
              </Text>
            ) : null}
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => {
              e.preventDefault();
              if (editing) {
                update.mutate({
                  id: editing.id,
                  label: form.label,
                  imagePath: form.imagePath,
                  textBaked: form.textBaked,
                  theme: form.theme as (typeof BADGE_GRAPHIC_THEMES)[number],
                  graphicType: form.graphicType as (typeof BADGE_GRAPHIC_TYPES)[number],
                  sortOrder: form.sortOrder,
                });
              } else {
                create.mutate({
                  slug: form.slug,
                  label: form.label,
                  imagePath: form.imagePath,
                  textBaked: form.textBaked,
                  theme: form.theme as (typeof BADGE_GRAPHIC_THEMES)[number],
                  graphicType: form.graphicType as (typeof BADGE_GRAPHIC_TYPES)[number],
                  sortOrder: form.sortOrder,
                });
              }
            }}
          >
            {!editing ? (
              <div>
                <label htmlFor="bg-slug" className="text-sm font-medium">
                  Slug
                </label>
                <TextInput
                  id="bg-slug"
                  className="mt-1"
                  placeholder="minimal-sale"
                  value={form.slug}
                  onValueChange={(v) => setForm((f) => ({ ...f, slug: v }))}
                  required
                />
              </div>
            ) : (
              <Text className="text-sm text-tremor-content-subtle">Slug: {editing.slug}</Text>
            )}
            <div>
              <label htmlFor="bg-label" className="text-sm font-medium">
                Label
              </label>
              <TextInput
                id="bg-label"
                className="mt-1"
                value={form.label}
                onValueChange={(v) => setForm((f) => ({ ...f, label: v }))}
                required
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="min-w-[10rem]">
                <label className="text-sm font-medium">Theme</label>
                <Select
                  className="mt-1"
                  value={form.theme}
                  onValueChange={(v) => setForm((f) => ({ ...f, theme: v }))}
                >
                  {BADGE_GRAPHIC_THEMES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {THEME_LABELS[t] ?? t}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="min-w-[10rem]">
                <label className="text-sm font-medium">Category</label>
                <Select
                  className="mt-1"
                  value={form.graphicType}
                  onValueChange={(v) => setForm((f) => ({ ...f, graphicType: v }))}
                >
                  {BADGE_GRAPHIC_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t] ?? t}
                    </SelectItem>
                  ))}
                </Select>
              </div>
              <div className="min-w-[6rem]">
                <label htmlFor="bg-sort" className="text-sm font-medium">
                  Sort
                </label>
                <TextInput
                  id="bg-sort"
                  className="mt-1"
                  type="number"
                  value={String(form.sortOrder)}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, sortOrder: Number.parseInt(v, 10) || 0 }))
                  }
                />
              </div>
            </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.textBaked}
                    onChange={(e) => setForm((f) => ({ ...f, textBaked: e.target.checked }))}
                  />
                  Text baked into artwork
                </label>
            <div>
              <label className="text-sm font-medium">Image</label>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/avif,image/webp,image/png,image/jpeg,image/gif"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  loading={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  Upload image
                </Button>
                {form.imagePath ? (
                  <img
                    src={
                      imagePreviewVersion > 0
                        ? `${form.imagePath}${form.imagePath.includes("?") ? "&" : "?"}pv=${imagePreviewVersion}`
                        : form.imagePath
                    }
                    alt=""
                    className="apoaap-transparency-checkerboard h-12 w-12 rounded border object-contain"
                  />
                ) : null}
              </div>
              {uploadError ? (
                <Text className="mt-1 text-xs text-cp-danger" role="alert">
                  {uploadError}
                </Text>
              ) : null}
              {!form.imagePath ? (
                <Text className="mt-1 text-xs text-cp-danger">An image is required</Text>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                loading={create.isPending || update.isPending}
                disabled={!form.label || !form.imagePath || (!editing && !form.slug)}
              >
                {editing ? "Save changes" : "Create graphic"}
              </Button>
              <Button type="button" variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
            </div>
            {create.isError || update.isError ? (
              <Text className="text-xs text-cp-danger" role="alert">
                {(create.error ?? update.error)?.message}
              </Text>
            ) : null}
          </form>
          </div>
        </div>
      ) : null}

      <ConfirmDangerModal
        open={pendingDelete !== null}
        title="Permanently delete badge?"
        confirmLabel="Delete permanently"
        loading={remove.isPending}
        onCancel={() => {
          if (!remove.isPending) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) remove.mutate({ id: pendingDelete.id });
        }}
      >
        <Text>
          This will permanently remove{" "}
          <strong>{pendingDelete?.label ?? "this badge"}</strong>
          {pendingDelete?.slug ? (
            <>
              {" "}
              (<code>{pendingDelete.slug}</code>)
            </>
          ) : null}{" "}
          from the gallery and delete its stored image file if one exists in control-plane
          storage.
        </Text>
        <Text className="mt-2 text-cp-danger">
          This action cannot be undone. Merchants already using this graphic may still see it
          until Badgy refreshes its catalog.
        </Text>
        {remove.isError ? (
          <Text className="mt-2 text-xs text-cp-danger" role="alert">
            {remove.error.message}
          </Text>
        ) : null}
      </ConfirmDangerModal>
    </main>
  );
}
