const childrenOf = (children) => Array.isArray(children) ? children : [children];

export function h(tag, properties = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of childrenOf(children).flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node, ...children) {
  node.replaceChildren(...children.filter(Boolean));
  return node;
}

export function sourceBadge(source = "unknown") {
  const labels = { design: "设计", rule: "规则计算", demo: "演示", telemetry: "实时采集", unknown: "未接入" };
  return h("span", { className: `source-badge source-${source}`, text: labels[source] ?? source });
}

export function statusBadge(label, tone = "neutral") {
  return h("span", { className: `status-badge tone-${tone}`, text: label });
}

export function panel(title, body, options = {}) {
  const heading = h("div", { className: "panel-heading" }, [
    h("div", {}, [
      options.kicker ? h("p", { className: "section-kicker", text: options.kicker }) : null,
      h(options.level ?? "h2", { text: title }),
    ]),
    options.action ?? null,
  ]);
  return h("article", { className: `panel ${options.className ?? ""}`.trim() }, [heading, body]);
}

export function metricCard(label, value, detail, options = {}) {
  return h("article", { className: `metric-card tone-${options.tone ?? "neutral"}` }, [
    h("div", { className: "metric-label" }, [h("span", { text: label }), options.source ? sourceBadge(options.source) : null]),
    h("strong", { text: value }),
    h("p", { text: detail }),
  ]);
}

export function progressBar(value, max, label) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return h("div", { className: "progress-group" }, [
    h("div", { className: "progress-label" }, [h("span", { text: label }), h("span", { text: `${Math.round(percent)}%` })]),
    h("div", { className: "progress-track" }, [h("span", { style: { width: `${percent}%` } })]),
  ]);
}

export function formatPower(value) {
  return Number.isFinite(value) ? `${(value / 1_000).toFixed(value % 1_000 ? 1 : 0)} kW` : "未接入";
}

export function formatValue(value, suffix = "") {
  return value === null || value === undefined || value === "" ? "未接入" : `${value}${suffix}`;
}

export function emptyState(title, detail) {
  return h("div", { className: "empty-state" }, [h("strong", { text: title }), h("p", { text: detail })]);
}

export function loadingState(label = "正在读取机房数据") {
  return h("div", { className: "loading-state" }, [h("span", { className: "loading-mark" }), h("p", { text: label })]);
}

export function detailList(items) {
  return h("dl", { className: "detail-list" }, items.map(([label, value, source]) => [
    h("div", {}, [h("dt", { text: label }), h("dd", {}, [h("span", { text: formatValue(value) }), source ? sourceBadge(source) : null])]),
  ]));
}

export function showToast(message, tone = "ok") {
  const root = document.querySelector("#toast-root");
  const toast = h("div", { className: `toast tone-${tone}`, text: message });
  root.append(toast);
  window.setTimeout(() => toast.remove(), 3_200);
}

export function openDialog(content, options = {}) {
  const root = document.querySelector("#dialog-root");
  const close = () => root.replaceChildren();
  const overlay = h("div", { className: "dialog-overlay", role: "presentation", onClick: (event) => {
    if (event.target === overlay && options.dismissible !== false) close();
  } }, [
    h("section", { className: "dialog-card", role: "dialog", "aria-modal": "true", "aria-label": options.label ?? "确认操作" }, [
      content,
      options.dismissible === false ? null : h("button", { className: "dialog-close", type: "button", "aria-label": "关闭", text: "×", onClick: close }),
    ]),
  ]);
  root.replaceChildren(overlay);
  overlay.querySelector("button, input, select")?.focus();
  return close;
}
