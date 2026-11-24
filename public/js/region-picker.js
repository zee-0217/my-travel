export function initRegionPicker() {
  const select = document.querySelector('#region-select');
  const input = document.querySelector('#region');
  const custom = document.querySelector('#region-custom');
  let syncing = false;
  function fromSelect() {
    const isCustom = select.value === '__custom__';
    custom.hidden = !isCustom; custom.required = isCustom;
    input.value = isCustom ? custom.value.trim() : select.value;
    syncing = true;
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } finally { syncing = false; }
  }
  select.addEventListener('change', fromSelect);
  custom.addEventListener('input', fromSelect);
  input.addEventListener('input', () => {
    if (syncing) return;
    const known = [...select.options].some((option) => option.value === input.value && option.value !== '__custom__');
    if (input.value && known) { select.value = input.value; custom.hidden = true; custom.required = false; }
    else if (input.value) { select.value = '__custom__'; custom.hidden = false; custom.required = true; custom.value = input.value; }
  });
  document.querySelector('#trip-form').addEventListener('reset', () => queueMicrotask(fromSelect));
  fromSelect();
  return fromSelect;
}
