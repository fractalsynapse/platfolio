const eventDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const dayDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const activityDayLabel = day => dayDate.format(new Date(day));

export function createActivityFeed({ badge, escape, link }) {
  function timestamp(at) {
    return `<time datetime="${escape(at)}">${eventDate.format(new Date(at))}</time>`;
  }

  function dailyHistory(label, days) {
    return `<div class="activity-history">
      <ol class="activity-bars" aria-label="${escape(label)}">
        ${days.map(({ description, tone, size }) =>
          `<li data-tone="${tone}" data-size="${size}" title="${escape(description)}"><span class="visually-hidden">${escape(description)}</span></li>`).join("")}
      </ol>
      <div class="activity-range" aria-hidden="true"><span>${activityDayLabel(days[0].at)}</span><span>${activityDayLabel(days.at(-1).at)} · UTC</span></div>
    </div>`;
  }

  function timeline(entries) {
    return `<ol class="activity-timeline">${entries.map(({ title, href, at, tags, detail, content }) => `<li>
      <div class="activity-meta">${tags.map(([label, tone]) => badge(label, tone)).join("")}${timestamp(at)}</div>
      <h3>${href ? link(href, title, "activity-event") : `<span class="activity-event">${escape(title)}</span>`}</h3>
      ${detail ? `<p class="activity-detail">${escape(detail)}</p>` : ""}
      ${content ? `<div class="activity-content">${content}</div>` : ""}
    </li>`).join("")}</ol>`;
  }

  return { timestamp, dailyHistory, timeline };
}
