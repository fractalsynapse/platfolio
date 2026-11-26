export function setUpTemplateFilters(catalog: HTMLElement): (() => void) | undefined {
  const filters = catalog?.querySelector<HTMLFormElement>('[data-template-filters]');
  const count = catalog?.querySelector('[data-template-count]');
  const entries = catalog?.querySelectorAll<HTMLLIElement>('[data-template]');
  const empty = catalog?.querySelector<HTMLElement>('[data-template-empty]');

  if (filters && count && entries && empty) {
    const parameters = new URLSearchParams(location.search);
    const fields = filters.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name]');
    for (const input of fields) {
      input.value = parameters.get(input.name)?.slice(0, 100) ?? '';
    }
    const update = () => {
      const values = new FormData(filters);
      const query = String(values.get('q') ?? '').trim();
      const terms = query.toLocaleLowerCase().split(/\s+/);
      const mode = values.get('mode');
      const category = values.get('category');
      let visible = 0;
      for (const entry of entries) {
        const text = [entry.dataset.template, entry.dataset.repo, entry.textContent].join(' ').toLocaleLowerCase();
        entry.hidden = Boolean((mode && entry.dataset.mode !== mode) ||
          (category && entry.dataset.category !== category) || !terms.every((term) => text.includes(term)));
        if (!entry.hidden) visible++;
      }
      count.textContent = `${visible} ${visible === 1 ? 'template' : 'templates'}`;
      empty.hidden = visible !== 0;
      const url = new URL(location.href);
      for (const [key, value] of [['q', query], ['mode', mode], ['category', category]] as const) {
        if (typeof value === 'string' && value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      history.replaceState(history.state, '', url);
    };
    filters.hidden = false;
    filters.addEventListener('input', update);
    filters.addEventListener('submit', (event) => { event.preventDefault(); update(); });
    filters.addEventListener('reset', (event) => {
      event.preventDefault();
      for (const input of fields) input.value = '';
      update();
    });
    update();
    return update;
  }
}
