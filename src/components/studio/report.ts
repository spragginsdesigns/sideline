// The dashboard Sideline ships with. It is ordinary AG Studio report state: the treasurer (or the
// AI) can rearrange it, and "Reset layout" brings this back.
import type { AgReportState } from "ag-studio";
import { sidelinePageLayout } from "./theme";

const title = (text: string) => ({ enabled: true, text });

export const PAGES = [
  { id: "scoreboard", label: "Scoreboard" },
  { id: "money", label: "Where the money went" },
  { id: "canvas", label: "Blank canvas" },
] as const;

export function defaultReport(aiOpen = true): AgReportState {
  const layout = sidelinePageLayout;
  return {
    selectedPageId: "scoreboard",
    panels: { filters: { collapsed: true }, data: { collapsed: true }, edit: { collapsed: true }, ai: { collapsed: !aiOpen, width: 400 } },
    pages: [
      {
        id: "scoreboard",
        layout,
        widgets: {
          score: {
            type: "sideline-scoreboard",
            dataMapping: {
              home: [{ id: "dues.collected", aggregation: "sum" }],
              away: [{ id: "dues.outstanding", aggregation: "sum" }],
              roster: [{ id: "dues.family" }],
            },
          },
          charge: {
            type: "button-filter",
            dataMapping: { value: [{ id: "dues.charge" }] },
          },
          bench: {
            type: "sideline-bench",
            format: { title: title("The bench") },
            dataMapping: {
              label: [{ id: "dues.family" }],
              status: [{ id: "dues.status" }],
              number: [{ id: "dues.jersey" }],
              value: [{ id: "dues.outstanding", aggregation: "sum" }],
            },
          },
          owed: {
            type: "bar-chart-stacked",
            format: { title: title("Paid vs still owed, by family") },
            dataMapping: {
              categoryKey: [{ id: "dues.family" }],
              valueKey: [
                { id: "dues.collected", aggregation: "sum" },
                { id: "dues.outstanding", aggregation: "sum" },
              ],
            },
          },
          how: {
            type: "donut-chart",
            format: { title: title("How families paid") },
            dataMapping: { categoryKey: [{ id: "dues.paid_via" }], valueKey: [{ id: "dues.collected", aggregation: "sum" }] },
          },
          dues: {
            type: "grid",
            format: { title: title("Every family, live from PayPal"), style: { animateValueChanges: true } },
            dataMapping: {
              cols: [
                { id: "dues.family" },
                { id: "dues.players" },
                { id: "dues.charge" },
                { id: "dues.status" },
                { id: "dues.collected", aggregation: "sum" },
                { id: "dues.outstanding", aggregation: "sum" },
                { id: "dues.paid_via" },
                { id: "dues.language" },
                { id: "dues.paypal_invoice" },
              ],
            },
          },
        },
        widgetLayout: {
          score: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 7 },
          charge: { xTrack: 0, yTrack: 7, xSpan: 24, ySpan: 6 },
          bench: { xTrack: 0, yTrack: 13, xSpan: 15, ySpan: 17 },
          how: { xTrack: 15, yTrack: 13, xSpan: 9, ySpan: 17 },
          dues: { xTrack: 0, yTrack: 30, xSpan: 15, ySpan: 18 },
          owed: { xTrack: 15, yTrack: 30, xSpan: 9, ySpan: 18 },
        },
      },
      {
        id: "money",
        layout,
        widgets: {
          flow: {
            type: "multi-kpi",
            format: { style: { columns: 3, textAlign: "center", verticalAlign: "center" } },
            dataMapping: {
              values: [
                { id: "ledger.money_in", aggregation: "sum" },
                { id: "ledger.money_out", aggregation: "sum" },
                { id: "ledger.amount", aggregation: "sum" },
              ],
            },
          },
          spend: {
            type: "bar-chart-grouped",
            format: { title: title("Where the money went") },
            dataMapping: { categoryKey: [{ id: "spending.category" }], valueKey: [{ id: "spending.amount", aggregation: "sum" }] },
          },
          days: {
            type: "column-chart-stacked",
            format: { title: title("Cash flow by day") },
            dataMapping: {
              categoryKey: [{ id: "ledger.date" }],
              valueKey: [
                { id: "ledger.money_in", aggregation: "sum" },
                { id: "ledger.money_out", aggregation: "sum" },
              ],
            },
          },
          refs: {
            type: "grid",
            format: { title: title("Referees, paid by PayPal Payouts") },
            dataMapping: { cols: [{ id: "games.date" }, { id: "games.opponent" }, { id: "games.result" }, { id: "games.referee" }, { id: "games.payout" }, { id: "games.paid_out", aggregation: "sum" }] },
          },
          ledger: {
            type: "grid",
            format: { title: title("Every dollar in and out") },
            dataMapping: { cols: [{ id: "ledger.date" }, { id: "ledger.what" }, { id: "ledger.category" }, { id: "ledger.recorded_by" }, { id: "ledger.amount", aggregation: "sum" }] },
          },
        },
        widgetLayout: {
          flow: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 7 },
          spend: { xTrack: 0, yTrack: 7, xSpan: 12, ySpan: 15 },
          days: { xTrack: 12, yTrack: 7, xSpan: 12, ySpan: 15 },
          refs: { xTrack: 0, yTrack: 22, xSpan: 12, ySpan: 16 },
          ledger: { xTrack: 12, yTrack: 22, xSpan: 12, ySpan: 16 },
        },
      },
      { id: "canvas", layout, widgets: {}, widgetLayout: {} },
    ],
  } as unknown as AgReportState;
}
