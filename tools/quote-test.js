/*
 * 摘录纯函数层测试：node tools/quote-test.js
 * 覆盖 docs/v0.2-design.md「交互规格」§5.3 借用规则、§6.2 文件名、§6.3 Markdown 逐条规则。
 * 只依赖 src/shared/quotes.js，不碰 DOM、不碰 chrome API。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.argv[2] || path.join(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'src/shared/quotes.js'), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'quotes.js' });
const Q = ctx.window.RK_QUOTES;
if (!Q) {
  console.error('RK_QUOTES 未初始化');
  process.exit(1);
}

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failed++;
    console.log('FAIL ' + name);
    console.log('  期望: ' + JSON.stringify(expected));
    console.log('  实际: ' + JSON.stringify(actual));
  } else {
    console.log('OK   ' + name);
  }
}

/* ---------- displayBook / displaySource（§5.3 的四种记录形态） ---------- */
check('都有值：book 出 / source 出',
  Q.displayBook({ book: '长安的荔枝', source: '第二章' }) + '|' + Q.displaySource({ book: '长安的荔枝', source: '第二章' }),
  '长安的荔枝|第二章');
check('老数据只有 source：借用为书名，出处不再重复',
  Q.displayBook({ source: '长安的荔枝' }) + '|' + Q.displaySource({ source: '长安的荔枝' }),
  '长安的荔枝|');
check('只有 book',
  Q.displayBook({ book: '长安的荔枝' }) + '|' + Q.displaySource({ book: '长安的荔枝' }),
  '长安的荔枝|');
check('都没有',
  JSON.stringify([Q.displayBook({}), Q.displaySource({})]),
  '["",""]');
check('纯空格视为没有',
  Q.displayBook({ book: '   ' }) + '|' + Q.displaySource({ source: '  ', book: ' ' }),
  '|');

/* ---------- 本地日期 ---------- */
check('localDateKey 用本地时区（不是 UTC）',
  Q.localDateKey(new Date(2026, 7, 14, 23, 30)),
  '2026-08-14');
check('dateKeyOf 非法时间戳返回空',
  Q.dateKeyOf(undefined) + '|' + Q.dateKeyOf(NaN) + '|' + Q.dateKeyOf('x'),
  '||');
const fixedTs = new Date(2026, 7, 11, 10, 0, 0).getTime();
check('dateKeyOf 正常', Q.dateKeyOf(fixedTs), '2026-08-11');

/* ---------- 文件名净化 ---------- */
check('非法字符替换为 -（全角冒号是合法文件名字符，不替换）', Q.sanitizeFilename('长安的荔枝/上：下'), '长安的荔枝-上：下');
check('首尾点与空格去除', Q.sanitizeFilename('  .书名. '), '书名');
check('截断到 40 字符', Q.sanitizeFilename('长'.repeat(50)).length, 40);
check('全非法时为空', Q.sanitizeFilename('///'), '');
check('换行制表符替换', Q.sanitizeFilename('a\nb\tc'), 'a-b-c');

/* ---------- 分组（§5.2） ---------- */
{
  const groups = Q.groupQuotes([
    { id: 'a', text: '老 A', book: '乙书', at: fixedTs - 86400000 },
    { id: 'b', text: '老 B', source: '甲书', at: fixedTs },            // 老数据借用
    { id: 'c', text: '老 C', at: fixedTs - 172800000 },               // 未署名
    { id: 'd', text: '老 D', book: '甲书', source: '', at: fixedTs - 3600000 }
  ]);
  check('组数（甲书归一合并）', groups.length, 3);
  check('未署名固定最后', groups[2].name, '未署名');
  check('组间按最新 at 排序', groups[0].name + '>' + groups[1].name, '甲书>乙书');
  check('组内 at 降序', groups[0].items.map(q => q.id).join(','), 'b,d');
}

/* ---------- Markdown：全部导出，与规格 §6.3 示例逐字符一致 ---------- */
{
  const ts = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).getTime();
  const items = [
    { id: '1', text: '流程是弱者才要遵循的规矩。', book: '长安的荔枝', source: '第二章', at: ts(2026, 8, 11) },
    { id: '2', text: '我是一个很笨的人，只是不太愿意承认。', book: '长安的荔枝', source: '', at: ts(2026, 8, 9) },
    { id: '3', text: '一天之内，把长安走完。', source: '长安十二时辰', at: ts(2026, 8, 5) },
    { id: '4', text: '没有书名的句子也留下来了。', at: ts(2026, 8, 2) }
  ];
  const expected = [
    '# 摘录',
    '',
    '共 4 条 · 导出于 2026-08-14',
    '',
    '## 长安的荔枝',
    '',
    '> 流程是弱者才要遵循的规矩。',
    '',
    '- 出处：第二章',
    '- 2026-08-11',
    '',
    '> 我是一个很笨的人，只是不太愿意承认。',
    '',
    '- 2026-08-09',
    '',
    '## 长安十二时辰',
    '',
    '> 一天之内，把长安走完。',
    '',
    '- 2026-08-05',
    '',
    '## 未署名',
    '',
    '> 没有书名的句子也留下来了。',
    '',
    '- 2026-08-02',
    ''
  ].join('\n');
  check('全部导出逐字符一致', Q.buildMarkdown(items, { today: '2026-08-14' }), expected);
}

/* ---------- Markdown：多行正文 / 空行变 > ---------- */
{
  const md = Q.buildMarkdown(
    [{ id: '1', text: '第一行\n\n第三行', book: '书', at: fixedTs }],
    { today: '2026-08-14' }
  );
  const lines = md.split('\n');
  check('多行正文每行都有 > 前缀',
    lines.filter(l => l === '> 第一行' || l === '>' || l === '> 第三行').length, 3);
  check('正文内空行输出为单独 >', lines.indexOf('>') >= 0, true);
}

/* ---------- Markdown：单本导出 ---------- */
{
  const items = [
    { id: '1', text: '甲句', book: '甲书', at: fixedTs },
    { id: '2', text: '乙句', book: '乙书', at: fixedTs }
  ];
  const md = Q.buildMarkdown(items, { book: '甲书', today: '2026-08-14' });
  check('单本标题', md.startsWith('# 甲书\n'), true);
  check('单本不含其它书条目', md.includes('乙句'), false);
  check('单本不加 ## 分组', md.includes('## '), false);
}

/* ---------- Markdown：at 非法不输出日期行、绝不补今天 ---------- */
{
  const md = Q.buildMarkdown([{ id: '1', text: '无日期', book: '书', at: undefined }], { today: '2026-08-14' });
  check('无 at 无日期行', md.includes('- 2026'), false);
  check('仍保留引用块', md.includes('> 无日期'), true);
}

/* ---------- Markdown：单组全部导出仍写 ##（§6.3 规则 3） ---------- */
{
  const md = Q.buildMarkdown([{ id: '1', text: '句', book: '唯一的书', at: fixedTs }], { today: '2026-08-14' });
  check('单组仍写 ## 分组', md.includes('## 唯一的书'), true);
}

/* ---------- 边界：末尾恰好一个换行、无 BOM ---------- */
{
  const md = Q.buildMarkdown([{ id: '1', text: '句', book: '书', at: fixedTs }], { today: '2026-08-14' });
  check('末尾恰好一个换行', [md.endsWith('\n'), md.endsWith('\n\n')].join('|'), 'true|false');
  check('无 BOM', md.charCodeAt(0) === 0xfeff, false);
  check('无署名行', md.includes('书房'), false);
}

/* ---------- 脏数据防御 ---------- */
check('过滤非法条目', Q.buildMarkdown([null, {}, { text: '   ' }, { id: '1', text: '句', book: '书', at: fixedTs }], { today: '2026-08-14' }).includes('共 1 条'), true);

console.log('');
if (failed) {
  console.log('结果：' + failed + ' 项失败');
  process.exit(1);
} else {
  console.log('结果：全部通过');
}
