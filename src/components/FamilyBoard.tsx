"use client";
import { useEffect, useMemo, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClassRules,
} from "ag-grid-community";
import { BellRing, ExternalLink } from "lucide-react";
import type { DashboardView } from "@/lib/view";
import { LANGUAGE_NAMES, type Family } from "@/lib/types";
import { Avatar, StatusPill, money, timeAgo } from "./ui";
import { useMediaQuery } from "@/hooks/useDashboard";

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
  valueChangeValueHighlightBackgroundColor: "rgba(16,185,129,0.35)",
  fontFamily: "var(--font-hanken), sans-serif",
  dataFontSize: 14,
  spacing: 7,
  headerHeight: 40,
  rowHeight: 62,
});

type InvoiceView = DashboardView["invoices"][number];
type ChargeView = DashboardView["charges"][number];

export interface BoardRow {
  id: string;
  family: Family;
  invoice: InvoiceView | null;
  line: ChargeView["lines"][number] | null;
  coveredBy: string | null;
  covers: string[];
  status: string; // grid sort key
}

export function FamilyBoard({
  data,
  charge,
  freshlyPaid,
  onNudge,
}: {
  data: DashboardView;
  charge: ChargeView | null;
  freshlyPaid: Set<string>;
  onNudge: (invoiceIds: string[]) => void;
}) {
  const narrow = useMediaQuery("(max-width: 720px)");
  const grid = useRef<AgGridReact<BoardRow>>(null);

  const rows = useMemo<BoardRow[]>(() => {
    if (!charge) return [];
    const famById = new Map(data.team.families.map((f) => [f.id, f]));
    return data.team.families.map((f) => {
      const line = charge.lines.find((l) => l.familyId === f.id) ?? null;
      const invoice = data.invoices.find((i) => i.chargeId === charge.id && i.payerFamilyId === f.id) ?? null;
      const coveredBy = line && line.payerFamilyId && line.payerFamilyId !== f.id ? famById.get(line.payerFamilyId)?.surname ?? null : null;
      const covers = charge.lines
        .filter((l) => l.payerFamilyId === f.id && l.familyId !== f.id && l.amountCents > 0)
        .map((l) => famById.get(l.familyId)?.surname ?? "");
      let status = "Z";
      if (invoice?.status === "PAID") status = "C-paid";
      else if (invoice?.late) status = "A-late";
      else if (invoice?.status === "SENT") status = "B-sent";
      else if (coveredBy) status = "D-covered";
      else if (line?.reason === "scholarship") status = "E-scholarship";
      else if (line?.reason === "excluded") status = "F-excluded";
      return { id: f.id, family: f, invoice, line, coveredBy, covers, status };
    });
  }, [data, charge]);

  // Re-render rows that just turned green so their flash class applies.
  useEffect(() => {
    if (freshlyPaid.size) grid.current?.api?.redrawRows();
  }, [freshlyPaid]);

  const rowClassRules = useMemo<RowClassRules<BoardRow>>(
    () => ({ "row-paid-flash": (p) => Boolean(p.data?.invoice && freshlyPaid.has(p.data.invoice.id)) }),
    [freshlyPaid],
  );

  const columns = useMemo<ColDef<BoardRow>[]>(() => {
    const family: ColDef<BoardRow> = {
      headerName: "Family",
      colId: "family",
      flex: 2.2,
      minWidth: narrow ? 118 : 210,
      valueGetter: (p) => p.data?.family.surname,
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        const f = p.data!.family;
        return (
          <div className="flex h-full items-center gap-3 leading-tight">
            {!narrow && <Avatar name={f.guardian} />}
            <div className="min-w-0">
              <div className="truncate font-semibold text-chalk">{f.surname}</div>
              <div className="truncate text-xs text-chalk-faint">
                {f.players.map((pl) => `${pl.name.split(" ")[0]} #${pl.jersey}`).join(" · ")}
              </div>
            </div>
          </div>
        );
      },
    };
    const language: ColDef<BoardRow> = {
      headerName: "Speaks",
      colId: "lang",
      width: 108,
      valueGetter: (p) => p.data?.family.language,
      cellRenderer: (p: ICellRendererParams<BoardRow>) => (
        <span className="pill pill-muted" title={LANGUAGE_NAMES[p.data!.family.language]}>
          {p.data!.family.language}
        </span>
      ),
    };
    const amount: ColDef<BoardRow> = {
      headerName: "Owes",
      colId: "amount",
      width: narrow ? 84 : 110,
      type: "rightAligned",
      cellStyle: { display: "flex", alignItems: "center", justifyContent: "flex-end" },
      valueGetter: (p) => p.data?.invoice?.amountCents ?? 0,
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        const r = p.data!;
        if (!r.invoice) return <span className="led text-chalk-faint">–</span>;
        return <span className={`led font-semibold ${r.invoice.status === "PAID" ? "text-turf-bright" : "text-chalk"}`}>{money(r.invoice.amountCents)}</span>;
      },
    };
    const note: ColDef<BoardRow> = {
      headerName: "Notes",
      colId: "note",
      flex: 1.4,
      minWidth: 170,
      sortable: false,
      valueGetter: (p) => p.data?.coveredBy ?? p.data?.covers.join(","),
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        const r = p.data!;
        if (r.coveredBy) return <span className="pill pill-sky">Covered by {r.coveredBy}</span>;
        if (r.line?.reason === "scholarship") return <span className="pill pill-sky" title="Scholarship: the team fund covers this family">Scholarship</span>;
        if (r.line?.reason === "excluded") return <span className="text-sm text-chalk-faint">Not on this charge</span>;
        return (
          <div className="flex flex-wrap gap-1.5">
            {r.covers.map((c) => (
              <span key={c} className="pill pill-sky">
                Covers {c}
              </span>
            ))}
            {r.line?.reason === "custom" && <span className="text-sm text-chalk-dim">{r.line.note}</span>}
          </div>
        );
      },
    };
    const status: ColDef<BoardRow> = {
      headerName: "Status",
      colId: "status",
      width: narrow ? 100 : 118,
      sort: "asc",
      valueGetter: (p) => p.data?.status,
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        const r = p.data!;
        if (!r.invoice) return <span className="text-sm text-chalk-faint">{r.coveredBy || r.line?.reason === "scholarship" ? "Covered" : "–"}</span>;
        return <StatusPill status={r.invoice.status} late={r.invoice.late} daysLate={r.invoice.daysLate} />;
      },
    };
    const when: ColDef<BoardRow> = {
      headerName: "Last activity",
      colId: "when",
      flex: 1.2,
      minWidth: 132,
      valueGetter: (p) => p.data?.invoice?.paidAt ?? p.data?.invoice?.sentAt ?? "",
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        const inv = p.data!.invoice;
        if (!inv) return null;
        if (inv.paidAt) return <span className="text-sm text-chalk-dim">Paid {timeAgo(inv.paidAt)} · {inv.paidVia}</span>;
        if (inv.sentAt)
          return (
            <span className="text-sm text-chalk-dim">
              Sent {timeAgo(inv.sentAt)}
              {inv.reminders.length > 0 && ` · ${inv.reminders.length} nudge${inv.reminders.length > 1 ? "s" : ""}`}
            </span>
          );
        return null;
      },
    };
    const actions: ColDef<BoardRow> = {
      headerName: "",
      colId: "actions",
      width: 84,
      sortable: false,
      cellRenderer: (p: ICellRendererParams<BoardRow>) => {
        const inv = p.data!.invoice;
        if (!inv) return null;
        return (
          <div className="flex h-full items-center justify-end gap-1">
            {inv.status === "SENT" && !narrow && (
              <button
                className="rounded-md p-2 text-led-bright hover:bg-led/10"
                title={`Draft a nudge for the ${p.data!.family.surname} family`}
                aria-label={`Nudge the ${p.data!.family.surname} family`}
                onClick={() => onNudge([inv.id])}
              >
                <BellRing size={17} />
              </button>
            )}
            <a
              className="rounded-md p-2 text-chalk-dim hover:bg-chalk/10 hover:text-chalk"
              href={`/pay/${inv.id}`}
              target="_blank"
              rel="noreferrer"
              title="Open this family's pay page"
              aria-label={`Open the ${p.data!.family.surname} family's pay page`}
            >
              <ExternalLink size={17} />
            </a>
          </div>
        );
      },
    };
    return narrow ? [family, amount, status] : [family, language, amount, note, status, when, actions];
  }, [narrow, onNudge]);

  if (!charge) {
    return <div className="rounded-lg border border-dashed border-chalk/15 p-10 text-center text-chalk-dim">Paste a message from the group chat to create your first charge.</div>;
  }

  return (
    <div className="ag-theme-sideline" style={{ height: rows.length * 62 + 44 }}>
      <AgGridReact<BoardRow>
        ref={grid}
        theme={sidelineGridTheme}
        rowData={rows}
        columnDefs={columns}
        getRowId={(p) => p.data.id}
        rowClassRules={rowClassRules}
        defaultColDef={{ sortable: true, resizable: false, suppressMovable: true, cellStyle: { display: "flex", alignItems: "center" } }}
        suppressCellFocus
        animateRows
        onRowClicked={(e) => {
          // On phones the action column is hidden; tapping a row opens that family's pay page.
          if (narrow && e.data?.invoice) window.open(`/pay/${e.data.invoice.id}`, "_blank", "noopener");
        }}
        domLayout="normal"
      />
    </div>
  );
}
