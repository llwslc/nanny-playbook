#!/usr/bin/env node
// 检查指南里「读者看不见的东西」+ 跨文件的编号引用。规则见 .claude/CLAUDE.md。
// 一句话：这份文档的读者手上只有这份文档——很可能就是一沓打印纸。
//
// 三类：
//
// 1. 对话残留 —— 他没参与过讨论、没看过草稿、没读过被拿来对照的外部材料、没问过问题。
//    所以只做正面陈述，不反驳没提过的主张，不假设读者背景，不搬答复。
//    引号和行内代码先剥掉再匹配——里面是别人说的话（"我觉得他今天不太对"），不是叙述。
//
// 2. 仓库残留 —— 他没有仓库、不用 git、没有 `本地/` 这个目录，
//    也不知道这份东西在网上叫什么名字（`nanny-playbook` 印在纸上是天书）。
//    只查**会被印出来的部分**：<!-- onepage:skip-start/end --> 之间的内容不进合订本
//    （README 里那些 git 说明就在里面），对它们不设这条限制。
//    这类不剥引号：印在纸上的 `本地/` 换成等宽字体也还是天书。
//
// 3. 编号引用 —— 「红线第 12 条」「标准答案 §八」被别的文档**硬编码**引用。
//    编号是接口：只能追加，不能插队、不能重排。
//    重排**不会报错**——那些引用会静默地指向另一条规则 / 另一章，谁都不会发现。
//    所以这里当门禁：编号本身连不连续、所有引用指不指得着，都得对上。
//
// .claude/ 和 tools/ 不扫（规则文件本身就要列举这些反面词）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['ONEPAGE.md']); // 生成物

const RULES = [
  // ── 对话残留：全文都查 ──────────────────────────────────
  { re: /OKR/i,                                   why: '企业绩效框架。读者不一定用——把结论正面写出来，别引用这个词' },
  { re: /如果你在公司|很自然地想|你可能会想|你大概会/, why: '假设读者的职业背景或心理活动' },
  { re: /上一版|我原来|之前写的|原来那版/,           why: '引用读者看不见的草稿' },
  { re: /你发我的|你给我的|你说的那个|你问的/,        why: '引用对话里的东西' },
  { re: /先扔掉|别用.{0,8}那套/,                    why: '反驳一个指南从未提出的主张——读者没见过它' },
  { re: /我建议|我不建议|我觉得|我认为|我的答案/,      why: '指南没有叙述者「我」' },

  // ── 仓库残留：只查会被印出来的部分 ──────────────────────
  { print: true, re: /仓库|\brepos?\b/i,                        why: '读者手上是一沓打印纸，没有仓库' },
  { print: true, re: /\bgit\b|gitignore|\bclone\b|\bcommit\b|提交到/i, why: '读者不用 git' },
  { print: true, re: /本地\//,                                   why: '读者没有这个目录' },
  { print: true, re: /nanny-playbook/i,                          why: '仓库名。读者拿的是一沓纸，不知道这东西在网上叫什么——章节标题尤其别用它' },
  // 注：源文件里的 `[标准答案.md](标准答案.md)` 不查——build 会把跨文件链接
  // 改写成页内锚点、标签换成干净的章节名，`.md` 印不出来。
];

// 「红线第 N 条」「[红线](…)第 N 条」「[红线清单](…)第 N 条」。
// 必须带「红线」前缀——合同条款.md 里的「第 2 条」说的是它自己的条款，不是红线。
const RED_REF = /红线(?:清单)?(?:\.md)?(?:\]\([^)]*\))?\s*第\s*(\d+)\s*条/g;

// 「§八」这类**按编号**引用的章节。
// 后面紧跟汉字的不算：`§坠床` `§怎么识别"编的表"` 是**按标题**引用的——
// 那是文字不是编号，章节重排也不会断，不归这个门禁管。
const SEC_REF = /§\s*([一二三四五六七八九十]+)(?![一-龥])/g;

const CN = '零一二三四五六七八九';
const cn2n = (s) => {
  if (s === '十') return 10;
  const i = s.indexOf('十');
  if (i < 0) return CN.indexOf(s);                         // 一…九
  const hi = i === 0 ? 1 : CN.indexOf(s[0]);               // 十X / X十Y
  const lo = i === s.length - 1 ? 0 : CN.indexOf(s[i + 1]);
  return hi * 10 + lo;
};

// 剥掉引语和行内代码：里面是别人说的话 / 字面量，不是指南的叙述
const strip = (s) => s
  .replace(/`[^`]*`/g, '')
  .replace(/"[^"]*"/g, '')
  .replace(/'[^']*'/g, '')
  .replace(/[“][^”]*[”]/g, '')
  .replace(/[‘][^’]*[’]/g, '')
  .replace(/「[^」]*」/g, '');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .filter((e) => !['.git', 'node_modules', 'tools', '.claude', '本地', 'local'].includes(e.name))
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

// onepage.order 里写了 `文件 | 章节标题` 的，build 会把该文件的 H1 换成覆盖的标题。
// 那一行印不到纸上，所以 print 规则跳过它——README 的 `# nanny-playbook` 就是这么来的：
// 在 GitHub 上留着，在合订本里换成「怎么用这份指南」。
const orderFile = path.join(ROOT, 'tools/onepage.order');
const overridden = new Set(
  fs.existsSync(orderFile)
    ? fs.readFileSync(orderFile, 'utf8').split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && l.includes('|'))
        .map((l) => l.split('|')[0].trim())
    : [],
);

const hits = [];
const redRefs = [];
const secRefs = [];

for (const file of walk(ROOT).filter((f) => f.endsWith('.md'))) {
  const rel = path.relative(ROOT, file);
  if (SKIP.has(rel)) continue;
  let printed = true;   // 当前行是否会进合订本
  let h1Done = false;   // 该文件的第一个 H1 是否已经过了（build 只换第一个）
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/<!--\s*onepage:skip-start\s*-->/.test(line)) printed = false;

    // 会被 build 换掉的那个 H1：印出来的是覆盖的标题，原文查它没有意义
    const swapped = overridden.has(rel) && !h1Done && /^#\s+\S/.test(line);
    if (swapped) h1Done = true;

    const bare = strip(line);
    for (const { re, why, print } of RULES) {
      if (print && (!printed || swapped)) continue;
      const m = (print ? line : bare).match(re); // 仓库残留查原文，不剥引号
      if (m) hits.push({ rel, ln: i + 1, hit: m[0], why, print, line: line.trim().slice(0, 70) });
    }
    for (const m of line.matchAll(RED_REF)) redRefs.push({ rel, ln: i + 1, n: +m[1], hit: m[0] });
    for (const m of line.matchAll(SEC_REF)) secRefs.push({ rel, ln: i + 1, n: cn2n(m[1]), hit: m[0].trim() });
    if (/<!--\s*onepage:skip-end\s*-->/.test(line)) printed = true;
  });
}

// ── 编号一致性 ────────────────────────────────────────────
const numErrs = [];

// 红线清单：标题条数 / 对照表 / 签字页 / 所有「红线第 N 条」引用，四者必须对得上
const RED = path.join(ROOT, '模板/红线清单.md');
const rowNums = (s) => [...s.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => +m[1]);

if (!fs.existsSync(RED)) {
  numErrs.push('找不到 模板/红线清单.md');
} else {
  const src = fs.readFileSync(RED, 'utf8');
  const [head, sign] = src.split(/^#+\s*签字页/m);          // 签字页之前 = 对照表
  const declared = Number(src.match(/^##\s*(\d+)\s*条\s*$/m)?.[1] ?? 0);
  const main = rowNums(head);
  const sig = sign ? rowNums(sign) : [];
  const seq = main.map((_, i) => i + 1);

  if (!main.length) numErrs.push('红线对照表一条都没读到——表格格式变了？');
  else if (String(main) !== String(seq))
    numErrs.push(`红线对照表条号不连续：${main.join(',')} —— 应该是 1…${main.length}（只能追加，不能插队）`);

  if (declared !== main.length)
    numErrs.push(`红线标题写着「${declared} 条」，对照表实际 ${main.length} 条 —— 改条数别忘了 README.md 的目录说明`);

  if (String(sig) !== String(main))
    numErrs.push(`红线签字页和对照表对不上：签字页 [${sig.join(',') || '空'}]，对照表 [${main.join(',')}] —— 签字页才是签下去生效的那版`);

  for (const r of redRefs.filter((r) => main.length && !main.includes(r.n)))
    numErrs.push(`${r.rel}:${r.ln}  「${r.hit}」—— 红线清单只有 ${main.length} 条，没有第 ${r.n} 条`);
}

// 标准答案：章节号连续 + 所有「§N」引用都指得着
const ANS = path.join(ROOT, '参考/标准答案.md');
if (!fs.existsSync(ANS)) {
  numErrs.push('找不到 参考/标准答案.md');
} else {
  const secs = [...fs.readFileSync(ANS, 'utf8').matchAll(/^#\s+([一二三四五六七八九十]+)、/gm)].map((m) => cn2n(m[1]));
  const seq = secs.map((_, i) => i + 1);

  if (!secs.length) numErrs.push('标准答案.md 里一个「# 一、xxx」章节都没读到');
  else if (String(secs) !== String(seq))
    numErrs.push(`标准答案.md 章节号不连续：${secs.join(',')} —— 应该是 1…${secs.length}`);

  for (const r of secRefs.filter((r) => secs.length && !secs.includes(r.n)))
    numErrs.push(`${r.rel}:${r.ln}  「${r.hit}」—— 标准答案.md 只有 ${secs.length} 章，没有第 ${r.n} 章`);
}

// ── 报告 ──────────────────────────────────────────────────
if (!hits.length && !numErrs.length) {
  console.log('\x1b[32m✓ lint-docs\x1b[0m  无对话残留 / 仓库残留；红线条号、章节号一致');
  process.exit(0);
}

if (hits.length) {
  console.error(`\x1b[31m✗ lint-docs: 读者看不见的东西 ${hits.length} 处\x1b[0m`);
  console.error('  指南不能引用读者看不见的东西——他手上只有这份文档。规则见 .claude/CLAUDE.md。\n');
  for (const h of hits) {
    console.error(`  \x1b[33m${h.rel}:${h.ln}\x1b[0m  「${h.hit}」— ${h.why}`);
    console.error(`      ${h.line}\n`);
  }
  console.error('  改法：把结论正面写出来，而不是写成「对某个不在场的东西的反驳」。');
  console.error('  写给仓库使用者（而不是读者）的话，包进 <!-- onepage:skip-start --> … <!-- onepage:skip-end -->。\n');
}

if (numErrs.length) {
  console.error(`\x1b[31m✗ lint-docs: 编号对不上 ${numErrs.length} 处\x1b[0m`);
  console.error('  「红线第 N 条」「标准答案 §N」被别的文档硬编码引用。编号是接口：只能追加。\n');
  for (const e of numErrs) console.error(`  \x1b[33m${e}\x1b[0m`);
  console.error('\n  改法：新内容追加到末尾。非要插队，就把所有引用一起改——上面每一条都告诉你漏在哪。');
  console.error('  红线还要三处同步：对照表 + 签字页 + 标题条数（连带 README 的目录说明）。\n');
}

process.exit(1);
