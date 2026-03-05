---
name: log-analysis
description: Analyze system and application logs to identify errors, patterns, and root causes.
---

# Log Analysis

Systematic log analysis for identifying issues and patterns.

## Workflow

### 1. Identify Log Sources

#### System Logs (systemd / OS-level)
- System logs: `/var/log/syslog`, `/var/log/messages`
- Auth logs: `/var/log/auth.log`, `/var/log/secure`
- Journald: `journalctl -u <service>`

#### Service / Application Logs — Runtime Discovery (IMPORTANT)
When the user asks to check logs for a service or application, do NOT guess the log path. Follow this discovery flow:

**Step 1: Identify the runtime**
Determine HOW the service is started — this decides where logs live.
- `systemctl status <service>` — is it a systemd unit?
- `docker ps | grep <name>` — is it running as a Docker container?
- `docker compose ls` or check for `docker-compose.yml` — is it managed by Docker Compose?
- `kubectl get pods` — is it running in Kubernetes?
- `ps aux | grep <name>` — is it a bare process?

**Step 2: Based on runtime, find config and log location**

| Runtime | How to find logs |
|---------|-----------------|
| **systemd** | `journalctl -u <service>` or check `ExecStart=` in unit file for app-level log paths |
| **Docker (standalone)** | `docker logs <container>` for stdout/stderr; `docker inspect <container>` to check `LogPath` and volume mounts |
| **Docker Compose** | 1. Find compose file: `docker inspect <container>` → look at `com.docker.compose.project.working_dir` label, or search with `find / -name "docker-compose.yml" -o -name "compose.yml" 2>/dev/null`<br>2. Read the compose file to check `volumes:` for log mount paths<br>3. If logs are mounted to host → read log files directly from the host path<br>4. If no mount → use `docker logs <container>` |
| **Kubernetes** | `kubectl logs <pod>` for stdout; check pod spec `volumeMounts` for file-based logs, then `kubectl exec` to read them |
| **Bare process** | Check `/proc/<pid>/fd/1` symlink, or look for log path in the process command-line args or config file |

**Step 3: Retrieve logs using the appropriate method**
- If log files are mounted to the host filesystem → use `read_config` or `execute_command` to read them directly (faster and supports larger history)
- If logs are only in container stdout → use `docker logs --tail 200 <container>` or `kubectl logs --tail=200 <pod>`
- Always prefer host-mounted log files over `docker logs` when available — they are more complete and support better filtering

### 2. Time-Based Filtering
- Filter by time range: `journalctl --since "2 hours ago" --until "1 hour ago"`
- Docker logs by time: `docker logs --since 2h <container>`
- Use tail for recent entries: `tail -500 /path/to/log`
- grep with timestamps for specific windows

### 3. Pattern Detection
- Search for errors: `grep -i "error\|fail\|critical\|fatal" /path/to/log`
- Search for warnings: `grep -i "warn" /path/to/log`
- Count occurrences: `grep -c "pattern" /path/to/log`
- Unique error types: `grep -i error /path/to/log | sort | uniq -c | sort -rn`

### 4. Correlation
- Cross-reference timestamps across multiple log files
- Look for cascade failures
- Check if errors correlate with deployments or config changes

### 5. Summary
- Present findings in structured format
- Identify root cause vs symptoms
- Provide timestamps of key events
- Recommend remediation steps
