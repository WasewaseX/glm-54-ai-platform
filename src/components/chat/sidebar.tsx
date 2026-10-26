"use client";

import * as React from "react";
import {
  Archive,
  Download,
  FileText,
  Info,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
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
          ? "bg-primary/12 text-foreground ring-1 ring-primary/30"
          : "text-foreground/80 hover:bg-accent hover:text-accent-foreground"
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
              window.open(`/api/conversations/${conversation.id}/export?format=md`, "_blank");
            }}
          >
            <Download className="h-3.5 w-3.5" /> Export Markdown
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              window.open(`/api/conversations/${conversation.id}/export?format=json`, "_blank");
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
  const activeId = useAppStore((s) => s.activeId);
  const setActiveDialog = useAppStore((s) => s.setActiveDialog);

  const pinned = conversations.filter((c) => c.pinned);
  const recent = conversations.filter((c) => !c.pinned);

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <span className="text-sm font-semibold tracking-tight">GLM 5.4 AI</span>
      </div>

      {/* New chat */}
      <div className="px-3 pt-2">
        <Button
          onClick={() => {
            newConversation();
            onNavigate?.();
          }}
          className="glow-primary h-9 w-full justify-start gap-2 rounded-xl text-sm"
          aria-label="Start a new conversation"
        >
          <Plus className="h-4 w-4" />
          New chat
        </Button>
      </div>

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

      {/* List */}
      <ScrollArea className="min-h-0 flex-1 px-0 pb-2">
        <div className="px-1 pt-2">
          {loading && conversations.length === 0 && (
            <div className="space-y-1.5 px-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-accent/40" />
              ))}
            </div>
          )}

          {!loading && conversations.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              {searchQuery ? "No conversations match your search." : "No conversations yet — start one!"}
            </p>
          )}

          {pinned.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Pinned
              </p>
              <div className="space-y-0.5">
                {pinned.map((c) => (
                  <ConversationRow key={c.id} conversation={c} />
                ))}
              </div>
            </>
          )}
          {recent.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Recent
              </p>
              <div className="space-y-0.5">
                {recent.map((c) => (
                  <ConversationRow key={c.id} conversation={c} />
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      {/* Footer — sticky at bottom of sidebar */}
      <div className="mt-auto border-t border-sidebar-border/60 px-3 py-2.5">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 flex-1 justify-start gap-2 rounded-lg text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setActiveDialog("documents");
              onNavigate?.();
            }}
          >
            <FileText className="h-3.5 w-3.5" />
            Documents
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 flex-1 justify-start gap-2 rounded-lg text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setActiveDialog("settings");
              onNavigate?.();
            }}
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => {
              setActiveDialog("about");
              onNavigate?.();
            }}
            aria-label="About and verified capabilities"
          >
            <Info className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
