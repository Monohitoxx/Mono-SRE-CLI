---
name: ssh-troubleshoot
description: Systematic SSH troubleshooting for remote server issues including connectivity, performance, and service failures.
---

# SSH Troubleshoot

A systematic approach to troubleshooting remote server issues via SSH.

## Tool Selection (MUST follow)
- **systemd services** → `service_control` (status checks)
- **health checks** → `run_healthcheck` (ping, disk, memory, cpu, port, service)
- **config files** → `read_config`
- **everything else** → `execute_command` (one command per call)

## Workflow

### 1. Initial Assessment
Use `run_healthcheck` for quick system overview:
```
run_healthcheck({ host: "<host>", checks: ["ping", "disk", "memory", "cpu"] })
```

Then gather details with individual commands:
- System uptime: `execute_command({ command: "uptime", host: "<host>" })`
- Top processes: `execute_command({ command: "ps aux --sort=-%mem", host: "<host>" })`

### 2. Service Health Check
Use `service_control` for systemd services:
```
service_control({ service: "<name>", action: "status", host: "<host>" })
```

Check logs and ports with `execute_command`:
- Recent logs: `execute_command({ command: "journalctl -u <service> --since '1 hour ago' --no-pager", host: "<host>" })`
- Listening ports: `execute_command({ command: "ss -tlnp", host: "<host>" })`
- DNS resolution: `execute_command({ command: "dig <hostname>", host: "<host>" })`

### 3. Network Diagnostics
- Check interfaces: `execute_command({ command: "ip addr show", host: "<host>" })`
- Check routing: `execute_command({ command: "ip route show", host: "<host>" })`
- Test connectivity: `execute_command({ command: "ping -c 3 <target>", host: "<host>" })`
- Firewall rules: `execute_command({ command: "ufw status", host: "<host>" })`

### 4. Log Analysis
Use `read_config` for reading log files:
```
read_config({ config_path: "/var/log/auth.log", host: "<host>" })
```

Or use `execute_command` for filtered/recent logs:
- System logs: `execute_command({ command: "journalctl -xe --since '30 min ago' --no-pager", host: "<host>" })`

### 5. Resolution
- Document findings clearly
- Propose fixes with explanation
- Modifying operations require an approved **plan** first
- Always confirm before making changes
- Verify the fix resolved the issue
