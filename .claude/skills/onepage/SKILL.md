---
name: onepage
description: 重建可直接打印的合订本 ONEPAGE.md + ONEPAGE.html（把仓库全部 md 按 tools/onepage.order 的顺序合成一份）。改动任何 md、提交之前运行。新增 md 未登记进清单时构建会失败并报出文件名。
allowed-tools: Bash(node *)
---

# onepage

把 `nanny-playbook` 的全部内容合成一份**可直接打印的合订本**。

```bash
node ${CLAUDE_PROJECT_DIR}/tools/lint-docs.mjs      # 查对话残留
node ${CLAUDE_PROJECT_DIR}/tools/build-onepage.mjs  # 重建合订本
```

产出两份（都提交进 git）：

| 文件 | 干什么用 |
|---|---|
| `ONEPAGE.md` | GitHub 上能看、能 diff |
| `ONEPAGE.html` | **打印用**。浏览器打开 → `Cmd+P`。A4、每章自动分页、表格不跨页断行 |

## 平时不用手动跑

git 钩子会兜底。只要暂存区里有 `.md`，`git commit` 时自动 lint + 重建 + 把产物加进这次提交；**任一步红灯则拒绝提交**。

首次 clone 后启用一次：

```bash
git config core.hooksPath .githooks
```

**脚本放在 `tools/`，不放在这个 skill 目录里**——因为 git 钩子要调它们。别人 clone 了仓库、从不装 Claude，`git commit` 也得能跑。

## 顺序由清单决定，不是字母序

`tools/onepage.order` 是**唯一的顺序来源**，一行一个文件。

**门禁**：仓库里任何一个内容 md 不在清单里 → **构建直接失败**并报出文件名。

```
✗ onepage: 这些 md 不在 tools/onepage.order 里，打印版会漏掉它们：
    参考/新文件.md
  → 把它们加进 tools/onepage.order 的合适位置。
```

故意的——**新增文件必须显式指定它在打印版里的位置，不允许被静默漏掉。**

## 不要手改 ONEPAGE.*

它们是生成物。改内容改**源 md**，然后重建。

## 让某段不进打印版

源 md 里用注释包起来（比如 README 里那些 git 仓库的说明，印在纸上是噪音）：

```markdown
<!-- onepage:skip-start -->
这段不会出现在打印合订本里。
<!-- onepage:skip-end -->
```

## 构建时的自动改写

- **跨文件链接 → 页内锚点**（`[急救.md](急救.md)` → `#急救`），合订本里点得动、印出来也读得通
- **标签是文件路径的，换成干净的名字**（`模板/候选人评分表.md` → `候选人评分表`）——满篇路径没法读
- **章节标题取该文件自己的一级标题**，不是文件名
- **HTML 注释不渲染**（否则会被转义成可见正文印在纸上）
