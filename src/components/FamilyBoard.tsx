"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type IRowNode,
  type RowClassParams,
} from "ag-grid-community";
import { Banknote, BellRing, ChevronRight, ExternalLink, Search } from "lucide-react";
import type { DashboardView } from "@/lib/view";
import { LANGUAGE_NAMES, type Family } from "@/lib/types";
import { Avatar, StatusPill, money, timeAgo } from "./ui";
import { api, useMediaQuery } from "@/hooks/useDashboard";

ModuleRegistry.registerModules([AllCommunityModule]);

export const sidelineGridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: "#0a1020",
  foregroundColor: "#e2e8f0",
  chromeBackgroundColor: "#0f172a",
  headerBackgroundColor: "#0f172a",
  headerTextColor: "#94a3b8",
  headerFontWeight: 600,
  headerFontSize: 12,
  accentColor: "#f59e0b",
  borderColor: "rgba(148,163,184,0.12)",
  rowBorder: { color: "rgba(148,163,184,0.08)" },
  wrapperBorder: false,
  wrapperBorderRadius: 10,
  oddRowBackgroundColor: "#0b1224",
  rowHoverColor: "rgba(245,158,11,0.06)",
  selectedRowBackgroundColor: "rgba(245,158,11,0.10)",
  // The grid's own change flash is the moment a family pays: make it pitch green.
  valueChangeValueHighlightBackgroundColor: "rgba(16,185,129,0.45)",
  fontFamily: "var(--font-hanken), sans-serif",
  dataFontSize: 14,
  spacing: 7,
  headerHeight: 40,
  rowHeight: 62,
});

type InvoiceView = DashboardView["invoices"][number];
type ChargeView = DashboardView["charges"][number];
type Group = "late" | "unpaid" | "paid" | "covered" | "out";
export type BoardFilter = "all" | "late" | "unpaid" | "paid" | "covered";

export interface BoardRow {
  id: string;
  family: Family;
  invoice: InvoiceView | null;
  shareCents: number;
  prepaid: { amountCents: number; method: string } | null;
  coveredBy: string | null; // whole share covered by another family
  partlyCoveredBy: string | null;
  covers: string[];
  scholarship: boolean;
  excluded: boolean;
  group: Group;
  rank: number; // default order: paid rows climb to the top (newest first), then late, unpaid, covered
}

export interface BoardTotals {
  billed: number;
  collected: number;
  paid: number;
  invoices: number;
}

const CHIPS: { key: BoardFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "late", label: "Late" },
  { key: "unpaid", label: "Unpaid" },
  { key: "paid", label: "Paid" },
  { key: "covered", label: "Covered" },
];

const METHOD: Record<string, string> = { cash: "cash", venmo: "Venmo", zelle: "Zelle", check: "check", other: "outside PayPal" };

export function FamilyBoard({
  data,
  charge,
  freshlyPaid,
  onNudge,
  onError,
  filter,
  onFilter,
}: {
  data: DashboardView;
  charge: ChargeView | null;
  freshlyPaid: Set<string>;
  onNudge: (invoiceIds: string[]) => void;
  onError: (message: string) => void;
  filter: BoardFilter;
  onFilter: (f: BoardFilter) => void;
}) {
  const narrow = useMediaQuery("(max-width: 720px)");
  // Laptop widths: the board column is ~770px, so fold the language into the family cell.
  const compact = useMediaQuery("(max-width: 1499px)");
  const grid = useRef<AgGridReact<BoardRow>>(null);
  const [search, setSearch] = useState("");

  const rows = useMemo<BoardRow[]>(() => {
    if (!charge) return [];
    const famById = new Map(data.team.families.map((f) => [f.id, f]));
    return data.team.families.map((f) => {
      const own = charge.lines.filter((l) => l.familyId === f.id);
      const invoice = data.invoices.find((i) => i.chargeId === charge.id && i.payerFamilyId === f.id) ?? null;
      const full = own.length === 1 && own[0].payerFamilyId && own[0].payerFamilyId !== f.id ? own[0].payerFamilyId : null;
      const partial = own.length > 1 ? own.find((l) => l.payerFamilyId && l.payerFamilyId !== f.id)?.payerFamilyId ?? null : null;
      const covers = [...new Set(charge.lines.filter((l) => l.payerFamilyId === f.id && l.familyId !== f.id && l.amountCents > 0).map((l) => famById.get(l.familyId)?.surname ?? ""))];
      const pp = charge.prepaid?.find((p) => p.familyId === f.id) ?? null;
      const scholarship = own.some((l) => l.reason === "scholarship");
      const excluded = own.some((l) => l.reason === "excluded");
      let group: Group = "out";
      let rank = 9e15;
      if (invoice?.status === "PAID" || (!invoice && pp)) {
        group = "paid";
        const at = invoice?.paidAt ?? charge.createdAt;
        rank = -new Date(at).getTime(); // newest payment first
      } else if (invoice?.late) {
        group = "late";
        rank = 1e15;
      } else if (invoice?.status === "SENT" || invoice?.status === "DRAFT") {
        group = "unpaid";
        rank = 2e15;
      } else if (full || scholarship) {
        group = "covered";
        rank = 3e15;
      }
      return {
        id: f.id,
        family: f,
        invoice,
        shareCents: charge.lines.filter((l) => l.payerFamilyId === f.id).reduce((a, l) => a + l.amountCents, 0),
        prepaid: pp ? { amountCents: pp.amountCents, method: METHOD[pp.method] ?? pp.method } : null,
        coveredBy: full ? famById.get(full)?.surname ?? null : null,
        partlyCoveredBy: partial ? famById.get(partial)?.surname ?? null : null,
        covers,
        scholarship,
        excluded,
        group,
        rank,
      };
    });
  }, [data, charge]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, late: 0, unpaid: 0, paid: 0, covered: 0 };
    for (const r of rows) if (r.group in c) c[r.group]++;
    c.unpaid += c.late; // "Unpaid" includes late families
    return c;
  }, [rows]);

  const totals = useMemo<BoardTotals>(() => {
    const invs = rows.filter((r) => (r.invoice && r.invoice.status !== "CANCELLED") || r.prepaid);
    return {
      billed: invs.reduce((a, r) => a + (r.invoice?.amountCents ?? 0) + (r.prepaid?.amountCents ?? 0), 0),
      collected: invs.reduce((a, r) => a + (r.invoice?.status === "PAID" ? r.invoice.amountCents : 0) + (r.prepaid?.amountCents ?? 0), 0),
      paid: invs.filter((r) => r.group === "paid").length,
      invoices: invs.length,
    };
  }, [rows]);

  // When PayPal says a family paid, flash the whole row with the grid's own change flash.
  useEffect(() => {
    const api = grid.current?.api;
    if (!api || freshlyPaid.size === 0) return;
    const nodes: IRowNode<BoardRow>[] = [];
    api.forEachNode((n) => {
      if (n.data?.invoice && freshlyPaid.has(n.data.invoice.id)) nodes.push(n);
    });
    if (nodes.length) setTimeout(() => api.flashCells({ rowNodes: nodes, flashDuration: 1400, fadeDuration: 900 }), 60);
  }, [freshlyPaid, rows]);

  useEffect(() => {
    grid.current?.api?.onFilterChanged();
  }, [filter]);

  // Several cells render from more than their sort value (a DRAFT and a SENT invoice are both
  // "unpaid"), so redraw every cell when the data changes; payment flashes are triggered above.
  useEffect(() => {
    grid.current?.api?.refreshCells({ force: true, suppressFlash: true });
  }, [rows, totals]);

  const recordCash = useCallback(
    async (r: BoardRow) => {
      if (!r.invoice) return;
      if (!confirm(`Record ${money(r.invoice.amountCents)} paid in cash by the ${r.family.surname} family? This marks their PayPal invoice as paid.`)) return;
      try {
        await api(`/api/invoices/${r.invoice.id}/record-payment`, { method: "CASH" });
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [onError],
  );

  const columns = useMemo<ColDef<BoardRow>[]>(() => {
    const pinned = (p: { node?: IRowNode | null }) => Boolean(p.node?.rowPinned);
    const family: ColDef<BoardRow> = {
      headerName: "Family",
      colId: "family",
      flex: 2.2,
      minWidth: narrow ? 128 : compact ? 168 : 210,
      getQuickFilterText: (p) => (p.data?.family ? `${p.data.family.surname} ${p.data.family.guardian} ${p.data.family.players.map((x) => x.name).join(" ")}` : ""),
      valueGetter: (p) => p.data?.family?.surname,
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        if (pinned(p)) return <span className="font-display text-sm font-semibold uppercase tracking-wider text-chalk-dim">Team total</span>;
        const f = p.data!.family;
        return (
          <div className="flex h-full items-center gap-3 leading-tight">
            {!narrow && <Avatar name={f.guardian} />}
            <div className="min-w-0">
              <div className="truncate font-semibold text-chalk">{f.surname}</div>
              <div className="truncate text-xs text-chalk-faint">
                {f.players.map((pl) => (narrow ? pl.name.split(" ")[0] : `${pl.name.split(" ")[0]} #${pl.jersey}`)).join(" · ")}
                {compact && !narrow && <span className="ml-1.5 font-mono text-[0.65rem] uppercase text-chalk-dim" title={LANGUAGE_NAMES[f.language]}>· {f.language}</span>}
              </div>
            </div>
          </div>
        );
      },
    };
    const language: ColDef<BoardRow> = {
      headerName: "Speaks",
      headerTooltip: "The language Sideline writes this family's reminders in",
      colId: "lang",
      width: 96,
      valueGetter: (p) => p.data?.family?.language,
      tooltipValueGetter: (p) => (p.data?.family ? LANGUAGE_NAMES[p.data.family.language] : ""),
      cellRenderer: (p: ICellRendererParams<BoardRow>) => (pinned(p) ? null : <span className="pill pill-muted">{p.data!.family.language}</span>),
    };
    const amount: ColDef<BoardRow> = {
      headerName: "Owes",
      headerTooltip: "This family's invoice, including anyone they cover",
      colId: "amount",
      width: narrow ? 88 : compact ? 98 : 112,
      type: "rightAligned",
      cellStyle: { display: "flex", alignItems: "center", justifyContent: "flex-end" },
      valueGetter: (p) => (pinned(p) ? (p.data as unknown as BoardTotals & { billed: number })?.billed : (p.data?.invoice?.amountCents ?? 0) + (p.data?.prepaid?.amountCents ?? 0)),
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        if (pinned(p)) return <span className="led font-bold text-chalk">{money(p.value)}</span>;
        const r = p.data!;
        if (!r.invoice && !r.prepaid) return <span className="led text-chalk-faint">–</span>;
        return <span className={clsx("led font-semibold", r.group === "paid" ? "text-turf-bright" : "text-chalk")}>{money(p.value)}</span>;
      },
    };
    const note: ColDef<BoardRow> = {
      headerName: "Notes",
      colId: "note",
      flex: 1.4,
      minWidth: compact ? 118 : 170,
      sortable: false,
      getQuickFilterText: (p) => (p.data?.covers ? [p.data.coveredBy, ...p.data.covers, p.data.scholarship ? "scholarship" : ""].join(" ") : ""),
      valueGetter: (p) => p.data?.coveredBy ?? p.data?.covers?.join(","),
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        if (pinned(p)) {
          const t = p.data as unknown as BoardTotals;
          return <span className="text-sm text-chalk-dim">{money(t.collected)} collected</span>;
        }
        const r = p.data!;
        if (r.coveredBy) return <span className="pill pill-sky">Covered by {r.coveredBy}</span>;
        if (r.scholarship) return <span className="pill pill-sky" title="Scholarship: the team fund covers this family">Scholarship</span>;
        if (r.excluded) return <span className="text-sm text-chalk-faint">Not on this charge</span>;
        return (
          <div className="flex flex-wrap gap-1.5">
            {r.covers.map((c) => (
              <span key={c} className="pill pill-sky">
                Covers {c}
              </span>
            ))}
            {r.partlyCoveredBy && <span className="pill pill-sky">Part covered by {r.partlyCoveredBy}</span>}
            {r.prepaid && <span className="pill pill-paid">{money(r.prepaid.amountCents)} paid {r.prepaid.method}</span>}
          </div>
        );
      },
    };
    const status: ColDef<BoardRow> = {
      headerName: "Status",
      colId: "status",
      width: narrow ? 108 : 118,
      sort: "asc",
      enableCellChangeFlash: true,
      valueGetter: (p) => (pinned(p) ? 0 : p.data?.group),
      comparator: (_a, _b, na, nb) => (na.data?.rank ?? 0) - (nb.data?.rank ?? 0),
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        if (pinned(p)) {
          const t = p.data as unknown as BoardTotals;
          return <span className="led text-sm font-semibold text-chalk">{t.paid}/{t.invoices} paid</span>;
        }
        const r = p.data!;
        const pill = !r.invoice ? (
          r.prepaid ? <span className="pill pill-paid">● Paid</span> : <span className="text-sm text-chalk-faint">{r.coveredBy || r.scholarship ? "Covered" : "–"}</span>
        ) : (
          <StatusPill status={r.invoice.status} late={r.invoice.late} daysLate={r.invoice.daysLate} />
        );
        return (
          <span className="flex w-full items-center justify-between">
            {pill}
            {narrow && r.invoice && <ChevronRight size={15} className="text-chalk-faint" aria-hidden />}
          </span>
        );
      },
    };
    const when: ColDef<BoardRow> = {
      headerName: "Last activity",
      colId: "when",
      flex: 1.2,
      minWidth: compact ? 118 : 140,
      valueGetter: (p) => p.data?.invoice?.paidAt ?? p.data?.invoice?.reminders?.at(-1)?.at ?? p.data?.invoice?.sentAt ?? "",
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        if (pinned(p)) return null;
        const inv = p.data!.invoice;
        if (!inv) return null;
        const nudge = inv.reminders.at(-1);
        const [top, bottom] = inv.paidAt
          ? [`Paid ${timeAgo(inv.paidAt)}`, `via ${inv.paidVia}`]
          : nudge
            ? [`Nudged ${timeAgo(nudge.at)}`, `${inv.reminders.length} reminder${inv.reminders.length > 1 ? "s" : ""} so far`]
            : inv.sentAt
              ? [`Sent ${timeAgo(inv.sentAt)}`, "by PayPal invoice"]
              : ["Not sent yet", ""];
        return (
          <div className="leading-tight">
            <div className="text-sm text-chalk">{top}</div>
            <div className="text-xs text-chalk-faint">{bottom}</div>
          </div>
        );
      },
    };
    const actions: ColDef<BoardRow> = {
      headerName: "",
      colId: "actions",
      width: compact ? 112 : 124,
      sortable: false,
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        if (pinned(p)) return null;
        const r = p.data!;
        const inv = r.invoice;
        if (!inv) return null;
        const nudgedToday = inv.reminders.length > 0 && Date.now() - new Date(inv.reminders.at(-1)!.at).getTime() < 86_400_000;
        return (
          <div className="flex h-full items-center justify-end gap-0.5">
            {inv.status === "SENT" && (
              <>
                <button
                  className="rounded-md p-2 text-led-bright hover:bg-led/10 disabled:opacity-30"
                  title={nudgedToday ? "Already nudged today" : `Draft a nudge for the ${r.family.surname} family`}
                  aria-label={`Nudge the ${r.family.surname} family`}
                  disabled={nudgedToday}
                  onClick={() => onNudge([inv.id])}
                >
                  <BellRing size={17} />
                </button>
                <button className="rounded-md p-2 text-turf-bright hover:bg-turf/10" title="They paid you in cash: record it on their PayPal invoice" aria-label={`Record a cash payment from the ${r.family.surname} family`} onClick={() => recordCash(r)}>
                  <Banknote size={17} />
                </button>
              </>
            )}
            <a className="rounded-md p-2 text-chalk-dim hover:bg-chalk/10 hover:text-chalk" href={`/pay/${inv.id}`} target="_blank" rel="noreferrer" title="Open this family's pay page" aria-label={`Open the ${r.family.surname} family's pay page`}>
              <ExternalLink size={17} />
            </a>
          </div>
        );
      },
    };
    if (narrow) return [family, amount, status];
    return compact ? [family, amount, note, status, when, actions] : [family, language, amount, note, status, when, actions];
  }, [narrow, compact, onNudge, recordCash]);

  const pinnedBottom = useMemo(() => (rows.length ? [totals as unknown as BoardRow] : []), [rows.length, totals]);

  const isExternalFilterPresent = useCallback(() => filter !== "all", [filter]);
  const doesExternalFilterPass = useCallback(
    (node: IRowNode<BoardRow>) => {
      const g = node.data?.group;
      if (filter === "unpaid") return g === "unpaid" || g === "late";
      return g === filter;
    },
    [filter],
  );

  if (!charge) {
    return <div className="rounded-lg border border-dashed border-chalk/15 p-10 text-center text-chalk-dim">Paste a message from the group chat to create your first charge.</div>;
  }

  const visible = filter === "all" && !search ? rows.length : rows.filter((r) => (filter === "all" ? true : filter === "unpaid" ? r.group === "unpaid" || r.group === "late" : r.group === filter)).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Filter families">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              aria-pressed={filter === c.key}
              onClick={() => onFilter(c.key)}
              className={clsx(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                filter === c.key ? "border-led/70 bg-led/15 text-led-bright" : "border-chalk/12 text-chalk-dim hover:border-chalk/30 hover:text-chalk",
                c.key === "late" && counts.late > 0 && filter !== c.key && "text-coral-soft",
              )}
            >
              {c.label} <span className="led opacity-80">{counts[c.key]}</span>
            </button>
          ))}
        </div>
        {!narrow && (
          <label className="relative ml-auto">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-chalk-faint" />
            <span className="sr-only">Search families</span>
            <input className="field !w-52 !rounded-full !py-1.5 !pl-8 text-sm" placeholder="Search families, players…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
        )}
      </div>
      <div className="ag-theme-sideline" style={{ height: Math.max(3, visible) * 62 + 44 + 62 + 2 }}>
        <AgGridReact<BoardRow>
          ref={grid}
          theme={sidelineGridTheme}
          rowData={rows}
          columnDefs={columns}
          getRowId={(p) => p.data.id ?? "totals"}
          pinnedBottomRowData={pinnedBottom}
          getRowClass={(p: RowClassParams<BoardRow>) => (p.node.rowPinned ? "!bg-night-800 font-semibold" : undefined)}
          quickFilterText={search}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          defaultColDef={{ sortable: true, resizable: false, suppressMovable: true, cellStyle: { display: "flex", alignItems: "center" } }}
          tooltipShowDelay={300}
          animateRows
          onRowClicked={(e) => {
            // On phones the action column is hidden; tapping a row opens that family's pay page.
            if (narrow && !e.node.rowPinned && e.data?.invoice) window.open(`/pay/${e.data.invoice.id}`, "_blank", "noopener");
          }}
        />
      </div>
    </div>
  );
}
