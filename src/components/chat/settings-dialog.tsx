"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Loader2, Plus, Sparkles, Star, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useAppStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";
import type { UserSettings } from "@/lib/types";

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GeneralTab() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const { theme, setTheme } = useTheme();

  const update = (patch: Partial<UserSettings>) => void updateSettings(patch);

  return (
    <div className="divide-y divide-border/60">
      <Row title="Theme" description="Dark is the signature look; light works too.">
        <div className="flex gap-1 rounded-lg border p-0.5">
          {(["dark", "light", "system"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTheme(t);
                update({ theme: t });
              }}
              className={`rounded-md px-2.5 py-1 text-xs capitalize transition-colors ${
                (theme ?? "system") === t
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Send with Enter" description="When off, use Ctrl/⌘+Enter to send.">
        <Switch
          checked={settings.sendOnEnter}
          onCheckedChange={(v) => update({ sendOnEnter: v })}
          aria-label="Send with Enter"
        />
      </Row>
      <Row title="Thinking mode by default" description="Extended reasoning for new messages.">
        <Switch
          checked={settings.thinkingDefault}
          onCheckedChange={(v) => update({ thinkingDefault: v })}
          aria-label="Thinking mode by default"
        />
      </Row>
      <Row title="Web search by default" description="Ground every new message with search results.">
        <Switch
          checked={settings.webSearchDefault}
          onCheckedChange={(v) => update({ webSearchDefault: v })}
          aria-label="Web search by default"
        />
      </Row>
    </div>
  );
}

function PromptsTab() {
  const prompts = useAppStore((s) => s.prompts);
  const createPrompt = useAppStore((s) => s.createPrompt);
  const updatePrompt = useAppStore((s) => s.updatePrompt);
  const deletePrompt = useAppStore((s) => s.deletePrompt);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const [name, setName] = React.useState("");
  const [content, setContent] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const { toast } = useToast();

  const save = async () => {
    if (!name.trim() || !content.trim()) {
      toast.error("Prompt needs a name and content.");
      return;
    }
    setSaving(true);
    try {
      await createPrompt(name.trim(), content.trim());
      setName("");
      setContent("");
      toast.success("System prompt saved.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2.5 rounded-xl border p-3">
        <p className="text-sm font-medium">New system prompt</p>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name — e.g. Code reviewer"
          className="h-8 text-sm"
          aria-label="Prompt name"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="You are a meticulous code reviewer…"
          rows={3}
          className="w-full resize-none rounded-lg border bg-background/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 scrollbar-thin"
          aria-label="Prompt content"
        />
        <Button size="sm" onClick={() => void save()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Save prompt
        </Button>
      </div>

      <div className="max-h-64 overflow-y-auto pr-2 scrollbar-thin">
        {prompts.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No reusable prompts yet. Create one above.
          </p>
        ) : (
          <div className="space-y-2">
            {prompts.map((p) => (
              <div key={p.id} className="group rounded-xl border p-3">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={p.isDefault ? "Unset default" : "Set as default"}
                    onClick={() => void updatePrompt(p.id, { isDefault: !p.isDefault })}
                  >
                    <Star
                      className={`h-3.5 w-3.5 ${p.isDefault ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    aria-label="Delete prompt"
                    onClick={() => void deletePrompt(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{p.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />
      <div className="flex items-center justify-between py-1">
        <div>
          <p className="text-sm font-medium">Default prompt</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {settings.defaultSystemPromptId
              ? prompts.find((p) => p.id === settings.defaultSystemPromptId)?.name ?? "Previously deleted"
              : "No default — assistant persona only"}
          </p>
        </div>
        <div className="flex gap-1.5">
          {settings.defaultSystemPromptId && (
            <Button variant="outline" size="sm" onClick={() => void updateSettings({ defaultSystemPromptId: null })}>
              Clear
            </Button>
          )}
        </div>
      </div>
      {prompts.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Tip: click the star on a prompt to make it the default for new chats.
        </p>
      )}
    </div>
  );
}

function DataTab() {
  const clearAll = useAppStore((s) => s.clearAllConversations);
  const [stats, setStats] = React.useState<import("@/lib/types").UsageStats | null>(null);
  const [confirming, setConfirming] = React.useState(false);
  const { toast } = useToast();

  React.useEffect(() => {
    void (async () => {
      try {
        const { api } = await import("@/lib/api-client");
        const { stats } = await api<{ stats: import("@/lib/types").UsageStats }>("/api/stats");
        setStats(stats);
      } catch {
        /* stats are best-effort */
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          { label: "Conversations", value: stats?.totalConversations ?? "…" },
          { label: "Messages", value: stats?.totalMessages ?? "…" },
          { label: "Last 24h", value: stats?.last24hMessages ?? "…" },
          { label: "Prompt tokens", value: stats?.promptTokens.toLocaleString() ?? "…" },
          { label: "Output tokens", value: stats?.completionTokens.toLocaleString() ?? "…" },
          { label: "Avg latency", value: stats ? `${(stats.avgLatencyMs / 1000).toFixed(1)}s` : "…" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <Separator />

      <div className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-3">
        <p className="text-sm font-medium text-destructive">Danger zone</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Permanently delete all conversations. Documents and prompts are kept.
        </p>
        {confirming ? (
          <div className="mt-2.5 flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                void clearAll();
                setConfirming(false);
                toast.success("All conversations deleted.");
              }}
            >
              Yes, delete everything
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="destructive" size="sm" className="mt-2.5" onClick={() => setConfirming(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete all conversations
          </Button>
        )}
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const activeDialog = useAppStore((s) => s.activeDialog);
  const setActiveDialog = useAppStore((s) => s.setActiveDialog);
  const serverInfo = useAppStore((s) => s.serverInfo);

  return (
    <Dialog open={activeDialog === "settings"} onOpenChange={(open) => !open && setActiveDialog(null)}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Settings
          </DialogTitle>
          <DialogDescription>
            {serverInfo?.servedChatModel
              ? `Connected — serving ${serverInfo.servedChatModel}`
              : "Personalize your workspace."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="min-h-0 overflow-hidden">
          <TabsList className="w-full">
            <TabsTrigger value="general" className="flex-1">General</TabsTrigger>
            <TabsTrigger value="prompts" className="flex-1">Prompts</TabsTrigger>
            <TabsTrigger value="data" className="flex-1">Usage</TabsTrigger>
          </TabsList>
          <div className="mt-3 max-h-[55vh] overflow-y-auto pr-1 scrollbar-thin">
            <TabsContent value="general" className="mt-0">
              <GeneralTab />
            </TabsContent>
            <TabsContent value="prompts" className="mt-0">
              <PromptsTab />
            </TabsContent>
            <TabsContent value="data" className="mt-0">
              <DataTab />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
