# 三仓库与发布契约

## 1. 仓库边界

| 仓库 | 初始提交 | 当前 HEAD | 输入 | 发布产物 |
| --- | --- | --- | --- | --- |
| `minigba-core` | `58bb57e` | `5045490add4e9691d1c005aeb84c9886d2489536` | mGBA `26b7884bc25a5933960f3cdcd98bac1ae14d42e2`、emsdk 6.0.4 | `minigba-core.wasm`、SHA-256、ABI/build ID、SBOM、许可证 |
| `minigba-app` | `7284856` | `c65d25d193fd9ed2c943f249a39cf29137a660ec` | Core WASM + manifest、API base URL、R2 ROM manifest URL、授权 ROM host allowlist | 微信小程序 `dist/`、SBOM/审计报告、R2 目录校验、上传记录 |
| `minigba-api` | `07f4b73` | `962e0bbbe26a82d1001ba62fb68e5bc468d1e859` | Go 1.26.5、PostgreSQL 14+、微信凭证 | Linux amd64 release tar、SHA-256、OpenAPI、SBOM、许可证 |

每个目录都是独立 Git repository。不得把三者改回 npm workspace、Git subtree 或单仓库隐式相对依赖。根目录 `docs/` 是交付基线，不参与任一运行时依赖。

## 2. 兼容矩阵

一次候选发布必须记录以下四项：

| 字段 | 当前值 | 不兼容变更处理 |
| --- | --- | --- |
| Core ABI | `1` | 修改导出、结构布局或语义时递增，并同步 App |
| Core build ID | `mgba-0.10.5-0.1.0` | 即时状态只允许相同 build ID 直接恢复 |
| 本地 save schema | `1` | 先提供可回滚迁移，再提高 schema version |
| API major | `/v1` | 破坏性变更新增 major，旧 App 生命周期内保留旧接口 |

电池存档正文是 GBA save memory，不依赖即时状态格式；仍必须按 ROM SHA-256、类型、容量和正文 SHA-256 校验。

## 3. Core 到 App 的交接

1. 在 Ubuntu 22.04 裸机执行 `minigba-core/scripts/build-native.sh`。
2. 执行 `minigba-core/scripts/build-weapp.sh`；脚本同时验证导入、导出、单线程内存和状态 round-trip。
3. 将 `dist/minigba-core.wasm` 复制到 `minigba-app/src/assets/minigba-core.wasm`。
4. 更新 `minigba-core.manifest.json` 的 ABI、build ID、mGBA commit、大小和 SHA-256。
5. App 构建必须证明 `dist/player/assets/minigba-core.wasm` 摘要不变。

不得从聊天附件、临时下载目录或未提交 Core 工作树复制生产 WASM。

## 4. API 到 App 的交接

- `minigba-api/api/openapi.yaml` 是网络契约源。
- App 仅通过 `TARO_APP_API_BASE_URL` 注入 HTTPS origin，通过 `TARO_APP_ROM_CATALOG_URL` 和 `TARO_APP_ROM_CATALOG_REMOTE_ENABLED` 控制远端 R2 manifest，通过 `TARO_APP_ROM_DOWNLOAD_HOSTS` 注入授权下载 host allowlist；源码不得包含写凭证。
- `catalog.r2.json` 是 App 的内置发布输入；远端开关关闭时必须本地验证该文件且运行时不得请求 manifest。远端开关启用时必须先远程验证 schema v2、唯一 catalog ID/object key、ROM 长度和 URL host。ROM 不要求预置 SHA-256；目录失败仍必须阻断候选发布。
- staging 先完成登录、上传、历史、409 冲突、删除与账号删除往返，再生成候选小程序。
- 微信 request 合法域名必须是备案/审核允许的 HTTPS 域名；IP + HTTP 高端口只用于宿主 smoke test。

## 5. 发布顺序

1. Core 候选与许可证检查。
2. API 向后兼容发布、迁移、readiness 和备份检查。
3. R2 先核对 `gba/` 对象和可选封面，远程验证长度，再发布并记录 schema v2 manifest 与权利审核版本。
4. App 嵌入 Core 候选与已验证 R2 manifest，执行测试、构建和真机矩阵。
5. `miniprogram-ci` 上传体验版，记录 App commit、Core commit、API commit、R2 manifest 和四方摘要。
6. 双设备冲突、后台恢复、强杀恢复和账号删除验收通过后提交微信审核。
7. 灰度观察稳定后正式发布；失败按各仓库独立回滚，R2 使用上一已验证 manifest 回滚，不回写历史产物。

App 候选构建必须在 `project.config.json` 中固定已验证的微信基础库版本，并校验该字段进入 `dist/project.config.json`。本候选固定为 `3.16.1`；不得依赖开发者工具自动选择最新基础库，因为不完整的基础库缓存会在业务代码执行前表现为模拟器 HTTP 500。

## 6. Git 与凭证

- 三个仓库发布时必须 `git status --porcelain` 无输出。
- release 只能引用完整 commit，不引用浮动 branch。
- 微信 AppSecret、上传私钥、token signing key、数据库备份密钥、R2 access key/API token 不得进入 Git。
- Core 仓库的 mGBA 必须显示为 mode `160000` gitlink，且 `git submodule status` 与 manifest 一致。
