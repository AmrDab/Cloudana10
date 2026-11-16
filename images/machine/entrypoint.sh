#!/bin/sh
# Cloudana machine entrypoint (runs as root under tini): install the tenant's key, make host keys on the first start,
# hand the home directory (often a fresh encrypted volume mounted over it) to the user, then run sshd in the foreground.
set -eu

key="${SSH_PUBLIC_KEY:-${PUBLIC_KEY:-}}"
if [ -z "$key" ]; then
  echo "cloudana-machine: SSH_PUBLIC_KEY (or PUBLIC_KEY) is not set; there is no way to log in, so not starting" >&2
  exit 1
fi
umask 022
printf '%s\n' "$key" > /etc/ssh/authorized_keys/cloudana
chmod 0644 /etc/ssh/authorized_keys/cloudana

# Host keys: generated once per container (they live in its writable layer and survive restarts of the container).
ssh-keygen -A >/dev/null

home=/home/cloudana
if [ "$(stat -c %u "$home")" != 1000 ]; then chown 1000:1000 "$home"; fi
if [ ! -e "$home/.profile" ]; then
  cp -a /etc/skel/. "$home"/
  chown -R 1000:1000 "$home"
fi

mkdir -p /run/sshd
exec /usr/sbin/sshd -D -e
