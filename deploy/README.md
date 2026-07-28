# Ubuntu 22.04 bare-metal deployment

The deployment scripts reject virtual machines. They never invoke Docker, WSL, LXC, or another virtualization layer.

1. Build on an Ubuntu 22.04 bare-metal build host with the pinned Go toolchain:

   ```bash
   MINIGBA_RELEASE_VERSION=0.1.0 ./scripts/build-release.sh
   ```

2. On a clean Ubuntu 22.04 bare-metal server, reserve a high port and bootstrap once:

   ```bash
   MINIGBA_PUBLIC_PORT=38443 sudo -E ./deploy/bootstrap-ubuntu.sh
   ```

3. Set `MINIGBA_WECHAT_APP_ID` in `/etc/minigba/api.env`, write the AppSecret to `/etc/minigba/credentials/wechat-app-secret`, and keep both files owned by `root:minigba` with mode `0640`.

4. Transfer the release archive and its `.sha256`, then install:

   ```bash
   sudo ./deploy/install-release.sh dist/minigba-api-0.1.0-linux-amd64.tar.gz
   ```

5. For a WeChat production request domain, replace the HTTP-only Nginx listener with an approved domain and valid TLS certificate. An IP-address HTTP endpoint is suitable only for host smoke tests; it is not a valid production WeChat request domain.

Backups use `deploy/backup.sh` and require a GPG recipient whose private key is stored separately from the server and backup target. Restore is deliberately manual: verify the encrypted archive and checksums, restore into an isolated PostgreSQL database and blob root, run reference checks, then schedule a controlled cutover.
