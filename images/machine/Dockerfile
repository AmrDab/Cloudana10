# Cloudana machine: a rentable Ubuntu 24.04 box reached over SSH (docs/WORKSTATIONS.md §10 "Machines").
#
# Build (context = this directory):  docker build -t cloudana-machine images/machine
# Published by .github/workflows/machine-image.yml as ghcr.io/<owner>/cloudana-machine:<images/machine/VERSION>.
#
# - Login: root, by key only (no passwords). Root of the box is root inside the gVisor sandbox, not on the provider's
#   kernel (docs/TRUST_TIERS.md §5). `cloudana` (uid 1000) is the unprivileged account, same key.
#   Why not a user with sudo: under gVisor a setuid binary does not raise privileges, and the node keeps
#   no-new-privileges on; images/machine/smoke-test.sh shows both. sudo is installed so `sudo …` still works as root.
# - The key comes from SSH_PUBLIC_KEY (or PUBLIC_KEY), which the node agent sets from the workstation's access.ssh.
# - Host keys are generated on the container's first start (never baked into the image: no two machines share one).
# - tini is PID 1 and reaps orphans; sshd runs in the foreground as its child.
#
# On a node the agent runs it under gVisor (runsc) with --cap-drop=ALL --security-opt=no-new-privileges plus the short
# --cap-add list in node-agent/src/workstation.ts MACHINE_CAPS. smoke-test.sh runs it with exactly those flags in CI.
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-server sudo curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

# Ubuntu's image ships a user `ubuntu` with uid 1000; the machine's unprivileged user takes that uid. Its password field
# is "*": no password can log in, but the account is not locked (sshd refuses keys for locked accounts when PAM is off).
RUN userdel --remove ubuntu 2>/dev/null; \
    useradd --create-home --uid 1000 --user-group --shell /bin/bash cloudana \
 && usermod --password '*' cloudana \
 && usermod --password '*' root \
 && rm -f /etc/ssh/ssh_host_* \
 && mkdir -p /run/sshd /etc/ssh/authorized_keys

COPY sshd_config /etc/ssh/sshd_config.d/10-cloudana.conf
COPY entrypoint.sh /usr/local/sbin/cloudana-entrypoint
RUN chmod 0644 /etc/ssh/sshd_config.d/10-cloudana.conf && chmod 0755 /usr/local/sbin/cloudana-entrypoint

EXPOSE 22
WORKDIR /root
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/sbin/cloudana-entrypoint"]
