// 画面の部品（.vue）を DOM なしで描くための最小の DOM。jsdom などの依存を増やさず、Vue の createRenderer に渡す。
// 部品が使うものだけを持つ: 要素の入れ子、属性、dataset、文字、イベント、focus / blur、isConnected、
// 単純なセレクタ（`tag`、`[attr]`、`[attr="v"]` とその組み合わせ、空白で区切った子孫）の querySelector(All)。
// フォーカスを持った要素が外れたら、ブラウザと同じく activeElement は body に落ちる。
import { createRenderer, markRaw, type Component } from "vue";

type Listener = { fn: (e: FakeEvent) => void; once: boolean };
export type FakeEvent = { type: string; detail: number; target: FakeElement; currentTarget: FakeElement };

export class FakeNode {
  parentNode: FakeElement | null = null;
  constructor(
    readonly nodeType: number,
    public data = "",
  ) {
    // 本物の DOM 要素と同じく、ref に入れても reactive の Proxy にしない（Proxy だと同じ要素かどうかの比較が外れる）
    markRaw(this);
  }
  get textContent(): string {
    return this.nodeType === 3 ? this.data : "";
  }
  get isConnected(): boolean {
    let n: FakeNode | null = this;
    while (n) {
      if (n === fakeDocument.body) return true;
      n = n.parentNode;
    }
    return false;
  }
  contains(other: FakeNode | null): boolean {
    for (let n = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
}

const camelToKebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export class FakeElement extends FakeNode {
  childNodes: FakeNode[] = [];
  attrs = new Map<string, string>();
  private listeners = new Map<string, Listener[]>();
  readonly dataset: Record<string, string | undefined>;

  constructor(readonly tagName: string) {
    super(1);
    this.dataset = new Proxy({} as Record<string, string | undefined>, {
      get: (_t, k) => (typeof k === "string" ? this.attrs.get(`data-${camelToKebab(k)}`) : undefined),
    });
  }
  override get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, String(v));
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  addEventListener(type: string, fn: (e: FakeEvent) => void, opts?: { once?: boolean } | boolean) {
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, once: typeof opts === "object" && !!opts.once });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: (e: FakeEvent) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l.fn !== fn));
  }
  dispatch(type: string, detail = 0) {
    const e: FakeEvent = { type, detail, target: this, currentTarget: this };
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((l) => !l.once));
    list.forEach((l) => l.fn(e));
  }
  // キーボード（Enter / Space）や読み上げソフトで押したときの click は detail が 0。指やマウスなら 1
  click(detail = 0) {
    if (this.hasAttribute("disabled")) return;
    this.dispatch("click", detail);
  }
  focus(_opts?: { preventScroll?: boolean }) {
    if (!this.isConnected) return;
    setActive(this);
  }
  blur() {
    if (fakeDocument.activeElement === this) setActive(fakeDocument.body);
  }
  querySelectorAll<T = FakeElement>(selector: string): T[] {
    const steps = selector.trim().split(/\s+/).map(parseCompound);
    const out: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const c of el.children) {
        if (matchesChain(c, steps, this)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out as T[];
  }
  querySelector<T = FakeElement>(selector: string): T | null {
    return (this.querySelectorAll<T>(selector)[0] ?? null) as T | null;
  }
  // テスト用: 条件に合う子孫を、文書の順に返す
  findAll(pred: (el: FakeElement) => boolean): FakeElement[] {
    return this.children.flatMap((c) => [...(pred(c) ? [c] : []), ...c.findAll(pred)]);
  }
  hasClass(name: string) {
    return (this.getAttribute("class") ?? "").split(/\s+/).includes(name);
  }
}

type Compound = { tag: string | null; attrs: Array<{ name: string; value: string | null }> };
const parseCompound = (s: string): Compound => {
  const tag = /^[a-z][a-z0-9]*/i.exec(s)?.[0]?.toUpperCase() ?? null;
  const attrs = Array.from(s.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)).map((m) => ({ name: m[1]!, value: m[2] ?? null }));
  return { tag, attrs };
};
const matches = (el: FakeElement, c: Compound) =>
  (c.tag === null || el.tagName === c.tag) &&
  c.attrs.every((a) => (a.value === null ? el.hasAttribute(a.name) : el.getAttribute(a.name) === a.value));
// 最後の段がこの要素に、残りの段が祖先（scope の内側）に順に当たるか
const matchesChain = (el: FakeElement, steps: Compound[], scope: FakeElement): boolean => {
  const last = steps[steps.length - 1];
  if (!last || !matches(el, last)) return false;
  let i = steps.length - 2;
  for (let p = el.parentNode; p && p !== scope && i >= 0; p = p.parentNode) {
    if (matches(p, steps[i]!)) i -= 1;
  }
  return i < 0;
};

export const fakeDocument = {
  body: new FakeElement("BODY"),
  activeElement: null as FakeElement | null,
};

const setActive = (el: FakeElement) => {
  const prev = fakeDocument.activeElement;
  if (prev === el) return;
  fakeDocument.activeElement = el;
  if (prev && prev !== fakeDocument.body) prev.dispatch("blur");
};

/** body を空にし、フォーカスを body に戻す。各テストの最初に呼ぶ */
export const resetFakeDocument = () => {
  fakeDocument.body.childNodes.forEach((c) => (c.parentNode = null));
  fakeDocument.body.childNodes = [];
  fakeDocument.activeElement = fakeDocument.body;
};

const detach = (child: FakeNode) => {
  const parent = child.parentNode;
  if (!parent) return;
  parent.childNodes = parent.childNodes.filter((c) => c !== child);
  child.parentNode = null;
};

const { createApp } = createRenderer<FakeNode, FakeElement>({
  patchProp(el, key, prev, next) {
    if (/^on[A-Z]/.test(key)) {
      const type = key.slice(2).toLowerCase();
      const list = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []) as Array<(e: FakeEvent) => void>;
      list(prev).forEach((fn) => el.removeEventListener(type, fn));
      list(next).forEach((fn) => el.addEventListener(type, fn));
    } else if (key === "style") {
      /* 見た目は扱わない */
    } else if (next === null || next === undefined || next === false) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, next === true ? "" : String(next));
    }
  },
  insert(child, parent, anchor) {
    detach(child);
    const i = anchor ? parent.childNodes.indexOf(anchor) : -1;
    if (i < 0) parent.childNodes.push(child);
    else parent.childNodes.splice(i, 0, child);
    child.parentNode = parent;
  },
  remove(child) {
    const active = fakeDocument.activeElement;
    detach(child);
    if (active && child.contains(active)) fakeDocument.activeElement = fakeDocument.body;
  },
  createElement: (tag) => new FakeElement(tag.toUpperCase()),
  createText: (text) => new FakeNode(3, text),
  createComment: (text) => new FakeNode(8, text),
  setText(node, text) {
    node.data = text;
  },
  setElementText(el, text) {
    el.childNodes.forEach((c) => (c.parentNode = null));
    el.childNodes = [];
    if (text) {
      const t = new FakeNode(3, text);
      t.parentNode = el;
      el.childNodes.push(t);
    }
  },
  parentNode: (node) => node.parentNode,
  nextSibling(node) {
    const siblings = node.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(node) + 1] ?? null;
  },
});

/** 部品を body の下に描く。描画中のエラーと警告は errors に集める（テストで空を確かめる） */
export const mount = (component: Component, props: Record<string, unknown> = {}) => {
  const container = new FakeElement("DIV");
  container.parentNode = fakeDocument.body;
  fakeDocument.body.childNodes.push(container);
  const errors: unknown[] = [];
  const app = createApp(component, props);
  app.config.errorHandler = (e) => void errors.push(e);
  app.config.warnHandler = (msg) => void errors.push(msg);
  app.mount(container);
  return { container, errors, unmount: () => app.unmount() };
};
