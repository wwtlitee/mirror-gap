const $ = selector => document.querySelector(selector);
const DISPLAY_KEY = 'mirror-gap-display-v1';

/** Move existing controls so their state and event listeners keep one owner. */
export function setupUiOrganization() {
  const move = (selector, target) => $(target).append($(selector));
  move('.language-switch', '#settings-language');
  move('#connection', '#settings-connection');
  move('#save-status', '#settings-save');
  move('.version', '#settings-version');
  move('#render-rate', '#settings-performance');
  move('#demo-time-controls', '#settings-time');
  move('#about-button', '#settings-about-links');
  $('#about-button').textContent = '生活机制与说明';
  $('#about-button').removeAttribute('aria-label');
  $('#help-life').remove();
  $('.transport').remove();
  move('.environment-section', '#settings-pane-about'); // Retained inert legacy bindings.
  $('.life-footer').remove();

  move('.neural-metrics', '#observation-metrics');
  move('#activity-reason', '#behavior-explanation');
  $('#behavior-explanation').append($('#motion-explanation').parentElement);
  $('#neural-drawer-toggle').firstChild.textContent = '观察详情 ';
  $('#habitat-tools-toggle').firstChild.textContent = '房间与记录 ';
  $('#habitat-tools h2').textContent = '房间与记录';
  $('#habitat-tools').setAttribute('aria-label', '房间、互动与生活记录');
  $('#habitat-tools-close').setAttribute('aria-label', '关闭生活记录');

  const dialog = $('#settings-dialog');
  const tabs = [...dialog.querySelectorAll('[data-settings-tab]')];
  let returnFocus = null;
  function selectTab(name, focus = false) {
    const chosen = tabs.find(tab => tab.dataset.settingsTab === name) ?? tabs[0];
    for (const tab of tabs) {
      const active = tab === chosen;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    $('.settings-content').scrollTop = 0;
    if (focus) chosen.focus();
  }
  function open(name) {
    returnFocus = document.activeElement;
    // A settings link in the profile switches dialogs, keeping a single modal.
    if ($('#companion-dialog')?.open) $('#companion-dialog').close();
    for (const id of ['neural-drawer', 'habitat-tools']) {
      if (!$('#' + id).hidden) $('#' + (id === 'neural-drawer' ? 'neural-drawer-close' : 'habitat-tools-close')).click();
    }
    if (name) selectTab(name);
    if (!dialog.open) dialog.showModal();
    dialog.dispatchEvent(new Event('settings-open'));
    tabs.find(tab => tab.getAttribute('aria-selected') === 'true').focus();
  }
  $('#settings-toggle').addEventListener('click', () => open());
  $('#settings-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    const target = returnFocus?.isConnected && !returnFocus.closest('dialog:not([open])') ? returnFocus : $('#settings-toggle');
    target.focus();
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('[data-open-settings]');
    if (link) open(link.dataset.openSettings);
  });
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab.dataset.settingsTab));
    tab.addEventListener('keydown', event => {
      const offsets = {ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1};
      let next;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else if (event.key in offsets) next = (index + offsets[event.key] + tabs.length) % tabs.length;
      if (next === undefined) return;
      event.preventDefault(); selectTab(tabs[next].dataset.settingsTab, true);
    });
  });

  let display = {brain: true, hints: true};
  try {
    const saved = JSON.parse(localStorage.getItem(DISPLAY_KEY));
    for (const key of Object.keys(display)) if (typeof saved?.[key] === 'boolean') display[key] = saved[key];
  } catch { /* Defaults also work with blocked browser storage. */ }
  function applyDisplay() {
    $('.hud-brain').hidden = !display.brain;
    $('.orbit-hint').hidden = !display.hints;
    $('#show-brain').checked = display.brain;
    $('#show-hints').checked = display.hints;
  }
  for (const key of Object.keys(display)) $('#show-' + key).addEventListener('change', event => {
    display[key] = event.target.checked; applyDisplay();
    try { localStorage.setItem(DISPLAY_KEY, JSON.stringify(display)); } catch { /* Session preference still applies. */ }
  });
  applyDisplay();
}
