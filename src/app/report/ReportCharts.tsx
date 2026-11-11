"use client";
import { useMemo, useRef, useState } from "react";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule as ChartsModule, ModuleRegistry as ChartsRegistry, type AgChartOptions } from "ag-charts-community";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { sidelineGridTheme } from "@/components/FamilyBoard";
import { money } from "@/components/ui";
import { useMediaQuery } from "@/hooks/useDashboard";
import { cssFont } from "@/lib/cssFont";

ChartsRegistry.registerModules([ChartsModule]);
ModuleRegistry.registerModules([AllCommunityModule]);

export interface ReportRow {
  date: string;
  what: string;
  category: string;
  cents: number;
  viaPayPal: boolean;
}

const chartTheme = () => ({
  baseTheme: "ag-default-dark" as const,
  params: { backgroundColor: "transparent", foregroundColor: "#e2e8f0", fontFamily: cssFont("--font-hanken", "sans-serif"), chromeBackgroundColor: "#0f172a" },
});

export function ReportCharts({ rows, outBreakdown }: { rows: ReportRow[]; outBreakdown: { category: string; cents: number }[] }) {
  const narrow = useMediaQuery("(max-width: 640px)");
  const grid = useRef<AgGridReact<ReportRow>>(null);
  const [category, setCategory] = useState<string | null>(null);
  const shown = useMemo(() => (category ? rows.filter((r) => r.category === category) : rows), [rows, category]);
  const net = useMemo(() => [{ date: "", what: category ? `Total: ${category}` : "Net this season", category: "", cents: shown.reduce((a, r) => a + r.cents, 0), viaPayPal: false }], [shown, category]);

  const balanceOptions = useMemo<AgChartOptions>(() => {
    let running = 0;
    const points = rows.map((r) => {
      running += r.cents;
      return { date: new Date(r.date), balance: running / 100 };
    });
    return {
      theme: chartTheme(),
      height: 260,
      title: { text: "Team bank over the season", fontFamily: cssFont("--font-oswald", "sans-serif"), fontSize: 16, color: "#e2e8f0" },
      data: points,
      series: [
        {
          type: "area",
          xKey: "date",
          yKey: "balance",
          yName: "Balance",
          interpolation: { type: "step", position: "end" },
          fill: "#f59e0b",
          fillOpacity: 0.18,
          stroke: "#fbbf24",
          strokeWidth: 2,
          marker: { enabled: false },
          tooltip: { renderer: ({ datum }: { datum: { date: Date; balance: number } }) => ({ heading: datum.date.toLocaleDateString(), data: [{ label: "Balance", value: money(Math.round(datum.balance * 100)) }] }) },
        },
      ],
      axes: {
        x: { type: "time", position: "bottom", gridLine: { enabled: false } },
        y: { type: "number", position: "left", label: { formatter: ({ value }: { value: number }) => `$${value.toLocaleString()}` } },
      },
    } as AgChartOptions;
  }, [rows]);

  const outOptions = useMemo<AgChartOptions>(
    () =>
      ({
        theme: chartTheme(),
        height: 260,
        title: { text: "Where the money went", fontFamily: cssFont("--font-oswald", "sans-serif"), fontSize: 16, color: "#e2e8f0" },
        padding: { right: 48 },
        data: outBreakdown.map((d) => ({ ...d, dollars: d.cents / 100 })),
        series: [
          {
            type: "bar",
            direction: "horizontal",
            xKey: "category",
            yKey: "dollars",
            yName: "Spent",
            fill: "#10b981",
            cornerRadius: 4,
            label: { formatter: ({ value }: { value: number }) => money(Math.round(value * 100), { compact: true }), color: "#e2e8f0", placement: "outside-end" },
            cursor: "pointer",
            listeners: {
              // Click a bar to filter the "Every dollar" grid to that category.
              seriesNodeClick: ({ datum }: { datum: { category: string } }) => setCategory((c) => (c === datum.category ? null : datum.category)),
            },
          },
        ],
        axes: { x: { type: "category", position: "left" }, y: { type: "number", position: "bottom", label: { formatter: ({ value }: { value: number }) => `$${value}` } } },
      }) as AgChartOptions,
    [outBreakdown],
  );

  const columns = useMemo<ColDef<ReportRow>[]>(
    () => [
      { field: "date", headerName: narrow ? "When" : "Date", width: narrow ? 82 : 120, sort: "desc", valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "") },
      { field: "what", headerName: "What", flex: 1, minWidth: 130, wrapText: narrow, autoHeight: narrow, cellStyle: narrow ? { lineHeight: "1.35", paddingTop: "8px", paddingBottom: "8px" } : undefined },
      ...(narrow ? [] : [{ field: "category" as const, headerName: "Category", width: 140, filter: true }]),
      {
        field: "cents",
        headerName: "Amount",
        width: narrow ? 96 : 130,
        type: "rightAligned",
        valueFormatter: (p) => money(p.value, { sign: true }),
        cellClass: (p) => (p.value > 0 ? "led text-turf-bright" : "led text-coral-soft"),
      },
    ],
    [narrow],
  );

  return (
    <>
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="card p-3">
          <AgCharts options={balanceOptions} />
        </div>
        <div className="card p-3">
          <AgCharts options={outOptions} />
        </div>
      </section>
      <section className="card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide">Every dollar</h2>
          {category ? (
            <button className="pill pill-sent" onClick={() => setCategory(null)}>
              {category} ✕
            </button>
          ) : (
            <span className="text-xs text-chalk-faint">Tip: click a bar above to filter</span>
          )}
        </div>
        <div style={{ height: 480 }}>
          <AgGridReact<ReportRow>
            ref={grid}
            theme={sidelineGridTheme.withParams({ rowHeight: 46 })}
            rowData={shown}
            columnDefs={columns}
            pinnedBottomRowData={net}
            getRowClass={(p) => (p.node.rowPinned ? "!bg-night-800 font-semibold" : undefined)}
            defaultColDef={{ sortable: true, suppressMovable: true }}
          />
        </div>
      </section>
    </>
  );
}
