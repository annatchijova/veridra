type Child = Node | string;
type Attrs = Record<string, string | boolean>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false) continue;
    node.setAttribute(name, value === true ? "" : value);
  }
  node.append(...children);
  return node;
}

export function replaceChildren(parent: Element, ...children: Child[]): void {
  parent.replaceChildren(...children);
}

/** JSON for display only: bigint values become decimal strings, never rounded numbers. */
export function stringifyEvidence(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString(10) : v), 2);
}

/** Lets a long SNAKE_CASE name wrap at its underscores instead of mid-word. textContent is unchanged. */
export function breakable(name: string): Node[] {
  return name.split("_").flatMap((part, index, parts) => (index < parts.length - 1 ? [document.createTextNode(`${part}_`), document.createElement("wbr")] : [document.createTextNode(part)]));
}
