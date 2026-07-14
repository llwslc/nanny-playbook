#!/usr/bin/env node
// 把全部 md 合成一份可直接打印的 ONEPAGE.md + ONEPAGE.html。
// 零依赖。顺序由 tools/onepage.order 决定。
//
// 门禁：仓库里任何内容 md 不在清单里 → 失败并报出文件名，绝不静默漏掉。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_DIRS = ['流程', '参考', '模板'];
const GENERATED = ['ONEPAGE.md', 'ONEPAGE.html'];

const die = (msg) => { console.error(`\x1b[31m✗ onepage: ${msg}\x1b[0m`); process.exit(1); };

// ── 读清单 ───────────────────────────────────────────────
const orderFile = path.join(ROOT, 'tools/onepage.order');
if (!fs.existsSync(orderFile)) die('缺少 tools/onepage.order');

// 一行一个文件。可选 `文件 | 章节标题` —— 覆盖该文件自己的 H1。
// 源文件不动（README 的 `# nanny-playbook` 在 GitHub 上该留着），
// 只把印出来的那一份换掉：目录和章首都用覆盖的标题。
const entries = fs.readFileSync(orderFile, 'utf8')
  .split('\n').map(l => l.trim())
  .filter(l => l && !l.startsWith('#'))
  .map(l => {
    const [file, title] = l.split('|').map(s => s.trim());
    return { file, title: title || null };
  });
const order = entries.map(e => e.file);
const titleOf = new Map(entries.filter(e => e.title).map(e => [e.file, e.title]));

// ── 门禁 1：清单里的文件都得存在 ──────────────────────────
const missing = order.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) die(`清单里这些文件不存在：\n    ${missing.join('\n    ')}`);

// ── 门禁 2：仓库里的 md 都得在清单里（防止新文件被静默漏掉）──
// 根目录扫全部 md，不写白名单——白名单会让新增文件绕过门禁。
// 工具/元文件放在 .claude/ 和 tools/ 里，不在扫描范围内。
const onDisk = [
  ...fs.readdirSync(ROOT).filter(f => f.endsWith('.md')),
  ...CONTENT_DIRS.flatMap(d => {
    const dir = path.join(ROOT, d);
    return fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => `${d}/${f}`)
      : [];
  }),
].filter(f => !GENERATED.includes(f));

const orphan = onDisk.filter(f => !order.includes(f));
if (orphan.length) {
  die(`这些 md 不在 tools/onepage.order 里，打印版会漏掉它们：\n    ${orphan.join('\n    ')}\n` +
      `  → 把它们加进 tools/onepage.order 的合适位置。`);
}

// ── 文件名 → 锚点，用于把跨文件链接改写成页内锚点 ──────────
const anchorOf = (file) => path.basename(file, '.md');
const linkMap = new Map(order.map(f => [anchorOf(f), slug(anchorOf(f))]));

function slug(s) {
  s = s.toLowerCase().replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '');
  // CSS 的 ID 选择器不能以数字开头，而排版引擎会拿 href 去 querySelector——
  // `#1-初筛` 会直接抛 SyntaxError，整个分页就停在第一页。
  return /^\d/.test(s) ? `ch-${s}` : s;
}

// ── 逐个读取、清洗 ────────────────────────────────────────
const chapters = order.map((file, idx) => {
  let md = fs.readFileSync(path.join(ROOT, file), 'utf8');

  // 去掉标了 onepage:skip 的段落（仓库自身的说明，印在纸上是噪音）
  md = md.replace(/<!--\s*onepage:skip-start\s*-->[\s\S]*?<!--\s*onepage:skip-end\s*-->/g, '');

  // 章节标题：onepage.order 里的覆盖优先 → 文件自己的一级标题 → 退回文件名
  const h1 = md.match(/^#\s+(.+?)\s*$/m);
  const title = titleOf.get(file) || (h1 ? h1[1] : anchorOf(file));

  // 章首 H1 带上章号，和目录的序号一致——在一沓纸里翻章，认数字比认标题快。
  // （标题覆盖也在这里一并生效——否则目录印新名字、章首还印着旧的）
  if (h1) md = md.replace(/^#\s+.+?\s*$/m, () => `# ${idx + 1} · ${title}`);

  // 跨文件链接 → 页内锚点。
  // 标签若是文件路径（"模板/候选人评分表.md"），换成干净的名字——
  // 合订本里满篇路径没法读。链接不到的目标退化成加粗纯文本。
  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, href) => {
    if (/^https?:/.test(href)) return m;
    const label = /\.md$/.test(text) ? path.basename(text, '.md') : text;
    const target = linkMap.get(path.basename(href.split('#')[0], '.md'));
    return target ? `[${label}](#${target})` : `**${label}**`;
  });

  return { file, title, id: slug(anchorOf(file)), md: md.trim() };
});

// ── ONEPAGE.md ───────────────────────────────────────────
const stamp = process.env.SOURCE_DATE || '';
// 给维护者的话只能写在 HTML 注释里——注释不渲染、不进 PDF。
// 正文里的每一个字都会被印出来，而拿着打印稿的人没有仓库、不用 git。
const banner = [
  `<!-- 本文件由 tools/build-onepage.mjs 自动生成（${chapters.length} 个源文件），不要手改。 -->`,
  '<!-- 改内容请改各个源 md，提交时 pre-commit 会自动重建。 -->',
  '',
  '# 育儿嫂招聘与管理 · 打印合订本',
  '',
  stamp ? `> 生成时间：${stamp}` : '',
  '',
  '## 目录',
  '',
  ...chapters.map((c, i) => `${i + 1}. [${c.title}](#${c.id})`),
  '',
].filter(l => l !== undefined).join('\n');

const mdOut = banner + '\n' + chapters
  .map(c => `\n<a id="${c.id}"></a>\n\n${c.md}\n`)
  .join('\n---\n');

fs.writeFileSync(path.join(ROOT, 'ONEPAGE.md'), mdOut.replace(/\n{4,}/g, '\n\n\n') + '\n');

// ── 极简 markdown → html（够用即可，无外部依赖）──────────
function mdToHtml(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 行内：先保护 <br> 和 <a id>，再转义，最后还原 markdown 行内语法
  const inline = (s) => {
    const keep = [];
    s = s.replace(/<br\s*\/?>/gi, () => `\u0000${keep.push('<br>') - 1}\u0000`);
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
  };

  const out = [];
  const lines = src.split('\n');
  let i = 0;
  let listStack = []; // {tag, indent}
  let inSection = false;

  const closeLists = (toIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) {
      out.push(`</${listStack.pop().tag}>`);
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // 章节锚点：开一个新 section，先把上一个关掉
    const anchor = line.match(/^<a id="([^"]+)"><\/a>$/);
    if (anchor) {
      closeLists();
      if (inSection) out.push('</section>');
      out.push(`<section id="${anchor[1]}" class="chapter">`);
      inSection = true;
      i++; continue;
    }

    if (!line.trim()) { i++; continue; }

    // HTML 注释：不渲染（否则会被转义成可见正文印在纸上）
    if (/^<!--/.test(line.trim())) {
      while (i < lines.length && !/-->/.test(lines[i])) i++;
      i++; continue;
    }

    // 表格
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test((lines[i + 1] || '').trim())) {
      closeLists();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      out.push('<table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>');
      for (const r of body) out.push('<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>');
      out.push('</tbody></table>');
      continue;
    }

    // 引用块
    if (/^>\s?/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${mdToHtml(buf.join('\n')).replace(/<\/?section[^>]*>/g, '')}</blockquote>`);
      continue;
    }

    // 分隔线
    if (/^-{3,}$/.test(line.trim())) { closeLists(); out.push('<hr>'); i++; continue; }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeLists(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    // 列表
    const li = raw.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const indent = li[1].length;
      const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      closeLists(indent);
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent) { out.push(`<${tag}>`); listStack.push({ tag, indent }); }
      out.push(`<li>${inline(li[3].replace(/^\[([ x])\]\s*/, (_, c) => c === 'x' ? '☑ ' : '☐ '))}</li>`);
      i++; continue;
    }

    // 段落
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  closeLists();
  if (inSection) out.push('</section>');
  return out.join('\n');
}

const body = mdToHtml(mdOut);

// 目录列表标上 class——CSS 靠它给每一项补页码（target-counter 由排版引擎结算）。
// 找不到就直接失败：目录页码悄悄消失，比构建失败糟得多。
const bodyHtml = body.replace('<h2>目录</h2>\n<ol>', '<h2>目录</h2>\n<ol class="toc">');
if (bodyHtml === body) die('没找到「目录」列表——目录页码没法标注');

// 排版引擎（vendor 进仓库，MIT）：把文档排成真正的 A4 页。
// 页脚页码、页眉章节名、目录页码都出自同一次排版，和纸上印出来的天然一致——
// 在构建机上"预测"浏览器分页迟早会静默指错，这里不猜。
const VENDOR = path.join(ROOT, 'tools/vendor/paged.polyfill.js');
if (!fs.existsSync(VENDOR)) die('缺少 tools/vendor/paged.polyfill.js（页码排版引擎）');
const pagedjs = fs.readFileSync(VENDOR, 'utf8');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<!-- A4 页面固定 794px 宽。布局视口定成 页宽 + 两侧留白：手机自动把整页缩到屏幕宽
     （双指还能放大细看），桌面浏览器不理这一行。 -->
<meta name="viewport" content="width=826">
<script>document.documentElement.className = 'js';</script>
<title>育儿嫂招聘与管理 · 打印合订本</title>
<style>
  /* 文末内联的排版引擎会把正文切成真正的 A4 页：页眉印章节名，页脚印页码，
     目录页码用 target-counter 从同一次排版里取。
     打印时在浏览器对话框里关掉它自带的页眉页脚，别和页面里的叠在一起。 */
  :root { --line:#d5d5d5; --muted:#666; --accent:#8a1c1c; }
  * { box-sizing: border-box; }
  html {
    font: 9.5pt/1.65 -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color:#111;
  }
  body { margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 .6em; padding-bottom:.3em; border-bottom: 3px solid var(--accent); string-set: chaptitle content(text); }
  h2 { font-size: 14pt; margin: 1.6em 0 .5em; padding-left:.4em; border-left: 4px solid var(--accent); }
  h3 { font-size: 12pt; margin: 1.2em 0 .4em; }
  h4 { font-size: 11pt; margin: 1em 0 .3em; color: var(--muted); }
  h1, h2, h3, h4 { break-after: avoid; }
  p, li { margin: .35em 0; orphans: 2; widows: 2; }
  ul, ol { padding-left: 1.6em; margin: .4em 0; }
  code { background:#f2f2f2; padding: .1em .35em; border-radius:3px; font-size: .9em; }
  hr { border:0; border-top:1px solid var(--line); margin: 1.4em 0; }
  a { color: inherit; text-decoration: none; }
  blockquote {
    margin: .8em 0; padding: .6em 1em; background:#faf7f2;
    border-left: 3px solid #c9a227; break-inside: avoid;
  }
  blockquote > :first-child { margin-top:0; } blockquote > :last-child { margin-bottom:0; }
  table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: 9.5pt; }
  th, td { border: 1px solid var(--line); padding: .45em .6em; text-align: left; vertical-align: top; }
  th { background:#f4f2ef; font-weight: 600; }
  tr { break-inside: avoid; }
  .chapter { break-before: page; }

  /* 目录：标题靠左，页码靠右。
     排版引擎不认 leader() 点线——content 里混进它，整条声明会被判非法，页码直接消失。 */
  .toc { padding-left: 2.2em; }
  .toc li { margin: .45em 0; position: relative; padding-right: 3em; }
  .toc a::after { content: target-counter(attr(href), page); position: absolute; right: 0; }

  /* 左右 20mm 是装订边（订书针 / 打孔），别收窄。左右对称，单双面打印都留得出。
     页眉页脚排在上下边距里。 */
  @page {
    size: A4;
    margin: 15mm 20mm;
    @top-center { content: string(chaptitle); font-size: 8pt; color: #999; }
    @bottom-center { content: "第 " counter(page) " 页 · 共 " counter(pages) " 页"; font-size: 8pt; color: #999; }
  }
  @page :first { @top-center { content: none; } }  /* 封面页自己就是大标题 */

</style>
<style media="screen">
  /* 屏幕预览：灰底、白纸居中、页间距。
     media="screen" 一石二鸟：打印时浏览器天然忽略；排版引擎收集样式表时
     也明确跳过 media~='screen' 的表——所以这套样式从加载那一刻就生效，
     不会先靠边裸排、排完页码再跳到中间。
     margin auto 在窄屏自动退化成 0：页面比屏宽时靠左、可横向滚动，不裁两边。 */
  body { background: #d9d9d9; }
  .pagedjs_page { background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.28); margin: 16px auto; }
  /* 排版引擎启动后才把正文收进页面容器；在那之前把原始正文藏住，
     避免首帧闪一下未分页的裸文档。不开 JS 就没有 .js 类，原文照常显示、照常能印。 */
  .js body > :not(.pagedjs_pages) { display: none; }
</style>
</head>
<body>
${bodyHtml}
<script>
  // 排版完成的信号：无头浏览器出 PDF 时等它，别在排到一半时出片。
  window.PagedConfig = { after: () => { window.__pagedjsDone = true; } };
</script>
<script>
${pagedjs}
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'ONEPAGE.html'), html);

const kb = (f) => (fs.statSync(path.join(ROOT, f)).size / 1024).toFixed(0);
console.log(`\x1b[32m✓ onepage\x1b[0m  ${chapters.length} 个文件 → ONEPAGE.md (${kb('ONEPAGE.md')} KB) + ONEPAGE.html (${kb('ONEPAGE.html')} KB)`);
