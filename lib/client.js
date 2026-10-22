window.__ModuleLoader__.load({
  id: "dsh-bot-sandbox",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const react = require("react");
    const h = react.createElement;

    const color = {
      text: "var(--dsw-alias-text-1, #1a1a1a)",
      muted: "var(--dsw-alias-text-3, #6b7280)",
      border: "var(--dsw-alias-border-1, #e5e7eb)",
      bg: "var(--dsw-alias-bg-1, #ffffff)",
      subtle: "var(--dsw-alias-bg-2, #f7f7f8)",
      accent: "var(--dsw-alias-accent-1, #4d6bfe)",
      danger: "var(--dsw-alias-danger-1, #dc2626)",
    };

    const styles = {
      wrap: { display: "flex", flexDirection: "column", gap: "14px", padding: "4px 0 20px", color: color.text },
      title: { fontSize: "15px", fontWeight: 600, margin: 0 },
      hint: { margin: 0, fontSize: "12px", lineHeight: 1.6, color: color.muted },
      card: { border: `1px solid ${color.border}`, borderRadius: "10px", background: color.bg, padding: "12px 14px" },
      cardTitle: { fontSize: "13px", fontWeight: 600, margin: "0 0 8px" },
      row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "8px 0", borderTop: `1px solid ${color.border}` },
      rowFirst: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "2px 0 8px" },
      name: { fontSize: "13px", fontWeight: 500, wordBreak: "break-all" },
      meta: { fontSize: "11px", color: color.muted, wordBreak: "break-all", marginTop: "2px" },
      button: { border: `1px solid ${color.border}`, background: color.subtle, color: color.text, borderRadius: "7px", padding: "5px 10px", fontSize: "12px", cursor: "pointer" },
      primary: { border: "none", background: color.accent, color: "#fff", borderRadius: "7px", padding: "5px 12px", fontSize: "12px", cursor: "pointer" },
      danger: { border: `1px solid ${color.border}`, background: "transparent", color: color.danger, borderRadius: "7px", padding: "5px 10px", fontSize: "12px", cursor: "pointer" },
      input: { border: `1px solid ${color.border}`, background: color.bg, color: color.text, borderRadius: "7px", padding: "6px 9px", fontSize: "12px", outline: "none", flex: "1 1 180px", minWidth: "120px" },
      rowActions: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
      note: { fontSize: "11px", color: color.muted, lineHeight: 1.6, margin: 0 },
      banner: { borderRadius: "8px", padding: "8px 10px", fontSize: "12px", lineHeight: 1.5 },
      audit: { fontSize: "11px", color: color.muted, fontFamily: "ui-monospace, Consolas, monospace", lineHeight: 1.7, maxHeight: "180px", overflow: "auto", margin: 0 },
      footerButton: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "5px 10px",
        borderRadius: "8px",
        border: `1px solid ${color.border}`,
        background: color.subtle,
        color: color.text,
        fontSize: "12px",
        cursor: "pointer",
      },
      popup: {
        position: "fixed",
        left: "20px",
        bottom: "84px",
        width: "420px",
        maxWidth: "calc(100vw - 40px)",
        maxHeight: "70vh",
        overflow: "auto",
        zIndex: 2147483000,
        background: color.bg,
        color: color.text,
        border: `1px solid ${color.border}`,
        borderRadius: "12px",
        boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
        padding: "12px 14px",
      },
    };

    async function api(path, options) {
      const response = await fetch(path, { cache: "no-store", ...options });
      let body;
      try {
        body = await response.json();
      } catch {
        body = { ok: false, error: `HTTP ${response.status}` };
      }
      if (!response.ok || body?.ok === false) {
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      return body;
    }

    function Banner({ tone, children }) {
      const palette =
        tone === "error"
          ? { background: "rgba(220,38,38,0.08)", color: color.danger }
          : { background: "rgba(77,107,254,0.08)", color: color.text };
      return h("div", { style: { ...styles.banner, ...palette } }, children);
    }

    function Panel({ onChanged } = {}) {
      const [state, setState] = react.useState(null);
      const [busy, setBusy] = react.useState(false);
      const [message, setMessage] = react.useState("");
      const [error, setError] = react.useState("");
      const [manualPkg, setManualPkg] = react.useState("");
      const [manualRow, setManualRow] = react.useState("");

      const load = async () => {
        try {
          const data = await api("/api/bot-sandbox/state");
          setState(data);
          setError("");
        } catch (err) {
          setError(String(err?.message ?? err));
        }
      };

      react.useEffect(() => {
        void load();
      }, []);

      const act = async (path, body) => {
        setBusy(true);
        setError("");
        setMessage("");
        try {
          const data = await api(path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body ?? {}),
          });
          setState(data);
          setMessage(data.message ?? "完成");
          if (typeof onChanged === "function") onChanged();
        } catch (err) {
          setError(String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
      };

      if (state === null) {
        return h(
          "div",
          { style: styles.wrap },
          h("p", { style: styles.title }, "机器人沙箱"),
          error !== "" ? h(Banner, { tone: "error" }, error) : h("p", { style: styles.hint }, "正在加载…"),
        );
      }

      const targets = Array.isArray(state.targets) ? state.targets : [];
      const candidates = Array.isArray(state.candidates) ? state.candidates : [];
      const audits = Array.isArray(state.audit) ? state.audit : [];

      return h(
        "div",
        { style: styles.wrap },
        h("p", { style: styles.title }, "机器人沙箱"),
        h(
          "p",
          { style: styles.hint },
          "列表里的插件所创建的新会话只能聊天：所有主机工具调用和审批请求都会被拒绝。你自己从 Harness 开的新会话不受影响。",
        ),
        error !== "" ? h(Banner, { tone: "error" }, error) : null,
        message !== "" ? h(Banner, null, message) : null,
        h(
          "div",
          { style: styles.card },
          h("p", { style: styles.cardTitle }, `受控插件（${targets.length}）`),
          targets.length === 0
            ? h("p", { style: styles.note }, "还没有受控插件。从下方列表加入。")
            : targets.map((target) =>
                h(
                  "div",
                  { key: target.package, style: styles.row },
                  h(
                    "div",
                    { style: { minWidth: 0 } },
                    h("div", { style: styles.name }, target.package),
                    h("div", { style: styles.meta }, `row: ${target.rowId} · preset: ${target.preset || "保持原样"}`),
                  ),
                  h(
                    "button",
                    {
                      type: "button",
                      style: styles.danger,
                      disabled: busy,
                      onClick: () => {
                        const ok =
                          typeof window === "undefined" || typeof window.confirm !== "function"
                            ? true
                            : window.confirm(
                                `取消隔离 ${target.package}？\n\n之后它新建的会话会恢复工具权限；已写入的 cwd 会保留。`,
                              );
                        if (ok) void act("/api/bot-sandbox/remove", { package: target.package });
                      },
                    },
                    "取消隔离",
                  ),
                ),
              ),
        ),
        h(
          "div",
          { style: styles.card },
          h("p", { style: styles.cardTitle }, "已安装的组合包"),
          candidates.length === 0
            ? h("p", { style: styles.note }, "没有可添加的组合包（需要包声明 dsh.bundle.patch）。")
            : candidates.map((candidate) =>
                h(
                  "div",
                  { key: candidate.package, style: styles.row },
                  h(
                    "div",
                    { style: { minWidth: 0 } },
                    h("div", { style: styles.name }, candidate.package + (candidate.version ? `  ${candidate.version}` : "")),
                    h(
                      "div",
                      { style: styles.meta },
                      candidate.controlled
                        ? "已在受控列表"
                        : candidate.row?.rowId
                          ? `${candidate.botLike ? "疑似对话插件" : "非对话插件（不建议）"} · 将隔离 loader row: ${candidate.row.rowId}`
                          : `${candidate.botLike ? "疑似对话插件" : "非对话插件（不建议）"} · 无法自动确定 row: ${candidate.row?.reason ?? "未知"}`,
                    ),
                  ),
                  candidate.controlled
                    ? h("span", { style: styles.meta }, "✓")
                    : h(
                        "button",
                        {
                          type: "button",
                          style: candidate.row?.rowId && candidate.botLike ? styles.primary : styles.button,
                          // One-click only for chat-bot-looking bundles; anything else
                          // goes through the explicit manual form below.
                          disabled: busy || !candidate.row?.rowId || !candidate.botLike,
                          title: candidate.botLike
                            ? candidate.row?.reason ?? undefined
                            : "非对话类插件不建议加入；如确需，请用下方手动添加",
                          onClick: () => act("/api/bot-sandbox/add", { package: candidate.package, rowId: candidate.row?.rowId }),
                        },
                        candidate.botLike ? "加入隔离" : "需手动",
                      ),
                ),
              ),
        ),
        h(
          "div",
          { style: styles.card },
          h("p", { style: styles.cardTitle }, "手动添加"),
          h(
            "div",
            { style: styles.rowActions },
            h("input", {
              style: styles.input,
              placeholder: "包名，如 @scope/bot",
              value: manualPkg,
              onChange: (event) => setManualPkg(event.target.value),
            }),
            h("input", {
              style: styles.input,
              placeholder: "row id（可留空自动识别）",
              value: manualRow,
              onChange: (event) => setManualRow(event.target.value),
            }),
            h(
              "button",
              {
                type: "button",
                style: styles.primary,
                disabled: busy || manualPkg.trim() === "",
                onClick: async () => {
                  const pkg = manualPkg.trim();
                  const ok =
                    typeof window === "undefined" || typeof window.confirm !== "function"
                      ? true
                      : window.confirm(
                          `确定要把 ${pkg} 加入机器人沙箱吗？\n\n请确认：\n1) 它是对话型机器人插件；\n2) 它支持 cwd 配置（否则隔离不会生效）。`,
                        );
                  if (!ok) return;
                  await act("/api/bot-sandbox/add", {
                    package: pkg,
                    rowId: manualRow.trim(),
                  });
                  setManualPkg("");
                  setManualRow("");
                },
              },
              "添加",
            ),
            h(
              "button",
              {
                type: "button",
                style: styles.button,
                disabled: busy || targets.length === 0,
                onClick: () => act("/api/bot-sandbox/apply", {}),
              },
              "重新应用",
            ),
          ),
          h("p", { style: styles.note }, "提示：加入后只对之后新建的会话生效；旧机器人会话请在聊天里发 /new。"),
        ),
        h(
          "div",
          { style: styles.card },
          h("p", { style: styles.cardTitle }, "最近拦截"),
          audits.length === 0
            ? h("p", { style: styles.note }, "暂无记录。")
            : h(
                "pre",
                { style: styles.audit },
                audits
                  .slice()
                  .reverse()
                  .map((event) => {
                    const time = (() => {
                      try {
                        return new Date(event.ts).toLocaleString();
                      } catch {
                        return "";
                      }
                    })();
                    const detail = event.event === "approval-denied" ? event.callId ?? "" : event.tool ?? "";
                    return `${time}  ${event.event}  ${detail}`;
                  })
                  .join("\n"),
              ),
        ),
        h("p", { style: styles.note }, `受限根：${state.root}`),
      );
    }

    const name = "bot-sandbox";
    const inject = ["slots"];

    function FooterEntry() {
      const [open, setOpen] = react.useState(false);
      const [count, setCount] = react.useState(null);

      const refresh = async () => {
        try {
          const data = await api("/api/bot-sandbox/state");
          setCount(Array.isArray(data.targets) ? data.targets.length : 0);
        } catch {
          setCount(null);
        }
      };

      react.useEffect(() => {
        void refresh();
      }, []);

      return h(
        "div",
        { style: { position: "relative", display: "inline-flex" } },
        h(
          "button",
          {
            type: "button",
            title: "机器人沙箱",
            style: styles.footerButton,
            onClick: () => {
              setOpen((value) => !value);
              void refresh();
            },
          },
          h("span", {
            style: {
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: count === null ? "#9ca3af" : count > 0 ? "#16a34a" : "#9ca3af",
            },
          }),
          "沙箱",
          count === null
            ? null
            : h("span", { style: { fontSize: "11px", opacity: 0.75 } }, String(count)),
        ),
        open
          ? h(
              "div",
              { style: styles.popup },
              h(
                "div",
                { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" } },
                h("span", { style: { fontSize: "12px", color: color.muted } }, "机器人沙箱"),
                h("button", { type: "button", style: styles.button, onClick: () => setOpen(false) }, "关闭"),
              ),
              h(Panel, { onChanged: refresh }),
            )
          : null,
      );
    }

    function apply(ctx) {
      const slots = ctx.slots;
      if (slots === undefined) return;
      const disposers = [];
      try {
        disposers.push(
          slots.inject("settings.section", () =>
            slots.register(
              { name: "settings.section", id: "bot-sandbox", order: 90, label: "机器人沙箱" },
              Panel,
            ),
          ),
        );
      } catch (err) {
        console.error("[bot-sandbox] 注册设置页失败", err);
      }
      try {
        disposers.push(
          slots.inject("sidebar.footer.action", () =>
            slots.register(
              { name: "sidebar.footer.action", id: "bot-sandbox", order: 91 },
              FooterEntry,
            ),
          ),
        );
      } catch (err) {
        console.error("[bot-sandbox] 注册左下角入口失败", err);
      }
      if (typeof ctx.effect === "function") {
        ctx.effect(() => () => {
          for (const dispose of disposers.reverse()) {
            try {
              dispose();
            } catch {
              /* ignore */
            }
          }
        }, "bot-sandbox.client");
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  },
});
