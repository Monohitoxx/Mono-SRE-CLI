/**
 * Unit tests for classifyToolCallRisk.
 * Covers: plan-exempt tools, service_control, write_config,
 * all plan-required categories, read-only patterns, and sudo catch-all.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { classifyToolCallRisk } from "../../src/core/risk-classifier.js";

// ─── Plan-exempt tools ────────────────────────────────────────────────────

describe("plan-exempt tools → always read-only", () => {
  const exemptTools = [
    "plan", "plan_progress", "inventory_lookup", "read_config",
    "run_healthcheck", "ask_user", "web_search", "web_fetch",
    "save_memory", "grep_search", "read_many_files", "read_file",
    "inventory_add", "inventory_remove", "activate_skill",
  ];

  for (const tool of exemptTools) {
    test(`${tool} is read-only`, () => {
      const r = classifyToolCallRisk(tool, {});
      assert.equal(r.level, "read-only", `${tool} should be exempt from plan requirement`);
    });
  }
});

// ─── service_control ─────────────────────────────────────────────────────

describe("service_control", () => {
  test("action=status → read-only", () => {
    const r = classifyToolCallRisk("service_control", { action: "status", service: "nginx" });
    assert.equal(r.level, "read-only");
  });

  for (const action of ["start", "stop", "restart", "reload", "enable", "disable"]) {
    test(`action=${action} → plan-required`, () => {
      const r = classifyToolCallRisk("service_control", { action, service: "nginx" });
      assert.equal(r.level, "plan-required");
      assert.ok(r.matchedPatterns.includes("service-lifecycle"));
    });
  }
});

// ─── write_config ─────────────────────────────────────────────────────────

describe("write_config → always plan-required", () => {
  test("any write_config call requires plan", () => {
    const r = classifyToolCallRisk("write_config", {
      config_path: "/etc/nginx/nginx.conf",
      content: "worker_processes 4;",
    });
    assert.equal(r.level, "plan-required");
    assert.deepEqual(r.matchedPatterns, ["config-write"]);
  });
});

// ─── execute_command: package management ─────────────────────────────────

describe("execute_command — package management → plan-required", () => {
  const cases = [
    "apt-get install nginx",
    "apt install curl",
    "apt-get remove curl",
    "apt-get purge openssh-server",
    "dnf install httpd",
    "yum remove httpd",
    "pip install requests",
    "pip3 install flask",
    "npm install -g nodemon",
    "npm uninstall -g pm2",
    "gem install bundler",
    "rpm -i package.rpm",
    "dpkg -i package.deb",
    "dpkg -r package",
  ];

  for (const cmd of cases) {
    test(`"${cmd}"`, () => {
      const r = classifyToolCallRisk("execute_command", { command: cmd });
      assert.equal(r.level, "plan-required", `"${cmd}" should require a plan`);
      assert.ok(r.matchedPatterns.includes("package-management"));
    });
  }
});

// ─── execute_command: service lifecycle ──────────────────────────────────

describe("execute_command — service lifecycle → plan-required", () => {
  const cases = [
    "systemctl restart nginx",
    "systemctl stop apache2",
    "systemctl start redis",
    "systemctl enable sshd",
    "systemctl disable firewalld",
    "systemctl reload nginx",
    "systemctl daemon-reload",
    "service nginx restart",
    "service mysql stop",
  ];

  for (const cmd of cases) {
    test(`"${cmd}"`, () => {
      const r = classifyToolCallRisk("execute_command", { command: cmd });
      assert.equal(r.level, "plan-required");
      assert.ok(r.matchedPatterns.includes("service-lifecycle"));
    });
  }
});

// ─── execute_command: config write ────────────────────────────────────────

describe("execute_command — config write → plan-required", () => {
  const cases = [
    "tee > /etc/hosts",
    "cat file.conf > /etc/nginx/nginx.conf",
    "echo 'nameserver 8.8.8.8' > /etc/resolv.conf",
    "sed -i 's/foo/bar/' /etc/ssh/sshd_config",
    "cp nginx.conf /etc/nginx/nginx.conf",
    "mv new.conf /etc/nginx/nginx.conf",
    "chmod 600 /etc/ssh/sshd_config",
    "chown root:root /etc/hosts",
  ];

  for (const cmd of cases) {
    test(`"${cmd}"`, () => {
      const r = classifyToolCallRisk("execute_command", { command: cmd });
      assert.equal(r.level, "plan-required");
      assert.ok(r.matchedPatterns.includes("config-write"));
    });
  }
});

// ─── execute_command: firewall ────────────────────────────────────────────

describe("execute_command — firewall → plan-required", () => {
  const cases = [
    "iptables -A INPUT -p tcp --dport 80 -j ACCEPT",
    "ip6tables -P FORWARD DROP",
    "firewall-cmd --add-port=443/tcp",
    "ufw allow 22/tcp",
    "ufw deny 3306",
    "ufw enable",
    "ufw disable",
    "nft add rule inet filter input drop",
  ];

  for (const cmd of cases) {
    test(`"${cmd}"`, () => {
      const r = classifyToolCallRisk("execute_command", { command: cmd });
      assert.equal(r.level, "plan-required");
      assert.ok(r.matchedPatterns.includes("firewall"));
    });
  }
});

// ─── execute_command: docker ──────────────────────────────────────────────

describe("execute_command — docker mutating → plan-required", () => {
  const dangerous = [
    "docker run -d --name web nginx",
    "docker rm my-container",
    "docker stop db",
    "docker kill api",
    "docker pull nginx:latest",
    "docker build -t myapp .",
    "docker network create my-net",
    "docker volume rm old-vol",
    "docker-compose up -d",
    "docker-compose down",
  ];

  for (const cmd of dangerous) {
    test(`"${cmd}" requires plan`, () => {
      const r = classifyToolCallRisk("execute_command", { command: cmd });
      assert.equal(r.level, "plan-required");
      assert.ok(r.matchedPatterns.includes("docker"));
    });
  }

  test('"docker ps" is read-only', () => {
    assert.equal(
      classifyToolCallRisk("execute_command", { command: "docker ps" }).level,
      "read-only",
    );
  });

  test('"docker logs my-app" is read-only', () => {
    assert.equal(
      classifyToolCallRisk("execute_command", { command: "docker logs my-app" }).level,
      "read-only",
    );
  });
});

// ─── execute_command: kubernetes ─────────────────────────────────────────

describe("execute_command — kubernetes mutating → plan-required", () => {
  const dangerous = [
    "kubectl apply -f deployment.yaml",
    "kubectl delete pod my-pod",
    "kubectl scale deployment web --replicas=3",
    "kubectl rollout restart deployment/api",
    "kubectl patch svc web -p '{}'",
    "kubectl drain node1",
    "kubectl cordon node2",
    "helm install myapp ./chart",
    "helm upgrade myapp ./chart",
    "helm uninstall myapp",
  ];

  for (const cmd of dangerous) {
    test(`"${cmd}" requires plan`, () => {
      const r = classifyToolCallRisk("execute_command", { command: cmd });
      assert.equal(r.level, "plan-required");
      assert.ok(r.matchedPatterns.includes("kubernetes"));
    });
  }

  test('"kubectl get pods" is read-only', () => {
    assert.equal(
      classifyToolCallRisk("execute_command", { command: "kubectl get pods" }).level,
      "read-only",
    );
  });

  test('"kubectl logs my-pod" is read-only', () => {
    assert.equal(
      classifyToolCallRisk("execute_command", { command: "kubectl logs my-pod" }).level,
      "read-only",
    );
  });
});

// ─── execute_command: user management ────────────────────────────────────

describe("execute_command — user management → plan-required", () => {
  const cases = [
    "useradd deploy",
    "userdel testuser",
    "usermod -aG sudo alice",
    "groupadd devs",
    "groupdel devs",
    "passwd alice",
    "chpasswd",
    "visudo",
  ];

  for (const cmd of cases) {
    test(`"${cmd}"`, () => {
      const r = classifyToolCallRisk("execute_command", { command: cmd });
      assert.equal(r.level, "plan-required");
      assert.ok(r.matchedPatterns.includes("user-management"));
    });
  }
});

// ─── execute_command: disk / storage ─────────────────────────────────────

describe("execute_command — disk/storage → plan-required", () => {
  const cases = [
    "mkfs.ext4 /dev/sdb",
    "fdisk /dev/sdb",
    "parted /dev/sdc",
    "pvcreate /dev/sdb",
    "vgcreate vg0 /dev/sdb",
    "lvcreate -L 10G vg0",
    "mount /dev/sdb1 /mnt/data",
    "umount /mnt/data",
    "dd if=/dev/zero of=/dev/sdb bs=512",
  ];

  for (const cmd of cases) {
    test(`"${cmd}"`, () => {
      const r = classifyToolCallRisk("execute_command", { command: cmd });
      assert.equal(r.level, "plan-required");
      assert.ok(r.matchedPatterns.includes("disk-storage"));
    });
  }
});

// ─── execute_command: read-only ───────────────────────────────────────────

describe("execute_command — read-only commands", () => {
  const cases = [
    "df -h",
    "free -m",
    "uptime",
    "ps aux",
    "ps -ef | grep nginx",
    "top -b -n 1",
    "systemctl status nginx",
    "systemctl is-active sshd",
    "systemctl list-units",
    "journalctl -u nginx --since today",
    "dmesg | tail -20",
    "cat /etc/os-release",
    "cat /etc/hostname",
    "cat /etc/hosts",
    "cat /etc/resolv.conf",
    "hostname",
    "uname -r",
    "id",
    "whoami",
    "netstat -tlnp",
    "ss -tlnp",
    "ip addr show",
    "ip route show",
    "ping -c 3 8.8.8.8",
    "dig google.com",
    "nslookup google.com",
    "ls -la /etc",
    "find /var/log -name '*.log'",
    "df -h | grep /dev",
    "docker ps",
    "docker images",
    "kubectl get pods",
    "kubectl describe deployment web",
    "kubectl logs my-pod",
    "helm list",
    "rpm -qa | grep nginx",
    "dpkg -l | grep ssh",
    "apt list --installed",
  ];

  for (const cmd of cases) {
    test(`"${cmd}"`, () => {
      const r = classifyToolCallRisk("execute_command", { command: cmd });
      assert.equal(r.level, "read-only", `"${cmd}" should be read-only`);
    });
  }
});

// ─── execute_command: unclassified sudo → plan-required ───────────────────

describe("execute_command — unclassified sudo → plan-required (conservative policy)", () => {
  const cases = [
    "sudo rm -rf /tmp/olddata",
    "sudo chmod 777 /var/data",
  ];

  for (const cmd of cases) {
    test(`"${cmd}"`, () => {
      const r = classifyToolCallRisk("execute_command", { command: cmd });
      assert.equal(r.level, "plan-required");
      assert.ok(r.matchedPatterns.includes("sudo"));
    });
  }
});

// ─── execute_command: sudo classifier edge cases ──────────────────────────

describe("execute_command — sudo classifier edge cases", () => {
  test('"sudo ln -s /tmp/x /etc/x" → plan-required via config-write (ln to /etc/)', () => {
    const r = classifyToolCallRisk("execute_command", { command: "sudo ln -s /tmp/x /etc/x" });
    assert.equal(r.level, "plan-required");
    // The config-write pattern (/\b(cp|mv|ln)\b.*\/etc\//) fires before sudo catch-all
    assert.ok(r.matchedPatterns.includes("config-write"), `Got: ${r.matchedPatterns}`);
  });

  test('"cat file | sudo tee /tmp/output" → read-only (cat matches read-only before sudo catch-all)', () => {
    // cat matches READ_ONLY_PATTERNS before the sudo pipe check is reached
    const r = classifyToolCallRisk("execute_command", { command: "cat file | sudo tee /tmp/output" });
    assert.equal(r.level, "read-only");
  });

  test('"cat file | sudo tee > /etc/nginx.conf" → plan-required (config-write to /etc/)', () => {
    const r = classifyToolCallRisk("execute_command", { command: "cat file | sudo tee > /etc/nginx.conf" });
    assert.equal(r.level, "plan-required");
    assert.ok(r.matchedPatterns.includes("config-write"));
  });
});

// ─── execute_command: low-risk (no pattern match) ─────────────────────────

describe("execute_command — low-risk commands (no pattern match)", () => {
  test("custom script path", () => {
    const r = classifyToolCallRisk("execute_command", { command: "/opt/app/healthcheck.sh" });
    assert.equal(r.level, "low");
  });

  test("empty command arg", () => {
    const r = classifyToolCallRisk("execute_command", {});
    assert.equal(r.level, "low");
    assert.equal(r.reason, "no command argument");
  });
});
