---
name: k8s-debug
description: Kubernetes cluster debugging and troubleshooting for pods, deployments, services, and nodes.
---

# Kubernetes Debug

Systematic Kubernetes debugging workflow.

## Workflow

### 1. Cluster Overview
- Check cluster status: `kubectl cluster-info`
- List nodes and status: `kubectl get nodes -o wide`
- Check component status: `kubectl get componentstatuses`

### 2. Pod Troubleshooting
- List pods with status: `kubectl get pods -A -o wide`
- Describe failing pod: `kubectl describe pod <pod> -n <ns>`
- Check pod logs: `kubectl logs <pod> -n <ns> --tail=100`
- Check previous container logs: `kubectl logs <pod> -n <ns> --previous`
- Check events: `kubectl get events -n <ns> --sort-by='.lastTimestamp'`

### 3. Deployment Issues
- Check deployment status: `kubectl get deploy -n <ns>`
- Check rollout status: `kubectl rollout status deploy/<name> -n <ns>`
- Check replica sets: `kubectl get rs -n <ns>`

### 4. Service & Networking
- Check services: `kubectl get svc -n <ns>`
- Check endpoints: `kubectl get endpoints -n <ns>`
- Check ingress: `kubectl get ingress -n <ns>`
- Test DNS from pod: `kubectl exec <pod> -n <ns> -- nslookup <svc>`

### 5. Resource Issues
- Check resource usage: `kubectl top nodes` / `kubectl top pods -n <ns>`
- Check resource quotas: `kubectl get resourcequota -n <ns>`
- Check PVCs: `kubectl get pvc -n <ns>`

### 6. Common Patterns
- CrashLoopBackOff: Check logs, resource limits, health probes
- ImagePullBackOff: Check image name, registry auth, network
- Pending: Check node resources, affinity rules, taints
- OOMKilled: Increase memory limits
