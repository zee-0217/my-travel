export const parseMoney = (value) => /^\d[\d,]*$/.test(String(value).trim()) ? Number(String(value).replaceAll(',', '')) : NaN;
export function formatMoneyInputs() {
  document.querySelectorAll('[data-money-input]').forEach((input) => {
    if (input.value && Number.isFinite(parseMoney(input.value))) input.value = parseMoney(input.value).toLocaleString('en-US');
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
export function initMoneyInputs() {
  document.querySelectorAll('[data-money-input]').forEach((input) => {
    const validate = () => {
      const amount = parseMoney(input.value), min = Number(input.dataset.min), max = Number(input.dataset.max);
      input.setCustomValidity(!input.value && !input.required || Number.isSafeInteger(amount) && amount >= min && amount <= max ? '' : `${min.toLocaleString('ko-KR')}원부터 ${max.toLocaleString('ko-KR')}원까지 숫자로 입력해 주세요.`);
    };
    input.addEventListener('input', () => {
      const start = input.selectionStart ?? input.value.length;
      const digitsBefore = input.value.slice(0, start).replace(/\D/g, '').length;
      const digits = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
      input.value = digits ? Number(digits).toLocaleString('en-US') : '';
      let caret = 0, count = 0;
      while (caret < input.value.length && count < digitsBefore) { if (/\d/.test(input.value[caret])) count++; caret++; }
      input.setSelectionRange(caret, caret); validate();
    });
    input.addEventListener('change', validate);
    input.form?.addEventListener('reset', () => queueMicrotask(() => { input.setCustomValidity(''); formatMoneyInputs(); }));
  });
  formatMoneyInputs();
}
