# Miniapp GBA

Miniapp GBA 是一个面向微信小程序的 GBA 模拟器系统。项目由 Taro/React 小程序、基于 mGBA 的单线程 WXWebAssembly 核心，以及提供微信登录和版本化云存档的 Go API 组成。

项目不会把用户私有 ROM 上传到云端。首页 ROM 广场读取 Cloudflare R2 的只读 schema v2 catalog；目录显示运营方提供的权利元数据，缺失时明确标注而不从文件名推断。对外发行前仍需由运营方完成内容权利和微信平台审核。

## 当前状态

- 微信小程序已实现 R2 ROM 广场、我的游戏、逐次游玩记录、游戏详情、ROM 导入与隔离、完整虚拟按键、Canvas 播放器、本地电池存档、即时状态存档、截图、快进、音频和诊断页面。
- 云端已实现微信身份交换、会话刷新、版本历史、乐观并发、冲突副本、删除与账户清除流程。
- Cloudflare R2 的 `gba/` 已实际核对：981 个 `.gba`、合计 `7,725,253,970` 字节；本地 `catalog.r2.json` 已生成并通过 schema v2 校验。
- App 的 TypeScript、ESLint、58 个 Vitest 测试、R2 manifest 校验及 Taro production build 已通过。
- 微信开发者工具 2.01.2510290 已验证使用基础库 `3.16.1` 正常加载；构建会阻止不兼容 WXSS 和错误的基础库版本进入 `dist/`。
- 微信小程序 AppID 已固定为 `wx4a8213e3dfa88565` 并进入构建门禁；AppSecret 只允许写入 Ubuntu 服务端 root 管理的凭证文件。Ubuntu 22.04 裸机、HTTPS 合法域名、上传私钥及 iOS/Android 真机矩阵仍是正式发布前置条件。

详细证据见 [当前验证报告](./docs/10-validation-report.md) 和 [需求追踪矩阵](./docs/11-requirement-traceability.md)。

## 仓库结构

```text
minigba-app/       Taro 4、React、TypeScript 微信小程序
minigba-core/      mGBA 适配层、C ABI、原生测试和 WXWebAssembly 构建
minigba-api/       Go API、PostgreSQL migrations、systemd/Nginx 部署文件
docs/              产品、技术、存储、测试、安全、发布和运维文档
```

`main` 是可直接检出的完整交付快照。`components/app`、`components/core` 和 `components/api` 分支保留三个组件的独立 Git 历史。mGBA 固定为 `minigba-core/vendor/mgba` 子模块。

## 获取源码

```bash
git clone --recurse-submodules git@github.com:carzygod/Miniapp-GBA.git
cd Miniapp-GBA
```

已有 checkout 可执行：

```bash
git submodule update --init --recursive
```

## 构建微信小程序

本地客户端开发需要 Node.js 22+ 和 npm 10+：

```bash
cd minigba-app
npm ci
npm run typecheck
npm run lint
npm test -- --run
npm run build:weapp
```

微信开发者工具必须导入构建产物目录：

```text
minigba-app/dist
```

不要导入仓库根目录或 `minigba-app/src`。`project.config.json` 固定基础库 `3.16.1`；若开发者工具控制台仍保留旧的 500 或 WXSS 记录，应先清空控制台并重新编译当前 `dist/`。

开发模式使用：

```bash
npm run dev:weapp
```

正式构建还需要注入 HTTPS API origin、R2 manifest 和授权 ROM 下载 host：

```bash
export TARO_APP_API_BASE_URL=https://api.example.com
export TARO_APP_ROM_CATALOG_URL=https://rom.sid.mom/catalog/v2/roms.json
export TARO_APP_ROM_CATALOG_REMOTE_ENABLED=false
export TARO_APP_ROM_DOWNLOAD_HOSTS=rom.sid.mom
npm run validate:catalog -- catalog.r2.json
npm run build:weapp
```

远端目录尚未发布时保持 `TARO_APP_ROM_CATALOG_REMOTE_ENABLED=false`，小程序直接使用随包内置的 981 项目录且不会请求 404。仅在远端 schema v2 文件公开校验通过后将其改为 `true`。

## 构建模拟器核心

发行核心只支持 Ubuntu 22.04 x86_64 裸机。安装 CMake、Ninja、Python 3 和项目固定的 emsdk 后执行：

```bash
cd minigba-core
git submodule update --init --recursive
./scripts/build-native.sh
./scripts/build-weapp.sh
node ./scripts/verify-wasm.mjs dist/minigba-core.wasm
node ./tests/wasm-smoke.mjs dist/minigba-core.wasm
```

生成的 WASM 必须通过 manifest 和 SHA-256 校验后才能替换 App 内的固定核心。完整交接规则见 [三仓库与发布契约](./docs/09-repository-release-contract.md)。

## 运行云存档 API

API 要求 Ubuntu 22.04 裸机、Go 1.26 和 PostgreSQL 14+。开发数据库必须与生产数据库隔离：

```bash
cd minigba-api
cp .env.example .env
go mod download
go run ./cmd/api migrate
go run ./cmd/api serve
```

验证命令：

```bash
go test -race ./...
go vet ./...
```

生产环境使用非特权 `minigba` 用户、systemd、Nginx 和独立存档卷，不使用容器。部署、备份、恢复和回滚步骤见 [Ubuntu 22.04 构建与部署](./docs/05-ubuntu-build-deploy.md) 及 [API 部署说明](./minigba-api/deploy/README.md)。

## 关键边界

- 仅支持微信小程序，不提供 H5、WebView 模拟器或其他小程序平台构建。
- 只允许 Ubuntu 22.04 裸机进行发行构建和服务端部署。
- 禁止 Docker、Podman、LXC、WSL、虚拟机及其他虚拟化环境。
- 云端默认仅保存电池存档和即时状态存档，不保存 ROM。
- R2 catalog 使用独立目录 ID、object key、精确长度和白名单 HTTPS URL；ROM 下载不要求预置 SHA-256，客户端不包含 R2/S3 写凭证，也不直接列举桶对象。
- 本地与云端数据均按 ROM SHA-256 和账户作用域隔离。
- 正式发布必须完成服务端微信凭证落地、合法 HTTPS 域名、双端真机和数据恢复验收。

## 文档

从 [文档中心](./docs/README.md) 开始阅读。R2 对象布局、manifest、微信域名、发布和下架流程见 [R2 ROM 广场文档](./docs/12-r2-rom-catalog.md)；其余产品需求、技术设计、核心移植、存储同步、测试验收、安全合规、交付计划和当前阻断均在 `docs/` 中维护。

## 许可证

MiniGBA 自有代码使用 Apache-2.0。mGBA 使用 MPL-2.0；各组件的 `LICENSE`、`THIRD_PARTY_NOTICES.md`、上游固定记录和发行 SBOM 构成完整分发材料。
