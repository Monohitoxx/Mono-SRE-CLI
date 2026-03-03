---
name: log-analysis
description: Analyze system and application logs to identify errors, patterns, and root causes.
---

# Log Analysis

Systematic log analysis for identifying issues and patterns.

## Workflow

### 1. Identify Log Sources
- System logs: `/var/log/syslog`, `/var/log/messages`
- Auth logs: `/var/log/auth.log`, `/var/log/secure`
- Application logs: Check application-specific paths
- Journald: `journalctl -u <service>`
- Container logs: `docker logs <container>` or `kubectl logs <pod>`

### 2. Time-Based Filtering
- Filter by time range: `journalctl --since "2 hours ago" --until "1 hour ago"`
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
