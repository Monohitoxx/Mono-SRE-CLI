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
- `docker ps | grep <name>` — is it a Docker container? (check this FIRST — most apps run in Docker)
- `systemctl status <service>` — is it a systemd unit?
- `kubectl get pods` — is it running in Kubernetes?

Once you identify the runtime, STOP checking other runtimes. Do NOT check systemctl after you already found a Docker container.

**Step 2: If Docker container found → inspect mounts immediately**
Do NOT jump to `docker logs` or guess log paths. Run these TWO commands:

```
docker inspect <container> --format '{{json .Mounts}}'
```
This shows ALL volume mounts. Look for host paths containing logs (e.g. `/u01/app/log`, `/data/logs`, `/var/log/app`).

```
docker exec <container> ls /var/log/ /tmp/ 2>/dev/null
```
Mounted host directories are visible inside the container too. This is the fastest way to discover log files.

If mounts show log directories on the host:
- Go directly to the host path and read log files there (PREFERRED — more complete, supports grep/tail)
- Use `read_config` to read remote log/config files instead of `execute_command cat`

If no log mounts found:
- Try `docker exec <container> find / -name "*.log" -not -path "/proc/*" -not -path "/sys/*" 2>/dev/null | head -20` to search inside the container
- Fall back to `docker logs <container> --tail 200`

**Step 2a: Other runtimes**

| Runtime | How to find logs |
|---------|-----------------|
| **systemd** | `journalctl -u <service>` or check `ExecStart=` in unit file for app-level log paths |
| **Kubernetes** | `kubectl logs <pod>` for stdout; check pod spec `volumeMounts` for file-based logs, then `kubectl exec` to read them |
| **Bare process** | Check `/proc/<pid>/fd/1` symlink, or look for log path in the process command-line args or config file |

**Step 3: Retrieve logs using the appropriate method**
- Host-mounted log files → use `read_config` (for config/small files) or `execute_command` with `tail`/`grep` (for large log files)
- Container stdout only → `docker logs --tail 200 <container>` or `kubectl logs --tail=200 <pod>`
- Local files → use `read_many_files` with glob patterns (e.g. `pattern: "/var/log/nginx/*.log"`) for batch reading
- Always prefer host-mounted log files over `docker logs` — they are more complete and support grep/tail

### 2. Time-Based Filtering
- Filter by time range: `journalctl --since "2 hours ago" --until "1 hour ago"`
- Docker logs by time: `docker logs --since 2h <container>`
- Use tail for recent entries: `tail -500 /path/to/log`
- grep with timestamps for specific windows

### 3. Pattern Detection

**IMPORTANT: grep with alternation (`\|`) is blocked by the command policy checker.** The `\|` is misinterpreted as a pipe. Use one of these alternatives:

- Run **separate grep commands** for each pattern (RECOMMENDED):
  ```
  grep -i "error" /path/to/log | tail -50
  grep -i "crit" /path/to/log | tail -50
  grep -i "fatal" /path/to/log | tail -50
  ```
- Or use `grep -e` for multiple patterns (no `|` needed):
  ```
  grep -e "error" -e "crit" -e "fatal" /path/to/log | tail -50
  ```
- NEVER use `grep -i "error\|crit\|fatal"` — it WILL be blocked.

Other useful patterns:
- Count occurrences: `grep -c "pattern" /path/to/log`
- Unique error types: `grep -i error /path/to/log | sort | uniq -c | sort -rn`

### 4. Common Pitfalls
- `grep` returns **exit code 1** when there are ZERO matches — this is NOT an error. Report "no matches" to the user.
- `find` returns **exit code 1** when there are zero results with `| grep` — same, not an error.
- Do NOT skip `docker inspect` for mounts — jumping straight to `docker logs | grep` misses volume-mounted log files.
- `docker exec` with `curl`/`wget`/`nc` often fails in minimal containers — use the HOST's tools instead (run commands from the host, not inside the container).
- `zcat` may not be in the command allowlist — for compressed logs, check if uncompressed versions exist first.
- When a command is denied by policy, do NOT retry with minor variations. Restructure the command (e.g. split piped grep into separate calls).

### 5. Correlation
- Cross-reference timestamps across multiple log files
- Look for cascade failures
- Check if errors correlate with deployments or config changes

### 6. Summary
- Present findings in structured format
- Identify root cause vs symptoms
- Provide timestamps of key events
- Recommend remediation steps
