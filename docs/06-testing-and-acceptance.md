# 测试与验收开发文档

版本：1.0  
状态：测试基线  
构建和服务端测试环境：Ubuntu 22.04 LTS 裸机

## 1. 测试目标

- 证明定制 mGBA WASM 在真实微信 iOS/Android 环境可稳定运行。
- 证明 ROM 隔离、本地存档、状态存档和云同步不会丢失或串写数据。
- 证明网络、后台、内存、磁盘和进程异常都能恢复或明确失败。
- 用可重复数据衡量帧率、输入延迟、音频缓冲和内存，而不是依赖主观试玩。
- 保证 Ubuntu 22.04 裸机可以从源码完成构建、部署、备份和恢复。

## 2. 测试层次

| 层次 | 内容 | 执行位置 |
| --- | --- | --- |
| C 单元测试 | ABI、长度、状态机、存档、输入位图、环形缓冲 | Ubuntu 22.04 Build Host |
| 核心确定性测试 | ROM + 输入序列 + 帧 hash | Ubuntu 22.04 原生及 WASM 测试器 |
| TypeScript 单元测试 | repository、manifest、同步、冲突和平台 mock | Ubuntu 22.04 Build Host |
| Go 单元/集成测试 | API、鉴权、revision、事务、blob、删除 | Ubuntu 22.04 Test Host |
| 契约测试 | 客户端类型与 API/OpenAPI 一致性 | Ubuntu 22.04 Build Host |
| 小程序真机测试 | Canvas、WXWebAssembly、触控、音频、生命周期 | iOS/Android 微信真机 |
| 系统测试 | 小程序到 Ubuntu staging API 的完整流程 | 真机 + Ubuntu 22.04 staging |
| 运维演练 | 发布、回滚、备份、恢复、磁盘和进程故障 | Ubuntu 22.04 staging |

自动化测试不得连接生产数据库、生产 blob 根目录或生产微信 AppID。

## 3. 测试环境

### 3.1 Ubuntu 测试主机

- 与生产相同的 Ubuntu 22.04 大版本和 CPU 架构。
- 直接安装 PostgreSQL、Nginx、Node、Go 和 Emscripten。
- 使用独立 Unix 用户、数据库、端口和 `/srv/minigba-test`。
- 测试完成后只清理精确的 run ID 目录和数据库 schema。
- 不使用容器、WSL 或虚拟机创建临时环境。

### 3.2 微信环境

至少维护：

- development AppID：本地接口和开发验证。
- staging AppID：连接 Ubuntu staging，执行验收和审核预演。
- production AppID：只接受正式构建。

微信合法域名、业务域名和隐私声明按环境分离。生产小程序不得通过设置切换到 development API。

### 3.3 真机矩阵

每个正式版本至少覆盖：

| 平台 | 档位 | 选择标准 |
| --- | --- | --- |
| iOS | 最低支持 | 最老仍在支持范围内的 iPhone/微信版本 |
| iOS | 主流 | 当前主要用户占比设备 |
| iOS | 高端 | 当前高刷新率设备，验证 60 FPS 调度 |
| Android | 低端 | 低内存、较弱 CPU/GPU、主流微信版本 |
| Android | 主流 | 常见中端 SoC 和系统版本 |
| Android | 高端 | 当前高端 SoC，验证性能上限和高刷屏 |

设备清单由真实用户分布季度更新。开发者工具结果不能代替真机结果。

## 4. 测试 ROM 与数据

### 4.1 来源要求

- 只使用自研 homebrew、明确允许再分发的 homebrew、mGBA/硬件诊断测试或项目成员合法自备但不提交仓库的 ROM。
- 仓库内测试 ROM 必须附许可证、来源 URL、SHA-256 和允许用途。
- 商业 ROM 不进入仓库、CI artifact、截图、录屏或缺陷附件。

### 4.2 覆盖集合

测试集合至少覆盖：

- ARM 和 Thumb 指令、异常、中断和 Open Bus。
- 视频模式 0-5、精灵、窗口、blend、DMA 和不同帧负载。
- Direct Sound、PSG、多声道和静音场景。
- SRAM、Flash 64 KiB、Flash 128 KiB、EEPROM 512 B/8 KiB。
- RTC 读取、跨天和设备时间变化。
- 1 MiB、8 MiB、16 MiB、32 MiB ROM。
- 无效 Header、截断、随机数据、超限和恶意 ZIP。

每个测试 ROM 在 `testdata/rom-manifest.json` 记录预期行为，不使用文件名判断测试类型。

## 5. C/WASM 测试

### 5.1 ABI 单元测试

- `mgba_wx_abi_version` 与 TypeScript 期望一致。
- 每个 API 在错误生命周期状态返回正确错误码。
- `ptr + len` 溢出、越界、NULL、零长度和未对齐输入被拒绝。
- alloc/free 可重复运行，重复 free 在诊断版本被发现。
- destroy 在未 create、部分 create 和完整 create 后均幂等。

### 5.2 视频

- 固定 ROM、输入和帧数得到稳定 framebuffer hash。
- width/height/stride/format 正确。
- Memory 增长后 TypeScript 视图能重建。
- Canvas 2D 与 WebGL 路径输出抽样像素一致。
- 暂停、恢复和帧跳过不改变核心模拟结果。

### 5.3 音频

- 环形缓冲 wrap-around、空、满、欠载和溢出。
- 固定帧数输出样本数在允许误差内。
- 快进切换后没有旧缓冲导致的延迟播放。
- suspend/resume 后声道、采样率和音量正确。
- 10 分钟音频 hash/统计回归，用于发现全静音和明显破音。

### 5.4 输入

- 10 位按键全部独立测试。
- A+B、L+R、方向+A/B、多触点组合。
- D-pad 滑动方向序列。
- TouchCancel/onHide 后 mask 必须为 0。
- 快速按压不依赖 keydown/keyup 队列顺序。

### 5.5 电池和状态存档

- 各存档类型写入、复制、销毁核心、重新创建和加载后内容一致。
- generation 只在数据变更时递增。
- 错误大小、错误 ROM、截断状态和错误 checksum 被拒绝。
- 状态加载失败不改变原核心可观察状态。
- 不同 build ID 的状态在 TypeScript 层被拒绝。

## 6. 客户端测试

### 6.1 Repository 单元测试

- R2 manifest 版本、生成时间、条目上限、重复 digest、精确长度、HTTPS、host allowlist 和分发许可。
- 目录网络失败回退到最后一次完整验证缓存，并显式标记 stale。
- R2 下载的响应长度、文件长度、SHA-256 和 GBA Header 任一不一致都不得入库。
- ROM hash 与已知向量一致。
- 重复 ROM 不产生第二份文件。
- 同名不同 ROM 产生独立目录。
- 原子提交每个故障点都能恢复 current 或 previous。
- manifest 临时文件、损坏 JSON、丢失正文和 checksum 错误。
- 存储不足时不删除上一成功存档。
- 清缓存不会删除 ROM 或正式存档。
- 同一游玩 session 多次 checkpoint 只生成一条记录，累计时长只增加真实运行增量。
- 游玩记录损坏回退、500 项保留上限、按 ROM 清除和单条删除互不影响存档。

### 6.2 同步队列单元测试

- 同键任务合并为最新 local revision。
- 离线、超时、429、5xx 使用有上限退避。
- 400/401/403/校验错误停止自动重试并显示原因。
- 409 进入冲突状态，不覆盖本地或云端。
- App 被杀后队列从持久文件恢复。
- 上传完成前再次保存会产生后续任务。
- 删除与上传顺序一致且幂等。

### 6.3 UI/交互测试

- 首页 ROM 广场加载、缓存、失败、空目录、搜索、分类筛选、已安装和下载进度状态。
- 本地游戏库空、正常、损坏索引和存储不足状态；目录失败时仍可进入本地游戏。
- 游戏详情在仅目录、已安装、无存档、多存档和有历史记录状态下主动作正确。
- 游玩记录逐条删除、全局清空和按游戏清空不影响累计时长、ROM 与存档。
- 播放器横竖屏、安全区、字体放大和长标题。
- 所有按键触控区域稳定，不因按下改变布局。
- 菜单打开立即暂停，关闭后不自动偷跑。
- 云同步关闭、未登录、离线、冲突、配额不足和服务器故障状态。
- 删除、恢复、导入存档均有正确确认和反馈。

## 7. API 和数据库测试

### 7.1 测试数据库

- 在 Ubuntu Test Host 直接安装的 PostgreSQL 创建专用数据库。
- 每个测试 run 使用唯一 schema 或数据库名，并验证解析后的名称只含受控字符。
- migration 从空库执行，再验证当前版本重复执行幂等。
- 测试账号不是 PostgreSQL 超级用户。

### 7.2 API 功能

- 微信登录成功、无效 code、重复 code、上游超时和限流。
- access token 过期、签名错误、audience 错误和 session 撤销。
- 首次上传、幂等重试、同 checksum、新 checksum、错误 base revision。
- 下载 header、正文长度、checksum、ETag 和私有缓存策略。
- 历史恢复创建新 revision，不改写旧版本。
- 单存档、ROM 级、账号级删除。
- 用户 A 无法列出、下载、覆盖或删除用户 B 数据。

### 7.3 事务和文件故障

在可注入 repository 接口中模拟：

- 临时文件创建失败。
- 写到一半磁盘满。
- checksum 不一致。
- blob rename 失败。
- 数据库事务提交失败。
- 进程在 blob 提交后、数据库提交前退出。
- 垃圾回收与上传并发。

测试结束后运行引用一致性检查，确认没有错误引用和提前删除。

### 7.4 并发

- 同用户同存档 20 个并发上传，只允许一个 base revision 成功。
- 相同 Idempotency-Key 相同请求返回相同结果。
- 相同 key 不同正文返回幂等键冲突。
- 不同用户、不同 ROM 不因全局锁互相阻塞。

## 8. 端到端测试用例

| 用例 ID | 场景 | 关键预期 |
| --- | --- | --- |
| `TC-ROM-001` | 导入合法 `.gba` | 创建唯一 ROM ID，可进入游戏 |
| `TC-ROM-002` | 同 ROM 不同文件名 | 不重复占用，仍匹配原存档 |
| `TC-ROM-003` | 同名不同 ROM | 两个独立条目和存档目录 |
| `TC-ROM-004` | 32 MiB 边界/超限 | 边界接受，超限在完整读取前拒绝 |
| `TC-ROM-005` | R2 manifest 含重复 hash、错误 host 或缺少许可 | 拒绝整个新目录，保留已验证缓存 |
| `TC-ROM-006` | R2 ROM 内容与 manifest 不一致 | 不写入正式 ROM 或本地索引 |
| `TC-ROM-007` | R2 目录离线后打开首页 | 广场标记缓存，本地游戏和存档可用 |
| `TC-EMU-001` | 30 分钟普通运行 | 无崩溃，达到性能门槛，无持续增长 |
| `TC-EMU-002` | 后台 30 秒再返回 | 暂停、清键、音频可恢复、进度未丢失 |
| `TC-CTL-001` | D-pad 滑动 + A/B | 方向连续，多点同时生效，无卡键 |
| `TC-SAVE-001` | 游戏内保存后强杀微信 | 重开后恢复最后成功电池存档 |
| `TC-SAVE-002` | 存档写入时磁盘不足 | current/previous 至少一份有效 |
| `TC-STATE-001` | 创建并加载 5 个槽 | 每槽独立，截图不影响正文 |
| `TC-STATE-002` | 核心升级后加载旧状态 | 不兼容时明确拒绝，电池存档可用 |
| `TC-HIST-001` | 运行、暂停、后台、继续、退出 | 只累计真实运行秒数，同一会话无重复 |
| `TC-HIST-002` | 删除会话明细 | ROM、累计时长和全部存档保持不变 |
| `TC-CLOUD-001` | 设备 A 上传、B 恢复 | hash 匹配，B 获得相同 `.sav` |
| `TC-CLOUD-002` | A/B 离线修改后同步 | 产生冲突，不静默覆盖 |
| `TC-CLOUD-003` | 上传响应丢失后重试 | 幂等，不产生重复 revision |
| `TC-CLOUD-004` | 下载中断 | 本地 current 不变，任务可重试 |
| `TC-SEC-001` | 修改 romId 访问他人存档 | 返回统一 404，无内容泄露 |
| `TC-DEL-001` | 删除账号 | 会话撤销，任务可查询，数据按策略清除 |
| `TC-OPS-001` | API 发布失败 | 自动/手动回切上一 release |
| `TC-OPS-002` | 从备份恢复 | checksum 和引用一致，RTO/RPO 达标 |

## 9. 生命周期和故障测试

必须执行：

- Home 键、锁屏、微信前后台切换、系统来电/音频打断。
- 网络 Wi-Fi/蜂窝切换、断网、弱网、高延迟和重复请求。
- 微信进程被系统回收、用户主动结束、小程序更新。
- 服务端 API restart、Nginx reload、PostgreSQL restart。
- blob 盘只读、磁盘 95%/100%、inode 耗尽。
- 设备时间前进/回拨、跨时区、RTC 跨天。
- Canvas context 丢失、WebAudioContext suspended/interrupted。
- 微信内存告警和 WASM 分配失败。

每个故障必须记录预期的数据状态、用户提示和恢复步骤。

## 10. 性能测试方法

### 10.1 条件

- 使用 Release WASM、小程序 staging 构建和真实微信客户端。
- 关闭开发调试器、FPS 浮层之外的额外日志。
- 记录设备、系统、微信、基础库、小程序和 core build ID。
- 每次测试预热 2 分钟，采样至少 10 分钟。
- 分别测试冷机和连续运行后的热状态。
- 不用充电状态作为唯一结果，记录低电量模式和温度影响。

### 10.2 指标

- core frame time P50/P95/P99。
- present time P50/P95/P99。
- 实际 executed/presented/dropped frame 数。
- 触摸回调到 key mask 写入时间。
- 音频 queued frames、欠载、溢出和恢复次数。
- JS heap/WASM memory/进程总内存可观测值。
- ROM 加载、save commit、state create/load 时延。
- 30 分钟内存高水位和结束时相对增长。

### 10.3 通过标准

- 平均 FPS >= 58，P95 frame time <= 20 ms。
- 输入路径 P95 <= 35 ms。
- 30 分钟音频欠载 <= 1 次，无持续爆音。
- 30 分钟内存相对稳定，预热后增长 <= 20%。
- 进入后台后 1 秒内停止帧执行和音频输出。
- 64 KiB 电池存档本地提交 P95 <= 100 ms；较大存档按大小线性评估。

最低档 Android 达不到标准时，必须在 POC 闸门决定提高最低设备要求、启用 WebGL 路径或停止项目；不能用隐藏帧率下降掩盖。

## 11. 安全测试

- 依赖漏洞、许可证、secret 和 SBOM 扫描。
- Go 静态检查、C 编译警告和 TypeScript 严格检查。
- 恶意长度、随机 ROM、畸形 ZIP、路径穿越和压缩炸弹。
- IDOR、token 篡改、会话撤销、重放和 revision 竞争。
- 超大 body、慢速上传、连接耗尽和 rate limit。
- 日志及诊断包敏感信息扫描。
- systemd 权限验证：服务进程不能写 `/etc`、程序 release 和其他用户目录。
- 备份权限、加密、恢复隔离和密钥轮换演练。

## 12. 发布流水线门禁

每个 commit：

- 格式、lint、TypeScript、Go/C 单元测试。
- API 契约、数据库迁移和核心 ABI 自测。

每个合并请求：

- 受影响领域集成测试。
- 依赖/许可证/secret 扫描。
- 至少一名模块 owner 审查。

每个候选版本：

- Ubuntu 22.04 干净 Build Host 可重复构建。
- staging 数据库从空库迁移及上一生产 schema 升级。
- 完整真机矩阵、30 分钟性能和云同步测试。
- 发布、回滚、备份和恢复 smoke test。
- 小程序包内容和大小检查。

## 13. 缺陷等级

| 等级 | 定义 | 发布策略 |
| --- | --- | --- |
| Blocker | 存档丢失/串档、跨用户读取、无法启动、审核/版权阻断 | 禁止发布 |
| Critical | 高频崩溃、主流设备不可玩、云端静默覆盖 | 禁止发布 |
| Major | 明显性能、音频、布局或单功能失败，有可接受绕行 | 产品负责人书面接受才可发布 |
| Minor | 不影响核心流程的视觉或低频问题 | 可进入后续版本 |

任何存档完整性缺陷至少为 Critical；跨用户授权缺陷一律为 Blocker。

## 14. 验收报告

候选版本报告必须包含：

- release commit、core build ID、WASM SHA-256、API version。
- Ubuntu 22.04 构建主机和工具链版本。
- 真机矩阵及每台设备结果。
- 测试 ROM manifest 版本。
- 功能、性能、安全、备份和恢复结果。
- 所有未关闭 Major/Minor 缺陷及接受人。
- 小程序包大小、隐私 API 扫描和许可证报告。
- 明确声明构建、测试服务和部署未使用容器或虚拟化环境。
