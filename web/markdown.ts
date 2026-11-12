export function safeURL(value: unknown): string | null {
  try {
    const u = new URL(String(value));
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
function inline(parent: HTMLElement, text: string) {
  const re =
    /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let index = 0;
  for (const match of text.matchAll(re)) {
    parent.append(document.createTextNode(text.slice(index, match.index)));
    let el: HTMLElement;
    if (match[2]) {
      el = document.createElement("strong");
      el.textContent = match[2];
    } else if (match[3]) {
      el = document.createElement("code");
      el.textContent = match[3];
    } else {
      const a = document.createElement("a");
      a.textContent = match[4];
      a.href = safeURL(match[5]) ?? "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      el = a;
    }
    parent.append(el);
    index = (match.index ?? 0) + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(index)));
}
export function markdown(text: string) {
  const root = document.createElement("div");
  root.className = "prose";
  const lines = String(text).split("\n");
  let list: HTMLElement | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code = [];
      while (++i < lines.length && !lines[i].startsWith("```"))
        code.push(lines[i]);
      const pre = document.createElement("pre");
      pre.textContent = code.join("\n");
      if (pre.textContent.length > 1500) {
        const d = document.createElement("details"),
          s = document.createElement("summary");
        d.className = "json-details";
        s.textContent = "查看结构化草案";
        d.append(s, pre);
        root.append(d);
      } else root.append(pre);
      list = null;
      continue;
    }
    if (!line.trim()) {
      list = null;
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    if (bullet) {
      if (!list) {
        list = document.createElement("ul");
        root.append(list);
      }
      const li = document.createElement("li");
      inline(li, bullet[1]);
      list.append(li);
      continue;
    }
    list = null;
    const heading = line.match(/^(#{1,4})\s+(.+)$/),
      node = document.createElement(heading ? "h3" : "p");
    inline(node, heading ? heading[2] : line);
    root.append(node);
  }
  return root;
}
