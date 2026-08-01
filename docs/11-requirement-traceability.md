# 需求实现与验收追踪矩阵

版本：1.0  
盘点日期：2026-08-01
基线：`01-product-requirements.md`、三个独立仓库当前工作树

## 1. 状态定义

| 状态 | 含义 | 是否可发布 |
| --- | --- | --- |
| 自动验证 | 已实现，且已有自动测试、静态检查或产物检查证据 | 该项本身可进入候选 |
| 已实现/待环境验收 | 代码和交互已实现，但必须在微信真机、合法 ROM、PostgreSQL 或裸机上验收 | 验收前不可正式发布 |
| 外部前置 | 依赖主体资质、法律审核、生产凭证、域名或真实运营周期 | 前置完成前不可上线 |
| P2 延期 | 首版范围外，按需求文档延期 | 不阻塞首版 |

“已实现”只表示仓库内存在完整执行路径，不表示真机性能、平台审核或生产可用性已经通过。

## 2. 账号与 ROM

| 需求 | 状态 | 实现与自动证据 | 剩余验收 |
| --- | --- | --- | --- |
| FR-ACC-001 | 自动验证 | App 本地游戏库、播放器、存档均不要求 token；`src/cloud/sync-service.ts` 仅在显式同步时检查登录 | 真机游客全流程 |
| FR-ACC-002 | 已实现/待环境验收 | `CloudClient.login` 调用 `wx.login`；API 服务端交换 code，App 不含 AppSecret | E3 微信真实凭证 |
| FR-ACC-003 | 自动验证 | `library-repository.ts` 首次导入前记录版权确认版本和时间 | 微信弹窗走查 |
| FR-ACC-004 | 已实现/待环境验收 | 设置页首次云登录展示数据类型并要求明确同意 | E6 隐私文本审核 |
| FR-ACC-005 | 自动验证 | 设置页退出；只删除 session token，不删除本地目录 | 真机退出重登 |
| FR-ACC-006 | 已实现/待环境验收 | App 二次确认、删除回执查询；API 删除 job、撤销 session、worker、审计 | E2 PostgreSQL 集成、E3 往返 |
| FR-ROM-001 | 已实现/待环境验收 | `chooseMessageFile` 只选单个 `.gba/.zip`，读取前检查元数据大小 | E4 iOS/Android 微信文件选择器 |
| FR-ROM-002 | 已实现/待环境验收 | 编译期 host allowlist、HTTPS、HTTP 状态、Content-Length、声明长度、SHA-256 全部校验 | E3 合法 request 域名与授权清单 |
| FR-ROM-003 | 自动验证 | 原始 ROM、下载和 ZIP 解压上限均为 32 MiB；文件选择先查 `size` | 大小边界真机回归 |
| FR-ROM-004 | 自动验证 | 扩展名、GBA 头、Logo、header checksum、大小和 SHA-256；异常头需用户确认；单测覆盖 header | E5 损坏 ROM 集 |
| FR-ROM-005 | 自动验证 | ROM ID 为内容 SHA-256，分片路径去重；游戏库可修改显示名称 | 重命名后存档回归 |
| FR-ROM-006 | 自动验证 | 游戏库展示标题、最后游玩、本地存档、云状态、同步时间、失败原因和 ROM 占用 | 视觉与长文本真机走查 |
| FR-ROM-007 | 自动验证 | 删除菜单明确“保留存档”或“同时删除本地存档”，默认项保留 | 真机破坏性操作走查 |
| FR-ROM-008 | 已实现/待环境验收 | 递归重扫、恢复孤儿、移除丢失索引、SHA 校验、损坏文件隔离 | E4 微信文件系统批量回归 |
| FR-ROM-009 | 自动验证 | fflate 单 ROM ZIP；条目数、路径、总大小、压缩比和多 ROM 限制；Vitest 覆盖合法/恶意包 | 大 ZIP 真机内存测试 |
| FR-ROM-010 | P2 延期 | 未实现 IPS/UPS/BPS，符合首版范围 | 后续版本另立设计 |
| FR-ROM-011 | 已实现/待环境验收 | `RomCatalogClient` 从构建时 URL 读取 R2 manifest，15 分钟缓存并在失败时保留 stale 缓存；首页本地数据独立加载 | E9 真实 R2 URL 与断网回归 |
| FR-ROM-012 | 自动验证 | schema、时间、500 项上限、唯一 SHA-256、长度、HTTPS、精确 host 和许可全量校验；Vitest 与发布脚本覆盖 | E6 权利证据人工审核 |
| FR-ROM-013 | 已实现/待环境验收 | `importCatalogItem` 校验 HTTP 200、响应/文件长度、SHA-256、Header 后才原子入库 | E4/E9 真机 R2 下载 |
| FR-ROM-014 | 已实现/待环境验收 | 首页广场支持搜索、分类、精选排序、缓存标识、刷新、安装状态和下载进度 | E4 长文本/弱网视觉走查 |
| FR-ROM-015 | 已实现/待环境验收 | `pages/game` 汇总下载/启动、许可、ROM 身份、累计时长、会话和存档；删除默认保留存档/记录 | E4 详情管理全流程 |

## 3. 模拟、视频、音频与控制

| 需求 | 状态 | 实现与自动证据 | 剩余验收 |
| --- | --- | --- | --- |
| FR-EMU-001 | 已实现/待环境验收 | mGBA 0.10.5 GBA-only WASM；ABI smoke 覆盖加载、帧、视频和 state | E1、E4、E5 CPU/视频/音频/RTC/save matrix |
| FR-EMU-002 | 自动验证 | 播放器只按当前 ROM SHA-256 路径加载 battery save | 20 ROM 交叉污染回归 |
| FR-EMU-003 | 已实现/待环境验收 | 播放器暂停、继续、软复位、安全退出均释放资源并 flush | E4 生命周期走查 |
| FR-EMU-004 | 已实现/待环境验收 | page hide/unload、音频中断均暂停并保存 | E4 后台、来电、音频抢占 |
| FR-EMU-005 | 自动验证 | `InputBitmap.clear` 和 pause/hide/error 路径统一清键；单测覆盖 | 多指真机回归 |
| FR-EMU-006 | 已实现/待环境验收 | 帧循环 catch 后停止运行、清键、暂停音频、记录 `CORE_RUNTIME` 并尝试 flush | E5 故障注入和崩溃 ROM |
| FR-EMU-007 | 已实现/待环境验收 | 2x/3x/4x 多帧执行，快进自动静音 | E4 热量、帧率、音画行为 |
| FR-EMU-008 | 已实现/待环境验收 | 自动帧跳过默认关闭，仅减少 present，不减少模拟帧 | E4 低端机负载测试 |
| FR-EMU-009 | 已实现/待环境验收 | 系统时间大幅回拨检测、暂停、告警和诊断记录 | E4 RTC ROM 与时间变更 |
| FR-VID-001 | 自动验证 | Core 固定 240 x 160；Canvas 与 CSS 保持 3:2 | 多尺寸截图比对 |
| FR-VID-002 | 已实现/待环境验收 | 竖屏画面在控制区上方，landscape media query 居中布局 | E4 横竖屏设备矩阵 |
| FR-VID-003 | 已实现/待环境验收 | 使用 safe-area inset，播放器工具和控制区有响应式约束 | E4 刘海、圆角、胶囊按钮 |
| FR-VID-004 | 已实现/待环境验收 | 设置 `sharp/smooth`，启动 Canvas 时设置 image smoothing | E4 像素截图验证 |
| FR-VID-005 | 自动验证 | FPS 诊断开关默认关闭 | 真机读数校准 |
| FR-VID-006 | 已实现/待环境验收 | 截图先存小程序目录，用户再次确认后调用相册 API | E4 相册授权拒绝/允许 |
| FR-AUD-001 | 已实现/待环境验收 | 用户点击开始后初始化 WebAudio；失败可继续静音运行 | E4 iOS/Android WebAudio |
| FR-AUD-002 | 自动验证 | 0-100 音量和声音开关；AudioOutput 单测验证增益 | 真机音量主观测试 |
| FR-AUD-003 | 已实现/待环境验收 | 后台暂停音频，回前台仍需用户继续 | E4 生命周期测试 |
| FR-AUD-004 | 自动验证 | 有界音频队列不阻塞核心，并累计 underrun/overflow；Vitest 覆盖 | E4 长时间计数趋势 |
| FR-AUD-005 | 已实现/待环境验收 | low-latency/stable 两档，在下一次播放器实例生效 | E4 延迟与稳定性对比 |
| FR-CTL-001 | 自动验证 | 虚拟控制包含 D-pad、A/B、L/R、Start/Select | E4 触控走查 |
| FR-CTL-002 | 自动验证 | 方向源按触点坐标更新，可滑动换向和组合斜向；输入位图单测 | E4 拇指滑动测试 |
| FR-CTL-003 | 自动验证 | 控件按 source 合并位图，支持多点并发；输入单测覆盖 | E4 三指及以上组合 |
| FR-CTL-004 | 自动验证 | touch end/cancel、hide、pause 和 error 全部释放对应 source/全量输入 | E4 中断手势 |
| FR-CTL-005 | 已实现/待环境验收 | 控制面 CSS 禁止 touch action/滚动，页面未开启下拉刷新 | E4 边缘滑动测试 |
| FR-CTL-006 | 已实现/待环境验收 | 大小、间距、透明度滑杆和恢复默认；位置由三套预设控制 | E4 最小/最大布局 |
| FR-CTL-007 | 已实现/待环境验收 | 左手、右手、横屏预设 | E4 横竖屏拇指可达性 |
| FR-CTL-008 | 已实现/待环境验收 | 震动开关；API 失败被吞掉并静默降级 | E4 支持/不支持设备 |
| FR-CTL-009 | 已实现/待环境验收 | 独立工具栏提供暂停、状态保存/载入和退出，不复用 GBA 位图 | E4 菜单期间不误触 |

## 4. 本地存档与状态

| 需求 | 状态 | 实现与自动证据 | 剩余验收 |
| --- | --- | --- | --- |
| FR-SAVE-001 | 自动验证 | 核心 dirty generation 变化后 5 秒防抖写入 | E4 强杀时间窗 |
| FR-SAVE-002 | 已实现/待环境验收 | hide 和安全退出立即 flush | E4 后台/退出故障注入 |
| FR-SAVE-003 | 自动验证 | atomic writer 使用 current、previous、临时文件；失败回滚 | 文件系统故障真机验证 |
| FR-SAVE-004 | 自动验证 | 正文回读并校验长度/SHA 后才写 manifest；repository 测试覆盖 | 磁盘不足测试 |
| FR-SAVE-005 | 自动验证 | current 损坏时仅在 previous 正文和 manifest 同时通过时恢复并提示 | 真机手工破坏测试 |
| FR-SAVE-006 | 已实现/待环境验收 | 游戏管理菜单支持首次/覆盖导入 `.sav`，存档页支持导出/覆盖导入；覆盖会保留 previous | E4 分享文件和不同容量 `.sav` |
| FR-SAVE-007 | 已实现/待环境验收 | 运行时大小与 dirty generation 来自 mGBA ABI；外部 `.sav` 进入游戏时由核心校验 | E5 SRAM/Flash/EEPROM 容量矩阵 |
| FR-STATE-001 | 自动验证 | 5 个手动槽和 1 个 auto 槽 | E4 全槽往返 |
| FR-STATE-002 | 自动验证 | manifest 含 ROM ID、core build ID、schema、时间、SHA 和大小 | 跨版本样本检查 |
| FR-STATE-003 | 自动验证 | build ID 不同禁止加载；存档页仍可导出或删除 | Core 升级回归 |
| FR-STATE-004 | 自动验证 | 选槽先暂停；load 前建内存备份，失败则恢复备份并保持安全状态 | 损坏 state 真机测试 |
| FR-STATE-005 | 已实现/待环境验收 | 默认每 60 秒和 hide 创建 auto state，可关闭 | E4 计时/后台测试 |
| FR-STATE-006 | 已实现/待环境验收 | 保存后独立生成 PNG preview，失败只进诊断；列表显示预览 | E4 Canvas 临时文件权限 |

## 5. 云同步、设置、诊断与游玩记录

| 需求 | 状态 | 实现与自动证据 | 剩余验收 |
| --- | --- | --- | --- |
| FR-CLOUD-001 | 自动验证 | 未登录、匿名账户域或未显式开启 `cloudSync` 时队列不上传 | E3 登录状态往返 |
| FR-CLOUD-002 | 自动验证 | 开启云同步后 battery 自动同步；state 由独立 `cloudStateSync` 开关 | E3 双设备测试 |
| FR-CLOUD-003 | 自动验证 | API 从 token 取 user ID，key 为 ROM/kind/slot；客户端不能指定 user ID | E2 跨用户 IDOR 集成测试 |
| FR-CLOUD-004 | 自动验证 | If-Match/base revision、409 冲突、不覆盖；Go service/HTTP 测试 | E2 PostgreSQL 并发事务 |
| FR-CLOUD-005 | 自动验证 | 冲突保存本地/云端正文副本，并展示 revision、设备、时间、大小、checksum | E3 双设备人工决策 |
| FR-CLOUD-006 | 自动验证 | 队列按内部用户 UUID 分文件 atomic 持久化，损坏时校验并回退 `.previous`；指数退避、重连触发和 FIFO 串行执行均有 Vitest 覆盖 | E4 断网/杀进程/恢复及多账号切换 |
| FR-CLOUD-007 | 已实现/待环境验收 | API retention 命令保留最近 10 版或 30 天；条件 PostgreSQL 测试已编写 | E2 裸机数据库执行 |
| FR-CLOUD-008 | 自动验证 | 客户端同时验证 Content-Length、正文长度和 SHA 后才 commit | E3 代理截断故障注入 |
| FR-CLOUD-009 | 已实现/待环境验收 | 单槽、单 ROM 和账号级删除；删除与上传共用互斥锁，先取消队列，失败则恢复；账号删除有状态 | E2/E3 删除、并发上传与 GC 完整链路 |
| FR-CLOUD-010 | 自动验证 | 游戏库/存档页显示状态、最近时间、失败原因、terminal 状态和立即重试 | E3 错误码矩阵 |
| FR-SET-001 | 自动验证 | 登录和刷新响应均返回内部 UUID；设置与同步队列按 UUID 分区，非法 scope 退回匿名且兼容旧设置值；Vitest 覆盖 | E3 多账号切换 |
| FR-SET-002 | 自动验证 | 显示、音频、控制、存档、云同步、隐私/存储分组齐全 | 真机视觉检查 |
| FR-SET-003 | 自动验证 | 存储页分类 ROM、电池、状态、截图、临时、隔离和其他；Vitest 覆盖分类 | E4 文件系统统计 |
| FR-SET-004 | 自动验证 | 缓存只清 temp/export；截图/隔离独立清理；危险删除二次确认 | E4 磁盘不足和误删回归 |
| FR-DIAG-001 | 已实现/待环境验收 | 诊断页显示 App/基础库/设备/Core/FPS/P95/音频计数/最近错误 | E4 真实指标校准 |
| FR-DIAG-002 | 自动验证 | 诊断包限长并脱敏 token、UUID、wx/file 路径和哈希；Vitest 覆盖 | 安全人工复核样本 |
| FR-HIST-001 | 自动验证 | 播放器创建 UUID 会话并写 ROM ID、起止时间、真实运行秒数和结束原因；repository 校验结构 | E4 生命周期真机时间比对 |
| FR-HIST-002 | 自动验证 | pause/background/error/exit 统一 checkpoint；同一 ID upsert，只把未计入秒数增量写入累计时长 | E4 后台与音频中断矩阵 |
| FR-HIST-003 | 自动验证 | `PlayHistoryRepository` 原子保存、current 损坏恢复 previous、双损坏回退、最多 500 项；Vitest 覆盖 upsert/损坏/按 ROM 清理 | 500 项边界测试 |
| FR-HIST-004 | 已实现/待环境验收 | 首页和详情页提供全局/单 ROM 列表、逐条删除和清空，动作不调用 ROM/存档删除 | E4 破坏性操作走查 |

## 6. 非功能需求

| 需求 | 状态 | 当前证据 | 发布门槛 |
| --- | --- | --- | --- |
| NFR-PERF-001 | 已实现/待环境验收 | 帧调度目标 59.7275 FPS，诊断记录平均 FPS | E4 目标设备 >=58 FPS |
| NFR-PERF-002 | 已实现/待环境验收 | 记录最近 300 帧并计算 P95 | E4 普通速度 P95 <=12 ms |
| NFR-PERF-003 | 已实现/待环境验收 | 输入同步更新核心位图，无网络/持久化路径 | E4 触摸到位图 P95 <=35 ms |
| NFR-PERF-004 | 已实现/待环境验收 | 核心实例、RAF、音频和监听器均有销毁路径 | E4 30 分钟内存增长 <=20% |
| NFR-PERF-005 | 自动验证 | WASM 位于 player 分包，首屏主包不引用/加载二进制 | 微信开发者工具包分析 |
| NFR-REL-001 | 自动验证 | atomic writer、previous 双文件和回读校验测试 | E4 磁盘故障注入 |
| NFR-REL-002 | 自动验证 | 云错误只更新队列/状态，本地游玩与 commit 不依赖网络 | E4 飞行模式测试 |
| NFR-REL-003 | 已实现/待环境验收 | 客户端持久 idempotency UUID；服务端数据库记录 request hash | E2 服务重启重放测试 |
| NFR-REL-004 | 外部前置 | health/readiness、systemd、Nginx、备份脚本已提供 | E7 至少一个完整月 SLI/SLO |
| NFR-SEC-001 | 已实现/待环境验收 | App release 拒绝非 HTTPS；Nginx TLS 配置 | E8 有效域名/证书/高端口 |
| NFR-SEC-002 | 自动验证 | token 仅 header/storage；API 日志 route 去标识；诊断脱敏测试 | E3/E8 日志抽检 |
| NFR-SEC-003 | 自动验证 | 鉴权 user scope、客户端 UUID 队列隔离、key 格式、大小、SHA、内容寻址路径和配额 | E2 IDOR/配额集成测试 |
| NFR-SEC-004 | 已实现/待环境验收 | API 不接收用户 ROM；App 只下载运营方 R2 manifest 中有许可且 hash/长度通过的对象，用户私有 ROM 保持本地 | E6/E9 目录权利与对象审计 |
| NFR-SEC-005 | 已实现/待环境验收 | 删除 job 可重试、可查询、完成审计、延迟 blob GC | E2 完整删除演练 |
| NFR-MNT-001 | 自动验证 | `minigba-core`、`minigba-app`、`minigba-api` 为三个独立 Git 仓库 | 发布 commit 记录 |
| NFR-MNT-002 | 自动验证 | ABI 1 显式导出；WASM 检查禁止 pthread/SDL/DOM/IDBFS 私有依赖 | E1 Ubuntu 重建 |
| NFR-MNT-003 | 自动验证 | PostgreSQL 只通过 `internal/database/migrations` 版本化迁移 | E2 空库升级/回滚演练 |
| NFR-MNT-004 | 已实现/待环境验收 | npm lock、go.sum、mGBA commit、Node/Go/emsdk 版本锁定；三仓库发行守卫 | E1/E8 干净裸机重复构建 |

## 7. 外部验收门槛

| 编号 | 必需输入或环境 | 完成证据 |
| --- | --- | --- |
| E1 | Ubuntu 22.04 x86_64 裸机，不是 VM/容器/WSL | Core native CTest、WASM rebuild/hash、API race 全通过 |
| E2 | Ubuntu 22.04 裸机上的专用 PostgreSQL `_test` 数据库 | 条件集成测试无 skip，迁移、保留、删除、GC、重启幂等通过 |
| E3 | 真实微信 AppID/AppSecret、合法 HTTPS request 域名和发布私钥 | 登录、上传、下载、409、历史、删除端到端证据 |
| E4 | iOS/Android 各至少三档真实设备 | 30 分钟、横竖屏、多点、WebAudio、后台、强杀、断网矩阵 |
| E5 | 至少 20 个来源和许可证可追溯的 homebrew/测试 ROM | CPU、视频、音频、RTC、SRAM、Flash、EEPROM 报告 |
| E6 | 上线主体、地区和类目对应的法律/平台审核 | 隐私政策、用户协议、ROM 权利、许可证和审核结论 |
| E7 | 生产或等价环境的持续观测周期 | 月度 API 可用性 >=99.9% 的 SLI 报告 |
| E8 | 合规裸机、域名、证书、空闲高端口和备份目标 | 部署/回滚/恢复 smoke、最终 URL 和监控告警 |
| E9 | Cloudflare R2 `rom` 桶真实自定义域名、Public access、对象清单及微信 download/request 合法域名 | Dashboard 双人复核、远程 manifest 校验、对象 SHA-256、iOS/Android 下载和下架回滚证据 |

## 8. 当前阻塞结论

已提供的 `192.168.31.26` 是 Ubuntu 22.04.5，但宿主被识别为 VMware，且存在高磁盘/Swap 占用和既有容器服务。项目约束禁止虚拟化，因此未对该机器做安装、迁移、服务配置或端口占用。它不能作为 E1、E2 或 E8 的完成证据，也不能产生合规可访问地址。

正式发布判定仍遵循：所有 P0 已实现不等于已验收；E1-E6、E8 和 E9 未完成时禁止对外发布，E7 在上线后持续度量。
