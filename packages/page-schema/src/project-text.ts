import type { Node, Page } from './page.ts';

/** Anything a renderer may be handed: a page, one of its children, or a list of them. */
export type Renderable = Page | Node;

/**
 * Plain-text projection. The reason it exists is that the same data has to serve three renderers
 * (Astro, the SDK, an MCP tool response) and a mobile client; if a page cannot be described as text,
 * it is not actually data. It is also what tests assert against, which keeps the assertions about
 * "no value appears" honest rather than about markup.
 */
export function projectToText(node: Renderable | Renderable[], indent = 0): string {
  const pad = ' '.repeat(indent);
  const nodes = Array.isArray(node) ? node : [node];
  const out: string[] = [];
  for (const n of nodes) {
    const props = n.props as Record<string, unknown>;
    const label = props.title ?? props.text ?? props.label ?? props.name ?? props.service ?? '';
    // A notice renders its own tone line below, so printing the text twice is noise for a text client.
    if (n.component !== 'notice') out.push(`${pad}${n.component}: ${String(label)}`);
    if (n.component === 'secret-field') {
      out.push(`${pad}  ${props.name} [${props.environment}/${props.service}] mode=${props.mode} satisfied=${props.satisfied ? 'yes' : 'no'}`);
    }
    if (n.component === 'link-field') {
      out.push(`${pad}  ${props.name} -> ${props.href} satisfied=${props.satisfied ? 'yes' : 'no'}`);
    }
    if (n.component === 'instructions') {
      for (const step of (props.steps as string[] | undefined) ?? []) out.push(`${pad}  - ${step}`);
    }
    if (n.component === 'notice') out.push(`${pad}  (${props.tone}) ${props.text}`);
    if (n.component === 'action-button') out.push(`${pad}  POST ${props.action}`);
    const children = (n as { children?: Node[] }).children;
    if (children?.length) out.push(projectToText(children, indent + 2));
  }
  return out.join('\n');
}
