const RELATIVE = /^(?!\w+:|\/|#|\/\/)/;
const CALLOUTS = {
  note: 'note',
  tip: 'tip',
  important: 'note',
  warning: 'warning',
  caution: 'danger',
};
const DOC_LINK = /^([\w-]+)\.md(#.*)?$/;

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

const isDiagram = (node) =>
  node.tagName === 'svg' && String(node.properties?.id).startsWith('mermaid-');

const BOXES = [
  [isDiagram, 'diagram'],
  [(node) => node.tagName === 'table', 'table-wrap'],
];

/** Wide diagrams and tables scroll inside their own box instead of widening the page. */
function wrapDiagrams(node) {
  if (node.properties?.className?.some((name) => BOXES.some(([, box]) => box === name))) return;
  node.children = node.children?.map((child) => {
    const box = BOXES.find(([matches]) => matches(child));
    return box
      ? {
          type: 'element',
          tagName: 'div',
          properties: { className: [box[1]] },
          children: [child],
        }
      : child;
  });
}

const label = (kind) => kind[0].toUpperCase() + kind.slice(1);

/** Finds "> **Note**" and GitHub's "> [!NOTE]" so both read as one callout. */
function calloutKind(blockquote) {
  const paragraph = blockquote.children.find((n) => n.tagName === 'p');
  const first = paragraph?.children[0];
  if (first?.tagName === 'strong') {
    const kind = CALLOUTS[first.children[0]?.value?.toLowerCase()];
    return kind ? { kind } : null;
  }
  const marker = /^\[!(\w+)\]\s*/.exec(first?.value ?? '');
  const kind = marker && CALLOUTS[marker[1].toLowerCase()];
  if (!kind) return null;
  first.value = first.value.slice(marker[0].length);
  paragraph.children.unshift({
    type: 'element',
    tagName: 'strong',
    properties: {},
    children: [{ type: 'text', value: label(marker[1].toLowerCase()) }],
  });
  return { kind };
}

/**
 * Docs are written for GitHub. This points their relative links and images at the
 * site, sends links to non-doc files back to GitHub, and drops the first level one
 * heading because the page template renders the title itself. Raw HTML blocks,
 * such as light and dark pictures, reach this plugin as unparsed text.
 */
export function rehypeDocs({ repo }) {
  const toSite = (path) => `/${path}`;
  return (tree) => {
    const first = tree.children.findIndex((n) => n.tagName === 'h1');
    if (first !== -1) tree.children.splice(first, 1);

    walk(tree, (node) => {
      wrapDiagrams(node);
      if (node.type === 'raw')
        node.value = node.value.replace(/(src|srcset)="images\//g, '$1="/images/');
      const props = node.properties;
      if (!props) return;
      if (node.tagName === 'blockquote') {
        const callout = calloutKind(node);
        if (callout) props.className = ['callout', `callout-${callout.kind}`];
      }
      if (node.tagName === 'a' && typeof props.href === 'string' && RELATIVE.test(props.href)) {
        const doc = DOC_LINK.exec(props.href);
        if (doc) props.href = (doc[1] === 'README' ? '/docs' : `/docs/${doc[1]}`) + (doc[2] ?? '');
        else props.href = `${repo}/blob/main/docs/${props.href}`;
      }
      if (
        node.tagName === 'img' &&
        typeof props.src === 'string' &&
        props.src.startsWith('images/')
      ) {
        props.src = toSite(props.src);
      }
      if (
        node.tagName === 'source' &&
        typeof props.srcSet === 'string' &&
        props.srcSet.startsWith('images/')
      ) {
        props.srcSet = toSite(props.srcSet);
      }
    });
  };
}
