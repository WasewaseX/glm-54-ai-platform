"use client";

import * as React from "react";
import { Download, Info, Moon, PanelLeft, PanelRight, Sparkles, Sun, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/lib/store";
import { downloadExport } from "@/lib/api-client";
import { GITHUB_REPO_URL } from "@/lib/constants";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

export function ChatHeader({ onMobileMenu }: { onMobileMenu?: () => void }) {
  const activeId = useAppStore((s) => s.activeId);
  const conversations = useAppStore((s) => s.conversations);
  const serverInfo = useAppStore((s) => s.serverInfo);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setActiveDialog = useAppStore((s) => s.setActiveDialog);
  const artifacts = useAppStore((s) => s.artifacts);
  const artifactPanelOpen = useAppStore((s) => s.artifactPanelOpen);
  const setArtifactPanelOpen = useAppStore((s) => s.setArtifactPanelOpen);
  const { resolvedTheme, setTheme } = useTheme();

  // Theme-dependent UI must wait until after hydration (next-themes pattern).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const active = conversations.find((c) => c.id === activeId);
  const isDark = mounted && resolvedTheme !== "light";

  const exportAs = (format: "md" | "json") => {
    if (!active) return;
    downloadExport(active.id, format).catch((err) => toast.error((err as Error).message));
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background/70 px-3 backdrop-blur sm:px-4">
      {/* Mobile: opens the sheet. Desktop: toggles the sidebar column. */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-lg md:hidden"
        onClick={onMobileMenu}
        aria-label="Open conversations"
      >
        <PanelLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden h-8 w-8 rounded-lg md:inline-flex"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        <PanelLeft className="h-4 w-4" />
      </Button>

      <div className="flex min-w-0 items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <h1 className="truncate text-sm font-medium">
          {active ? active.title : "New conversation"}
        </h1>
        {serverInfo?.servedChatModel && (
          <Badge
            variant="outline"
            className="hidden shrink-0 border-primary/30 bg-primary/[0.07] font-mono text-[10px] text-primary/90 sm:inline-flex"
          >
            {serverInfo.servedChatModel}
          </Badge>
        )}
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        {/* Artifacts panel toggle (desktop column / mobile sheet) */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative h-8 w-8 rounded-lg",
            artifactPanelOpen && "bg-primary/10 text-primary"
          )}
          onClick={() => setArtifactPanelOpen(!artifactPanelOpen)}
          aria-label={artifactPanelOpen ? "Close artifacts panel" : "Open artifacts panel"}
          aria-pressed={artifactPanelOpen}
        >
          <PanelRight className="h-4 w-4" />
          {artifacts.length > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground"
              aria-hidden
            >
              {artifacts.length > 9 ? "9+" : artifacts.length}
            </span>
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground sm:inline-flex"
          onClick={() => window.open(GITHUB_REPO_URL, "_blank", "noopener,noreferrer")}
          aria-label="Open source repository"
        >
          Source
          <ExternalLink className="h-3 w-3" />
        </Button>

        {active && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label="Export conversation">
                <Download className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportAs("md")}>Export as Markdown</DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportAs("json")}>Export as JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label={mounted ? (isDark ? "Switch to light mode" : "Switch to dark mode") : "Toggle theme"}
        >
          {mounted ? (isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />) : <Moon className="h-4 w-4" />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-lg"
          onClick={() => setActiveDialog("about")}
          aria-label="About and verified capabilities"
        >
          <Info className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
