"use client";
// Sideline's custom AG Studio widgets. Both read their data through the widget API, so page
// filters, filter widgets and cross filters apply to them like any built-in widget, and both
// redraw when a PayPal webhook changes the data.
import { useEffect, useMemo, useState } from "react";
import { AgIncompleteDataMappingOverlay, AgNoDataOverlay, createWidgets } from "ag-studio-react";
import type { AgWidgetField, AgWidgetParams, AgWidgetsConfig } from "ag-studio";

type Rows = Record<string, unknown>[];
type Mapping = Partial<Record<string, AgWidgetField[]>>;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Run one query for the widget and keep it up to date. A data handle (not a one-off getData) is
 * what stays live across Studio's own refreshes of the widget: a title edit, a mode switch, a
 * filter, or a PayPal payment arriving as a transaction all deliver the query's rows again.
 */
function useRows(widgetApi: AgWidgetParams["widgetApi"], fields: AgWidgetField[]): Rows | null {
  const [rows, setRows] = useState<Rows | null>(null);
  const key = fields.map((f) => `${f.key}`).join("|");
  useEffect(() => {
    if (fields.length === 0) return;
    let alive = true;
    const handle = widgetApi.getDataHandle();
    handle.open(({ results }) => {
      for (const { response } of results) {
        if (alive && !response.replaced) setRows((response.results as { rows: Rows }).rows);
      }
    });
    handle.set("rows", { query: { fields } });
    return () => {
      alive = false;
      handle.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetApi, key]);
  return rows;
}

const SVG = (path: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

// --- Scoreboard ------------------------------------------------------------------------------

function ScoreboardWidget({ widgetApi, dataMapping, context }: AgWidgetParams) {
  const map = dataMapping as Mapping;
  const home = map.home?.[0];
  const away = map.away?.[0];
  const roster = map.roster?.[0];
  const fields = useMemo(() => (home && away ? [...(roster ? [roster] : []), home, away] : []), [home, away, roster]);
  const rows = useRows(widgetApi, fields);
  if (!home || !away) return <AgIncompleteDataMappingOverlay />;
  if (!rows) return null;
  if (rows.length === 0) return <AgNoDataOverlay />;

  const collected = rows.reduce((a, r) => a + num(r[home.key]), 0);
  const owed = rows.reduce((a, r) => a + num(r[away.key]), 0);
  const billed = collected + owed;
  const pct = billed > 0 ? Math.round((collected / billed) * 100) : 0;
  const families = roster ? rows.length : 0;
  const paidUp = roster ? rows.filter((r) => num(r[away.key]) === 0).length : 0;
  const team = (context as { team?: { shortName?: string } } | undefined)?.team?.shortName ?? "HOME";

  return (
    <div className="sl-scoreboard">
      <div className="sl-sb-side">
        <div className="sl-sb-label">{team} · {home.name}</div>
        <div className="sl-sb-digits sl-sb-green">{money(collected)}</div>
      </div>
      {roster ? (
        <div className="sl-sb-mid">
          <div className="sl-sb-label">Paid in</div>
          <div className="sl-sb-clock">{pct}%</div>
          <div className="sl-sb-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Share collected">
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="sl-sb-period">
            {paidUp} of {families} families paid up
          </div>
        </div>
      ) : (
        // No roster mapped: the two scores are just two amounts, so the middle shows the gap between them.
        <div className="sl-sb-mid">
          <div className="sl-sb-label">Difference</div>
          <div className="sl-sb-clock">{collected - owed < 0 ? "-" : "+"}{money(Math.abs(collected - owed))}</div>
        </div>
      )}
      <div className="sl-sb-side sl-sb-right">
        <div className="sl-sb-label">{away.name}</div>
        <div className={`sl-sb-digits ${owed > 0 ? "sl-sb-amber" : "sl-sb-green"}`}>{money(owed)}</div>
      </div>
    </div>
  );
}

// --- The bench: one jersey per family --------------------------------------------------------

const TONE: Record<string, string> = { Paid: "paid", Open: "open", Late: "late", "Team fund": "fund", Covered: "fund" };

function BenchWidget({ widgetApi, dataMapping }: AgWidgetParams) {
  const map = dataMapping as Mapping;
  const label = map.label?.[0];
  const number = map.number?.[0];
  const status = map.status?.[0];
  const value = map.value?.[0];
  const fields = useMemo(() => (label && status ? [label, ...(number ? [number] : []), status, ...(value ? [value] : [])] : []), [label, number, status, value]);
  const rows = useRows(widgetApi, fields);
  if (!label || !status) return <AgIncompleteDataMappingOverlay />;
  if (!rows) return null;
  if (rows.length === 0) return <AgNoDataOverlay />;

  // A family with two charges shows its worst status.
  const rank: Record<string, number> = { Late: 4, Open: 3, "Team fund": 2, Covered: 1, Paid: 0 };
  const byFamily = new Map<string, { name: string; jersey: string; status: string; owed: number }>();
  for (const r of rows) {
    const name = String(r[label.key] ?? "");
    const st = String(r[status.key] ?? "");
    const cur = byFamily.get(name);
    const owed = (cur?.owed ?? 0) + (value ? num(r[value.key]) : 0);
    const worst = cur && (rank[cur.status] ?? 0) >= (rank[st] ?? 0) ? cur.status : st;
    byFamily.set(name, { name, jersey: number ? String(r[number.key] ?? "").split(" ")[0] : "", status: worst, owed });
  }
  const tiles = [...byFamily.values()].sort((a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0) || a.name.localeCompare(b.name));

  return (
    <div className="sl-bench">
      {tiles.map((t) => (
        <div key={t.name} className={`sl-jersey sl-jersey-${TONE[t.status] ?? "open"}`} title={`${t.name}: ${t.status}${t.owed > 0 ? `, ${money(t.owed)} still owed` : ""}`}>
          <svg viewBox="0 0 64 60" aria-hidden>
            <path d="M22 4 L8 10 L2 24 L12 29 L16 22 L16 56 L48 56 L48 22 L52 29 L62 24 L56 10 L42 4 C40 10 24 10 22 4 Z" />
          </svg>
          <span className="sl-jersey-no">{t.jersey.replace("#", "")}</span>
          <span className="sl-jersey-name">{t.name}</span>
          <span className="sl-jersey-status">{t.status === "Paid" ? "Paid" : t.owed > 0 ? money(t.owed) : t.status}</span>
        </div>
      ))}
    </div>
  );
}

export const sidelineWidgets = (base: AgWidgetsConfig): AgWidgetsConfig =>
  createWidgets({
    additionalTypes: [
      {
        id: "sideline-scoreboard",
        label: "Scoreboard",
        icon: SVG('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M12 5v14M6 10v4M17 10h2v4h-2z"/>'),
        dataMapping: {
          home: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "The home score: the amount collected so far (sum)." },
          away: { type: "field", supportedRoles: ["numeric"], required: true, aiDescription: "The away score: the amount still owed (sum)." },
          roster: { type: "field", supportedRoles: ["category"], aiDescription: "Optional. One entry per family, used for the 'N of M families paid up' line." },
        },
        form: (params: { createDefaults: (p: object) => unknown }) =>
          params.createDefaults({
            dataMappingItems: [
              { key: "home", label: "Home score (collected)" },
              { key: "away", label: "Away score (still owed)" },
              { key: "roster", label: "Roster (one per family)" },
            ],
          }),
        comp: ScoreboardWidget,
        defaultSize: { width: 900, height: 170 },
        minSize: { width: 280, height: 130 },
        ai: {
          description: "A stadium scoreboard for collections: the collected amount as the home score, the amount still owed as the away score, percent collected as the clock, and how many families are paid up.",
          usage: "Use it once at the top of a page as the headline for dues collection. All three fields come from the Family dues table: home = dues.collected (sum), away = dues.outstanding (sum), roster = dues.family. Do not mix in fields from another table.",
        },
      },
      {
        id: "sideline-bench",
        label: "The bench",
        icon: SVG('<path d="M8 3 3 6l2 5 2-1v10h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0Z"/>'),
        dataMapping: {
          label: { type: "field", supportedRoles: ["category"], required: true, aiDescription: "The family name shown under each jersey." },
          status: { type: "field", supportedRoles: ["category"], required: true, aiDescription: "Payment status (Paid, Open, Late, Team fund). It sets the jersey colour." },
          number: { type: "field", supportedRoles: ["category"], aiDescription: "Optional jersey number printed on the shirt." },
          value: { type: "field", supportedRoles: ["numeric"], aiDescription: "Optional amount still owed (sum), shown under families that owe." },
        },
        form: (params: { createDefaults: (p: object) => unknown }) =>
          params.createDefaults({
            dataMappingItems: [
              { key: "label", label: "Family" },
              { key: "status", label: "Status (sets the colour)" },
              { key: "number", label: "Jersey number" },
              { key: "value", label: "Still owed" },
            ],
          }),
        comp: BenchWidget,
        defaultSize: { width: 900, height: 230 },
        minSize: { width: 280, height: 140 },
        ai: {
          description: "A team bench: one jersey per family, coloured by payment status (green paid, amber open, red late, blue covered by the team fund or another family), with the amount still owed under it.",
          usage: "Use it to show at a glance which families have paid. All fields come from the Family dues table: label = dues.family, status = dues.status, number = dues.jersey, value = dues.outstanding (sum).",
        },
      },
    ],
    menu: [{ label: "Sideline", widgetIds: ["sideline-scoreboard", "sideline-bench"] }, ...base.menu],
  } as never) as AgWidgetsConfig;
