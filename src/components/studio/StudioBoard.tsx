"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Eye, PlayCircle, RotateCcw, Sparkles } from "lucide-react";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { AgStudioAiModule, enableStudioDevValidations, singleColumnLayout, type AgAiHarnessSetup, type AgPanelConfig, type AgResponsiveLayoutBreakpoint, type AgDataSourcesDefinition, type AgReportState, type AgStudioApi, type AgStudioMode } from "ag-studio";
import type { StudioTables } from "@/lib/studio/tables";
import { TopBar } from "@/components/TopBar";
import { diffTables, toSources } from "./data";
import { createSidelineHarness } from "./agents";
import { defaultReport, PAGES } from "./report";
import { sidelineStudioTheme } from "./theme";
import { sidelineWidgets } from "./widgets";
import { sidelineToolDisplay } from "./toolDisplay";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

const LICENSE_KEY = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY || undefined;
const MODULES = [AgStudioAiModule];
const STORE_KEY = "sideline.studio.v1";
// Phones (view mode): the same widgets, stacked in one column.
const BREAKPOINTS: AgResponsiveLayoutBreakpoint[] = [{ maxWidth: 700, layout: singleColumnLayout }];
const PAGE_LAYOUT = { minWidth: 300 };
const NO_SIDE_PANELS: AgPanelConfig = { view: { left: [], right: [] } };
const LOCALE_TEXT = { panelTitleAi: "Ask the treasurer", aiMessageInputPlaceholder: "Ask about the team's money, or ask for a chart" };

function savedReport(): AgReportState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const state = raw ? (JSON.parse(raw) as AgReportState) : null;
    return state && Array.isArray(state.pages) && PAGES.every((p) => state.pages.some((x) => x.id === p.id)) ? state : null;
  } catch {
    return null;
  }
}

export default function StudioBoard({ initial }: { initial: StudioTables }) {
  const studioApi = useRef<AgStudioApi | null>(null);
  const last = useRef<StudioTables>(initial);
  const [ready, setReady] = useState(false);
  const wide = useMemo(() => typeof window !== "undefined" && window.innerWidth >= 900, []);
  const [mode, setMode] = useState<AgStudioMode>(wide ? "edit" : "view");
  const [pageId, setPageId] = useState<string>("scoreboard");
  const [busy, setBusy] = useState(false);

  const data = useMemo<AgDataSourcesDefinition>(() => toSources(initial), [initial]);
  const initialState = useMemo<AgReportState>(() => savedReport() ?? defaultReport(wide), [wide]);
  const ai = useMemo<AgAiHarnessSetup>(() => (params) => createSidelineHarness(params, initial.team), [initial.team]);
  const context = useMemo(() => ({ team: initial.team }), [initial.team]);

  // Live data: poll the server and apply what changed as Studio transactions, so a PayPal webhook
  // moves every widget in place.
  const poll = useCallback(async () => {
    const engine = studioApi.current?.getDataEngine();
    if (!engine?.applyTransaction) return;
    try {
      const res = await fetch("/api/studio/data", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as StudioTables;
      const diffs = diffTables(last.current, next);
      if (diffs.length) await engine.applyTransaction(diffs.map((d) => ({ tableId: d.tableId, add: d.add, update: d.update, remove: d.remove })));
      last.current = next;
    } catch {
      // a missed poll is retried on the next tick
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 2000);
    return () => clearInterval(t);
  }, [ready, poll]);

  const onStateUpdated = useCallback(() => {
    const state = studioApi.current?.getState();
    if (!state) return;
    setPageId(state.selectedPageId);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // private mode: the layout just isn't remembered
    }
  }, []);

  const goTo = useCallback((id: string) => {
    const api = studioApi.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: id });
    setPageId(id);
  }, []);

  const reset = useCallback(() => {
    studioApi.current?.setState(defaultReport(true));
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      // nothing stored
    }
  }, []);

  // Demo only (simulator): two families pay through the simulated PayPal checkout, and the
  // INVOICING.INVOICE.PAID webhooks turn the board green.
  const familiesPay = useCallback(async () => {
    setBusy(true);
    try {
      const view = (await (await fetch("/api/state", { cache: "no-store" })).json()) as { charges: { id: string }[]; invoices: { chargeId: string; status: string }[] };
      const charge = view.charges.find((c) => view.invoices.some((i) => i.chargeId === c.id && i.status === "SENT"));
      if (charge) await fetch("/api/demo/pay-some", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chargeId: charge.id, count: 2 }) });
    } finally {
      setTimeout(() => setBusy(false), 1200);
    }
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-night-900">
      <TopBar data={null} active="studio" />
      <div className="flex flex-wrap items-center gap-2 border-b border-chalk/[0.08] bg-night-850 px-3 py-2 sm:px-6">
        <div className="flex min-w-0 gap-1 overflow-x-auto" role="tablist" aria-label="Dashboard pages">
          {PAGES.map((p) => (
            <button
              key={p.id}
              role="tab"
              aria-selected={pageId === p.id}
              onClick={() => goTo(p.id)}
              className={clsx("shrink-0 rounded-md px-3 py-2 text-sm font-semibold transition", pageId === p.id ? "bg-led/15 text-led-bright" : "text-chalk-dim hover:text-chalk")}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {initial.mode === "simulator" && (
            <button className="btn btn-ghost !min-h-9 !px-3 !text-xs" onClick={familiesPay} disabled={busy} title="Demo: two families pay through the simulated PayPal checkout">
              <PlayCircle size={15} /> Families pay
            </button>
          )}
          <button className="btn btn-ghost !min-h-9 !px-3 !text-xs" onClick={reset} title="Bring back the dashboard Sideline ships with">
            <RotateCcw size={14} /> <span className="hidden sm:inline">Reset layout</span>
          </button>
          {/* Building is a desktop job: Studio edits the desktop layout, and phones get the stacked view. */}
          <div className={clsx("rounded-lg border border-chalk/15 p-0.5", wide ? "flex" : "hidden")} role="group" aria-label="Dashboard mode">
            <button className={clsx("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold", mode === "view" ? "bg-chalk/10 text-chalk" : "text-chalk-dim")} aria-pressed={mode === "view"} onClick={() => setMode("view")}>
              <Eye size={14} /> View
            </button>
            <button className={clsx("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold", mode === "edit" ? "bg-led/15 text-led-bright" : "text-chalk-dim")} aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>
              <Sparkles size={14} /> Build with AI
            </button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <AgStudioProvider modules={MODULES} licenseKey={LICENSE_KEY}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            data={data}
            mode={mode}
            theme={sidelineStudioTheme}
            layout={PAGE_LAYOUT}
            localeText={LOCALE_TEXT as never}
            responsiveLayoutBreakpoints={BREAKPOINTS}
            panels={wide ? undefined : NO_SIDE_PANELS}
            widgets={sidelineWidgets as never}
            initialState={initialState}
            context={context}
            ai={ai}
            aiToolDisplay={sidelineToolDisplay as never}
            onApiReady={(e) => (studioApi.current = e.api as unknown as AgStudioApi)}
            onStudioReady={() => setReady(true)}
            onStateUpdated={onStateUpdated}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
