# 当前验证报告

报告日期：2026-08-02。

## 1. 已完成证据

### Core

- mGBA 0.10.5 固定为 Git submodule commit `26b7884bc25a5933960f3cdcd98bac1ae14d42e2`。
- WXWebAssembly 产物大小 `505983` 字节，SHA-256 `e187175cf04cd105c379727f2bf4a65185045e29da41ba09239b1d51d3d5b79f`。
- 导入仅为 `emscripten_notify_memory_growth` 及 5 个受控 WASI 系统调用；没有 pthread、共享内存、SDL、DOM 或 IDBFS。
- Node WASM smoke 已验证 ABI 1、ROM 加载、单帧、240 x 160 RGBA 和 `397312` 字节状态写入/恢复。
- Core 发行脚本已生成确定性 build metadata、CycloneDX SBOM，并随产物携带 MiniGBA/Apache、mGBA/MPL 和固定上游记录；元数据生成器以同一 WASM 验证通过。

### App

- TypeScript typecheck、ESLint、Vitest 和 Taro 4.2.1 weapp production build 通过。
- 微信开发者工具 2.01.2510290 暴露的 WXSS 通配选择器兼容问题已修复；生产构建现在自动扫描全部生成 WXSS，并在发现不受支持的通配选择器时阻断。
- 开发者工具的 `3.17.0` 基础库缓存曾出现下载不完整和 MD5 校验失败，导致模拟器在业务代码执行前返回 HTTP 500。工程现固定并构建校验 `libVersion: 3.16.1`；开发者工具重新完整下载该版本后，普通模式冷启动日志记录 `mainframe?v=3.16.1`、`finish load user code` 和 `webview page ready`，且不再出现 500、MD5、WXSS 或路由超时。
- 游客模式中的 `webapi_getwxaasyncsecinfo:fail` 和 `WAServiceMainContext timeout` 来自开发者工具安全服务限制，调用栈不包含 App 模块；必须登录开发者工具并使用有权限的真实 AppID 才能消除。Chromium 的 SharedArrayBuffer deprecation 是模拟器内核提示；当前 Core 不导入共享内存或 pthread，不属于本项目运行错误。
- `project.config.json` 和生成的 `dist/project.config.json` 已固定并校验 AppID `wx4a8213e3dfa88565`；上传脚本会拒绝与项目配置不一致的 `MINIGBA_WECHAT_APP_ID`。AppSecret 未进入 App 源码、构建常量或产物。
- 16 个测试文件、58 个测试通过；语句覆盖率 `63.53%`、分支 `58.05%`、函数 `65.26%`、行 `78.00%`。R2 schema v2 测试覆盖相对 URL、host allowlist、重复 catalog ID/object key、URL 与 object key 一致性、可选许可、无预置 digest、缓存回退，以及远端关闭时 981 项内置目录零请求启动；本地内容 ID、输入、ZIP、存档、云同步、诊断和游玩计时测试继续通过。
- 已实现 R2 ROM 广场、目录缓存/刷新、搜索分类、下载进度、游戏详情、真实运行区间计时、逐次游玩记录，以及原有授权下载、ROM 重扫/隔离、ZIP 安全限制、`.sav` 导入、状态预览、截图、快进、音频、控制、存储、诊断和云同步管理。
- 内置 981 项目录后，主包及非播放器页面 `879298` 字节；播放器分包 `542094` 字节；运行产物总计 `1421392` 字节，仍低于微信主包 2 MiB 限制。SBOM、许可证表和审计 JSON 位于忽略的 `artifacts/reports/`，不会进入微信上传根目录。
- 分包 WASM 摘要与 Core 候选一致。
- `TARO_APP_API_BASE_URL`、`TARO_APP_ROM_CATALOG_URL`、`TARO_APP_ROM_CATALOG_REMOTE_ENABLED` 和 `TARO_APP_ROM_DOWNLOAD_HOSTS` 均为编译期常量。远端关闭时，启动与强制刷新只读内置 981 项目录且不发送 manifest 请求；远端启用时先验证 schema v2 manifest。客户端校验目录 ID/object key、URL、精确长度和 GBA Header，不要求或比对预置 ROM SHA-256。

### Cloudflare R2

- Chrome 已实际核对 `rom` bucket：APAC、Dashboard 总大小 `9.74 GB`、公开访问已启用，自定义域名 `rom.sid.mom` 正常，R2.dev 已启用，CORS 为空。
- `gba/` 完整对象接口返回 981 个 `.gba`，合计 `7,725,253,970` 字节；key 和 ETag 均无重复，HTTP/custom metadata 均为空。
- 现有公开对象 `HEAD` 返回 200；`https://rom.sid.mom/catalog/v1.json` 和预定 schema v2 目录在上传前均不存在。
- 已生成 `minigba-app/catalog.r2.json`：981 项、schema v2、约 479 KB，使用 catalog ID/object key/ETag/精确大小而非 SHA-256；本地发布校验通过。
- App 启动时刷新仍有效的云会话并重新绑定内部用户 UUID，再处理该 UUID 专属的持久化同步队列；匿名态不处理任何队列，401 会清除失效 token，账户切换不会消费其他账户的待同步任务。
- 云端单槽/单 ROM 删除与同步上传共用 FIFO 互斥锁：先撤销命中的待上传任务，再执行远端删除；远端失败时恢复任务，避免删除成功后被并发上传重新创建。
- `npm audit --omit=dev` 当前报告 20 个依赖图发现（critical 3、high 8、moderate 8、low 1）。根因包含 Taro 4.2.1 当前依赖的 Swiper 11.1.15 和构建工具链；微信产物不包含第三方 Swiper JS runtime。`SECURITY-EXCEPTIONS.md` 与发行门禁只允许已审查包名，并于 2026-10-31 到期；新发现或过期会阻断发布。

### API

- `go vet ./...`、`go test -cover ./...` 和 Windows 辅助构建通过。
- 配置测试覆盖生产 AppID/AppSecret 格式、secret 文件读取和非法凭证拒绝；Ubuntu 上的凭证文件还必须是普通文件且 other 权限为 0，错误信息不包含 secret 值。
- HTTP 测试覆盖登录、鉴权、上传前置条件、刷新、版本列表、删除请求和删除状态。
- 实现 revision、幂等键、内容寻址 blob、配额、历史恢复、冲突、逻辑删除、账号删除 worker、历史保留、过期会话/幂等记录清理和延迟 blob 回收。
- PostgreSQL 条件集成测试已经加入并编译通过，覆盖 11 次版本提交、保留清理、软删除清理、blob 引用计数、过期记录清理和账号删除。当前因没有合规裸机测试数据库而明确跳过；发布脚本强制要求名称以 `_test` 结尾的专用数据库，不能把跳过结果作为候选发布证据。
- OpenAPI 3.1 文件已完成 YAML 解析验证。
- 登录与刷新契约均返回内部 `userId` UUID，以隔离客户端账号设置和同步队列，并有 HTTP 回归断言；API 发行包新增离线 `go.mod` 解析 SBOM、许可证表、build info 和全文件 checksum。

### 发布约束

- 三个发布守卫都会拒绝非 Ubuntu 22.04、VM、Docker/LXC 容器和 WSL。
- Core WASM、App 候选构建和 API release 构建都会拒绝脏 Git 工作树。
- 当前三个独立仓库 HEAD 分别为 Core `5045490add4e9691d1c005aeb84c9886d2489536`、App `c65d25d193fd9ed2c943f249a39cf29137a660ec`、API `962e0bbbe26a82d1001ba62fb68e5bc468d1e859`，工作树均为空且 `git fsck` 通过。
- `11-requirement-traceability.md` 已逐项覆盖产品文档中的全部 101 个 FR/NFR 标识，并区分自动验证、待环境验收、外部前置与 P2 延期。

## 2. 仍需外部环境完成

以下项目不能用 Windows 开发机或虚拟化替代，因此不标记为通过：

- Ubuntu 22.04 裸机上的 native C/CTest、Go race 和 PostgreSQL 集成测试。
- 已配置 AppID 对应的服务端 AppSecret 凭证文件、合法 request 域名和上传私钥下的登录/上传。
- 将 `catalog.r2.json` 上传为 `https://rom.sid.mom/catalog/v2/roms.json`，配置微信 request/download 合法域名，完成 ROM 权利台账和 iOS/Android 真机下载验证。Dashboard、公开域名和对象清单本身已于 2026-08-02 实际核对，不再属于未知项。
- iOS/Android 微信真机的 WXWebAssembly、Canvas、多点触控、音频、后台和 30 分钟稳定性矩阵。
- 微信审核、隐私协议、软件许可和 ROM 导入形态的业务审批。
- 独立备份目标上的加密备份和隔离恢复演练。

## 3. 候选服务器检查结论

提供的候选 Ubuntu 22.04.5 主机被检测为 VMware 虚拟机，并且系统盘和 swap 已处于高占用状态，另有既存容器和服务。项目约束明确禁止虚拟化，因此：

- 未在该主机安装包、创建用户、修改 PostgreSQL/Nginx/systemd 或占用端口。
- 未在该主机运行构建、迁移或部署脚本。
- 2026-08-02 再次尝试只读 SSH 盘点时，主机接受 SSH 握手但拒绝提供的 root 密码认证；本轮没有在该主机写入 AppSecret、环境文件或服务配置。
- 当前没有可以诚实交付的公网/局域网服务 URL。

要完成最终部署和可访问地址，必须提供 Ubuntu 22.04 裸机、未占用的高端口、微信服务端凭证；生产小程序还需要合法 HTTPS 域名和证书。拿到合规宿主后按 `minigba-api/deploy/README.md` 执行，并将最终 URL 与 smoke 结果追加到本报告。
