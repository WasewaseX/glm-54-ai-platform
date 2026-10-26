"use client";

import * as React from "react";
import {
  Code2,
  Copy,
  Download,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Loader2,
  PanelRight,
  PenLine,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Markdown } from "@/components/chat/markdown";
import { useAppStore } from "@/lib/store";
import { fetchRawBlob, saveBlob } from "@/lib/api-client";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { ArtifactItem, ArtifactKind, LiveArtifact } from "@/lib/types";

// ---------- Small helpers ----------

const KIND_META: Record<ArtifactKind, { label: string }> = {
  markdown: { label: "Markdown" },
  code: { label: "Code" },
  html: { label: "HTML" },
  svg: { label: "SVG" },
  image: { label: "Image" },
};

function KindIcon({ kind, className }: { kind: ArtifactKind; className?: string }) {
  const cls = cn("h-3.5 w-3.5 text-primary", className);
  switch (kind) {
    case "markdown":
      return <FileText className={cls} aria-hidden />;
    case "code":
      return <FileCode2 className={cls} aria-hidden />;
    case "html":
      return <Code2 className={cls} aria-hidden />;
    default:
      return <ImageIcon className={cls} aria-hidden />;
  }
}

const EXT_BY_KIND: Record<ArtifactKind, string> = {
  markdown: ".md",
  code: ".txt",
  html: ".html",
  svg: ".svg",
  image: ".png",
};

const MIME_BY_KIND: Record<Exclude<ArtifactKind, "image">, string> = {
  markdown: "text/markdown;charset=utf-8",
  code: "text/plain;charset=utf-8",
  html: "text/html;charset=utf-8",
  svg: "image/svg+xml;charset=utf-8",
};

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "artifact";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Wrap code in a CommonMark fence, padding the fence length so content that
 * itself contains backtick fences can never break the block. Rendered through
 * <Markdown> to reuse its code-block styling (language label, copy, theme).
 */
function fencedCode(content: string, language: string | null): string {
  const longest = (content.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language ?? ""}\n${content}\n${fence}`;
}

// ---------- Viewer ----------

function ImageArtifact({ artifact }: { artifact: ArtifactItem }) {
  // Image artifacts store the source document id in `content` — served the
  // same way documents-dialog displays stored images.
  if (!artifact.content) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/60 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
        Preparing image…
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center rounded-xl border border-border/60 bg-white p-2">
      <img
        src={`/api/documents/${artifact.content}/raw`}
        alt={artifact.title}
        className="max-h-[52vh] w-auto max-w-full rounded-lg object-contain"
      />
    </div>
  );
}

function SvgPreview({ content, title }: { content: string; title: string }) {
  return (
    <div className="flex items-center justify-center overflow-auto rounded-xl border border-border/60 bg-white p-3">
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(content)}`}
        alt={title}
        className="max-h-[52vh] w-auto max-w-full"
      />
    </div>
  );
}

function HtmlPreview({ content }: { content: string }) {
  // Sandboxed: scripts allowed, but no same-origin access (no cookies/localStorage).
  return (
    <iframe
      sandbox="allow-scripts"
      srcDoc={content}
      title="Artifact preview"
      className="h-[52vh] w-full rounded-md border bg-white"
    />
  );
}

function ArtifactViewer({ artifact }: { artifact: ArtifactItem }) {
  const [view, setView] = React.useState<"preview" | "code">(
    artifact.kind === "html" || artifact.kind === "svg" ? "preview" : "code"
  );

  // Reset the toggle when switching between artifacts.
  React.useEffect(() => {
    setView(artifact.kind === "html" || artifact.kind === "svg" ? "preview" : "code");
  }, [artifact.id, artifact.kind]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      toast.success("Artifact copied to clipboard");
    } catch {
      toast.error("Clipboard unavailable");
    }
  };

  const download = async () => {
    try {
      if (artifact.kind === "image") {
        const blob = await fetchRawBlob(`/api/documents/${artifact.content}/raw`);
        saveBlob(blob, `${slugify(artifact.title)}.png`);
      } else {
        const blob = new Blob([artifact.content], { type: MIME_BY_KIND[artifact.kind] });
        saveBlob(blob, `${slugify(artifact.title)}${EXT_BY_KIND[artifact.kind]}`);
      }
      toast.success("Artifact downloaded");
    } catch (err) {
      toast.error((err as Error)?.message ?? "Download failed");
    }
  };

  const hasCodeView = artifact.kind !== "image";
  const hasPreviewToggle = artifact.kind === "html" || artifact.kind === "svg";

  return (
    <section aria-label={`Artifact: ${artifact.title}`} className="flex h-full min-h-0 flex-col">
      {/* Viewer header: title + actions */}
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-card/60"
          aria-hidden
        >
          <KindIcon kind={artifact.kind} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{artifact.title}</p>
          <p className="text-[11px] text-muted-foreground">
            {KIND_META[artifact.kind].label}
            {artifact.language ? ` · ${artifact.language}` : ""}
          </p>
        </div>
        {hasPreviewToggle && (
          <div className="flex shrink-0 items-center rounded-lg border p-0.5" role="group" aria-label="Artifact view">
            <Button
              variant={view === "preview" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 rounded-md px-2 text-xs"
              onClick={() => setView("preview")}
              aria-pressed={view === "preview"}
            >
              Preview
            </Button>
            <Button
              variant={view === "code" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 rounded-md px-2 text-xs"
              onClick={() => setView("code")}
              aria-pressed={view === "code"}
            >
              Code
            </Button>
          </div>
        )}
        {hasCodeView && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => void copy()}
            aria-label="Copy artifact content"
          >
            <Copy className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
          onClick={() => void download()}
          aria-label="Download artifact"
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {artifact.kind === "markdown" && <Markdown content={artifact.content} />}
        {artifact.kind === "code" && <Markdown content={fencedCode(artifact.content, artifact.language)} />}
        {artifact.kind === "html" &&
          (view === "preview" ? <HtmlPreview content={artifact.content} /> : <Markdown content={fencedCode(artifact.content, "html")} />)}
        {artifact.kind === "svg" &&
          (view === "preview" ? (
            <SvgPreview content={artifact.content} title={artifact.title} />
          ) : (
            <Markdown content={fencedCode(artifact.content, "xml")} />
          ))}
        {artifact.kind === "image" && <ImageArtifact artifact={artifact} />}
      </div>
    </section>
  );
}

// ---------- Live draft (streaming) ----------

function LiveDraftView({ live }: { live: LiveArtifact }) {
  return (
    <section aria-label="Artifact draft in progress" className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
        <span className="shimmer-text text-sm font-medium">Writing artifact…</span>
        <Badge variant="outline" className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          draft
        </Badge>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-card/50 p-3 font-mono text-xs leading-relaxed text-muted-foreground scrollbar-thin">
        {live.content || "…"}
      </pre>
    </section>
  );
}

// ---------- Panel ----------

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 p-6 text-center">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.07]"
        aria-hidden
      >
        <FileText className="h-5 w-5 text-primary" />
      </span>
      <p className="text-sm font-medium">No artifacts yet</p>
      <p className="max-w-[270px] text-xs leading-relaxed text-muted-foreground">
        Ask the Agent to create a document, report, or image — finished files appear here live,
        ready to view, copy, and download.
      </p>
    </div>
  );
}

export function ArtifactPanel({ onClose }: { onClose?: () => void }) {
  const artifacts = useAppStore((s) => s.artifacts);
  const liveArtifact = useAppStore((s) => s.liveArtifact);
  const activeArtifactId = useAppStore((s) => s.activeArtifactId);
  const openArtifact = useAppStore((s) => s.openArtifact);

  const [viewingDraft, setViewingDraft] = React.useState(false);
  const lastDraftTempId = React.useRef<string | null>(null);

  // When a fresh draft starts streaming, jump to the live view automatically.
  React.useEffect(() => {
    if (liveArtifact && liveArtifact.tempId !== lastDraftTempId.current) {
      lastDraftTempId.current = liveArtifact.tempId;
      setViewingDraft(true);
    }
    if (!liveArtifact) setViewingDraft(false);
  }, [liveArtifact]);

  const active = artifacts.find((a) => a.id === activeArtifactId) ?? artifacts[0] ?? null;
  const showDraft = viewingDraft && liveArtifact !== null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 pl-4 pr-2">
        <PanelRight className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">Artifacts</h2>
        {artifacts.length > 0 && (
          <Badge
            variant="outline"
            className="shrink-0 border-primary/30 bg-primary/[0.07] text-[10px] text-primary/90"
          >
            {artifacts.length}
          </Badge>
        )}
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8 rounded-lg"
            onClick={onClose}
            aria-label="Close artifacts panel"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Artifact list */}
      {(artifacts.length > 0 || liveArtifact) && (
        <div
          className="max-h-44 shrink-0 space-y-1 overflow-y-auto border-b border-border/60 p-2 scrollbar-thin"
          role="listbox"
          aria-label="Artifacts in this conversation"
        >
          {liveArtifact && (
            <button
              type="button"
              role="option"
              aria-selected={showDraft}
              onClick={() => setViewingDraft(true)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                showDraft
                  ? "border-primary/40 bg-primary/10"
                  : "border-primary/25 bg-primary/[0.05] hover:bg-primary/10"
              )}
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10"
                aria-hidden
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="shimmer-text block truncate text-sm font-medium">Writing artifact…</span>
                <span className="block text-[11px] text-muted-foreground">streaming draft</span>
              </span>
              <PenLine className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
            </button>
          )}
          {artifacts.map((artifact) => {
            const selected = !showDraft && active?.id === artifact.id;
            return (
              <button
                key={artifact.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setViewingDraft(false);
                  openArtifact(artifact.id);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
                  selected
                    ? "border-primary/40 bg-primary/10"
                    : "border-transparent hover:bg-card/70"
                )}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-card/60"
                  aria-hidden
                >
                  <KindIcon kind={artifact.kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{artifact.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {KIND_META[artifact.kind].label}
                    {artifact.language ? ` · ${artifact.language}` : ""} · {formatWhen(artifact.updatedAt)}
                  </span>
                </span>
                {artifact.version > 1 && (
                  <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                    v{artifact.version}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Viewer */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
        {showDraft && liveArtifact ? (
          <LiveDraftView live={liveArtifact} />
        ) : active ? (
          <ArtifactViewer artifact={active} />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

/**
 * Rendering host: a fixed right column on desktop (md+), a slide-in Sheet on
 * mobile. The desktop column is a sibling of <main> in the page flex shell, so
 * it never overlaps content and keeps the footer pinned.
 */
export function ArtifactPanelHost() {
  const isMobile = useIsMobile();
  const artifactPanelOpen = useAppStore((s) => s.artifactPanelOpen);
  const setArtifactPanelOpen = useAppStore((s) => s.setArtifactPanelOpen);

  if (isMobile) {
    return (
      <Sheet open={artifactPanelOpen} onOpenChange={setArtifactPanelOpen}>
        <SheetContent
          side="right"
          aria-describedby={undefined}
          className="w-[85vw] max-w-[420px] border-border/60 bg-background p-0"
        >
          <SheetTitle className="sr-only">Artifacts</SheetTitle>
          <ArtifactPanel />
        </SheetContent>
      </Sheet>
    );
  }

  if (!artifactPanelOpen) return null;
  return (
    <aside
      className="flex w-[400px] shrink-0 flex-col border-l border-border/60 bg-background xl:w-[440px]"
      aria-label="Artifacts panel"
    >
      <ArtifactPanel onClose={() => setArtifactPanelOpen(false)} />
    </aside>
  );
}
