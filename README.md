# qq-moments · QQ空间说说 Skill

通过**手机 QQ 扫码登录**，自动化发布 QQ空间说说（文字 / 图片 / 权限），并可查看好友动态。

> ⚠️ 仅供**个人自动化自己的账号**使用。自动化操作可能违反腾讯服务协议，**风险自负**。请勿用于批量、骚扰或他人账号。

---

## ✨ 功能

| 模块 | 能力 | 状态 |
|------|------|------|
| 登录 | 手机扫码登录、二维码失效自动换、cookie 持久化、登录态检查 | ✅ |
| 发说说 | 纯文字（单行 / 多行）、单图 / **多图**、权限（公开 / 好友 / 私密）、`--dry-run` 预览、返回 tid+链接、临时图自动清理 | ✅ |
| 配图 | ① 找现成图（Wikimedia 免 key）② AI 生图（OpenAI 兼容，可选）③ 本地 SVG 插画兜底 | ✅ |
| 好友动态 | 动态流、好友列表、查看某人说说 | ✅ |
| 删除说说 | | ⏳ 未完成 |
| 点赞 / 评论 | | ⏳ 未完成 |

---

## 📦 环境要求

- Node.js 18+（依赖内置 `fetch`）
- 本机安装 **Microsoft Edge 或 Google Chrome**（自动查找；可用 `QZONE_BROWSER` 指定路径）

## 🚀 安装

```bash
npm install
```

---

## 🧭 使用

### 1. 登录

```bash
node scripts/login.mjs --login     # 扫码登录（已登录会跳过）
node scripts/login.mjs --status    # 检查登录态
node scripts/login.mjs --logout    # 清除本地登录数据
```

### 2. 发说说

```bash
# 预览（不发布）
node scripts/publish.mjs --text "文案" --visibility 公开 --dry-run

# 发布（纯文字）
node scripts/publish.mjs --text "文案" --visibility 公开

# 发布（多行文案 + 多图）
node scripts/publish.mjs --text-file 文案.txt --image a.jpg --image b.png --visibility 公开
```

- `--visibility`：`公开`（所有人可见）/ `好友` / `私密`
- `--image`：可重复，传本地图片路径（png/jpg 均可）
- `--text-file`：多行文案从文件读，避免命令行换行问题
- 发布的临时图（放在 `.qzone/incoming/`）**成功后自动清理**

### 3. 配图管线

```bash
node scripts/image.mjs --find "<关键词>"     # ① 找现成图（Wikimedia 免 key；配了 Pexels/Unsplash/Pixabay key 则优先）
node scripts/image.mjs --generate "<提示词>"  # ② AI 生图（需先 --ai-enable）
node scripts/image.mjs --svg "<意境关键词>"   # ③ 本地兜底插画（无需 key）
node scripts/image.mjs --ai-enable --key <K> [--provider openai --base <URL> --model <M>]
node scripts/image.mjs --ai-disable
node scripts/publish.mjs --cleanup            # 手动清理临时图
```

### 4. 好友动态

```bash
node scripts/feed.mjs --tab 好友动态 --count 20   # 动态流（tab: 好友动态/特别关心/与我相关/那年今日）
node scripts/feed.mjs --friends                   # 好友列表（昵称 ↔ uin）
node scripts/feed.mjs --friend <uin>              # 查看某位好友的说说
```

---

## 📁 目录结构

```
qq-moments-skill/
├─ SKILL.md              技能说明 + agent 工作流
├─ README.md             本文件
├─ package.json
├─ scripts/
│  ├─ login.mjs          扫码登录
│  ├─ publish.mjs        发说说
│  ├─ image.mjs          配图管线
│  ├─ feed.mjs           好友动态
│  ├─ delete.mjs         删除说说（未完成）
│  └─ lib/png-ascii.mjs  零依赖 PNG → 终端二维码
└─ .qzone/               （gitignore）本地数据
   ├─ session.json       登录态 cookie
   ├─ config.json        配图配置（找图来源 / AI key）
   ├─ state.json         当前扫码会话
   └─ incoming/          临时配图
```

---

## ⚙️ 原理（简述）

- **登录**：ptlogin2 扫码（`ptqrshow` / `ptqrlogin`）→ 无头浏览器访问 `check_sig` 落地 → 收 `p_skey` 等 cookie → 存 `session.json`。
- **发布**：图片经 `cgi_upload_image`（`picfile`=base64）拿 `albumid/lloc/bo` → `emotion_cgi_publish_v6`（`richval`/`pic_bo`）发布。
- **权限**：`ugc_right` = `1` 公开 / `2` 好友 / `64` 私密。
- **浏览器仅在**：①登录落地 ②抓好友动态流（并**写回 cookie**）时使用；其余全是纯 HTTP。

---

## 🔐 安全

- `.qzone/` 已加入 `.gitignore`（含 cookie / 配置 / AI key），**不会提交、不会上传**。
- 本地**不保存账号密码**，只保存登录态。

## ⚠️ 已知问题

1. **登录态寿命偏短**：实测约 **20 小时**失效一次（原因待查）。失效后重新 `--login` 即可。
2. **删除 / 点赞 / 评论**：接口未打通，暂不可用。

## 📄 许可

MIT
