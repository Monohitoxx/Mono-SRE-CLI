---
name: ssh-troubleshoot
description: Systematic SSH troubleshooting for remote server issues including connectivity, performance, and service failures.
---

# SSH Troubleshoot

A systematic approach to troubleshooting remote server issues via SSH.

## Workflow

### 1. Initial Assessment
- Connect to the target host via SSH
- Check system uptime and load: `uptime`
- Check disk space: `df -h`
- Check memory usage: `free -h`
- Check running processes: `ps aux --sort=-%mem | head -20`

### 2. Service Health Check
- Check systemd service status: `systemctl status <service>`
- View recent logs: `journalctl -u <service> --since "1 hour ago"`
- Check listening ports: `ss -tlnp`
- Verify DNS resolution: `dig <hostname>`

### 3. Network Diagnostics
- Check network interfaces: `ip addr show`
- Check routing table: `ip route show`
- Test connectivity: `ping -c 3 <target>`
- Check firewall rules: `iptables -L -n` or `ufw status`

### 4. Log Analysis
- Check system logs: `journalctl -xe --since "30 min ago"`
- Check auth logs: `tail -100 /var/log/auth.log`
- Check application logs in /var/log/

### 5. Resolution
- Document findings clearly
- Propose fixes with explanation
- Always confirm before making changes
- Verify the fix resolved the issue
