import { clear, h, showToast } from "./components.js";

const feedbackLabels = {
  alarm_opened: "新告警",
  capacity_warning: "容量预警",
  constraint_blocked: "约束阻断",
  dependency_offline: "依赖异常",
  plan_succeeded: "方案完成",
  plan_failed: "方案失败",
};

const entityLabels = {
  rack: "机柜",
  device: "设备",
  alarm: "告警",
  plan: "方案",
  audit: "审计记录",
  service: "服务",
};

function formatTime(value) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusText(state) {
  if (state.sync_status === "syncing") return "同步中";
  if (state.sync_status === "interrupted") return "同步中断";
  if (state.sync_status === "ready") return "全站已同步";
  return "等待同步";
}

function modelText(state) {
  if (state.model_status === "available") return "模型在线";
  if (state.model_status === "degraded") return "规则降级";
  if (state.model_status === "not_configured") return "规则模式";
  if (state.model_status === "probing") return "探活中";
  return "模型待命";
}

function navigationButton(reference, onNavigate) {
  const label = reference.label ?? `${entityLabels[reference.type] ?? reference.type} ${reference.id}`;
  return h("button", {
    className: "assistant-evidence",
    type: "button",
    "aria-label": `查看 ${label}`,
    onClick: () => onNavigate(reference),
  }, [
    h("span", { text: entityLabels[reference.type] ?? reference.type }),
    h("strong", { text: reference.id }),
    h("i", { "aria-hidden": "true", text: "↗" }),
  ]);
}

function proposalCard(proposal, state, client) {
  const used = Boolean(proposal.used || proposal.plan_id);
  const placement = proposal.type === "placement";
  const title = placement ? "上架方案草案" : "告警处置草案";
  const detail = placement
    ? `${proposal.payload?.device?.id ?? "待解析设备"} · 风险约束计算后进入最终确认`
    : `${proposal.payload?.alarm_id ?? "当前告警"} · 生成后仍需最终确认`;
  const canCreate = state.role === "admin" && !used && !state.sending;
  const button = h("button", {
    className: "assistant-proposal-action",
    type: "button",
    disabled: !canCreate,
    text: used ? `已生成 ${proposal.plan_id ?? "待确认方案"}` : "生成待确认方案",
    onClick: async () => {
      try {
        const plan = await client.acceptProposal(proposal.id);
        showToast(`已生成 ${plan.id}，等待最终确认`);
      } catch (error) {
        showToast(error.message ?? "方案生成失败", "danger");
      }
    },
  });
  return h("section", { className: "assistant-proposal", "aria-label": title }, [
    h("div", { className: "assistant-proposal-head" }, [
      h("span", { text: "ACTION BRIDGE" }),
      h("strong", { text: title }),
    ]),
    h("p", { text: detail }),
    button,
    state.role !== "admin"
      ? h("small", { text: "当前为只读角色，仅管理员可生成待确认方案。" })
      : null,
  ]);
}

function messageItem(message, state, client, onNavigate) {
  const assistant = message.role === "assistant";
  return h("article", {
    className: `assistant-message ${assistant ? "is-assistant" : "is-user"}`,
  }, [
    h("header", {}, [
      h("strong", { text: assistant ? "全站 AI" : "我" }),
      h("time", { text: formatTime(message.at) }),
    ]),
    h("p", { text: message.content }),
    assistant && message.evidence?.length
      ? h("div", { className: "assistant-evidence-list", "aria-label": "回答依据" },
          message.evidence.map((item) => navigationButton(item, onNavigate)))
      : null,
    assistant && message.proposal
      ? proposalCard(message.proposal, state, client)
      : null,
  ]);
}

function feedbackItem(event, onNavigate) {
  const label = feedbackLabels[event.type] ?? "站点事件";
  const clickable = event.entity && event.entity.type !== "service";
  const card = h(clickable ? "button" : "article", {
    className: `assistant-feedback severity-${event.severity ?? "info"}`,
    type: clickable ? "button" : undefined,
    "aria-label": clickable ? `查看 ${label} ${event.entity.id}` : undefined,
    onClick: clickable ? () => onNavigate(event.entity) : undefined,
  }, [
    h("span", { className: "assistant-feedback-signal", "aria-hidden": "true" }),
    h("div", {}, [
      h("header", {}, [h("strong", { text: label }), h("time", { text: formatTime(event.occurred_at) })]),
      h("p", { text: event.message }),
      event.entity ? h("small", { text: `${entityLabels[event.entity.type] ?? event.entity.type} / ${event.entity.id}` }) : null,
    ]),
  ]);
  return card;
}

function timeline(state, client, onNavigate) {
  const entries = [
    ...state.feedback.map((item, index) => ({ kind: "feedback", item, index, at: item.occurred_at })),
    ...state.messages.map((item, index) => ({ kind: "message", item, index, at: item.at })),
  ].sort((left, right) => {
    const byTime = String(left.at ?? "").localeCompare(String(right.at ?? ""));
    return byTime || left.index - right.index;
  });

  if (!entries.length) {
    return h("div", { className: "assistant-empty" }, [
      h("span", { "aria-hidden": "true", text: "JG1 ━━━ L5-A2-08 ━━━ JG2" }),
      h("strong", { text: "全站上下文已就绪" }),
      h("p", { text: "可以查询机柜容量、服务器、链路、告警与变更，也可以描述待上架设备。" }),
    ]);
  }

  return h("div", { className: "assistant-timeline" }, entries.map((entry) => (
    entry.kind === "feedback"
      ? feedbackItem(entry.item, onNavigate)
      : messageItem(entry.item, state, client, onNavigate)
  )));
}

function panelHeader(state, client) {
  const syncTone = state.sync_status === "interrupted" ? "is-danger" : state.sync_status === "ready" ? "is-ready" : "";
  return h("header", { className: "assistant-header" }, [
    h("div", { className: "assistant-title" }, [
      h("span", { className: "assistant-channel", "aria-hidden": "true", text: "AI / SITE BUS" }),
      h("div", {}, [h("h2", { text: "全站 AI 助手" }), h("p", { text: "容量 · 链路 · 告警 · 变更" })]),
    ]),
    h("button", {
      className: "assistant-close",
      type: "button",
      "aria-label": "收起 AI 助手",
      text: "—",
      onClick: () => client.setOpen(false),
    }),
    h("div", { className: "assistant-bus", "aria-label": "助手运行状态" }, [
      h("span", { className: syncTone, text: statusText(state) }),
      h("span", { text: `V${state.state_version ?? "—"}` }),
      h("span", { text: modelText(state) }),
      h("span", { text: state.role === "admin" ? "管理员" : "只读" }),
    ]),
  ]);
}

function composer(state, client, { draft, onDraft }) {
  const textarea = h("textarea", {
    id: "assistant-prompt",
    name: "assistant-prompt",
    rows: "2",
    maxlength: "2000",
    placeholder: "例如：CAB-09 还能上架一台 4U、1200W 的服务器吗？",
    disabled: state.sending,
  });
  textarea.value = draft;
  textarea.addEventListener("input", () => onDraft(textarea.value));
  const submit = async () => {
    const value = textarea.value.trim();
    if (!value || state.sending) return;
    onDraft("");
    textarea.value = "";
    try {
      await client.send(value);
    } catch (error) {
      onDraft(value);
      textarea.value = value;
      showToast(error.message ?? "AI 助手暂时不可用", "danger");
    }
  };
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  });
  return h("form", {
    className: "assistant-composer",
    onSubmit: (event) => {
      event.preventDefault();
      void submit();
    },
  }, [
    h("label", { for: "assistant-prompt", text: "向全站 AI 助手提问" }),
    h("div", {}, [
      textarea,
      h("button", {
        type: "submit",
        disabled: state.sending,
        text: state.sending ? "分析中…" : "发送",
      }),
    ]),
    state.error
      ? h("p", { className: "assistant-error", role: "alert", text: `连接提示：${state.error.message ?? "请求失败"}` })
      : null,
  ]);
}

export function mountAssistantPanel(root, { client, onNavigate = () => {} }) {
  let state = client.snapshot();
  let draft = "";

  function render() {
    const prompt = root.querySelector("#assistant-prompt");
    if (prompt && !state.sending) draft = prompt.value;
    root.hidden = !state.authenticated;
    if (!state.authenticated) {
      draft = "";
      clear(root);
      return;
    }

    const launcher = h("button", {
      className: "assistant-launcher",
      type: "button",
      "aria-label": state.open ? "AI 助手已展开" : "打开 AI 助手",
      "aria-expanded": String(state.open),
      onClick: () => client.setOpen(true),
    }, [
      h("span", { className: "assistant-launcher-mark", "aria-hidden": "true", text: "AI" }),
      h("span", {}, [h("strong", { text: "AI 助手" }), h("small", { text: statusText(state) })]),
      state.unread ? h("b", { className: "assistant-unread", text: state.unread > 99 ? "99+" : String(state.unread) }) : null,
    ]);

    const panel = h("section", {
      className: `assistant-panel${state.open ? " is-open" : ""}`,
      role: "dialog",
      "aria-modal": "false",
      "aria-label": "全站 AI 助手",
      "aria-hidden": String(!state.open),
    }, [
      panelHeader(state, client),
      h("div", { className: "assistant-scroll", "aria-live": "polite" }, [timeline(state, client, onNavigate)]),
      composer(state, client, {
        draft,
        onDraft(value) { draft = value; },
      }),
    ]);

    clear(root, launcher, panel);
    if (state.open) {
      root.querySelector(".assistant-scroll")?.scrollTo({ top: 100_000, behavior: "smooth" });
    }
  }

  const unsubscribe = client.subscribe((nextState) => {
    state = nextState;
    render();
  });
  render();
  return { render, destroy: unsubscribe };
}
