#!/bin/sh
# Cloudana machine entrypoint (runs as root under tini): install the tenant's key for root and cloudana, make host keys
# on the first start, set up root's home (often a fresh encrypted volume mounted over /root), then run sshd in the
# foreground.
set -eu

key="${SSH_PUBLIC_KEY:-${PUBLIC_KEY:-}}"
if [ -z "$key" ]; then
  echo "cloudana-machine: SSH_PUBLIC_KEY (or PUBLIC_KEY) is not set; there is no way to log in, so not starting" >&2
  exit 1
fi
umask 022
for user in root cloudana; do
  printf '%s\n' "$key" > "/etc/ssh/authorized_keys/$user"
  chmod 0644 "/etc/ssh/authorized_keys/$user"
done

# Host keys: generated once per container (they live in its writable layer and survive restarts of the container).
ssh-keygen -A >/dev/null

# /root is the volume's mount point: on a fresh volume, give it to root with the default dotfiles.
if [ "$(stat -c %u /root)" != 0 ]; then chown 0:0 /root; fi
chmod 0700 /root
if [ ! -e /root/.profile ]; then cp -a /etc/skel/. /root/; fi

mkdir -p /run/sshd
exec /usr/sbin/sshd -D -e
