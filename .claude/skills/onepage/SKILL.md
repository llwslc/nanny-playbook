---
name: onepage
description: 重建可直接打印的合订本 ONEPAGE.md + ONEPAGE.html（把仓库里全部 md 按 tools/onepage.order 的顺序合成一份）。每次改动任何 md、在提交之前运行。新增 md 未登记进清单时会构建失败并报出文件名。
---

# onepage

把 `nanny-playbook` 的全部内容合成**一份可直接打印的合订本**。

```bash
node tools/build-onepage.mjs
```

产出两份（都提交进 git）：

| 文件 | 干什么用 |
|---|---|
| `ONEPAGE.md` | GitHub 上能看、能 diff |
| `ONEPAGE.html` | **打印用**。浏览器打开 → `Cmd+P`。自带打印 CSS：A4、每章自动分页、表格不跨页断行 |

## 什么时候跑

**改了任何 md，提交之前。**

已经装了 git 钩子来兜底，正常情况下你不用手动跑：

```bash
git config core.hooksPath .githooks   # 一次性启用
```

之后每次 `git commit`，只要暂存区里有 `.md`，钩子就会自动重建并把两份产物 `git add` 进这次提交。**构建失败则拒绝提交。**

## 顺序由清单决定，不是字母序

`tools/onepage.order` 是**唯一的顺序来源**，一行一个文件。

**门禁**：仓库里任何一个内容 md 不在清单里 → **构建直接失败**，并报出文件名。

```
✗ onepage: 这些 md 不在 tools/onepage.order 里，打印版会漏掉它们：
    参考/新文件.md
  → 把它们加进 tools/onepage.order 的合适位置。
```

这是故意的——**新增文件必须显式指定它在打印版里的位置，不允许被静默漏掉。**

## 不要手改 ONEPAGE.*

它们是生成物。改内容改**源 md**，然后重建。

## 想让某段不进打印版

源 md 里用注释包起来（比如 README 里那些 git 仓库的说明，印在纸上是噪音）：

```markdown
<!-- onepage:skip-start -->
这段不会出现在打印合订本里。
<!-- onepage:skip-end -->
```

## 跨文件链接

构建时自动改写成**页内锚点**（`[急救.md](急救.md)` → `#急救`），所以合订本里点得动、印出来也读得通。链接不到的目标会退化成加粗纯文本。
