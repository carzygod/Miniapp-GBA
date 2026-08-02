# Ubuntu 22.04 构建、部署与运维文档

版本：1.0  
状态：部署设计  
唯一支持环境：Ubuntu Server 22.04 LTS x86_64 裸机

## 1. 范围和禁止项

本文覆盖：

- 开发/构建主机初始化。
- Node/Taro 小程序构建及 `miniprogram-ci` 上传。
- Emscripten/mGBA WASM 构建。
- Go API 构建。
- PostgreSQL、Nginx、systemd 的生产部署。
- 日志、备份、恢复、升级和回滚。

严格禁止：

- Docker、Podman、containerd、LXC 或其他容器运行时。
- WSL、Multipass、Vagrant、VirtualBox、VMware、KVM 或其他虚拟化环境。
- 依赖容器镜像完成 mGBA/Emscripten 构建。
- 在生产服务器执行未固定版本的远程安装脚本。

持续集成如果存在，必须运行在真实 Ubuntu 22.04 裸机自托管 runner 上。

## 2. 主机角色

推荐至少两个独立角色，均为 Ubuntu 22.04 裸机：

| 角色 | 用途 | 是否持有生产数据 |
| --- | --- | --- |
| Build Host | npm、Taro、Emscripten、Go 构建，小程序上传 | 否；仅持有受控发布凭证 |
| API Host | Nginx、Go API、PostgreSQL、blob 和备份任务 | 是 |

小规模预发布可合并，但生产建议分开。本文不设计其他操作系统的替代步骤。

## 3. 硬件建议

### 3.1 Build Host

- 4 核以上 x86_64 CPU。
- 16 GiB RAM。
- 80 GiB 可用 SSD。
- 时间同步和稳定 HTTPS 出网。

### 3.2 API Host

- 4 核 CPU、8 GiB RAM 起步。
- 系统盘 40 GiB。
- 独立数据盘挂载 `/srv/minigba`，初始 200 GiB 或按用户配额测算。
- 独立备份目标，不得只在同一数据盘保留备份。
- 公网只开放 80/443；SSH 仅管理网或固定来源。

## 4. 操作系统初始化

### 4.1 基础检查

```bash
lsb_release -ds
uname -m
timedatectl status
df -h
free -h
```

预期系统为 Ubuntu 22.04 LTS，架构为 `x86_64`。不符合时停止安装。

### 4.2 系统更新和基础包

```bash
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo apt-get install -y \
  build-essential ca-certificates cmake curl git gnupg jq \
  ninja-build pkg-config python3 python3-venv rsync unzip \
  brotli libpng-dev zlib1g-dev nginx postgresql postgresql-contrib ufw
```

生产升级先在 staging 裸机验证。内核或 libc 更新后安排维护窗口重启并执行健康检查。

### 4.3 时间同步

```bash
sudo timedatectl set-timezone UTC
sudo timedatectl set-ntp true
timedatectl status
```

服务器统一 UTC；客户端负责本地化展示。

## 5. 目录和账号

### 5.1 服务账号

```bash
sudo adduser --system --group --home /var/lib/minigba \
  --shell /usr/sbin/nologin minigba
```

### 5.2 目录

```bash
sudo install -d -o root -g minigba -m 0750 /etc/minigba
sudo install -d -o root -g minigba -m 0750 /etc/minigba/credentials
sudo install -d -o root -g minigba -m 0750 /opt/minigba/releases
sudo install -d -o minigba -g minigba -m 0750 /var/lib/minigba
sudo install -d -o minigba -g minigba -m 0750 /srv/minigba/blobs
sudo install -d -o minigba -g minigba -m 0750 /srv/minigba/tmp
sudo install -d -o minigba -g minigba -m 0750 /srv/minigba/quarantine
sudo install -d -o root -g root -m 0700 /srv/minigba-backups
```

推荐布局：

```text
/opt/minigba/releases/<release-id>/minigba-api
/opt/minigba/current -> /opt/minigba/releases/<release-id>
/etc/minigba/api.env
/etc/minigba/credentials/*
/srv/minigba/blobs
/srv/minigba/tmp
/srv/minigba/quarantine
/srv/minigba-backups/<backup-id>
```

## 6. 工具链固定

三个仓库分别提交 `toolchains/versions.env`，当前固定值为：

```bash
NODE_VERSION=24.18.0
NODE_LINUX_X64_SHA256=55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742
GO_VERSION=1.26.5
GO_LINUX_AMD64_SHA256=5c2c3b16caefa1d968a94c1daca04a7ca301a496d9b086e17ad77bb81393f053
EMSDK_VERSION=6.0.4
EMSDK_COMMIT=224ec5f9f2f72f09f9ce0e26d66bae7dbd8b692f
MGBA_VERSION=0.10.5
MGBA_COMMIT=26b7884bc25a5933960f3cdcd98bac1ae14d42e2
TARO_VERSION=4.2.1
```

版本升级作为独立变更，通过构建、许可证和真机回归后合并。

### 6.1 Node.js

不要依赖 Ubuntu 22.04 默认 Node 版本。Build Host 从 Node.js 官方归档安装固定版本并校验：

```bash
source toolchains/versions.env
cd /tmp
curl --fail --location --output node.tar.xz \
  "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
echo "${NODE_LINUX_X64_SHA256}  node.tar.xz" | sha256sum --check -
sudo install -d -m 0755 /opt/minigba/toolchains
sudo tar -xJf node.tar.xz -C /opt/minigba/toolchains
sudo ln -sfn \
  "/opt/minigba/toolchains/node-v${NODE_VERSION}-linux-x64" \
  /opt/minigba/toolchains/node
```

构建 shell 显式设置：

```bash
export PATH=/opt/minigba/toolchains/node/bin:$PATH
node --version
npm --version
```

### 6.2 Go

```bash
source toolchains/versions.env
cd /tmp
curl --fail --location --output go.tar.gz \
  "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"
echo "${GO_LINUX_AMD64_SHA256}  go.tar.gz" | sha256sum --check -
sudo install -d -m 0755 "/opt/minigba/toolchains/go-${GO_VERSION}"
sudo tar --strip-components=1 -xzf go.tar.gz \
  -C "/opt/minigba/toolchains/go-${GO_VERSION}"
sudo ln -sfn "/opt/minigba/toolchains/go-${GO_VERSION}" \
  /opt/minigba/toolchains/go
/opt/minigba/toolchains/go/bin/go version
```

### 6.3 Emscripten

```bash
source toolchains/versions.env
sudo install -d -o "$USER" -g "$USER" -m 0755 /opt/minigba/toolchains/emsdk
git clone https://github.com/emscripten-core/emsdk.git \
  /opt/minigba/toolchains/emsdk
cd /opt/minigba/toolchains/emsdk
git checkout --detach "$EMSDK_VERSION"
./emsdk install "$EMSDK_VERSION"
./emsdk activate "$EMSDK_VERSION"
source ./emsdk_env.sh
emcc --version
```

生产 Build Host 的 `/opt/minigba/toolchains` 应由专用构建账号拥有，普通服务账号无写权限。

## 7. 从源码构建

### 7.1 获取源码

```bash
git clone <approved-core-repository-url> /srv/build/minigba-core
git clone <approved-app-repository-url> /srv/build/minigba-app
git clone <approved-api-repository-url> /srv/build/minigba-api
git -C /srv/build/minigba-core checkout --detach <core-release-commit>
git -C /srv/build/minigba-app checkout --detach <app-release-commit>
git -C /srv/build/minigba-api checkout --detach <api-release-commit>
git -C /srv/build/minigba-core submodule update --init --recursive
git -C /srv/build/minigba-core status --short
git -C /srv/build/minigba-app status --short
git -C /srv/build/minigba-api status --short
```

构建脚本要求工作树干净；发布版本不得从有未提交文件的目录产生。

### 7.2 安装 JavaScript 依赖

```bash
export PATH=/opt/minigba/toolchains/node/bin:$PATH
cd /srv/build/minigba-app
npm ci --ignore-scripts=false
npm audit --omit=dev
```

如果依赖生命周期脚本不是必需，应在依赖评审后改为 `--ignore-scripts`。不能临时忽略 audit 阻断项发布。

### 7.3 构建 WASM

```bash
source /opt/minigba/toolchains/emsdk/emsdk_env.sh
cd /srv/build/minigba-core
./scripts/build-native.sh
./scripts/build-weapp.sh
sha256sum dist/minigba-core.wasm
```

脚本必须检查：

- 没有 pthread/shared-memory section。
- 没有 SDL、DOM、IDBFS 或 WebGL2 运行时依赖。
- ABI 自测通过。
- `.wasm`、可选 `.wasm.br`、build metadata 和许可证齐全。
- source map 不进入生产小程序包。

### 7.4 构建小程序

```bash
export PATH=/opt/minigba/toolchains/node/bin:$PATH
cd /srv/build/minigba-app
install -m 0644 /srv/build/minigba-core/dist/minigba-core.wasm src/assets/minigba-core.wasm
export TARO_APP_API_BASE_URL=https://api.example.com:38443
export TARO_APP_ROM_CATALOG_URL=https://rom.sid.mom/catalog/v2/roms.json
export TARO_APP_ROM_CATALOG_REMOTE_ENABLED=false
export TARO_APP_ROM_DOWNLOAD_HOSTS=rom.sid.mom
npm run lint
npm run test
npm run validate:catalog -- catalog.r2.json
npm run build:weapp
```

在 `catalog/v2/roms.json` 公开读取和远程校验通过之前，必须保持远端开关为 `false`。上传完成后先验证远端目录，再改为 `true` 构建候选版本；`scripts/build-release.sh` 会按该开关选择校验内置或远端目录。

构建后验证：

```bash
test -f dist/app.json
test -f dist/player/assets/minigba-core.wasm
find dist -type f -name '*.map' -print
du -ah dist | sort -h | tail -n 30
```

生产检查要求 source map 查找无输出，并在微信包大小规则内。WASM 放在播放器分包，不进入首页主包。

### 7.5 构建 API

```bash
export PATH=/opt/minigba/toolchains/go/bin:$PATH
cd /srv/build/minigba-api
export MINIGBA_TEST_DATABASE_URL='postgres://<test-role>@localhost/minigba_test?sslmode=disable'
MINIGBA_RELEASE_VERSION=<semver> ./scripts/build-release.sh
```

`MINIGBA_TEST_DATABASE_URL` 必须指向名称以 `_test` 结尾的专用数据库，执行账号需要创建/删除 schema 的权限。测试会为每个用例创建隔离 schema 并在结束时删除；严禁指向生产数据库。

如果未来依赖 CGO，必须在 Ubuntu 22.04 裸机重新定义运行库和安全更新策略，不得悄悄改变构建方式。

## 8. PostgreSQL 初始化

Ubuntu 22.04 官方仓库默认 PostgreSQL 主版本作为首版基线。确认版本：

```bash
psql --version
sudo systemctl enable --now postgresql
sudo -u postgres psql -c 'SELECT version();'
```

创建角色和数据库时使用交互式安全密码或受控脚本变量，不能把密码提交到 shell 历史：

```sql
CREATE ROLE minigba LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE minigba_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE DATABASE minigba OWNER minigba_migrator ENCODING 'UTF8';
```

在数据库内：

```sql
REVOKE ALL ON DATABASE minigba FROM PUBLIC;
GRANT CONNECT ON DATABASE minigba TO minigba;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO minigba;
```

由 `minigba_migrator` 执行以下默认权限配置，使后续迁移创建的表和 sequence 自动授权给应用角色：

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE minigba_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO minigba;
ALTER DEFAULT PRIVILEGES FOR ROLE minigba_migrator IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO minigba;
```

每次首次迁移完成后还要对迁移前已存在对象执行等价的 `GRANT`。数据库应用角色与 systemd 的 `minigba` 操作系统账号同名，使用本机 Unix socket peer 认证。迁移账号拥有 schema DDL 权限；应用账号仅拥有运行所需 DML 和 sequence 权限。迁移完成后不能让 API 使用 migrator 凭证。

`pg_hba.conf` 仅允许本机 Unix socket 或明确内网地址，生产禁止公网暴露 5432。

## 9. API 配置

`/etc/minigba/api.env` 示例：

```ini
MINIGBA_LISTEN_ADDR=127.0.0.1:8080
MINIGBA_DATABASE_URL=postgres://minigba@/minigba?host=/var/run/postgresql&sslmode=disable
MINIGBA_BLOB_ROOT=/srv/minigba/blobs
MINIGBA_TEMP_ROOT=/srv/minigba/tmp
MINIGBA_WECHAT_APP_ID=<appid>
MINIGBA_WECHAT_APP_SECRET_FILE=/etc/minigba/credentials/wechat-app-secret
MINIGBA_TOKEN_SIGNING_KEY_FILE=/etc/minigba/credentials/token-signing-key
MINIGBA_MAX_SAVE_BYTES=8388608
MINIGBA_LOG_LEVEL=info
```

权限：

```bash
sudo chown root:minigba /etc/minigba/api.env
sudo chmod 0640 /etc/minigba/api.env
sudo chown root:minigba /etc/minigba/credentials/*
sudo chmod 0640 /etc/minigba/credentials/*
```

数据库密码如果使用 TCP 连接，放入独立凭证文件或权限严格的环境文件；不得出现在进程参数中。

## 10. 数据库迁移

发布前：

```bash
sudo -u minigba \
  /opt/minigba/releases/<release-id>/minigba-api migrate \
  --database-url-file /etc/minigba/credentials/migrator-database-url
```

迁移规则：

- 先备份并检查可用空间。
- 使用 advisory lock 防止两个迁移进程并发。
- 每个迁移在 `schema_migrations` 记录 checksum。
- 长时间回填拆成后台批次，不持有长事务锁住 API。
- 应用回滚不自动执行破坏性 down migration。

## 11. systemd 服务

`/etc/systemd/system/minigba-api.service`：

```ini
[Unit]
Description=MiniGBA API
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=minigba
Group=minigba
EnvironmentFile=/etc/minigba/api.env
ExecStart=/opt/minigba/current/minigba-api serve
WorkingDirectory=/var/lib/minigba
Restart=on-failure
RestartSec=5s
TimeoutStartSec=30s
TimeoutStopSec=30s
KillSignal=SIGTERM

NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=false
ReadWritePaths=/srv/minigba /var/lib/minigba
ReadOnlyPaths=/etc/minigba
UMask=0027

[Install]
WantedBy=multi-user.target
```

WASM/JIT 不在 API 服务内，`MemoryDenyWriteExecute` 最终可根据 Go 二进制验证后改为 true。

启用：

```bash
sudo systemctl daemon-reload
sudo systemctl enable minigba-api.service
sudo systemctl start minigba-api.service
sudo systemctl status minigba-api.service --no-pager
```

## 12. Nginx

在 `/etc/nginx/conf.d/minigba-limits.conf` 的 http 上下文配置速率区：

```nginx
limit_req_zone $binary_remote_addr zone=minigba_auth:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=minigba_api:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=minigba_conn:10m;
```

站点 `/etc/nginx/sites-available/minigba-api`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 9m;
    client_body_timeout 15s;
    keepalive_timeout 30s;
    limit_conn minigba_conn 20;

    location = /v1/auth/wechat/login {
        limit_req zone=minigba_auth burst=5 nodelay;
        proxy_pass http://127.0.0.1:8080;
        include proxy_params;
        proxy_set_header X-Request-ID $request_id;
    }

    location /v1/ {
        limit_req zone=minigba_api burst=30 nodelay;
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        include proxy_params;
        proxy_set_header X-Request-ID $request_id;
    }

    location = /health/live {
        allow 127.0.0.1;
        deny all;
        proxy_pass http://127.0.0.1:8080;
    }
}
```

配置和证书路径按实际域名调整。启用前：

```bash
sudo ln -s /etc/nginx/sites-available/minigba-api \
  /etc/nginx/sites-enabled/minigba-api
sudo nginx -t
sudo systemctl reload nginx
```

证书通过组织批准的 ACME/CA 流程直接安装在 Ubuntu 22.04 主机。续期后执行 `nginx -t` 成功才 reload。

## 13. 防火墙

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <management-cidr> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

不得开放 5432 和 8080 到公网。

## 14. 发布 API

发布脚本逻辑：

1. 验证 release ID、二进制 SHA-256、签名和 Ubuntu 目标架构。
2. 创建 `/opt/minigba/releases/<release-id>`。
3. 复制二进制、许可证和 build metadata，所有者 root、模式 0755/0644。
4. 执行数据库兼容性检查和迁移。
5. 使用临时 symlink 后原子替换 `/opt/minigba/current`。
6. restart API，轮询 readiness。
7. 运行登录 mock 以外的只读 smoke test 和内部健康检查。
8. 失败时切回上一 symlink 并 restart。
9. 保留最近 5 个 release，清理前确认不再被 current 指向。

示例检查：

```bash
readlink -f /opt/minigba/current
sudo systemctl restart minigba-api
curl --fail --silent http://127.0.0.1:8080/health/ready
sudo journalctl -u minigba-api --since '-5 minutes' --no-pager
```

## 15. 上传微信小程序

### 15.1 凭证

- AppID 从发布环境配置读取。
- 上传私钥位于 `/etc/minigba-build/wechat-upload.key`，模式 0600。
- Build Host 出网 IP 配置在微信后台白名单。
- 私钥不进入仓库、npm cache、构建日志和产物。

### 15.2 自动上传

`minigba-app/scripts/upload.sh` 使用固定版本的 `miniprogram-ci`：

```bash
export PATH=/opt/minigba/toolchains/node/bin:$PATH
export MINIGBA_WECHAT_APP_ID=<appid>
export MINIGBA_MINIPROGRAM_PRIVATE_KEY=/etc/minigba-build/wechat-upload.key
export MINIGBA_RELEASE_VERSION=<semver>
export MINIGBA_RELEASE_DESCRIPTION="Release <release-id>"
./scripts/upload.sh
```

脚本在上传前验证：

- Git commit 与 release metadata 一致。
- 主包、分包和 WASM 大小满足微信当前限制。
- 不包含 `.map`、`.gba`、`.sav`、测试凭证和开发 API 地址。
- `MINIGBA_CORE_BUILD_ID` 与打包 WASM metadata 一致。
- 隐私清单和实际调用 API 一致。

上传成功不等于发布成功；审核提交、灰度和正式发布仍需按微信后台流程记录操作人和版本。

## 16. 监控和日志

### 16.1 systemd/journald

```bash
sudo journalctl -u minigba-api -f
sudo journalctl -u nginx --since today
sudo systemctl --failed
```

API 输出结构化 JSON 到 stdout/stderr。journald 配置磁盘上限和保留时间，禁止无限增长。

### 16.2 指标

至少监控：

- HTTP 请求率、P50/P95/P99 延迟和 4xx/5xx。
- 登录成功/失败、上传成功/冲突/失败。
- PostgreSQL 连接数、慢查询、数据库和 WAL 空间。
- blob/tmp/backup 磁盘空间和 inode。
- systemd 重启次数、进程 RSS 和文件描述符。
- 备份最后成功时间和恢复验证时间。

指标端点仅监听 localhost，由 Ubuntu 22.04 上直接运行的受控监控代理抓取。

## 17. 备份

### 17.1 目标

- RPO：24 小时以内，生产成熟后目标 1 小时。
- RTO：4 小时以内。
- PostgreSQL 和 blob 使用共同 backup ID。
- 备份必须传输到独立故障域并加密。

### 17.2 备份流程

由于 blob 内容不可变，备份任务采用数据库备份租约：

1. 在数据库创建 backup lease，暂停 blob 垃圾回收。
2. 生成 backup ID 和 UTC 时间。
3. `pg_dump --format=custom --serializable-deferrable`。
4. 使用 `rsync -a --link-dest` 增量复制 blob 到新 backup ID。
5. 生成数据库 dump、blob 清单和文件 SHA-256。
6. 加密并复制到独立备份目标。
7. 释放 backup lease，恢复垃圾回收。
8. 更新监控中的最后成功时间。

PostgreSQL 示例：

```bash
sudo install -d -o root -g root -m 0700 \
  /srv/minigba-backups/<backup-id>
sudo -u postgres pg_dump \
  --format=custom \
  --serializable-deferrable \
  minigba | sudo tee \
  /srv/minigba-backups/<backup-id>/minigba.dump >/dev/null
```

备份脚本使用 `flock` 防止并发，只能操作解析后位于 `/srv/minigba-backups` 的目录。

### 17.3 systemd timer

- `minigba-backup.service`：Type=oneshot，执行受控备份脚本。
- `minigba-backup.timer`：每日全量元数据备份，按目标 RPO 增加频率。
- `Persistent=true`：主机停机错过计划后补执行。
- 失败通过监控告警，不静默重试覆盖原备份。

## 18. 恢复

恢复必须先在隔离目录演练：

1. 校验备份清单、签名/加密和所有 SHA-256。
2. 安装相同 Ubuntu 22.04 基线和 PostgreSQL 主版本。
3. 停止 API 写流量。
4. 恢复 blob 到新的暂存根目录并校验。
5. 创建空数据库，使用 `pg_restore` 恢复。
6. 运行 blob 引用一致性检查。
7. 启动 API 指向暂存 blob，执行只读和写入 smoke test。
8. 通过后原子切换正式数据路径并恢复流量。
9. 记录实际 RPO/RTO 和发现的问题。

禁止在未校验备份时覆盖现有生产数据。

## 19. 回滚

### 19.1 API 回滚

- 将 `/opt/minigba/current` 切回上一 release。
- restart 服务并验证 readiness。
- 数据库必须保持上一版本可读；因此迁移遵循 expand/contract。
- 如果新版本已经写入新格式，由兼容层处理，不能直接执行破坏性 SQL 回滚。

### 19.2 小程序回滚

- 保留最近发布版本、commit、core build ID 和上传记录。
- 通过微信后台执行版本回退或重新上传已验证产物。
- 核心回退时禁止自动加载由更新核心产生的不兼容状态存档；电池存档必须继续可用。

## 20. 定期运维

每日：

- 检查服务健康、磁盘、错误率、同步冲突异常增长和备份结果。

每周：

- 检查 Ubuntu 安全更新、依赖安全报告、孤立 blob dry-run 和证书有效期。

每月：

- 在隔离目录执行备份恢复。
- 审查管理员和发布密钥权限。
- 清理过期 release、日志和已达到保留期的数据。
- 复查容量预测、RPO/RTO 和微信基础库兼容性。

每次升级：

- 先 staging、再灰度、最后生产。
- 记录 OS 包、Node、Go、emsdk、mGBA、npm 和数据库迁移版本。
- 完成发布后 smoke test 和至少一次真实设备云存档往返。
