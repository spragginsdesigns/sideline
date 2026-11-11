"use client";
import { useMemo } from "react";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule, ModuleRegistry, type AgChartOptions } from "ag-charts-community";
import type { DashboardView } from "@/lib/view";
import { money } from "./ui";
import { cssFont } from "@/lib/cssFont";

ModuleRegistry.registerModules([AllCommunityModule]);

type ChargeView = DashboardView["charges"][number];

export function Scoreboard({ data, charge }: { data: DashboardView; charge: ChargeView | null }) {
  const s = data.summary;
  const stats = charge?.stats;
  const pct = stats && stats.billedCents > 0 ? Math.round((stats.collectedCents / stats.billedCents) * 100) : 0;

  return (
    <section aria-label="Scoreboard" className="card relative overflow-hidden p-0">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-led/60 to-transparent" />
      <div className="grid grid-cols-2 gap-px bg-chalk/[0.06] lg:grid-cols-[1.25fr_1fr_1fr_1fr_auto]">
        <Tile label="Team bank" sub={`${money(s.moneyInCents, { compact: true })} in · ${money(s.moneyOutCents, { compact: true })} out this season`}>
          <span className="led led-amber text-3xl font-bold sm:text-[2.6rem]">{money(s.balanceCents)}</span>
        </Tile>
        <Tile label={charge ? `Collected · ${charge.title}` : "Collected"} sub={stats ? `of ${money(stats.billedCents)} billed` : "No charges yet"}>
          <span className="led led-green text-2xl font-bold sm:text-[2rem]">{money(stats?.collectedCents ?? 0)}</span>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-night-600">
            <div className="h-full rounded-full bg-turf transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </Tile>
        <Tile label="Still owed" sub={stats && stats.late > 0 ? `${stats.late} famil${stats.late === 1 ? "y" : "ies"} past due` : "Nobody past due"}>
          <span className={`led text-2xl font-bold sm:text-[2rem] ${stats && stats.late > 0 ? "led-coral" : "led-amber"}`}>{money(stats?.outstandingCents ?? 0)}</span>
        </Tile>
        <Tile label="Invoices paid" sub={stats?.absorbedCents ? `${money(stats.absorbedCents)} covered by the team fund` : `${pct}% of this charge`}>
          <span className="led text-2xl font-bold text-chalk sm:text-[2rem]">
            {stats?.paid ?? 0}
            <span className="text-chalk-faint">/{stats?.invoices ?? 0}</span>
          </span>
        </Tile>
        <div className="col-span-2 hidden items-center justify-center bg-night-850 px-4 lg:col-span-1 lg:flex">
          <Donut collected={stats?.collectedCents ?? 0} outstanding={stats?.outstandingCents ?? 0} absorbed={stats?.absorbedCents ?? 0} />
        </div>
      </div>
    </section>
  );
}

function Tile({ label, sub, children }: { label: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1 bg-night-850 px-4 py-4 sm:px-5 sm:py-5">
      <div className="label truncate">{label}</div>
      <div>{children}</div>
      <div className="truncate text-xs text-chalk-faint">{sub}</div>
    </div>
  );
}

function Donut({ collected, outstanding, absorbed }: { collected: number; outstanding: number; absorbed: number }) {
  const options = useMemo<AgChartOptions>(() => {
    const slices = [
      { what: "Collected", cents: collected, fill: "#10b981" },
      { what: "Still owed", cents: outstanding, fill: "#f59e0b" },
      { what: "Team-covered", cents: absorbed, fill: "#38bdf8" },
    ].filter((d) => d.cents > 0);
    return {
      width: 132,
      height: 132,
      padding: { top: 2, right: 2, bottom: 2, left: 2 },
      background: { visible: false },
      legend: { enabled: false },
      data: slices.length ? slices : [{ what: "Nothing billed", cents: 1, fill: "#222c45" }],
      series: [
        {
          type: "donut",
          angleKey: "cents",
          legendItemKey: "what",
          innerRadiusRatio: 0.72,
          fills: slices.length ? slices.map((s) => s.fill) : ["#222c45"],
          strokes: ["#0a1020"],
          strokeWidth: 3,
          tooltip: {
            renderer: ({ datum }: { datum: { what: string; cents: number } }) => ({ heading: datum.what, data: [{ label: "Amount", value: money(datum.cents) }] }),
          },
          innerLabels: [{ text: total(collected, outstanding) + "%", fontSize: 22, fontFamily: cssFont("--font-jetbrains", "monospace"), fontWeight: "bold", color: "#e2e8f0" }],
        },
      ],
    } as AgChartOptions;
  }, [collected, outstanding, absorbed]);
  return <AgCharts options={options} />;
}

function total(collected: number, outstanding: number) {
  const billed = collected + outstanding;
  return billed > 0 ? Math.round((collected / billed) * 100) : 0;
}
