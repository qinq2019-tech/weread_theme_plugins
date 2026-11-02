# 交接记录（Handoff）

> 更新时间：2026-11-02 11:40 · 版本 v0.3.0
> **跨平台 / 新会话接手先读 `PROJECT-STATUS.md`（现状总览与推进顺序）**，本文件是踩坑档案与决策细节，两者不重复：总览看那份，细节看这份。

## 一句话状态

v0.3.0 完成：针对登录态真机反馈的「组件堆积混乱」，书桌改为**替换式挂载**（原地顶掉原生「继续阅读」分区，等宽等位、卸载还原）、画廊题签删除（继续阅读全局只在书桌出现一次）、三套专属区空态降级（数据不足收缩为一行轻提示）。三套自动化测试 97 项全绿；`preview.html` 已同步。**待登录态真机复核**（重点：替换落位、「查看全部」链接、恢复原版后原生分区复位）。

---

## 已确认的产品决策

| 决策 | 结论 |
|---|---|
| 审美方向 | 用户确认「对味」，方向成立 |
| 主题数量 | **三套全部保留**：私人书房 `paper`、书架画廊 `gallery`、轻彩空间 `pastel`。不是三选一，是常驻可切换，后续新增功能不得删减任何一套 |
| 专属内容区 | v0.2 落地：不是换配色，是换内容气质。专属区**不加框**（页面上唯一带框的是书桌）、最大字号 17px、三套用三套完全不同的栅格 |
| 摘录管理位置 | 设置页整页承载；功能坞只保留快速录入 + 「管理摘录」跳转入口 |
| 摘录字段 | 新增 `book` 字段；老数据（书名在 `source` 里）**只读借用、不迁移**，用户主动保存那一刻才落 `book` |
| 删除策略 | 逐条删除**不用 confirm**，立即写 storage + 8 秒单一可累积撤销栈；confirm 只留给「清空数据」 |
| pastel 不做专注计时 | 要么统计非阅读时间、要么与心跳重复计时，两个方向都是造数 |
| 丰富 vs 专注 | 首页/书架可丰富，正文阅读保持克制（正文是 canvas，只做色温层） |
| 数据边界 | 全部本地存储；不请求站点接口、不碰账号凭据、不绕过付费墙 |

---

## 已交付内容

**v0.3 新增**（登录态真机反馈修复）：书桌替换式挂载（`10-adapter.js` 新增 `deskAnchor()`：登录态首页返回 replace 模式锚点，其它结构回退 prepend；`30-desk.js` 原地顶掉 `.wr_index_page_top_section_wrapper`、抄原生 margin、卸载时把原生节点放回原位）；书桌头部保留原生「查看全部 · N 个」入口（href 现场提取，站点不给就不渲染）；画廊题签（.rk-plate）整体删除——继续阅读全局只在书桌出现一次；三套专属区空态降级（在读 < 3 本 / 无摘录且在读不足 / 有记录天数 < 3 → 一行 `rk-wing-note` 轻提示，不再撑骨架）；新增 `tools/dump-home.js` 与 `tools/dump-home-2.js`（登录态 Console 侦察脚本，只读）。

**v0.2 已有**：主题专属区（书桌下方独立一条，`deskModules.wingPaper/wingGallery/wingTime` 三个独立开关，只渲染当前主题对应的那一个，关闭后连宿主都不留）；摘录管理设置页卡片（按书/按时间视图、就地编辑、删除 8 秒撤销、全部/单本导出 Markdown）；功能坞「管理摘录」入口（`rk:open-options` 带 `#quotes` hash 直达）；新令牌 7 个（heat1-3 / spine1-3 / shadowSoft，三主题×明暗共 42 值）。

**v0.1 已有**：首页「我的书桌」（问候 / 继续阅读 / 今日目标环 / 最近摘录）、右下角功能坞（主题 / 明暗 / 字体 / 留白 / 摘录 / 色温 / 沉浸 / 恢复原版）、设置页（预览 + 开关 + 目标 + 数据导入导出清空）、弹窗（总开关 + 主题 + 页面适配诊断）、阅读器（色温层 / 顶底栏隐藏 / 阅读记录）、SW 按 tabId 去重聚合阅读时长。

文件地图：

```
weread-studio/
├─ manifest.json          MV3，权限只有 storage + https://weread.qq.com/*
├─ preview.html           静态设计预览（三主题 + 深色可切；专属区数值与 05-ui-css.js 联动）
├─ docs/
│  └─ v0.2-design.md      v0.2 规格唯一来源：视觉方向（§1-11）+ 交互规格（摘录管理）
├─ README.md              安装、架构决策、验收清单、边界
├─ PROJECT-STATUS.md      跨平台交接总览：现状 / 卡点 / 下一步 / 接手步骤（新会话入口）
├─ HANDOFF.md             本文件
├─ tools/
│  ├─ smoke-test.js       DOM 桩冒烟：首页 / 替换式挂载与还原 / 专属区三套 + 空态 / 阅读器 / 陌生页 / 还原
│  ├─ quote-test.js       摘录纯函数层测试（借用规则 / Markdown 逐条规则）
│  ├─ options-test.js     设置页行为测试（分组 / 删除撤销 / 导出捕获 / 编辑 / 同步）
│  ├─ live-check.js       CDP 驱动 headless Chrome 注入真实页面（未登录）
│  ├─ dump-home.js        登录态首页结构侦察 · 第一段（Console 粘贴，只读）
│  └─ dump-home-2.js      登录态首页结构侦察 · 第二段（分区清单 / 继续阅读分区内部）
├─ icons/                 16/48/128 图标 + 生成脚本
└─ src/
   ├─ shared/defaults.js  默认设置（含 deskModules 三 个 wing 开关）
   ├─ shared/palette.js   三套主题令牌（含 heat/spine/shadowSoft）+ 字体 + 留白
   ├─ shared/quotes.js    摘录纯函数层：displayBook/displaySource/groupQuotes/buildMarkdown
   ├─ content/00-core.js  命名空间、存储、事件总线、DOM 工具（含安全建节点 RK.h）
   ├─ content/05-ui-css.js  Shadow DOM 样式表（字符串；末尾「主题专属区」分节）
   ├─ content/10-adapter.js 站点适配层——唯一允许出现站点类名的文件
   ├─ content/20-theme.js 主题应用/撤除、站点明暗判定（TOKEN_MAP 含 7 个新令牌）
   ├─ content/30-desk.js   首页书桌
   ├─ content/35-wing.js   主题专属区（三套模块 + hash 分档 / 日历 / 相对时间）
   ├─ content/40-dock.js   悬浮坞（含「管理摘录」入口、200 上限 toast）
   ├─ content/50-reader.js 色温、沉浸、阅读记录、时长心跳
   ├─ content/60-boot.js   启动、SPA 导航、生命周期、还原（含 wing 挂卸）
   ├─ content/page-theme.css 注入页面的视觉层
   ├─ background.js        SW：时长聚合、打开设置页（支持 #hash 直达）
   ├─ options/             设置页（含摘录管理卡片：options.html/css/js）
   └─ popup/               弹窗
```

---

## 关键事实（下一轮别重新踩）

1. **现行线上首页不是 Nuxt 版**：没有 `#__nuxt`，没有任何 `.wr_index_page_*`。真实锚点是 `#routerView.home_page`、`.home_page_container`、`.ranking_block_*`、`.ranking_topCategory_container`；封面 `.wr_bookCover`（首页 24 个）。
2. **阅读器正文是 2 个 `<canvas>`**：改字号/行距/划线会破坏排版，所以只做 `pointer-events:none` 的色温层。
3. **`document.title` 格式**：`书名 - 作者 - 微信读书`，第二段是作者，不是章节。
4. **阅读器顶栏 `.readerTopBar` 里没有章节名**，只有「加入书架 / 首页 / 我的书架 / 登录」。章节不要猜，猜了会写成「加入书架」。右侧控件栏是 `.readerControls`（48×504）。底部栏当前未发现（`[class*="readerBottom"]` 为 null）。
5. **宿主元素必须用内联样式定位**：Shadow 样式表里的属性选择器选不到宿主（只能用 `:host`）。这个坑当初让功能坞变成静态元素被挤到页面底部、书桌丢了边框底色。
6. **SPA 导航**：content script 在隔离世界，改不了页面自己的 `history.pushState`。用 location 轮询 1.5s + `popstate` + `MutationObserver`（节流 900ms）。
7. **页面底色只在明暗一致时覆盖**（`html[data-rk-theme-match="1"]`）。实测阅读器是深色面，纸色主题下 `match=0`，此时页面保持站点原色，只改我们自己的组件——这是刻意设计，不是 bug。
8. **CSS 变量写在 `<html>`**，能穿透 Shadow 边界继承，所以换主题时组件样式一行都不用改。
9. **hash 必须用无符号右移（`h >>> 3`）**：`hashName` 返回 `>>>0` 的 32 位数，带符号 `>>` 会让 hash ≥ 2³¹ 的书取档成 `undefined`，书脊直接丢宽高。这个 bug 是 dump-dom 数出来的，截图上只表现为「书脊稀疏」。
10. **`RK.h(tag, props)` 里 `style` 必须放 props 顶层**——塞进 `attrs` 会被 `setAttribute('style', '[object Object]')` 吃掉（无报错、静默失效）。
11. **`20-theme.js` 的 `apply()` 用 `if (tokens[key])` 守卫，令牌漏填不报错、只静默漏色**。新令牌必须在 palette.js 的 6 个对象（3 主题 × 明暗）逐个补齐，改完肉眼切 6 次确认。
12. **纸色令牌要对着画布色核对**：gallery/pastel 浅色 spine-1 原值与画布几乎同色（`#EEF2EE` vs `#F2F4F0`），书脊在墙上隐身；已压深为 `#E3EBE4` / `#EAE1F9`。
13. **preview.html 与 05-ui-css.js 是两份手工联动副本**；且预览的变体显示规则要把 display 和栅格写进同一条主题条件规则（`body[data-theme="x"] .wing-body.wv-x{display:grid;...}`），否则 `display:grid` 的无条件规则会压过 `.wv{display:none}`，三套同屏。
14. **设置页编辑摘录期间绝不调全量 `render()`**——它会把编辑中的 textarea 整个换掉；只调 `renderQuotes()` + `renderStats()`，且 `storage.onChanged` 在 `editingId` 非空时跳过重绘。
15. **撤销条必须是常驻 `role="status"` 节点**（options.html 里预先写好、初始 hidden）；删除时才 createElement 插入的 live region 读屏经常不播报。
16. **登录态首页与未登录首页是两套结构**（2026-11-02 实测，v0.2 真机翻车的根因）：登录后 `weread.qq.com/` 根路径是 `.wr_index_page_*`（此前以为已消失的"旧版"结构——当时测的是未登录 `/web/` 的 `.home_page_container` 新结构，两套都活着）。登录态首页的内容区**只有一个主体分区**：`.wr_index_page_top_section_wrapper`（标题行「继续阅读 + 查看全部·N 个」+ 22 张分类卡 562px 宽单列）。此前把书桌+专属区 prepend 进去，等于在原生主体前叠了两条全宽横幅——这就是「一片乱码」的来源。v0.3 起书桌对该分区做替换式挂载。
17. **替换式挂载的还原必须先插回再移除**：`unmount()` 先 `parent.insertBefore(NATIVE, MOUNTED)` 再 `removeChild(MOUNTED)`；且要判断 NATIVE 是否已被站点自行重渲染（`document.contains(NATIVE)` 为 true 就不插回，避免插回过期节点）。桩测试里引用原生分区要在 mount **之前**取——替换后 querySelector 查不到了，挂在之后取会拿到 null。
18. **测试断言的取值时机跟挂载方式耦合**：`report()` 在替换完成后调用 `deskAnchor()` 只会返回 fallback 模式（锚点已被顶掉），断言 replace 模式必须在挂载前捕获。

---

## 已验证 / 未验证

**已验证（v0.3）**：全部 JS 语法；`tools/smoke-test.js` 37 项全过（新增：替换式挂载 5 项 + 替换式还原 2 项 + 三套空态降级 3 项 + 题签删除 1 项）；`tools/quote-test.js` 30 项全过；`tools/options-test.js` 30 项全过（合计 97 项）；`preview.html` gallery/paper 截图核对（题签删除后书脊墙独占整行、书桌头部「查看全部」链接落位正常）。

**已验证（v0.2）**：`tools/smoke-test.js`（含专属区三套场景）28 条全过；`tools/quote-test.js` 30 条全过；`tools/options-test.js` 30 条全过；`preview.html` 五张截图逐张核对，修掉三处视觉缺陷（见关键事实 9 / 12 / 13）。

**v0.1 基线已验证**：`tools/live-check.js` 在真实首页与阅读器注入 0 报错，书桌/功能坞正确挂载，沉浸命中 `.readerTopBar` 与 `.readerControls`，色温层生效。

**未验证（需要登录后人工确认）**：v0.3 替换式挂载在登录态真实页面的表现（原生分区被顶掉后的落位、「查看全部」链接真实 href 与去向、「恢复原版」后原生分区复位、Vue 重渲染时序下 unmount 的健壮性）；竖排书名字体回退；书架页 `/web/shelf`；Edge 实机。

---

## 下一轮的起点（候选，未开工）

按价值排序：

1. **真机验收 v0.2**：登录后跑 `tools/live-check.js https://weread.qq.com/web/` 看专属区真实挂载（重点：竖排书名在站点字体环境的回退表现），再按 README 第六节清单过一遍摘录管理。
2. **书架页改造**：需登录后先摸清 `/web/shelf` 结构，再接专属区。
3. **摘录墙的「从正文中摘句」**：目前摘录只能手打；若登录后能拿到划词/目录 DOM，可做「选中即摘」。先摸清站点能力再立项。
4. **Ardot 设计稿**：空白画布已建（https://ardot.tencent.com/file/741974379968982），可把 v0.2 三套首页画成正式设计稿。
5. **进度记录增强**：进度依赖 `[class*="progress"]` 百分比文本，登录后确认能否稳定取到。

---

## 复跑验证

```bash
cd /Users/qin/WorkBuddy/微信/weread-studio

# 1. 语法
for f in $(find src -name "*.js"); do node --check "$f" || echo "FAIL $f"; done

# 2. DOM 桩冒烟（离线，四场景）
node tools/smoke-test.js "$PWD"

# 3. 真实页面注入（需要能访问 weread.qq.com；登录后跑一次验收 v0.2 专属区）
node tools/live-check.js "$PWD" "https://weread.qq.com/web/" /tmp/live-home.png
node tools/live-check.js "$PWD" "https://weread.qq.com/web/reader/ce032b305a9bc1ce0b0dd2a" /tmp/live-reader.png \
  'window.__RK__.reader.apply({enabled:true,readerTone:55,immersive:true,logReading:true})'

# 4. 摘录相关测试
node tools/quote-test.js "$PWD"
node tools/options-test.js "$PWD"

# 5. 静态预览三套主题截图（可选，专属区核对）
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for t in paper gallery pastel gallery-dark pastel-dark; do
  "$CH" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --window-size=1280,1500 --screenshot="/tmp/prev-$t.png" "file://$PWD/preview.html#$t"
done
```

人工验收清单见 `README.md` 第六节。

---

## 约定（下一轮请遵守）

- 站点类名只写在 `src/content/10-adapter.js`；其它文件不得出现 `wr_` / `ranking_` / `home_page` 之类的站点选择器。
- 不要把三套主题改成一套，也不要为了某个主题删掉通用能力。
- 新增 UI 一律进 Shadow DOM，宿主定位写内联样式。
- 用户输入（摘录、书名）只用 `textContent`，不拼 `innerHTML`。
- 关掉开关必须能干净还原：`RK.theme.remove()` + 卸载组件，不留残余样式。
