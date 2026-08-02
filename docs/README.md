# MiniGBA 文档中心

版本：1.0  
状态：实施与验收基线  
更新日期：2026-07-31

## 1. 文档目标

本目录定义 MiniGBA 微信小程序从立项、开发、测试、发布到运维的完整基线。项目目标是在微信小程序中运行用户自行提供或获得合法授权的 GBA ROM，并提供虚拟按键、本地存档、即时状态存档和云存档能力。

本文档集只考虑以下环境：

- 开发、构建、持续集成和服务端部署操作系统：Ubuntu 22.04 LTS x86_64。
- 客户端运行环境：微信小程序，iOS 和 Android 微信客户端。
- 服务端部署方式：Ubuntu 22.04 裸机进程，由 systemd 管理，通过 Nginx 暴露 HTTPS。
- 数据库：Ubuntu 22.04 上直接安装的 PostgreSQL。
- 不允许使用 Docker、Podman、LXC、WSL、虚拟机或其他容器及虚拟化环境。

## 2. 文档导航

| 文档 | 内容 | 主要读者 |
| --- | --- | --- |
| [01-product-requirements.md](./01-product-requirements.md) | 产品目标、角色、用户流程、功能需求、非功能需求和发布验收 | 产品、研发、测试、运营 |
| [02-technical-design.md](./02-technical-design.md) | 总体架构、模块边界、运行时、接口约束和代码结构 | 前端、后端、架构师 |
| [03-emulator-porting.md](./03-emulator-porting.md) | mGBA 到微信 WXWebAssembly 的移植、渲染、音频、输入和调度 | C/WASM、客户端研发 |
| [04-storage-and-cloud-sync.md](./04-storage-and-cloud-sync.md) | ROM、本地文件、数据库、API、云存档和冲突处理 | 客户端、后端、DBA |
| [05-ubuntu-build-deploy.md](./05-ubuntu-build-deploy.md) | Ubuntu 22.04 裸机构建、发布、systemd、Nginx、备份和回滚 | 开发、运维 |
| [06-testing-and-acceptance.md](./06-testing-and-acceptance.md) | 自动化、真机、兼容性、性能、故障和验收测试 | 测试、研发、产品 |
| [07-security-and-compliance.md](./07-security-and-compliance.md) | ROM 版权、隐私、安全模型、供应链和上线检查 | 安全、法务、研发、运营 |
| [08-delivery-plan.md](./08-delivery-plan.md) | 阶段计划、技术闸门、人员、风险、Definition of Done | 项目负责人、全体成员 |
| [09-repository-release-contract.md](./09-repository-release-contract.md) | 三仓库边界、版本兼容矩阵、产物交接和发布顺序 | Tech Lead、发布工程师 |
| [10-validation-report.md](./10-validation-report.md) | 当前实现、自动化证据、外部验收和部署阻断 | 研发、测试、产品 |
| [11-requirement-traceability.md](./11-requirement-traceability.md) | 每个 FR/NFR 的实现、自动证据与真机、裸机、合规门槛 | 产品、研发、测试、发布 |
| [12-r2-rom-catalog.md](./12-r2-rom-catalog.md) | 真实 Cloudflare R2 的 981 项 GBA 清单、schema v2、无预置 SHA-256 流程、微信域名、发布与回滚 | 客户端、发布、运营、安全、法务 |

## 3. 约束优先级

约束冲突时按以下顺序处理：

1. 法律、版权、微信平台和隐私合规要求。
2. 数据完整性，任何性能优化不得以存档损坏风险为代价。
3. 真机稳定性和可恢复性。
4. 输入延迟、画面和音频体验。
5. 功能丰富度和视觉效果。

## 4. 产品边界

首个正式版本包含：

- 导入、校验、管理和启动 GBA ROM。
- 240 x 160 原生画面输出、横竖屏适配和像素整数缩放优先策略。
- 十字键、A、B、L、R、Start、Select 以及快捷菜单。
- SRAM、Flash、EEPROM 电池存档。
- 手动和自动即时状态存档。
- 微信登录、跨设备云存档、历史版本和冲突副本。
- 设置、诊断、隐私、存储占用和数据导出/删除。

首个正式版本不包含：

- 商业 ROM 商店、搜索、分享或下载服务。
- 官方 GBA BIOS 分发。
- 联机线缆、多人联机、金手指、倒带和传感器模拟。
- GB/GBC、NDS 或其他主机核心。
- H5、支付宝、抖音、React Native 或桌面端发布。

## 5. 核心决策

- Taro 只负责微信小程序页面、业务状态和平台 API 适配，不承担模拟器逐帧渲染。
- 正式模拟器使用 mGBA 的定制无界面核心，编译为单线程 WXWebAssembly 兼容模块。
- 不直接使用 gbajs3 的浏览器 WASM 构建；它依赖 SDL、浏览器 DOM、WebGL2、IDBFS 和 pthread。
- 不把高频帧数据放进 React state，不通过 Taro setState 驱动画面。
- 本地二进制存储统一使用微信文件系统，键值存储只保存小型配置和索引。
- 云端默认只保存存档及元数据，不保存 ROM。
- ROM、存档和状态存档都以 ROM 内容 SHA-256 为主键隔离。

## 6. 需求追踪规则

- 产品需求使用 `FR-领域-编号`，例如 `FR-SAVE-003`。
- 非功能需求使用 `NFR-领域-编号`，例如 `NFR-PERF-001`。
- 测试用例使用 `TC-领域-编号`。
- 架构决策使用 `ADR-编号`；产生不可逆或跨模块影响的决策必须新增 ADR。
- 每个合并请求必须注明覆盖的需求 ID 和测试用例 ID。

## 7. 完成定义

只有同时满足以下条件，版本才能标记为可发布：

- 范围内 P0/P1 需求全部完成，且没有未接受的阻断级缺陷。
- 指定 iOS、Android 真机矩阵通过连续运行、音频、输入和存档测试。
- 本地存档、云存档、恢复、冲突和删除流程均有自动化或可重复测试证据。
- Ubuntu 22.04 全新主机可以严格按照部署文档完成构建和部署。
- 发布过程没有使用任何容器或虚拟化环境。
- ROM、核心、字体、图标及第三方依赖已完成许可证与版权检查。
- 微信审核材料、隐私政策、用户协议和数据删除入口准备完毕。
