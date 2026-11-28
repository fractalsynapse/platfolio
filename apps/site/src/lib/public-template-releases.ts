import { createPublicMarketplaceCatalog, workspacePaths } from '@platfolio/ui';
import { runtimeConfigFrom } from './site-config.ts';

export function showPublicTemplateReleases(catalog: HTMLElement, afterRefresh?: () => void): void {
  const status = catalog.querySelector<HTMLElement>('[data-release-status]');
  if (!status) return;
  status.hidden = false;
  status.textContent = 'Checking published releases…';

  let client: ReturnType<typeof createPublicMarketplaceCatalog>;
  const runtime = runtimeConfigFrom(globalThis);
  try {
    client = createPublicMarketplaceCatalog(runtime?.apiBaseUrl ?? catalog.dataset.catalogApi ?? '');
  } catch {
    status.textContent = 'Published releases are unavailable. Try again shortly.';
    return;
  }

  const entries = catalog.querySelectorAll<HTMLElement>('[data-release-template]');
  const checked = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
  let checking = false;

  async function refresh() {
    if (checking || !status) return;
    checking = true;
    try {
      const result = await client.read();
      const releases = result.ok && Array.isArray(result.value) ? result.value : undefined;
      let available = 0;

      for (const entry of entries) {
        const { releaseTemplate, releaseRepo } = entry.dataset;
        const release = releases?.find((item) => item?.template === releaseTemplate && item.repo === releaseRepo &&
          /^[a-f0-9]{40}$/.test(item.revision) && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(item.version));
        if (release) available++;

        for (const version of entry.querySelectorAll<HTMLElement>('[data-release-version]')) {
          version.hidden = !release;
          version.textContent = release ? (version.dataset.releaseVersion === 'label' ? `Version ${release.version}` : release.version) : '';
        }

        for (const link of entry.querySelectorAll<HTMLAnchorElement>('[data-release-tree], [data-release-file]')) {
          link.hidden = !release;
          if (!release) link.removeAttribute('href');
          else {
            const path = link.dataset.releaseFile;
            link.href = `https://github.com/${release.repo}/${path ? 'blob' : 'tree'}/${release.revision}${path ? '/' + path : ''}`;
          }
        }
        for (const content of entry.querySelectorAll<HTMLElement>('[data-release-only]')) {
          content.hidden = !release;
        }
        for (const link of entry.querySelectorAll<HTMLAnchorElement>('[data-release-install]')) {
          link.hidden = release?.installable !== true;
          if (runtime?.installationRole === 'hub') {
            link.href = workspacePaths.launch;
            link.textContent = 'Launch private Platfolio';
          }
        }
      }

      status.textContent = !releases ? 'Published releases are unavailable. Try again shortly.'
        : available ? `Published releases checked at ${checked.format(new Date())}.` : 'No published releases are available.';
      afterRefresh?.();
    } finally {
      checking = false;
    }
  }

  const unsubscribe = client.subscribe(() => { void refresh(); });
  window.addEventListener('pagehide', (event) => { if (!event.persisted) unsubscribe(); });
  void refresh();
}
