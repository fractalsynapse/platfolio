const sourcePlatforms = team => team.instances.filter(instance => instance.templateSource && instance.lifecycle !== "removed");
const text = (data, field) => String(data.get(field) ?? "").trim();
const coverFormats = ["image/png", "image/jpeg", "image/webp"];
const maxCoverBytes = 2 * 1024 * 1024;

export function createTemplatePublisher({ heading, panel, escape, authError, cardHeader, publishedTemplates, isOwner, save }) {
  let releaseEditor = () => {};

  function options(choices, selected) {
    return choices.map(([value, title]) =>
      `<option value="${escape(value)}"${value === selected ? " selected" : ""}>${escape(title)}</option>`).join("");
  }

  function publish(team) {
    const title = heading(team, "Publish template");
    if (!isOwner(team)) return `${title}${panel("Team owners can publish templates", "<p>Ask a team owner to review and publish a listing.</p>")}`;
    const sources = sourcePlatforms(team);
    if (!sources.length) return `${title}${panel("No platforms available", "<p>Choose a platform to publish once the team has a source revision to use.</p>")}`;

    const existing = publishedTemplates.find(template => template.publisherTeam === team.slug);
    const platform = sources.find(source => source.slug === existing?.platformSlug) ?? sources[0];
    return `${title}
      <div class="page-columns publish-columns">
        ${panel("Listing details", `<form class="form publish-form" id="publish-listing" data-template-publish>
          <fieldset class="form-group">
            <legend>Source and presentation</legend>
            <label for="publish-platform">Source platform</label>
            <select id="publish-platform" name="platform">${options(sources.map(item => [item.slug, item.name]), platform.slug)}</select>
            <p class="input-help" data-publish-source></p>
            <label for="publish-title">Listing name</label>
            <input id="publish-title" name="title" value="${escape(existing?.title ?? `${platform.name} template`)}" maxlength="80" required>
            <label for="publish-summary">Short description</label>
            <textarea id="publish-summary" name="summary" rows="3" maxlength="240" required>${escape(existing?.summary ?? platform.templateSource.summary)}</textarea>
            <label for="publish-cover">Cover image (optional)</label>
            <input id="publish-cover" type="file" accept="${coverFormats.join(",")}" aria-describedby="publish-cover-help">
            <p id="publish-cover-help" class="input-help">Use a wide screenshot, PNG, JPEG, or WebP up to 2 MB. The gradient is the default.</p>
            <p class="form-error" role="status" data-cover-error></p>
            <button class="button secondary publish-cover-remove" type="button" data-remove-cover hidden>Remove cover image</button>
          </fieldset>
          <label for="publish-included">Included with the template</label>
          <textarea id="publish-included" name="included" rows="3" maxlength="480" required>${escape(existing?.included ?? "Source repository, Compose manifest, and environment registry.")}</textarea>
          ${authError()}
        </form>`)}
        <div>
          ${panel("Listing preview", '<div class="publish-preview" data-publish-preview></div>', "context-panel")}
          <p class="input-help">Publishing adds the listing to this mockup session.</p>
          <div class="actions"><button class="button primary" type="submit" form="publish-listing">Publish demo listing</button></div>
        </div>
      </div>`;
  }

  function connect(root, team) {
    releaseEditor();
    releaseEditor = () => {};
    const form = root.querySelector("[data-template-publish]");
    if (!form || !team || !isOwner(team)) return;
    const source = root.querySelector("[data-publish-source]");
    const preview = root.querySelector("[data-publish-preview]");
    const error = form.querySelector(".form-error:not([data-cover-error])");
    const coverField = form.querySelector("#publish-cover");
    const coverError = form.querySelector("[data-cover-error]");
    const removeCover = form.querySelector("[data-remove-cover]");
    const platformField = form.elements.namedItem("platform");
    const platformFor = data => sourcePlatforms(team).find(item => item.slug === data.get("platform"));
    const savedCover = () => publishedTemplates.find(item =>
      item.publisherTeam === team.slug && item.platformSlug === platformField.value)?.coverImage ?? "";
    let coverImage = savedCover();
    let draftCover = "";
    let loadingCover = "";

    function releaseCover() {
      if (draftCover) URL.revokeObjectURL(draftCover);
      if (loadingCover) URL.revokeObjectURL(loadingCover);
      draftCover = "";
      loadingCover = "";
    }
    releaseEditor = releaseCover;

    function update() {
      const data = new FormData(form);
      const platform = platformFor(data);
      if (!platform) return;
      source.textContent = `${platform.repository} · ${platform.templateSource.commit.slice(0, 7)}`;
      removeCover.hidden = !coverImage;
      const listing = {
        ...platform.templateSource, title: text(data, "title") || platform.name, publisherName: team.name,
        coverImage, updatedAt: new Date().toISOString(),
      };
      preview.innerHTML = `<div class="template-card" data-category="${escape(listing.category)}">${cardHeader(listing, "h3")}</div>
        <p>${escape(text(data, "summary"))}</p>
        <p class="template-included">${escape(text(data, "included"))}</p>`;
    }

    form.addEventListener("input", update);
    platformField.addEventListener("change", () => {
      releaseCover();
      coverImage = savedCover();
      coverField.value = "";
      coverError.textContent = "";
      update();
    });
    coverField.addEventListener("change", async () => {
      if (loadingCover) URL.revokeObjectURL(loadingCover);
      loadingCover = "";
      coverError.textContent = "";
      const file = coverField.files[0];
      if (!file) return;
      if (!coverFormats.includes(file.type) || !file.size || file.size > maxCoverBytes) {
        coverError.textContent = "Choose a PNG, JPEG, or WebP image up to 2 MB.";
        coverField.value = "";
        return;
      }
      const url = URL.createObjectURL(file);
      loadingCover = url;
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
      } catch {
        if (loadingCover !== url) return;
        URL.revokeObjectURL(url);
        loadingCover = "";
        coverField.value = "";
        coverError.textContent = "This image could not be opened.";
        return;
      }
      if (loadingCover !== url) return;
      if (draftCover) URL.revokeObjectURL(draftCover);
      loadingCover = "";
      draftCover = url;
      coverImage = url;
      error.textContent = "";
      update();
    });
    removeCover.addEventListener("click", () => {
      releaseCover();
      coverImage = "";
      coverField.value = "";
      coverError.textContent = "";
      update();
      coverField.focus();
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!isOwner(team)) return;
      const data = new FormData(form);
      const platform = platformFor(data);
      if (!platform) return;
      const title = text(data, "title");
      const summary = text(data, "summary");
      const included = text(data, "included");
      if (loadingCover) {
        error.textContent = "Wait for the cover image preview to finish.";
        return;
      }
      if (!title || !summary || !included) {
        error.textContent = "Fill in the listing name, description, and included items.";
        return;
      }
      draftCover = "";
      save(team, platform, { title, summary, included, coverImage });
    });
    update();
  }

  return { publish, connect };
}
