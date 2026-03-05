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
- `kubectl get pods` — is it running in Kubernetes?
- `ps aux | grep <name>` — is it a bare process?

**Step 2: If Docker container found → MUST inspect before reading logs**
Do NOT jump straight to `docker logs`. Always inspect first to understand the setup:

```
docker inspect <container> --format '{{json .Config.Labels}}'
```
Check the labels for:
- `com.docker.compose.project.working_dir` → this is a Docker Compose service
- `com.docker.compose.project.config_files` → path to the compose file

Then inspect mounts:
```
docker inspect <container> --format '{{json .Mounts}}'
```
Look for volume mounts that contain log paths (e.g. `/var/log/`, `./logs:`, etc.).

**Step 2a: Docker Compose service**
If compose labels are found:
1. Read the compose file from `com.docker.compose.project.config_files` label (or `<working_dir>/docker-compose.yml`)
2. Check `volumes:` section for any log directory mounts to host
3. Check `logging:` section for custom log driver config
4. If logs are mounted to host → go directly to the host path to read log files (PREFERRED — more complete, supports grep/tail)
5. If no log mount → fall back to `docker logs <container> --tail 200`

**Step 2b: Standalone Docker container**
1. Check `docker inspect` output for `LogPath` (JSON log file path on host)
2. Check `Mounts` for volume-mounted log directories
3. If host-mounted logs exist → read them directly
4. Otherwise → `docker logs <container> --tail 200`

**Step 2c: Other runtimes**

| Runtime | How to find logs |
|---------|-----------------|
| **systemd** | `journalctl -u <service>` or check `ExecStart=` in unit file for app-level log paths |
| **Kubernetes** | `kubectl logs <pod>` for stdout; check pod spec `volumeMounts` for file-based logs, then `kubectl exec` to read them |
| **Bare process** | Check `/proc/<pid>/fd/1` symlink, or look for log path in the process command-line args or config file |

**Step 3: Retrieve logs using the appropriate method**
- If log files are mounted to the host filesystem → use `read_config` or `execute_command` to read them directly (faster, more complete history, supports grep/tail)
- If logs are only in container stdout → use `docker logs --tail 200 <container>` or `kubectl logs --tail=200 <pod>`
- Always prefer host-mounted log files over `docker logs` when available

**Common Pitfalls**
- `grep` returns exit code 1 when there are ZERO matches — this is NOT an error, it means no results found. Report "no matches" to the user instead of treating it as a failure.
- Do NOT skip `docker inspect` — jumping straight to `docker logs | grep` misses volume-mounted log files which are often more complete.
- Some apps write logs to files inside the container without mounting them. If `docker logs` is empty and no mounts exist, try: `docker exec <container> find /var/log /tmp /app -name "*.log" 2>/dev/null`

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
