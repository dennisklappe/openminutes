export const BASE_CSS = `
body { overflow-wrap: anywhere; }
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1c1f24;
  --muted: #5d6572;
  --rule: #d9dde3;
  --accent: #2760ab;
  --soft: #f4f6f9;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14171c;
    --fg: #e6e8ec;
    --muted: #9aa3b0;
    --rule: #2e343d;
    --accent: #74a8ef;
    --soft: #1c2027;
  }
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; color: var(--fg); background: var(--bg); line-height: 1.55; }
.minutes { margin: 0 auto; padding: 40px 24px 28px; }
.minutes h1, .minutes h2, .minutes h3, .minutes h4 { line-height: 1.25; }
.minutes a { color: var(--accent); }
.logo { display: block; max-height: 64px; max-width: 220px; margin-bottom: 20px; }
.facts { margin: 0; }
.facts div { display: flex; gap: 12px; }
.facts dt { color: var(--muted); min-width: 84px; }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.people ul { margin: 0; padding-left: 20px; }
.people .note { color: var(--muted); }
.summary ul, .summary ol { padding-left: 22px; }
.summary .task { list-style: none; margin-left: -22px; }
.summary .box { display: inline-block; width: 22px; }
.table-wrap { overflow-x: auto; margin: 8px 0 14px; }
.minutes table { border-collapse: collapse; width: 100%; font-size: 0.95em; }
.minutes th, .minutes td { overflow-wrap: normal; border: 1px solid var(--rule); padding: 6px 10px; text-align: left; vertical-align: top; }
.minutes th { background: var(--soft); font-weight: 600; }
.minutes .col-fit { white-space: nowrap; }
.minutes .col-cap { max-width: 16rem; overflow-wrap: anywhere; }
.seg { display: flex; gap: 12px; margin: 0 0 6px; }
.seg time { color: var(--muted); font-variant-numeric: tabular-nums; flex: none; }
.seg .who { font-weight: 600; }
.empty { color: var(--muted); font-style: italic; }
.powered { margin-top: 40px; font-size: 10px; text-align: center; color: var(--muted); }
.powered a { color: inherit; }
.tabs { position: relative; }
.tab-radio { position: absolute; opacity: 0; pointer-events: none; }
.tab-bar { display: flex; gap: 4px; border-bottom: 1px solid var(--rule); margin-bottom: 8px; overflow-x: auto; }
.tab-bar label { padding: 8px 16px; cursor: pointer; color: var(--muted); border-bottom: 3px solid transparent; margin-bottom: -1px; white-space: nowrap; font-weight: 600; }
.tab-bar label:hover { color: var(--fg); }
.tab-panel { display: none; }
#tab-minutes:checked ~ #minutes, #tab-transcript:checked ~ #transcript, #tab-chat:checked ~ #chat, #tab-links:checked ~ #links { display: block; }
#tab-minutes:checked ~ .tab-bar label[for="tab-minutes"], #tab-transcript:checked ~ .tab-bar label[for="tab-transcript"], #tab-chat:checked ~ .tab-bar label[for="tab-chat"], #tab-links:checked ~ .tab-bar label[for="tab-links"] { color: var(--accent); border-bottom-color: var(--accent); }
.tab-radio:focus-visible ~ .tab-bar label { outline-offset: -2px; }
#tab-minutes:focus-visible ~ .tab-bar label[for="tab-minutes"], #tab-transcript:focus-visible ~ .tab-bar label[for="tab-transcript"], #tab-chat:focus-visible ~ .tab-bar label[for="tab-chat"], #tab-links:focus-visible ~ .tab-bar label[for="tab-links"] { outline: 2px solid var(--accent); }
.tabs:has(.tab-panel:target) .tab-panel:not(:target) { display: none; }
.tabs:has(.tab-panel:target) .tab-panel:target { display: block; }
.tabs:has(.tab-panel:target) .tab-bar label { color: var(--muted); border-bottom-color: transparent; }
.tabs:has(#minutes:target) .tab-bar label[for="tab-minutes"], .tabs:has(#transcript:target) .tab-bar label[for="tab-transcript"], .tabs:has(#chat:target) .tab-bar label[for="tab-chat"], .tabs:has(#links:target) .tab-bar label[for="tab-links"] { color: var(--accent); border-bottom-color: var(--accent); }
.bubble { background: var(--soft); border-radius: 12px; padding: 8px 12px; margin: 8px 0; max-width: 42rem; }
.bubble p { margin: 0; overflow-wrap: anywhere; }
.bubble .meta { font-size: 0.85em; color: var(--muted); }
.bubble .meta .who { color: var(--fg); font-weight: 600; }
.bubble .meta time { font-variant-numeric: tabular-nums; }
.links ul { padding-left: 20px; overflow-wrap: anywhere; }
@media (max-width: 560px) { .minutes { padding: 24px 16px; } .seg { flex-direction: column; gap: 0; } }
@media print {
  :root { --bg: #fff; --fg: #000; --muted: #555; --rule: #ccc; --accent: #000; --soft: #f2f2f2; }
  .minutes { padding: 0; max-width: none; }
  a { text-decoration: none; }
  section { break-inside: avoid-page; }
  .tab-bar { display: none; }
  .tab-panel { display: block !important; }
  .seg { break-inside: avoid; }
}
`;
