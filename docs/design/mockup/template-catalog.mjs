// Presentation snapshots from the published Compose manifests.
// The source commits are review evidence. Instance setup will resolve and record its own ref.
const templates = [
  {
    id: "starter-web", title: "Starter Web Service", category: "web-apps",
    summary: "Launch a website with a database and an API for other tools to use.",
    repository: "fractalsynapse/platfolio-starter-web", commit: "f2a095711f98696a98ed1711a87ed288ef034bf4",
    updatedAt: "2026-11-14T06:11:27Z", highlights: ["JSON API", "PostgreSQL"],
    kind: "Web", mode: "Development", service: "web", ingress: "Public website",
    resource: "PostgreSQL · app-db", production: "main", staging: "staging", developmentOverlay: true,
    setupInputs: {
      setting: { name: "UI_BRAND", label: "Header brand", value: "Starter" },
      references: ["DATABASE_URL ← app-db"],
    },
  },
  {
    id: "starter-worker", title: "Starter Worker Service", category: "background-workers",
    summary: "Run background tasks and keep their saved files when you deploy again.",
    repository: "fractalsynapse/platfolio-starter-worker", commit: "d270cd25777c030a4035fbce38793f83b73cadd2",
    updatedAt: "2026-11-14T06:04:25Z", highlights: ["Background jobs", "5 GB retained storage"],
    kind: "Worker", mode: "Development", service: "queue", ingress: "No public web address",
    resource: "5 GB of storage for task data", production: "main", staging: "staging", developmentOverlay: true,
    setupInputs: { setting: { name: "WORKER_CONCURRENCY", label: "Worker concurrency", value: "4", type: "number" } },
  },
  {
    id: "shared-identity", title: "Shared Identity (Keycloak)", category: "identity",
    summary: "Let multiple apps share the same sign-in service.",
    repository: "fractalsynapse/platfolio-shared-identity", commit: "4d0e298f3dd4c0fb24737f4b493da972aa12ba1c",
    updatedAt: "2026-11-14T06:11:31Z", highlights: ["Shared sign-in (OIDC)", "PostgreSQL"],
    kind: "Web", mode: "Hosted", service: "keycloak", ingress: "Public sign-in address",
    resource: "PostgreSQL · keycloak-db", production: "main", provides: "Shared sign-in (OIDC)",
    requirement: "Set the Keycloak administrator password where the setup plan tells you before you launch.",
    setupInputs: {
      setting: { name: "KC_HOSTNAME", label: "Keycloak web address (optional)", value: "" },
      secrets: [["KC_BOOTSTRAP_ADMIN_PASSWORD", "Railway service variable"]],
      references: ["KC_DB_URL ← keycloak-db"],
    },
  },
];

const detailsPath = template => `/templates/${template.id}`;
const publisher = template => template.publisherName ?? template.repository.split("/")[0];
const environments = template => template.staging ? "Production and staging" : "Production";
const categoryLabels = {
  "web-apps": "Web apps",
  "background-workers": "Background workers",
  identity: "Sign-in",
};
const fields = [
  { name: "category", label: "Category", options: [["", "All categories"], ...Object.entries(categoryLabels)] },
  { name: "mode", label: "Operating mode", options: [["", "All modes"], ["development", "Development"], ["hosted", "Hosted"]] },
  { name: "sort", label: "Sort by", options: [["recent", "Last updated"], ["name", "Name (A–Z)"]] },
];
const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

function readFilters(params) {
  const filters = { q: params.get("q")?.trim().slice(0, 100) ?? "" };
  for (const { name, options } of fields) {
    const option = options.find(([value]) => value === params.get(name));
    filters[name] = (option ?? options[0])[0];
  }
  return filters;
}

const defaultFilters = readFilters(new URLSearchParams());

function matchingTemplates(catalog, { q, category, mode, sort }) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = catalog.filter(template => {
    if (category && template.category !== category) return false;
    if (mode && template.mode.toLowerCase() !== mode) return false;
    const searchable = [
      template.title, template.summary, publisher(template), template.repository, categoryLabels[template.category],
      template.kind, template.mode, template.service, template.ingress, template.resource,
      environments(template), ...template.highlights,
    ].join(" ").toLowerCase();
    return terms.every(term => searchable.includes(term));
  });
  return matches.sort(sort === "name"
    ? (left, right) => left.title.localeCompare(right.title)
    : (left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function createTemplateCatalog({ heading, teamHeading, panel, link, escape, breadcrumb, publishedTemplates }) {
  const catalogEntries = () => [...templates, ...publishedTemplates];
  const findTemplate = id => catalogEntries().find(template => template.id === id);

  function facts(entries, classes = "") {
    return `<dl class="facts ${classes}">${entries.map(([label, value]) =>
      `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl>`;
  }

  function updated(template) {
    return `<time datetime="${escape(template.updatedAt)}">${date.format(new Date(template.updatedAt))}</time>`;
  }

  function cardLink(path, action, title, classes) {
    return `<a href="${escape(path)}" class="button ${classes}" aria-label="${escape(`${action} for ${title}`)}" data-route>${action}</a>`;
  }

  function cardHeader(template, headingTag = "h2") {
    return `<header class="template-card-header">
      ${template.coverImage ? `<img class="template-card-cover" src="${escape(template.coverImage)}" alt="" decoding="async">` : ""}
      <div class="template-card-title">
        <div class="template-card-type">
          <span>${escape(categoryLabels[template.category])}</span>
          <span>${escape(template.kind)} · ${escape(template.mode)}</span>
        </div>
        <${headingTag}>${escape(template.title)}</${headingTag}>
      </div>
    </header>
    <div class="template-card-meta">
      <p>Published by <strong>${escape(publisher(template))}</strong></p>
      <p>Updated ${updated(template)}</p>
    </div>`;
  }

  function cards(matches, connectionsPath) {
    if (!matches.length) return `<div class="panel template-empty">
      <h2>No matching templates</h2><p>Try another search or clear the filters.</p>
    </div>`;

    return `<ul class="template-grid" role="list">${matches.map(template => `
      <li class="template-card" data-category="${escape(template.category)}">
        ${cardHeader(template)}
        <div class="template-card-body">
          <p class="template-card-summary">${escape(template.summary)}</p>
          <ul class="template-highlights" aria-label="Capabilities" role="list">${template.highlights.map(item => `<li>${escape(item)}</li>`).join("")}</ul>
        </div>
        <div class="template-card-specs">${facts([
          ["Public access", template.ingress],
          ["Environments", environments(template)],
        ])}</div>
        <footer class="template-card-footer">
          <div class="template-card-actions">
            ${cardLink(detailsPath(template), connectionsPath ? "View details" : "View template", template.title, "secondary")}
            ${connectionsPath ? cardLink(connectionsPath(template), "Use template", template.title, "primary") : ""}
          </div>
        </footer>
      </li>`).join("")}</ul>`;
  }

  const resultCount = matches => `${matches.length} ${matches.length === 1 ? "template" : "templates"}`;

  let connectDestination;
  function catalogBrowser(connectionsPath) {
    connectDestination = connectionsPath;
    const filters = readFilters(new URLSearchParams(location.search));
    const matches = matchingTemplates(catalogEntries(), filters);
    return `<section class="template-market" aria-label="Template catalog" data-template-market>
      <form class="template-search panel" role="search" aria-label="Search and filter templates" id="template-search">
        <label class="template-search-query" for="template-query">
          Search templates
          <input type="search" name="q" id="template-query" placeholder="Name, publisher, or capability" maxlength="100" value="${escape(filters.q)}">
        </label>
        ${fields.map(({ name, label, options }) => `<label for="template-${name}">
          ${label}
          <select name="${name}" id="template-${name}">
            ${options.map(([value, title]) => `<option value="${escape(value)}"${value === filters[name] ? " selected" : ""}>${escape(title)}</option>`).join("")}
          </select>
        </label>`).join("")}
        <button class="button secondary" type="reset">Clear filters</button>
      </form>
      <p class="template-result-count" role="status">${resultCount(matches)}</p>
      <div class="template-results">${cards(matches, connectionsPath)}</div>
    </section>`;
  }

  function connect(root) {
    const market = root.querySelector("[data-template-market]");
    if (!market) return;
    const connectionsPath = connectDestination;
    const form = market.querySelector("form");
    const count = market.querySelector(".template-result-count");
    const results = market.querySelector(".template-results");

    function update() {
      const filters = readFilters(new FormData(form));
      const matches = matchingTemplates(catalogEntries(), filters);
      count.textContent = resultCount(matches);
      results.innerHTML = cards(matches, connectionsPath);
      const query = new URLSearchParams(Object.entries(filters).filter(([key, value]) => value !== defaultFilters[key]));
      const search = query.size ? `?${query}` : "";
      history.replaceState(history.state, "", location.pathname + search + location.hash);
    }

    form.addEventListener("input", update);
    form.addEventListener("submit", event => {
      event.preventDefault();
      update();
    });
    form.addEventListener("reset", event => {
      event.preventDefault();
      for (const [key, value] of Object.entries(defaultFilters)) form.elements.namedItem(key).value = value;
      update();
    });
  }

  function catalog() {
    return `<div class="layout"><main class="public-shell" id="main">
      ${breadcrumb("Templates", ["Home", "/"])}
      ${heading("Templates", "Find a starting point for your next platform.")}
      ${catalogBrowser()}
    </main></div>`;
  }

  function detail(template, destination, teamName) {
    if (!template) return `<main class="public-shell" id="main">
      ${breadcrumb("Template unavailable", ["Home", "/"], ["Templates", "/templates"])}
      ${heading("Template unavailable", "This template is outside the published catalog.")}
      ${link("/templates", "Browse templates", "button secondary")}
    </main>`;

    const source = `https://github.com/${template.repository}`;
    const snapshot = `${source}/blob/${template.commit}`;
    return `<div class="layout"><main class="public-shell" id="main">
      ${breadcrumb(template.title, ["Home", "/"], ["Templates", "/templates"])}
      ${heading(template.title, template.summary)}
      <div class="actions">
        ${link(destination, teamName ? `Use template for ${teamName}` : "Use template", "button primary")}
        ${link("/templates", "All templates", "button secondary")}
      </div>
      <div class="page-columns">
        <div>
          ${panel("What runs", facts([
            ["Type", `${template.kind} · ${template.mode}`],
            ["Service", template.service],
            ["Public access", template.ingress],
            ["Data", template.resource],
            ...(template.provides ? [["Provides", template.provides]] : []),
          ], "fact-grid"))}
          ${template.included ? panel("Included with the template", `<p class="template-included">${escape(template.included)}</p>`) : ""}
          ${panel("Environments", facts([
            ["Production branch", template.production],
            ["Staging branch", template.staging ?? "Staging disabled"],
            ["Local development", template.developmentOverlay ? "Run locally with Docker Compose" : "Runs on your hosting provider"],
          ]))}
        </div>
        <div>
          ${panel("Source", `${facts([["Publisher", publisher(template)], ["Repository", template.repository]])}
            <p class="muted">Updated ${updated(template)}</p>
            <ul class="source-links">
              <li><a href="${source}/commit/${template.commit}" target="_blank" rel="noopener">Code version ${template.commit.slice(0, 7)}</a></li>
              <li><a href="${source}" target="_blank" rel="noopener">View code on GitHub</a></li>
              <li><a href="${snapshot}/compose.yaml" target="_blank" rel="noopener">App services (Compose file)</a></li>
              <li><a href="${snapshot}/environment.yaml" target="_blank" rel="noopener">Settings file</a></li>
              ${template.developmentOverlay ? `<li><a href="${snapshot}/compose.dev.yaml" target="_blank" rel="noopener">Local setup file</a></li>` : ""}
            </ul>`, "context-panel")}
          ${panel("Before setup", `<p>Platfolio version 0.4.0 or newer in the 0.x series. During setup, choose your team’s GitHub repository and Railway workspace.</p>
              ${template.requirement ? `<p>${escape(template.requirement)}</p>` : ""}`)}
        </div>
      </div>
    </main></div>`;
  }

  function setup(team, template, selectionPath, connectionsPath, progress = "") {
    const path = selectionPath(team);
    if (!template) return `${teamHeading(team, "Choose a template")}${catalogBrowser(connectionsPath)}`;

    return `${teamHeading(team, "Review template")}${progress}
      ${panel("Selected template", `${facts([
        ["Template", template.title],
        ["Template source", template.repository],
        ["Code version", template.commit.slice(0, 7)],
        ["Team", team.name],
        ["Environments", environments(template)],
      ], "fact-grid")}
      <div class="actions">${link(path, "Change template", "button secondary")}
        ${link(detailsPath(template), "View template details", "button secondary")}</div>`)}
      <div class="actions">${link(connectionsPath(template), "Continue to connections", "button primary")}</div>`;
  }

  return { catalog, detail, setup, connect, findTemplate, cardHeader };
}
