import { esc } from './format';
import { icons } from './icons';
import { sections, type Field, type PanelDef } from './settings-data';
import type { State } from './state';

function control(field: Field, state: State): string {
  const value = state.settings[field.key];
  const help = 'help' in field && field.help ? `<small>${esc(field.help)}</small>` : '';
  const bind = `data-setting="${field.key}"`;
  if (field.kind === 'check') {
    return `<div class="field"><label class="check"><input type="checkbox" ${bind}${value === true ? ' checked' : ''}>${esc(field.label)}</label>${help}</div>`;
  }
  if (field.kind === 'segmented') {
    const buttons = field.options
      .map(
        ([option, label]) =>
          `<button type="button" data-act="choice" data-key="${field.key}" data-value="${esc(option)}" aria-pressed="${value === option}">${esc(label)}</button>`,
      )
      .join('');
    return `<div class="segmented" role="group" aria-label="${esc(field.label)}">${buttons}</div>`;
  }
  const label = `<span>${esc(field.label)}</span>`;
  if (field.kind === 'select') {
    const options = field.options
      .map(
        ([option, text]) =>
          `<option value="${esc(option)}"${value === option ? ' selected' : ''}>${esc(text)}</option>`,
      )
      .join('');
    return `<label class="field">${label}<select ${bind}>${options}</select>${help}</label>`;
  }
  if (field.kind === 'area') {
    return `<label class="field">${label}<textarea rows="3" ${bind}>${esc(String(value))}</textarea>${help}</label>`;
  }
  const placeholder =
    'placeholder' in field && field.placeholder ? ` placeholder="${esc(field.placeholder)}"` : '';
  return `<label class="field">${label}<input type="${field.kind}" autocomplete="off" ${bind} value="${esc(String(value))}"${placeholder}>${help}</label>`;
}

function panel(def: PanelDef, state: State): string {
  const facts = def.facts
    ? `<dl class="facts">${def.facts.map(([term, text]) => `<dt>${esc(term)}</dt><dd>${esc(text)}</dd>`).join('')}</dl>`
    : '';
  const buttons = [
    ...(def.save ? [`<button class="primary" type="submit">${esc(def.save)}</button>`] : []),
    ...(def.actions ?? []).map(
      (action) =>
        `<button type="button" data-act="settings-action" data-panel="${def.id}" data-text="${esc(action.result)}">${esc(action.label)}</button>`,
    ),
  ];
  const feedback =
    state.feedback?.panel === def.id
      ? `<p class="feedback ok" role="status">${icons.check}${esc(state.feedback.text)}</p>`
      : '';
  const foot = buttons.length
    ? `<footer class="card-foot"><div class="actions">${buttons.join('')}</div>${feedback}</footer>`
    : '';
  const head = `<header class="card-head"><div class="card-title"><h3>${esc(def.title)}</h3></div>${def.description ? `<p>${esc(def.description)}</p>` : ''}</header>`;
  const body = `<div class="card-body">${facts}${def.fields.map((field) => control(field, state)).join('')}</div>`;
  return `<form class="panel card" data-act="settings-save" data-panel="${def.id}">${head}${body}${foot}</form>`;
}

export function settingsScreen(state: State): string {
  const section = sections.find((entry) => entry.id === state.section) ?? sections[0];
  const tabs = sections
    .map(
      (entry) =>
        `<a href="#" data-act="section" data-key="${entry.id}"${entry.id === section.id ? ' aria-current="page"' : ''}>${esc(entry.label)}</a>`,
    )
    .join('');
  return `<header class="page-head"><h1 role="heading" aria-level="2">Settings</h1></header><div class="settings"><nav class="subnav" aria-label="Settings sections">${tabs}</nav><div class="settings-body"><header class="section-head"><h2>${esc(section.label)}</h2><p>${esc(section.description)}</p></header>${section.panels.map((def) => panel(def, state)).join('')}</div></div>`;
}
