"use client";

import * as React from "react";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/store";
import { apiClient, formatBytes } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { DocumentDetail } from "@/lib/types";

function DocRow({ id }: { id: string }) {
  const documents = useAppStore((s) => s.documents);
  const deleteDocument = useAppStore((s) => s.deleteDocument);
  const setActiveDialog = useAppStore((s) => s.setActiveDialog);
  const doc = documents.find((d) => d.id === id);
  const [busy, setBusy] = React.useState<"summarize" | null>(null);
  const { toast } = useToast();

  if (!doc) return null;

  const summarize = async () => {
    setBusy("summarize");
    try {
      await apiClient.summarizeDocument(doc.id);
      await useAppStore.getState().loadDocuments();
      toast.success("Summary generated.");
      setActiveDialog("documents");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="group rounded-xl border p-3 transition-colors hover:border-primary/30">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/[0.08]">
          {doc.kind === "image" ? (
            <ImageIcon className="h-4 w-4 text-primary" />
          ) : (
            <FileText className="h-4 w-4 text-primary" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{doc.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {formatBytes(doc.size)}
            {doc.kind === "text" && doc.chunkCount > 0 && ` · ${doc.chunkCount} chunks indexed`}
            {" · "}
            {new Date(doc.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {doc.kind === "text" && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => void summarize()}
              disabled={busy === "summarize"}
              aria-label={`Summarize ${doc.name}`}
            >
              {busy === "summarize" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-primary" />
              )}
              Summarize
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => void deleteDocument(doc.id)}
            aria-label={`Delete ${doc.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {doc.excerpt && (
        <p className="mt-2 line-clamp-2 border-t border-border/50 pt-2 text-xs leading-relaxed text-muted-foreground">
          {doc.excerpt}
        </p>
      )}
    </div>
  );
}

export function DocumentsDialog() {
  const activeDialog = useAppStore((s) => s.activeDialog);
  const setActiveDialog = useAppStore((s) => s.setActiveDialog);
  const documents = useAppStore((s) => s.documents);
  const uploadFiles = useAppStore((s) => s.uploadFiles);
  const [detail, setDetail] = React.useState<DocumentDetail | null>(null);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const viewDetail = async (id: string) => {
    setLoadingId(id);
    try {
      const { api } = await import("@/lib/api-client");
      const { document } = await api<{ document: DocumentDetail }>(`/api/documents/${id}`);
      setDetail(document);
    } catch (err) {
      const { toast } = await import("sonner");
      toast.error((err as Error).message);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <Dialog open={activeDialog === "documents"} onOpenChange={(open) => { if (!open) { setActiveDialog(null); setDetail(null); } }}>
      <DialogContent className="max-h-[85vh] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Documents</DialogTitle>
          <DialogDescription>
            Text files are chunked and indexed for retrieval (RAG). Images and PDFs are analyzed
            by the vision model when attached to a message.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void uploadFiles(files.slice(0, 6));
            e.target.value = "";
          }}
        />
        <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" />
          Upload files
        </Button>

        {detail ? (
          <div className="min-h-0 space-y-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDetail(null)}>
                ← Back
              </Button>
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{detail.name}</p>
              {detail.kind === "text" && (
                <Badge variant="outline" className="text-[10px]">{detail.chunkCount} chunks</Badge>
              )}
            </div>
            {detail.summary && (
              <div className="rounded-xl border border-primary/25 bg-primary/[0.05] p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> AI summary
                </p>
                <div className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">
                  {detail.summary}
                </div>
              </div>
            )}
            <div className="h-64 overflow-y-auto rounded-xl border p-3 scrollbar-thin">
              {detail.kind === "image" ? (
                <img
                  src={`/api/documents/${detail.id}/raw`}
                  alt={detail.name}
                  className="mx-auto max-h-60 rounded-lg"
                />
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground scrollbar-thin">
                  {detail.content ?? "(no extractable text — binary preview not supported)"}
                </pre>
              )}
            </div>
          </div>
        ) : (
          <div className="max-h-[45vh] overflow-y-auto pr-2 scrollbar-thin">
            {documents.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No documents yet. Upload or drop files onto the composer.
              </p>
            ) : (
              <div className="space-y-2">
                {documents.map((d) => (
                  <div
                    key={d.id}
                    className={cn("cursor-pointer", loadingId === d.id && "opacity-50")}
                    onClick={() => void viewDetail(d.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && void viewDetail(d.id)}
                  >
                    <DocRow id={d.id} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
