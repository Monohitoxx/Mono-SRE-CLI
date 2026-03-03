---
name: root-admin
description: System administration with root privileges - package installation, service configuration, system tuning, and security hardening.
---

# Root Admin

System administration tasks requiring elevated (root/sudo) privileges.

## Prerequisites
- Target remote hosts via inventory (`host`, `hosts`, or `tags`)
- Use the correct specialized tool for each operation (see Tool Selection below)
- Do NOT put `sudo` in tool arguments; the system escalates automatically after permission errors
- Modifying operations (package install, service changes, config writes) require an approved **plan** first

## Tool Selection (MUST follow)
- **systemd services** → `service_control` (start/stop/restart/reload/status/enable/disable)
- **read config files** → `read_config`
- **write config files** → `write_config` (auto-backup)
- **health checks** → `run_healthcheck` (ping, disk, memory, cpu, port, service, http)
- **everything else** → `execute_command` (one command per call, no `&&` or `|` chaining)

## Workflow

### 1. Package Management
Requires a **plan** — the system will block without one.

- **Debian/Ubuntu**: `apt update` then `apt install -y <package>` (separate commands)
- **RHEL/CentOS**: `dnf install -y <package>` or `yum install -y <package>`
- **Alpine**: `apk add <package>`
- Always update package lists before installing
- Check installed version: `dpkg -l <package>` or `rpm -q <package>`

### 2. Service Management
Use `service_control` tool — do NOT use `execute_command` with `systemctl`.

- Start/stop/restart: `service_control({ service: "<name>", action: "restart", host: "<host>" })`
- Enable on boot: `service_control({ service: "<name>", action: "enable", host: "<host>" })`
- Check status: `service_control({ service: "<name>", action: "status", host: "<host>" })`
- View logs: `execute_command({ command: "journalctl -u <service> --no-pager -n 50", host: "<host>" })`

### 3. System Configuration
Use `read_config` / `write_config` — do NOT use `execute_command` with cat/tee/echo.

- Read first with `read_config`, show diff, then write with `write_config`
- Network config: `/etc/netplan/`, `/etc/network/interfaces`, `/etc/sysconfig/network-scripts/`
- DNS: `/etc/resolv.conf`, `/etc/hosts`
- Firewall: use `execute_command` with `ufw` or `iptables`

### 4. User & Permission Management
- Create user: `execute_command({ command: "useradd -m -s /bin/bash <user>", host: "<host>" })`
- Add to group: `execute_command({ command: "usermod -aG <group> <user>", host: "<host>" })`
- Set file permissions: `execute_command` with `chmod` / `chown`

### 5. Security Hardening
- Update all packages: `apt upgrade -y` or `yum update -y` (requires plan)
- Configure SSH: use `read_config` / `write_config` for `/etc/ssh/sshd_config`
- Audit open ports: `execute_command({ command: "ss -tlnp", host: "<host>" })`

### Safety Rules
- Modifying operations MUST use an approved plan (the system enforces this)
- Run ONE command per `execute_command` call — no `&&`, `||`, `;`, or `|` chaining
- NEVER run commands that could brick the system (overwrite boot, delete /)
- `write_config` creates backups automatically
- Verify changes after applying them
