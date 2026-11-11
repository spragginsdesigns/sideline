// One AG Studio theme for the whole dashboard: the night-game scoreboard palette the rest of
// Sideline uses. Shared params restyle Studio's own UI, the grid widgets and the chart widgets at once.
import { studioTheme, type AgStudioTheme } from "ag-studio";

const night900 = "#070b14";
const night850 = "#0a1020";
const night800 = "#0f172a";
const chalk = "#e2e8f0";
const dim = "#94a3b8";
const led = "#f59e0b";
const turf = "#10b981";
const coral = "#f87171";
const sky = "#38bdf8";
const hairline = "rgba(148,163,184,0.16)";

export const sidelineStudioTheme: AgStudioTheme = studioTheme.withParams({
  browserColorScheme: "dark",
  backgroundColor: night850,
  foregroundColor: chalk,
  textColor: chalk,
  subtleTextColor: dim,
  accentColor: led,
  borderColor: hairline,
  fontFamily: "var(--font-hanken), 'Hanken Grotesk', system-ui, sans-serif",
  rowHoverColor: "rgba(245,158,11,0.07)",
  // The moment a family pays: changed cells flash pitch green.
  valueChangeUpColor: "#34d399",
  valueChangeDownColor: "#fbbf24",
  valueChangeHighlightBackgroundColor: "rgba(16,185,129,0.4)",

  studioMinWidth: 300,
  studioCanvasBackgroundColor: night900,
  studioCanvasGridLineColor: "rgba(226,232,240,0.05)",
  studioPanelContainerBackgroundColor: night800,
  studioPanelGroupBackgroundColor: night850,
  studioPanelHeaderFontFamily: "var(--font-oswald), 'Oswald', sans-serif",
  studioAiPanelInputMessageBackgroundColor: "rgba(245,158,11,0.14)",
  studioAiPanelWidth: 400,

  // Charts: collected is turf green, still owed is LED amber, then the rest of the kit.
  chartPaletteFills1Color: turf,
  chartPaletteFills2Color: led,
  chartPaletteFills3Color: sky,
  chartPaletteFills4Color: coral,
  chartPaletteFills5Color: "#a78bfa",
  chartPaletteFills6Color: "#f472b6",
  chartPaletteStrokes1Color: turf,
  chartPaletteStrokes2Color: led,
  chartPaletteStrokes3Color: sky,
  chartPaletteStrokes4Color: coral,
  chartPaletteStrokes5Color: "#a78bfa",
  chartPaletteStrokes6Color: "#f472b6",
  chartAxisLabelColor: dim,
  chartGridLineColor: "rgba(148,163,184,0.12)",
  chartLegendLabelColor: chalk,
  chartTooltipBackgroundColor: night800,
  chartTooltipTextColor: chalk,
});

/** Page layout: widgets are floodlit cards on the pitch. */
export const sidelinePageLayout = {
  backgroundColor: night900,
  widgetBackgroundColor: night850,
  widgetBorderEnabled: true,
  widgetBorderColor: hairline,
  widgetBorderWidth: 1,
  widgetBorderRadius: 12,
  widgetPadding: 6,
};
