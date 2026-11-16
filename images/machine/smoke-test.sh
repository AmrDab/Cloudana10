#!/usr/bin/env bash
# Smoke test for the machine image (run by .github/workflows/machine-image.yml). Usage: smoke-test.sh <image> [runtime]
#
# 1. The flags the node agent uses for a machine (node-agent/src/workstation.ts: --cap-drop=ALL plus MACHINE_CAPS, no
#    no-new-privileges, under runsc on a node): log in over SSH with a fresh key as `cloudana`, sudo to root, install a
#    package, write to the home directory (a bind mount, as the encrypted volume is), and see the sandbox under runsc.
#    Root login and password login are refused.
# 2. The agent's plain workstation flags (--cap-drop=ALL, no-new-privileges, nothing added): sshd cannot run.
# 3. MACHINE_CAPS with no-new-privileges kept: sshd runs, and the result of sudo is printed (sudo is setuid).
set -euo pipefail

image="$1"
runtime="${2:-runc}"
CAPS=(CHOWN DAC_OVERRIDE FOWNER FSETID KILL SETGID SETUID SYS_CHROOT AUDIT_WRITE NET_BIND_SERVICE)

work="$(mktemp -d)"
cleanup() { docker rm -f m-ok m-plain m-nnp >/dev/null 2>&1 || true; sudo rm -rf "$work" 2>/dev/null || rm -rf "$work"; }
trap cleanup EXIT

ssh-keygen -q -t ed25519 -N "" -f "$work/id"
pub="$(cat "$work/id.pub")"
mkdir -p "$work/home"

# What workstationRunArgs passes besides the capability flags (no --storage-opt: the runner's disk has no quotas).
common=(-d --pids-limit=512 --memory 1024m --memory-swap 1024m --cpus 1 --shm-size=1g --runtime="$runtime"
  -e NVIDIA_VISIBLE_DEVICES=none -e "PUBLIC_KEY=$pub" -e "SSH_PUBLIC_KEY=$pub")
capadd=()
for c in "${CAPS[@]}"; do capadd+=("--cap-add=$c"); done

sshx() {
  local port="$1" user="$2"
  shift 2
  ssh -i "$work/id" -p "$port" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes \
    -o ConnectTimeout=5 -o LogLevel=ERROR "$user@127.0.0.1" "$@"
}
waitssh() {
  for _ in $(seq 1 40); do
    if sshx "$1" cloudana true 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
fail() {
  echo "FAIL: $*" >&2
  docker logs m-ok 2>&1 | tail -20 >&2 || true
  exit 1
}

echo "== 1. machine flags ($runtime): --cap-drop=ALL ${capadd[*]}"
docker run --name m-ok "${common[@]}" --cap-drop=ALL "${capadd[@]}" \
  --mount "type=bind,source=$work/home,target=/home/cloudana" -p 127.0.0.1:2201:22 "$image" >/dev/null
waitssh 2201 || fail "no SSH login within 40 s"
[ "$(sshx 2201 cloudana whoami)" = cloudana ] || fail "login user is not cloudana"
if [ "$(sshx 2201 cloudana sudo -n id -u)" != 0 ]; then
  sshx 2201 cloudana 'stat -c "%A %U %n" /usr/bin/sudo; grep -E "NoNewPrivs|Cap(Inh|Prm|Eff|Bnd)" /proc/self/status; grep -E " / |/usr" /proc/mounts' >&2 || true
  fail "passwordless sudo does not give root"
fi
sshx 2201 cloudana 'test -f ~/.profile && touch ~/written && test "$(stat -c %U ~)" = cloudana' || fail "home directory not handed to the user"
[ -e "$work/home/written" ] || fail "file written in the box is not on the bind-mounted home"
sshx 2201 cloudana 'sudo -n apt-get update -qq && sudo -n apt-get install -y -qq --no-install-recommends jq >/dev/null && jq --version' \
  || fail "apt-get install as root failed"
if sshx 2201 root true 2>/dev/null; then fail "root login was accepted"; fi
methods="$(ssh -v -p 2201 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o PubkeyAuthentication=no \
  cloudana@127.0.0.1 true 2>&1 | tr -d '\r' | grep -m1 'Authentications that can continue' || true)"
case "$methods" in *"continue: publickey") ;; *) fail "server offers more than publickey: $methods" ;; esac
if [ "$runtime" = runsc ]; then
  sshx 2201 cloudana 'sudo -n dmesg | head -1' | grep -q gVisor || fail "not running under gVisor"
  echo "   sandbox: $(sshx 2201 cloudana 'sudo -n dmesg | head -1')"
fi
echo "   ok: ssh as cloudana, sudo to root, apt install, home on the mount, root and passwords refused"

echo "== 2. plain workstation flags ($runtime): --cap-drop=ALL --security-opt=no-new-privileges, nothing added"
docker run --name m-plain "${common[@]}" --cap-drop=ALL --security-opt=no-new-privileges -p 127.0.0.1:2202:22 "$image" >/dev/null
if waitssh 2202; then fail "sshd ran with every capability dropped (expected it cannot)"; fi
echo "   ok: no login, as expected. Container log:"
docker logs m-plain 2>&1 | tail -5 | sed 's/^/     /'

echo "== 3. machine capabilities with no-new-privileges kept ($runtime)"
docker run --name m-nnp "${common[@]}" --cap-drop=ALL "${capadd[@]}" --security-opt=no-new-privileges -p 127.0.0.1:2203:22 "$image" >/dev/null
waitssh 2203 || fail "sshd needs only the capabilities, yet no login with no-new-privileges"
if sshx 2203 cloudana sudo -n true 2>"$work/sudo.err"; then
  echo "   sudo works with no-new-privileges under $runtime"
else
  echo "   sudo refused with no-new-privileges under $runtime: $(tail -1 "$work/sudo.err")"
fi
echo "smoke test passed ($runtime)"
