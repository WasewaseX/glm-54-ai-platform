"use client";

import * as React from "react";
import { SidebarContent } from "@/components/chat/sidebar";
import { ChatHeader } from "@/components/chat/chat-header";
import { MessageList } from "@/components/chat/message-list";
import { Composer } from "@/components/chat/composer";
import { Welcome } from "@/components/chat/welcome";
import { SettingsDialog } from "@/components/chat/settings-dialog";
import { DocumentsDialog } from "@/components/chat/documents-dialog";
import { AboutDialog } from "@/components/chat/about-dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAppStore } from "@/lib/store";

export default function Home() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const messages = useAppStore((s) => s.messages);

  const [booted, setBooted] = React.useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = React.useState(false);

  React.useEffect(() => {
    void bootstrap().finally(() => setBooted(true));
  }, [bootstrap]);

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <DesktopSidebar />

      {/* Mobile sidebar (sheet) */}
      <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="w-80 border-sidebar-border/60 bg-sidebar p-0"
        >
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <SidebarContent onNavigate={() => setMobileSheetOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <main className="flex min-w-0 flex-1 flex-col">
        <ChatHeader onMobileMenu={() => setMobileSheetOpen(true)} />

        {hasMessages ? (
          <MessageList />
        ) : booted ? (
          <Welcome />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
              Warming up the workspace…
            </div>
          </div>
        )}

        <Composer />

        {/* Slim status footer — sticks to the bottom of the main column */}
        <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border/40 px-3 pb-[env(safe-area-inset-bottom)] text-[10px] text-muted-foreground/70 sm:px-4">
          <span>
            {messages.length > 0
              ? "History restored from database"
              : "Session-ready · history is saved automatically"}
          </span>
          <span className="hidden sm:block">Next.js 16 · SSE streaming · RAG long-context</span>
        </footer>
      </main>

      <SettingsDialog />
      <DocumentsDialog />
      <AboutDialog />
    </div>
  );
}

/**
 * Desktop sidebar. Rendered after `booted` so widths animate in only when
 * there is data; collapse state lives in the store.
 */
function DesktopSidebar() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  return (
    <aside
      className={`hidden shrink-0 border-r border-sidebar-border/60 transition-[width] duration-200 md:block ${
        sidebarOpen ? "w-72" : "w-0 overflow-hidden border-r-0"
      }`}
    >
      <SidebarContent />
    </aside>
  );
}
