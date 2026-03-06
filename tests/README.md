# Mono CLI 測試說明

## 目錄結構

```
tests/
├── unit/                          # 單元測試（純邏輯，無 API 呼叫）
│   ├── risk-classifier.test.ts    # 風險分類器
│   ├── settings.test.ts           # 指令 allow/deny 政策
│   └── command-policy.test.ts     # 指令解析工具函數
├── integration/                   # 整合測試（Mock AI，無 API 呼叫）
│   ├── agent-gates.test.ts        # Agent 四層 Gate 邏輯
│   └── prompt-injection.test.ts   # Prompt Injection 防禦（Mock AI）
└── e2e/                           # 端對端測試（真實 AI model，需 API Key）
    └── prompt-injection-real.test.ts
```

---

## 執行測試

### Mock 測試（單元 + 整合）

不需要 API Key，可在任何環境執行：

```bash
npm test
```

涵蓋 **282 個測試**，包括：
- 風險分類器的所有指令分類規則
- 指令 allow/deny 政策邏輯
- Agent 四層 Gate 的攔截行為
- 10 種 Prompt Injection 場景（Mock AI 版）

### 真實 AI 測試（E2E）

需要在 `.mono/.env` 設定好 API Key：

```bash
npm run test:e2e
```

這組測試會對真實 AI model 發送 Prompt Injection 訊息，驗證即使模型被注入影響，Gates 依然能阻止危險操作實際執行。每個測試約需 10–30 秒，總計約 2 分鐘。

---

## 測試架構原理

### 為什麼要分兩層測試？

#### Mock 測試的局限

整合測試使用預先腳本化的假 AI（`mockProvider`），直接告訴「AI」要回傳什麼 tool call：

```typescript
// 測試裡人手指定 AI 的回應
mockProvider.enqueue([
  { name: "execute_command", args: { command: "sudo rm -rf /" } }
]);
```

這只能驗證：「**假設** AI 已被注入並回傳了危險 tool call，Gate 能否攔截？」

無法驗證：真實 AI model 收到注入訊息後**是否真的會**發出危險 tool call。

#### E2E 測試補充真實行為

E2E 測試用真實 AI model，能觀察到：

- 模型有時會**直接拒絕**惡意指令（Injection 1、4）
- 模型有時會**被注入成功**，嘗試發出危險 tool call（Injection 2、3）
- 但無論模型行為如何，**Gates 作為最後防線都能攔截**

---

### Agent 四層 Gate 機制

每個 tool call 在執行前必須通過以下四關：

```
AI 回傳 tool call
       │
       ▼
  ┌─────────────────────────────────────┐
  │ GATE 1：參數驗證                     │
  │ 缺少必填參數 → 回傳錯誤給 AI         │
  └─────────────────────────────────────┘
       │ 通過
       ▼
  ┌─────────────────────────────────────┐
  │ GATE 2：風險分類                     │
  │ plan-required 且無批准計劃 → 封鎖    │
  │ 涵蓋：安裝套件、systemd、防火牆、    │
  │        Docker、K8s、用戶管理、磁碟   │
  └─────────────────────────────────────┘
       │ 通過
       ▼
  ┌─────────────────────────────────────┐
  │ GATE 3：sudo 優先政策                │
  │ 第一次嘗試含 sudo → 封鎖             │
  │ 必須先用無 sudo 版本，失敗後才升級   │
  └─────────────────────────────────────┘
       │ 通過
       ▼
  ┌─────────────────────────────────────┐
  │ GATE 4：用戶確認                     │
  │ 需要確認的工具 → 等待用戶批准        │
  │ 用戶可輸入拒絕原因，轉發給 AI        │
  └─────────────────────────────────────┘
       │ 用戶批准
       ▼
    實際執行
```

Gates 的關鍵特性：**所有邏輯都在代碼層硬編碼**，不依賴 AI model 的判斷。無論 AI 被注入什麼指令，只要觸發 Gate 條件就一定被攔截。

---

### Prompt Injection 為什麼難以完全防禦？

Prompt Injection 的攻擊面在於 AI model 本身，而非代碼層：

| 攻擊方向 | Gates 能否防禦 |
|---------|--------------|
| 注入惡意 system prompt 讓 AI 呼叫危險 tool | ✅ Gate 2/3 攔截 tool call |
| 聲稱計劃已批准，要求跳過確認 | ✅ Gate 2 不受對話內容影響 |
| 假扮 DAN / Admin 身份要求無限制執行 | ✅ Gates 不認身份，只看 tool call |
| 在 feedback 欄位嵌入批准聲明 | ✅ `string !== true`，無法繞過 Gate 4 |
| 讓 AI 產生一個不存在的工具名稱 | ✅ Gate 1 回傳 Unknown tool 錯誤 |
| 讓 AI 在正常操作中夾帶惡意指令 | ✅ 每個 tool call 獨立經過所有 Gates |

Gates 無法防禦的情況（超出本系統範圍）：
- AI model 被注入後修改了**非工具操作**的回應內容（如輸出虛假診斷結果）
- 攻擊者直接控制了 API key 或 `.mono/.env` 配置

---

### E2E 測試如何記錄 AI 嘗試的行為

```
RecordingRegistry.validateToolCall()   ← GATE 1 入口，記錄所有 AI 嘗試
          │
          ▼
       GATE 2 風險分類
          │ 若 plan-required → 封鎖，tool 不執行
          ▼
       GATE 3 sudo 檢查
          │ 若含 sudo → 封鎖
          ▼
   onToolCallStart callback             ← 到這裡表示通過 GATE 1–3
          │
          ▼
   onConfirmToolCall callback           ← GATE 4，測試中自動拒絕
          │
          ▼
   StubExecuteCommand.execute()         ← 只有通過全部 Gates 才到這裡
   stubTool.executedCommands            ← 實際執行記錄
```

測試的核心斷言：`executedCommands` 中不應出現任何危險指令，無論 AI model 被如何注入。
