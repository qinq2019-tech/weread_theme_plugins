# 项目进展（跨平台交接）

> 更新时间：2026-11-02 11:40 · 版本 **v0.3.0** · 仓库 `github.com/qinq2019-tech/weread_theme_plugins`
>
> **换电脑、换 AI 平台、隔几周回来，只读这一份就能接上。** 踩坑细节在 `HANDOFF.md`，视觉与交互规格在 `docs/v0.2-design.md`，用户视角说明在 `README.md`。

---

## 一、这是什么

Chrome / Edge 的 MV3 扩展，给**微信读书网页版**（`weread.qq.com`）加一张自己的书桌：三套可切换主题、继续阅读、每日目标、摘录收藏（按书归档 / 就地编辑 / 导出 Markdown）、阅读器护眼色温与沉浸模式。

不联网、不碰账号凭据、不绕付费墙，数据只写本机 `storage.local`。权限只有 `storage` + `weread.qq.com`。

---

## 二、现在到哪一步了

| 阶段 | 状态 | 证据 |
|---|---|---|
| v0.1 首页书桌 / 功能坞 / 设置页 / 阅读器色温与沉浸 | ✅ 线上实测通过 | CDP 注入真实页面，锚点命中、挂载正确、全流程 0 报错 |
| v0.2 三套主题专属区（摘句墙 / 书脊墙 / 读过的日子） | ✅ 代码完成 + 静态核对 | 88 项自动化全绿；`preview.html` 5 张截图逐张核对，修掉 3 处视觉缺陷 |
| v0.2 摘录管理（按书归档 / 就地编辑 / 8 秒撤销 / 导出） | ✅ 代码完成 + 行为测试 | `options-test.js` 30 项覆盖分组、撤销原位插回、导出内容、编辑保存、跨标签同步 |
| v0.2 登录后真机验收 | ✅ 已做，发现布局问题 | 用户实测反馈：组件叠加导致堆积混乱 → 定位为**登录态首页结构与预期不符**（详见 `HANDOFF.md` 关键事实 16） |
| **v0.3 替换式挂载 + 信息去重 + 空态降级** | ✅ 代码完成，**待真机复核** | 97 项自动化全绿（新增替换式挂载/还原/三套空态断言）；`preview.html` 已同步并截图核对 |
| 书架页 `/web/shelf` 改造 | ⬜ 未开工 | 登录后才是客户端渲染，未登录摸不到结构 |
| Edge 实机 | ⬜ 未做 | API 兼容，但没实测 |

代码这边没有已知待修的缺陷。v0.3 改动需要用户在登录态真机复核一次（见下）。

---

## 三、当前卡点：要人操作的 3 步（v0.3 复核）

1. `chrome://extensions` → 找到 `weread-studio` → 点**刷新按钮**（重要：浏览器里跑的还是 v0.2 旧代码，不刷新看不到替换式挂载）。
2. 登录 `weread.qq.com`（根路径首页）。
3. 按下面的清单点一遍，异常截图发回来。

只需要看这 4 处（其余项 README 第六节已覆盖，这 4 个是自动化结构上测不到的）：

| 看点 | 为什么只能人看 |
|---|---|
| 书桌是否**原地占住**原生「继续阅读」分区（等宽等位、原生内容不下推） | 替换锚点 `.wr_index_page_top_section_wrapper` 只在登录态存在，自动化桩测不到真实 Vue 渲染时序 |
| 书桌头部右侧「查看全部 · N 个」链接可点、去向正确 | href 从原生 DOM 现场提取，桩里验证不了真实值 |
| 画廊主题书脊墙独占整行、右下不再有白色题签卡 | 真实字体环境下竖排书名的回退表现 |
| 点「恢复原版」后原生「继续阅读」分区（22 个分类卡）完整回来 | 干净还原铁律；桩验证过逻辑，真机验证 Vue 重渲染时序 |

顺手验「控制台无红色报错」——这个最容易被新代码破坏。

---

## 四、不可改的产品决策

改代码前必须遵守，这些是用户明确拍过的：

| 决策 | 结论 |
|---|---|
| 审美方向 | 用户确认「对味」，方向成立 |
| 主题数量 | **三套全部保留**：`paper` 私人书房 / `gallery` 书架画廊 / `pastel` 轻彩空间。常驻可切换，**不是三选一**，新增功能不得删减任何一套 |
| 专属内容区 | 不是换配色，是换内容气质：不加框（页面上唯一带框的是书桌）、最大字号 17px、三套用三套不同栅格 |
| 摘录管理位置 | 设置页整页承载；功能坞只留快速录入 + 「管理摘录」入口 |
| 摘录字段 | 新增 `book` 字段；老数据（书名在 `source` 里）只读借用不迁移，用户主动保存才落 `book` |
| 删除策略 | 逐条删除**不用 confirm**，立即写 storage + 8 秒单一可累积撤销栈；confirm 只留给「清空数据」 |
| pastel 不做专注计时 | 要么统计非阅读时间、要么与心跳重复计时，两个方向都是造数 |
| 丰富 vs 专注 | 首页 / 书架可丰富，正文阅读保持克制（正文是 canvas，只做色温层） |
| 数据边界 | 全部本地存储；不请求站点接口、不碰账号凭据、不绕过付费墙 |

---

## 五、想改什么，动哪个文件

| 想做的事 | 动这里 |
|---|---|
| 换配色 / 加主题 | `src/shared/palette.js`（3 主题 × 明暗 = 6 个对象，**逐个补齐**）+ `20-theme.js` 的 `TOKEN_MAP` |
| 改首页书桌内容 | `src/content/30-desk.js` 的 `buildDesktop()`，开关在 `deskModules` |
| 改主题专属区 | `src/content/35-wing.js` + `05-ui-css.js` 末尾「主题专属区」分节 + **`preview.html` 同步改**（两份手工联动副本） |
| 改摘录逻辑 | `src/shared/quotes.js`（纯函数层：分组 / 借用规则 / Markdown）+ `src/options/` |
| 站点改版导致失效 | **只改** `src/content/10-adapter.js` 的 `CANDIDATES`，先用弹窗「页面适配诊断」看哪项未匹配 |
| 功能坞按钮 | `src/content/40-dock.js` |
| 阅读器色温 / 沉浸 / 阅读记录 | `src/content/50-reader.js` |
| 启动、SPA 导航、还原 | `src/content/60-boot.js` |
| 加新模块 | 新建 `src/content/XX-xxx.js`，在 `manifest.json` 的 `js` 数组里排在 `60-boot.js` 之前，用 `RK.bus` 收发事件，不改旧代码 |

---

## 六、怎么跑验证

环境：Node **≥ 18**（用了全局 `fetch` 与 `WebSocket`；实测 v22.22.2）。**没有 npm 依赖，没有 `package.json`，不需要 install。**

```bash
cd weread-studio

# 1. 语法检查
for f in $(find src -name "*.js"); do node --check "$f" || echo "FAIL $f"; done

# 2. 三套自动化（离线，应全绿：28 + 30 + 30 = 88 项）
node tools/smoke-test.js   "$PWD"   # 首页挂载 / 还原干净 / 专属区三套各挂一次 / 阅读器 / 陌生页降级
node tools/quote-test.js   "$PWD"   # 摘录借用规则、本地日期、文件名净化、Markdown 逐条规则
node tools/options-test.js "$PWD"   # 设置页真实行为：分组、删除撤销原位插回、导出捕获、编辑、跨标签同步、#quotes 定位

# 3. 真实页面注入（CDP 驱动 headless Chrome；未登录也能跑，验证锚点与挂载）
node tools/live-check.js "$PWD" "https://weread.qq.com/web/" /tmp/live-home.png
node tools/live-check.js "$PWD" "https://weread.qq.com/web/reader/ce032b305a9bc1ce0b0dd2a" /tmp/live-reader.png \
  'window.__RK__.reader.apply({enabled:true,readerTone:55,immersive:true,logReading:true})'

# 4. 静态预览截图（可选，核对专属区）
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for t in paper gallery pastel gallery-dark pastel-dark; do
  "$CH" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --window-size=1280,1500 --screenshot="/tmp/prev-$t.png" "file://$PWD/preview.html#$t"
done
```

`live-check.js` 每次用全新临时 profile（`/tmp/rk-live-profile`，启动前会删），所以**天然未登录**——它验不了登录态的东西，别指望它代替人工验收。

---

## 七、改代码前最容易踩的 3 条（全 15 条见 `HANDOFF.md`）

1. **宿主元素必须用内联样式定位**。Shadow 样式表里的属性选择器选不到宿主（只能用 `:host`）。这个坑当初让功能坞变成静态元素被挤到页面底部。
2. **hash 必须用无符号右移 `h >>> 3`**。`hashName` 返回 `>>>0` 的 32 位数，带符号 `>>` 会让 hash ≥ 2³¹ 的书取档成 `undefined`，书脊直接丢宽高——截图上只表现为「书脊稀疏」，极难从视觉反推。
3. **`palette.js` 漏填令牌不报错**。`apply()` 有 `if (tokens[key])` 守卫，漏了只会静默漏色；新令牌必须在 6 个对象里逐个补齐，改完三套 × 两态肉眼切 6 次。

---

## 八、下一步优先级

| 优先 | 候选 | 价值 | 前置条件 |
|---|---|---|---|
| P0 | 真机复核 v0.3（替换式挂载 + 还原） | 唯一阻塞项，过了才算 v0.3 收尾 | 人登录点一遍（见第三节） |
| P1 | 书架页 `/web/shelf` 改造 | 覆盖缺口最大的一块 | 登录后先摸真实 DOM，再往 `10-adapter.js` 加 CANDIDATES |
| P2 | 从正文中摘句（选中即摘） | 现在摘录只能手打，这是体验断层 | 先确认登录后能否拿到划词 DOM；拿不到就是造需求，别立项 |
| P2 | Ardot 正式设计稿 | 三套首页画成正式稿 | 不依赖登录，随时能开工；空白画布 `https://ardot.tencent.com/file/741974379968982` |
| P3 | 进度记录增强 | 进度依赖 `[class*="progress"]` 文本 | 登录后确认能否稳定取到 |

---

## 九、新环境接手 5 步

```bash
git clone git@github.com:qinq2019-tech/weread_theme_plugins.git weread-studio
cd weread-studio && node -v && node tools/smoke-test.js "$PWD"
```

1. **clone** —— 仓库根目录就是扩展根（`manifest.json` 在根），不用再进子目录。
2. **跑测试** —— 三套全绿说明代码完好，可以放心改。
3. **装扩展** —— `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选仓库根目录。
4. **登录** `weread.qq.com`，右下角出现圆钮即成功，然后按第三节 / README 第六节验收。
5. **改完推送** —— `git add -A && git commit -m "..." && git push`（SSH 已配好，`main` 跟踪 `origin/main`）。

---

## 十、给新会话的开场白（直接粘）

```
接手一个 Chrome/Edge MV3 扩展项目：微信读书网页版增强（三套主题 + 首页书桌 + 摘录管理 + 阅读器色温）。
仓库根目录就是扩展根。先读 PROJECT-STATUS.md 摸清现状，再读 HANDOFF.md 的「关键事实」15 条（都是踩过的坑，
不要重复试错），需要改视觉/交互细节时读 docs/v0.2-design.md。

硬约束：三套主题（paper/gallery/pastel）全部保留，不是三选一；站点类名只准写在 src/content/10-adapter.js；
新增 UI 一律进 Shadow DOM 且宿主定位写内联样式；用户输入只走 textContent；关掉开关必须干净还原。

动手前先跑 node tools/smoke-test.js / quote-test.js / options-test.js 确认 88 项全绿，改完再跑一遍。
当前卡点是登录后真机验收，未经我确认不要动 v0.2 已交付的交互。
```

---

版本 0.2.0 · 本文件随每次交付更新
