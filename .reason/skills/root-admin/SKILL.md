---
name: root-admin
description: System administration with root privileges - package installation, service configuration, system tuning, and security hardening.
---

# Root Admin

System administration tasks requiring elevated (root/sudo) privileges.

## Prerequisites
- Root mode must be enabled via `/root` command before using sudo tools
- Use `shell_sudo` for local root commands
- Use `ssh_exec_sudo` for remote root commands via SSH

## Workflow

### 1. Package Management
- **Debian/Ubuntu**: `apt update && apt install -y <package>`
- **RHEL/CentOS**: `yum install -y <package>` or `dnf install -y <package>`
- **Alpine**: `apk add <package>`
- Always update package lists before installing
- Check installed version: `dpkg -l <package>` or `rpm -q <package>`

### 2. Service Management
- Start/stop/restart: `systemctl restart <service>`
- Enable on boot: `systemctl enable <service>`
- Check status: `systemctl status <service>`
- View logs: `journalctl -u <service> -f`

### 3. System Configuration
- Edit config files: read first, show diff, then write
- Network config: `/etc/netplan/`, `/etc/network/interfaces`, `/etc/sysconfig/network-scripts/`
- DNS: `/etc/resolv.conf`, `/etc/hosts`
- Firewall: `ufw allow <port>` or `iptables -A INPUT -p tcp --dport <port> -j ACCEPT`
- Crontab: `crontab -e` or write to `/etc/cron.d/`

### 4. User & Permission Management
- Create user: `useradd -m -s /bin/bash <user>`
- Set password: `passwd <user>`
- Add to group: `usermod -aG <group> <user>`
- Set file permissions: `chmod`, `chown`

### 5. Security Hardening
- Update all packages: `apt upgrade -y` or `yum update -y`
- Configure SSH: `/etc/ssh/sshd_config`
- Set up fail2ban: `apt install fail2ban`
- Audit open ports: `ss -tlnp`

### Safety Rules
- ALWAYS show the command and explain what it does before executing
- NEVER run commands that could brick the system (overwrite boot, delete /)
- Take backups before modifying config files: `cp <file> <file>.bak`
- Verify changes after applying them
