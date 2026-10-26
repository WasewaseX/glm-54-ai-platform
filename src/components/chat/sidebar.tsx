"use client";

import * as React from "react";
import {
  Archive,
  Cloud,
  Download,
  FileText,
  House,
  Info,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  PanelLeftClose,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/lib/store";
import { downloadExport } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/types";

function ConversationRow({ conversation }: { conversation: ConversationSummary }) {
  const activeId = useAppStore((s) => s.activeId);
  const openConversation = useAppStore((s) => s.openConversation);
  const renameConversation = useAppStore((s) => s.renameConversation);
  const togglePin = useAppStore((s) => s.togglePin);
  const toggleArchive = useAppStore((s) => s.toggleArchive);
  const deleteConversation = useAppStore((s) => s.deleteConversation);

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(conversation.title);
  const active = activeId === conversation.id;

  const commitRename = () => {
    const title = draft.trim();
    if (title && title !== conversation.title) void renameConversation(conversation.id, title);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="px-1.5 py-0.5">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-8 text-sm"
          aria-label="Conversation title"
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => void openConversation(conversation.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") void openConversation(conversation.id);
      }}
      className={cn(
        "group mx-1.5 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors",
        active
          ? "bg-accent text-accent-foreground ring-1 ring-primary/25"
          : "text-foreground/80 hover:bg-accent/70 hover:text-accent-foreground"
      )}
    >
      {conversation.pinned && <Pin className="h-3 w-3 shrink-0 text-primary/80" />}
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-[13px] font-medium leading-5", active && "text-foreground")}>
          {conversation.title}
        </p>
        {conversation.preview && (
          <p className="truncate text-[11px] leading-4 text-muted-foreground/80">{conversation.preview}</p>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 rounded-md opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label={`Options for ${conversation.title}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              setDraft(conversation.title);
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              void togglePin(conversation.id, !conversation.pinned);
            }}
          >
            {conversation.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            {conversation.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              downloadExport(conversation.id, "md").catch((err) => toast.error((err as Error).message));
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export Markdown
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              downloadExport(conversation.id, "json").catch((err) => toast.error((err as Error).message));
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              void toggleArchive(conversation.id, true);
            }}
          >
            <Archive className="h-3.5 w-3.5" /> Archive
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              void deleteConversation(conversation.id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const conversations = useAppStore((s) => s.conversations);
  const loading = useAppStore((s) => s.conversationsLoading);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const newConversation = useAppStore((s) => s.newConversation);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setActiveDialog = useAppStore((s) => s.setActiveDialog);
  const setActiveAgent = useAppStore((s) => s.setActiveAgent);
  const setComposerDraft = useAppStore((s) => s.setComposerDraft);
  const activeAgentId = useAppStore((s) => s.activeAgentId);

  const pinned = conversations.filter((c) => c.pinned);
  const recent = conversations.filter((c) => !c.pinned);

  const goHome = () => {
    newConversation();
    onNavigate?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand row */}
      <div className="flex items-center justify-between px-3 pb-2 pt-3.5">
        <button
          type="button"
          onClick={goHome}
          className="flex items-center gap-2 rounded-lg px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label="GLM 5.4 AI — go home"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground font-serif text-sm font-bold text-background">
            Z
          </span>
          <span className="text-sm font-semibold tracking-tight">GLM 5.4 AI</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
          onClick={() => setSidebarOpen(false)}
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Primary nav */}
      <nav className="px-2 pt-1" aria-label="Primary">
        <button
          type="button"
          onClick={goHome}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground/90 outline-none transition-colors hover:bg-accent/70 focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <House className="h-4 w-4" />
          Home
        </button>
        <button
          type="button"
          onClick={() => toast.info("Scheduled tasks are on the roadmap — use cron-driven agents from the CLI for now.")}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground/70 outline-none transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <Clock className="h-4 w-4" />
          Scheduled
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveDialog("documents");
            onNavigate?.();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground/70 outline-none transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <Cloud className="h-4 w-4" />
          Cloud
        </button>
      </nav>

      {/* Search */}
      <div className="relative px-3 pb-1 pt-3">
        <Search className="pointer-events-none absolute left-5.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pl-px text-muted-foreground/70" />
        <Input
          value={searchQuery}
          onChange={(e) => void setSearchQuery(e.target.value)}
          placeholder="Search conversations…"
          aria-label="Search conversations"
          className="h-8 rounded-lg bg-background/60 pl-8 text-xs"
        />
      </div>

      {/* Recents */}
      <ScrollArea className="min-h-0 flex-1 px-0 pb-2">
        <div className="px-1 pt-1">
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground/80">Recents</p>
          {loading && conversations.length === 0 && (
            <div className="space-y-1.5 px-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-accent/40" />
              ))}
            </div>
          )}

          {!loading && conversations.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {searchQuery ? "No conversations match your search." : "No conversations yet — start one!"}
            </p>
          )}

          {pinned.length > 0 && (
            <div className="space-y-0.5">
              {pinned.map((c) => (
                <ConversationRow key={c.id} conversation={c} />
              ))}
            </div>
          )}
          {recent.length > 0 && (
            <div className="space-y-0.5">
              {recent.map((c) => (
                <ConversationRow key={c.id} conversation={c} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Agents promo card */}
      <div className="mx-2.5 mb-2.5 rounded-xl border border-border/60 bg-card/70 p-3">
        <p className="text-xs font-semibold">Meet Your AI Agents</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          Specialist modes for code, writing, data, decks, and sites.
        </p>
        <div className="mt-2 flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 rounded-lg text-[11px]"
            onClick={() => {
              newConversation();
              setActiveAgent(activeAgentId === "writing" ? null : "writing");
              setComposerDraft("Chapter 1 of an original serialized webnovel — I'll ask you to continue after each part.");
              onNavigate?.();
            }}
          >
            Writer
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 flex-1 rounded-lg text-[11px]"
            onClick={() => {
              setActiveDialog("about");
              onNavigate?.();
            }}
          >
            Agents info
          </Button>
        </div>
      </div>

      {/* Footer — sticky at bottom of sidebar */}
      <div className="border-t border-sidebar-border/60 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/70 to-primary/40 text-[11px] font-semibold text-primary-foreground"
          >
            Z
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-medium">Anonymous session</p>
            <p className="truncate text-[10px] text-muted-foreground">history synced locally</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => {
              setActiveDialog("documents");
              onNavigate?.();
            }}
            aria-label="Documents"
          >
            <FileText className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => {
              setActiveDialog("about");
              onNavigate?.();
            }}
            aria-label="About and verified capabilities"
          >
            <Info className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => {
              setActiveDialog("settings");
              onNavigate?.();
            }}
            aria-label="Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
