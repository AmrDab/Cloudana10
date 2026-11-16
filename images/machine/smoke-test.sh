#!/usr/bin/env bash
# Smoke test for the machine image (run by .github/workflows/machine-image.yml). Usage: smoke-test.sh <image> [runtime]
#
# 1. The flags the node agent uses for a machine (node-agent/src/workstation.ts machineArgs: the workstation hardening,
#    --cap-drop=ALL and no-new-privileges included, plus MACHINE_CAPS; under runsc on a node): log in over SSH with a
#    fresh key as root, install a package, write to /root (a bind mount, as the encrypted volume is), see the sandbox
#    under runsc, log in as cloudana (not root). Password login is refused.
# 2. The agent's plain workstation flags (--cap-drop=ALL, no-new-privileges, nothing added): sshd cannot run.
# Why the login is root and not a user with sudo: an earlier version of this test (PR #109, runs 43884893078 and
# 43886632603) gave cloudana passwordless sudo and found it refused under no-new-privileges (runc), and refused under
# runsc even without no-new-privileges, with SETUID in the bounding set: gVisor does not raise privileges on a setuid exec.
set -euo pipefail

image="$1"
runtime="${2:-runc}"
CAPS=(CHOWN DAC_OVERRIDE FOWNER SETGID SETUID SYS_CHROOT AUDIT_WRITE)

work="$(mktemp -d)"
cleanup() { docker rm -f m-ok m-plain >/dev/null 2>&1 || true; sudo rm -rf "$work" 2>/dev/null || rm -rf "$work"; }
trap cleanup EXIT

ssh-keygen -q -t ed25519 -N "" -f "$work/id"
pub="$(cat "$work/id.pub")"
mkdir -p "$work/root"

# What workstationRunArgs passes besides the capability flags (no --storage-opt: the runner's disk has no quotas).
common=(-d --pids-limit=512 --memory 1024m --memory-swap 1024m --cpus 1 --shm-size=1g --runtime="$runtime"
  -e NVIDIA_VISIBLE_DEVICES=none -e "PUBLIC_KEY=$pub" -e "SSH_PUBLIC_KEY=$pub")
capadd=()
for c in "${CAPS[@]}"; do capadd+=("--cap-add=$c"); done

sshx() {
  local port="$1" user="$2"
  shift 2
  ssh -i "$work/id" -p "$port" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes \
    -o ConnectTimeout=5 -o LogLevel=ERROR ${TTY:+-tt} "$user@127.0.0.1" "$@"
}
# An interactive login: sshd allocates a pty and hands it to the user (CHOWN, FOWNER).
ptyok() { TTY=1 sshx "$1" "$2" 'tty | grep -q /dev/pts/' </dev/null >/dev/null 2>&1; }
waitssh() {
  for _ in $(seq 1 40); do
    if sshx "$1" root true 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
fail() {
  echo "FAIL: $*" >&2
  docker logs m-ok 2>&1 | grep -v -E "Accepted publickey|disconnect|Disconnected" | tail -20 >&2 || true
  exit 1
}

# One container with --cap-drop=ALL, no-new-privileges and the given capabilities: prints login · pty · apt.
probe() {
  local label="$1" port="$2"
  shift 2
  local args=()
  for c in "$@"; do args+=("--cap-add=$c"); done
  docker run --name "m-probe-$port" "${common[@]}" --cap-drop=ALL --security-opt=no-new-privileges "${args[@]}" -p "127.0.0.1:$port:22" "$image" >/dev/null
  local login=no pty=no upty=no apt=no
  if waitssh "$port"; then
    login=yes
    ptyok "$port" root && pty=yes
    ptyok "$port" cloudana && upty=yes
    sshx "$port" root 'apt-get install -y -qq --no-install-recommends jq >/dev/null 2>&1 || (apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq --no-install-recommends jq >/dev/null 2>&1)' && apt=yes
  fi
  printf '   %-28s login %-3s  root pty %-3s  cloudana pty %-3s  apt %s\n' "$label" "$login" "$pty" "$upty" "$apt"
  docker rm -f "m-probe-$port" >/dev/null 2>&1 || true
}

# Informational, before the assertions: MACHINE_CAPS alone and with each capability it leaves out.
echo "== 0. MACHINE_CAPS and one more ($runtime): login · pty login · apt-get install"
probe "MACHINE_CAPS" 2230 "${CAPS[@]}"
port=2230
for extra in FSETID KILL NET_BIND_SERVICE; do
  port=$((port + 1))
  probe "+ $extra" "$port" "${CAPS[@]}" "$extra"
done

echo "== 1. machine flags ($runtime): --cap-drop=ALL --security-opt=no-new-privileges ${capadd[*]}"
docker run --name m-ok "${common[@]}" --cap-drop=ALL --security-opt=no-new-privileges "${capadd[@]}" \
  --mount "type=bind,source=$work/root,target=/root" -p 127.0.0.1:2201:22 "$image" >/dev/null
waitssh 2201 || fail "no SSH login within 40 s"
[ "$(sshx 2201 root id -u)" = 0 ] || fail "login is not root"
ptyok 2201 root || fail "no pty for an interactive root login"
ptyok 2201 cloudana || fail "no pty for an interactive cloudana login"
sshx 2201 root 'test -f ~/.profile && touch ~/written && test "$(stat -c %u ~)" = 0' || fail "/root not set up on the mount"
[ -e "$work/root/written" ] || fail "file written in the box is not on the bind-mounted /root"
sshx 2201 root 'apt-get update -qq && apt-get install -y -qq --no-install-recommends jq >/dev/null && jq --version && sudo -n true' \
  || fail "apt-get install as root failed"
[ "$(sshx 2201 cloudana id -u)" = 1000 ] || fail "cloudana login is not uid 1000"
methods="$(ssh -v -p 2201 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o PubkeyAuthentication=no \
  root@127.0.0.1 true 2>&1 | tr -d '\r' | grep -m1 'Authentications that can continue' || true)"
case "$methods" in *"continue: publickey") ;; *) fail "server offers more than publickey: $methods" ;; esac
if [ "$runtime" = runsc ]; then
  sshx 2201 root 'dmesg | head -1' | grep -q gVisor || fail "not running under gVisor"
  echo "   sandbox: $(sshx 2201 root 'dmesg | head -1')"
fi
if sshx 2201 cloudana sudo -n true 2>"$work/sudo.err"; then fail "sudo worked as cloudana with no-new-privileges"; fi
echo "   ok: ssh as root (key only), apt install, /root on the mount, cloudana is uid 1000, passwords refused"
echo "   sudo as cloudana refused, as expected: $(tail -1 "$work/sudo.err")"

echo "== 2. plain workstation flags ($runtime): --cap-drop=ALL --security-opt=no-new-privileges, nothing added"
docker run --name m-plain "${common[@]}" --cap-drop=ALL --security-opt=no-new-privileges -p 127.0.0.1:2202:22 "$image" >/dev/null
if waitssh 2202; then fail "sshd ran with every capability dropped (expected it cannot)"; fi
echo "   ok: no login, as expected. Container log:"
docker logs m-plain 2>&1 | tail -5 | sed 's/^/     /'

if [ "$runtime" = runsc ]; then
  # Which capability is each one for? Drop one at a time (informational: the assertions above are the test).
  echo "== 3. MACHINE_CAPS minus one ($runtime): login · pty login · apt-get install"
  port=2210
  for drop in "${CAPS[@]}"; do
    port=$((port + 1))
    args=()
    for c in "${CAPS[@]}"; do [ "$c" = "$drop" ] || args+=("$c"); done
    probe "without $drop" "$port" "${args[@]}"
  done
fi
echo "smoke test passed ($runtime)"
