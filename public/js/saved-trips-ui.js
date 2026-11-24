import { createSavedTripStore, snapshotTrip, exportTrip } from './saved-trips.js';
import { validateItinerary, minutes } from './itinerary-validation.js';

const $ = (selector) => document.querySelector(selector);
const node = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };

export function downloadSavedTrip(trip) {
  const blob = new Blob([exportTrip(trip)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = node('a');
  link.href = url; link.download = `여행한조각-${trip.region.replace(/[^가-힣a-z0-9_-]/gi, '_')}-${trip.startDate}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function editSavedTrip(plan, { title, personalNote, stops }, now = () => new Date().toISOString()) {
  const updated = snapshotTrip(plan);
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 100 || typeof personalNote !== 'string' || personalNote.length > 1000) throw new Error('제목은 1~100자, 메모는 1000자 이내로 입력해 주세요.');
  if (!Array.isArray(stops) || stops.length !== updated.days.reduce((sum, day) => sum + day.stops.length, 0)) throw new Error('수정할 방문 장소를 다시 확인해 주세요.');
  updated.title = title.trim(); updated.personalNote = personalNote.trim();
  let index = 0;
  for (const day of updated.days) for (const stop of day.stops) {
    const change = stops[index++], start = minutes(change?.time), end = change?.endTime ? minutes(change.endTime) : null;
    if (start === null || change.endTime && (end === null || end <= start) || typeof change.personalNote !== 'string' || change.personalNote.length > 500) throw new Error('방문·종료 시각을 확인해 주세요. 종료 시각은 방문 시각보다 늦어야 하며 장소 메모는 500자 이내예요.');
    stop.time = change.time; stop.endTime = change.endTime || null; stop.personalNote = change.personalNote.trim();
  }
  updated.localEditedAt = now();
  updated.validation = { ...validateItinerary(updated), replanCount: 0, maxReplans: 0, stopReason: 'LOCAL_EDIT', history: [], repairs: [] };
  updated.replanReason = null;
  return snapshotTrip(updated);
}

export function initSavedTrips({ getTrip, loadTrip, isBusy, notify }) {
  let store;
  let activeId = null, editingId = null;
  const sessions = new Map(); // Session identifiers stay in memory, never localStorage or JSON.
  const error = (message = '') => { $('#saved-trips-error').textContent = message; $('#saved-trips-error').hidden = !message; };
  try { store = createSavedTripStore(); } catch { error('브라우저 저장소를 사용할 수 없어요. 현재 일정은 JSON으로 내보낼 수 있어요.'); }
  const run = (action) => { if (isBusy()) return; try { error(); action(); } catch (err) { error(err.message); } };
  const button = (text, action, className = 'text-button') => { const el = node('button', className, text); el.type = 'button'; el.addEventListener('click', () => run(action)); return el; };
  function refreshControls() {
    $('#save-trip-button').disabled = isBusy() || getTrip()?.isSample !== false || !store;
    $('#save-trip-button').textContent = activeId ? '변경사항 저장' : '♡ 여행 일정 저장';
    $('#save-trip-copy').hidden = !activeId;
    $('#save-trip-copy').disabled = isBusy();
    $('#saved-trips').querySelectorAll('button, input, textarea').forEach((el) => { el.disabled = isBusy(); });
  }
  function open(entry) {
    closeEditor();
    const plan = structuredClone(entry.plan), session = sessions.get(entry.id);
    if (session?.updatedAt === entry.updatedAt && !plan.localEditedAt) plan.planId = session.planId;
    activeId = entry.id; loadTrip(plan, entry.updatedAt); render();
    $('#saved-trips-status').textContent = `“${plan.title || plan.region}” 일정을 열었어요.`;
  }
  function render() {
    if (!store) { refreshControls(); return; }
    let entries;
    try { entries = store.list(); } catch (err) { error(err.message); refreshControls(); return; }
    if (activeId && !entries.some((entry) => entry.id === activeId)) activeId = null;
    $('#saved-trips-count').textContent = `${entries.length}개`;
    $('#saved-trips-empty').hidden = entries.length !== 0;
    $('#saved-trips-list').replaceChildren(...entries.map((entry) => {
      const card = node('li', 'saved-trip-card'); card.dataset.savedId = entry.id;
      const title = node('h3', '', entry.plan.title || `${entry.plan.region} 여행`);
      card.append(title, node('p', 'muted', `${entry.plan.region} · ${entry.plan.startDate} 출발 · ${entry.plan.duration}일 · ${entry.plan.travelers}명`), node('p', 'panel-note', `최근 저장 ${new Date(entry.updatedAt).toLocaleString('ko-KR')}${entry.id === activeId ? ' · 현재 열린 일정' : ''}`));
      const actions = node('div', 'saved-trip-actions');
      actions.append(button('일정 열기', () => open(store.get(entry.id)), 'outline-button saved-trip-open'), button('직접 수정', () => showEditor(store.get(entry.id)), 'text-button saved-trip-edit'), button('JSON 내보내기', () => downloadSavedTrip(store.get(entry.id).plan), 'text-button saved-trip-export'), button('삭제', () => {
        store.remove(entry.id); sessions.delete(entry.id);
        if (editingId === entry.id) closeEditor();
        if (activeId === entry.id) activeId = null;
        render(); $('#saved-trips-status').textContent = '저장 목록에서 삭제했어요. 현재 화면의 일정은 유지돼요.';
      }, 'text-button saved-trip-delete'));
      card.append(actions); return card;
    }));
    refreshControls();
  }
  function save(asCopy = false) {
    if (!store) throw new Error('브라우저 저장소를 사용할 수 없어요.');
    const trip = getTrip(), entry = store.save(trip, asCopy ? null : activeId);
    if (trip.planId && !trip.localEditedAt) sessions.set(entry.id, { planId: trip.planId, updatedAt: entry.updatedAt });
    else sessions.delete(entry.id);
    activeId = entry.id; render(); $('#saved-trips-status').textContent = '이 브라우저에 여행 일정을 저장했어요.'; notify('여행 일정을 저장했어요.');
  }
  function closeEditor() { editingId = null; $('#saved-trip-editor').hidden = true; $('#saved-editor-stops').replaceChildren(); }
  function showEditor(entry) {
    editingId = entry.id;
    $('#saved-edit-title').value = entry.plan.title || `${entry.plan.region} 여행`;
    $('#saved-edit-note').value = entry.plan.personalNote || '';
    $('#saved-editor-stops').replaceChildren();
    entry.plan.days.forEach((day, dayIndex) => {
      const group = node('fieldset', 'saved-edit-day'); group.append(node('legend', '', `${dayIndex + 1}일차 · ${day.date}`));
      day.stops.forEach((stop) => {
        const row = node('div', 'saved-edit-stop'); row.append(node('strong', '', stop.title));
        for (const [key, text, type, value] of [['time','방문 시각','time',stop.time], ['endTime','종료 시각 · 선택','time',stop.endTime || ''], ['personalNote','장소 메모','text',stop.personalNote || '']]) {
          const label = node('label', 'field', text), input = node('input'); input.type = type; input.value = value; input.dataset.editField = key;
          if (key === 'time') input.required = true;
          if (key === 'personalNote') input.maxLength = 500;
          label.append(input); row.append(label);
        }
        group.append(row);
      });
      $('#saved-editor-stops').append(group);
    });
    $('#saved-trip-editor').hidden = false; $('#saved-edit-title').focus();
  }
  $('#save-trip-button').addEventListener('click', () => run(() => save()));
  $('#save-trip-copy').addEventListener('click', () => run(() => save(true)));
  $('#saved-trips-refresh').addEventListener('click', () => run(render));
  $('#saved-edit-cancel').addEventListener('click', () => run(closeEditor));
  $('#saved-edit-form').addEventListener('submit', (event) => {
    event.preventDefault(); run(() => {
      const entry = store.get(editingId);
      const stops = [...$('#saved-editor-stops').querySelectorAll('.saved-edit-stop')].map((row) => Object.fromEntries([...row.querySelectorAll('input')].map((input) => [input.dataset.editField, input.value])));
      const plan = editSavedTrip(entry.plan, { title: $('#saved-edit-title').value, personalNote: $('#saved-edit-note').value, stops });
      const updated = store.save(plan, entry.id); sessions.delete(entry.id); closeEditor(); open(updated);
      $('#saved-trips-status').textContent = '직접 수정한 일정을 저장하고 다시 검증했어요. 자동 재계획이나 API 호출은 하지 않았어요.';
    });
  });
  window.addEventListener('storage', (event) => { if (event.key === 'travel-piece.saved-trips.v1' || event.key === null) { closeEditor(); render(); } });
  render();
  return { refreshControls, detach() { activeId = null; closeEditor(); render(); } };
}
