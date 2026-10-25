import { createHash } from 'node:crypto';

const STORAGE_KEY = 'openminutes-theme';

const SCRIPT = `(function(){var r=document.documentElement,k='${STORAGE_KEY}';function s(){try{return localStorage.getItem(k)}catch(e){return null}}function p(){return matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}function a(t){r.setAttribute('data-theme',t);var b=document.getElementById('theme-toggle');if(b){b.hidden=false;b.textContent=t==='dark'?'Light':'Dark';b.setAttribute('aria-label','Switch to '+(t==='dark'?'light':'dark')+' mode')}}var c=s();a(c==='dark'||c==='light'?c:p());document.getElementById('theme-toggle').addEventListener('click',function(){var n=r.getAttribute('data-theme')==='dark'?'light':'dark';try{localStorage.setItem(k,n)}catch(e){}a(n)});var h=function(){var i=location.hash.slice(1),r=i&&document.getElementById('tab-'+i);if(r&&r.className==='tab-radio')r.checked=true};h();addEventListener('hashchange',h);document.querySelectorAll('.tab-radio').forEach(function(t){t.addEventListener('change',function(){if(location.hash)location.replace(location.pathname+location.search+'#')})})})();`;

const STYLE = `
:root[data-theme="light"] { color-scheme: light; --bg: #ffffff; --fg: #1c1f24; --muted: #5d6572; --rule: #d9dde3; --accent: #2760ab; --soft: #f4f6f9; }
:root[data-theme="dark"] { color-scheme: dark; --bg: #14171c; --fg: #e6e8ec; --muted: #9aa3b0; --rule: #2e343d; --accent: #74a8ef; --soft: #1c2027; }
#theme-toggle { position: fixed; top: 12px; right: 12px; font: 12px system-ui, sans-serif; color: var(--muted); background: var(--soft); border: 1px solid var(--rule); border-radius: 999px; padding: 4px 12px; cursor: pointer; }
#theme-toggle:hover { color: var(--fg); }
@media (max-width: 600px) { body { padding-top: 56px; } #theme-toggle { position: absolute; padding: 12px 16px; min-height: 44px; } }
@media print { #theme-toggle { display: none; } :root[data-theme] { --bg: #fff; --fg: #000; --muted: #555; --rule: #ccc; --accent: #000; --soft: #f2f2f2; } }
`;

export const SHARE_SCRIPT_HASH = `sha256-${createHash('sha256').update(SCRIPT).digest('base64')}`;

export function withShareTheme(html: string): string {
  return html
    .replace('</head>', () => `<style>${STYLE}</style>\n</head>`)
    .replace(
      '</body>',
      () =>
        `<button id="theme-toggle" type="button" hidden>Dark</button>\n<script>${SCRIPT}</script>\n</body>`,
    );
}
