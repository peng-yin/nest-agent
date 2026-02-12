# API 文档

> 基础路径：`/api/v1`  
> 认证方式：JWT Bearer Token（除 Auth 接口外，所有接口均需 `Authorization: Bearer <token>` 头）  
> 响应格式：JSON  
> 流式接口：SSE（`text/event-stream`），遵循 AG-UI 协议

---

## 1. 认证 Auth

### 1.1 注册

```
POST /api/v1/auth/register
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱格式 |
| password | string | 是 | 最少 6 位 |
| name | string | 是 | 用户名 |
| tenantId | string | 是 | 租户 ID |

**响应示例：**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "name": "张三",
    "tenantId": "tenant-001"
  }
}
```

### 1.2 登录

```
POST /api/v1/auth/login
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| email | string | 是 | 邮箱格式 |
| password | string | 是 | 密码 |

**响应：** 同注册

---

## 2. 对话 Chat

### 2.1 流式对话（核心接口）

```
POST /api/v1/chat/completions
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | 是 | 用户消息 |
| conversationId | string(uuid) | 否 | 会话 ID，不传则自动创建 |
| workflowId | string(uuid) | 否 | 工作流 ID，传入则走 DAG 编排模式 |
| llmOptions | object | 否 | LLM 参数 |
| llmOptions.provider | string | 否 | `openai` / `anthropic` / `dashscope` |
| llmOptions.model | string | 否 | 模型名称 |
| llmOptions.temperature | number | 否 | 0 ~ 2 |

**响应：** `text/event-stream`，AG-UI 事件流

```
event: RUN_STARTED
data: {"type":"RUN_STARTED","threadId":"xxx","runId":"xxx"}

event: STEP_STARTED
data: {"type":"STEP_STARTED","stepName":"researcher"}

event: TOOL_CALL_START
data: {"type":"TOOL_CALL_START","toolCallId":"xxx","toolCallName":"web_search"}

event: TOOL_CALL_ARGS
data: {"type":"TOOL_CALL_ARGS","toolCallId":"xxx","delta":"{\"query\":\"...\"}" }

event: TOOL_CALL_END
data: {"type":"TOOL_CALL_END","toolCallId":"xxx"}

event: TEXT_MESSAGE_START
data: {"type":"TEXT_MESSAGE_START","messageId":"xxx","role":"assistant"}

event: TEXT_MESSAGE_CONTENT
data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"xxx","delta":"回答内容..."}

event: TEXT_MESSAGE_END
data: {"type":"TEXT_MESSAGE_END","messageId":"xxx"}

event: STEP_FINISHED
data: {"type":"STEP_FINISHED","stepName":"researcher"}

event: TOOL_CALL_RESULT
data: {"type":"TOOL_CALL_RESULT","messageId":"xxx","toolCallId":"xxx","role":"tool","content":"..."}

event: RUN_FINISHED
data: {"type":"RUN_FINISHED","threadId":"xxx","runId":"xxx"}

event: done
data: [DONE]
```

### 2.2 创建会话

```
POST /api/v1/chat/conversations
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 否 | 会话标题 |
| workflowId | string(uuid) | 否 | 关联工作流 |

**响应：** `Conversation` 对象

### 2.3 获取会话列表

```
GET /api/v1/chat/conversations
```

**响应：** `Conversation[]`，按更新时间倒序

### 2.4 获取会话消息

```
GET /api/v1/chat/conversations/:id/messages
```

**响应：** `Message[]`，按创建时间正序

### 2.5 删除会话

```
DELETE /api/v1/chat/conversations/:id
```

**响应：** `{ "success": true }`

---

## 3. 工作流 Workflow

### 3.1 创建工作流

```
POST /api/v1/workflows
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 工作流名称 |
| description | string | 否 | 描述 |
| nodes | WorkflowNode[] | 是 | DAG 节点列表 |
| edges | WorkflowEdge[] | 是 | DAG 边列表 |
| globalVariables | object | 否 | 全局变量 |

**WorkflowNode：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 节点唯一 ID |
| type | string | `agent` / `tool` / `condition` / `start` / `end` |
| name | string | 节点名称 |
| config | object | 节点配置（agent 的 prompt/tools，tool 的 toolName/input 等） |

**WorkflowEdge：**

| 字段 | 类型 | 说明 |
|------|------|------|
| source | string | 源节点 ID |
| target | string | 目标节点 ID |
| condition | string | 可选，条件节点的匹配关键词 |

**请求体示例：**

```json
{
  "name": "研究工作流",
  "nodes": [
    { "id": "s", "type": "start", "name": "开始", "config": {} },
    { "id": "r", "type": "agent", "name": "researcher", "config": { "prompt": "你是研究助手", "tools": ["web_search"] } },
    { "id": "e", "type": "end", "name": "结束", "config": {} }
  ],
  "edges": [
    { "source": "s", "target": "r" },
    { "source": "r", "target": "e" }
  ]
}
```

### 3.2 获取工作流列表

```
GET /api/v1/workflows
```

### 3.3 获取工作流详情

```
GET /api/v1/workflows/:id
```

### 3.4 更新工作流

```
PUT /api/v1/workflows/:id
```

**请求体：** 同创建，所有字段均可选

### 3.5 删除工作流

```
DELETE /api/v1/workflows/:id
```

**响应：** `{ "success": true }`

---

## 4. 知识库 Knowledge Base

### 4.1 创建知识库

```
POST /api/v1/knowledge-bases
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 知识库名称 |
| description | string | 否 | 描述 |
| chunkSize | number | 否 | 文档分块大小，默认 1000 |
| chunkOverlap | number | 否 | 分块重叠大小，默认 200 |

### 4.2 获取知识库列表

```
GET /api/v1/knowledge-bases
```

### 4.3 添加文档

```
POST /api/v1/knowledge-bases/:id/documents
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| documents | array | 是 | 文档列表 |
| documents[].content | string | 是 | 文档内容 |
| documents[].metadata | object | 否 | 元数据 |

**响应：**

```json
{ "chunksCreated": 15 }
```

### 4.4 语义检索

```
POST /api/v1/knowledge-bases/:id/search
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| query | string | 是 | 查询文本 |
| topK | number | 否 | 返回条数，默认 5 |

**响应：**

```json
[
  { "text": "匹配的文本片段...", "metadata": {}, "score": 0.92 }
]
```

### 4.5 删除知识库

```
DELETE /api/v1/knowledge-bases/:id
```

**响应：** `{ "success": true }`

---

## 5. AG-UI 事件类型一览

| 事件类型 | 说明 | 关键字段 |
|---------|------|---------|
| `RUN_STARTED` | 运行开始 | threadId, runId |
| `RUN_FINISHED` | 运行结束 | threadId, runId |
| `RUN_ERROR` | 运行出错 | message, code? |
| `STEP_STARTED` | 步骤/Agent 开始 | stepName |
| `STEP_FINISHED` | 步骤/Agent 结束 | stepName |
| `TEXT_MESSAGE_START` | 文本消息开始 | messageId, role |
| `TEXT_MESSAGE_CONTENT` | 文本消息增量内容 | messageId, delta |
| `TEXT_MESSAGE_END` | 文本消息结束 | messageId |
| `TOOL_CALL_START` | 工具调用开始 | toolCallId, toolCallName |
| `TOOL_CALL_ARGS` | 工具调用参数（增量） | toolCallId, delta |
| `TOOL_CALL_END` | 工具调用结束 | toolCallId |
| `TOOL_CALL_RESULT` | 工具调用结果 | toolCallId, content |
| `CUSTOM` | 自定义事件 | name, value |

---

## 6. 错误响应格式

所有接口的错误响应统一格式：

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    { "path": "email", "message": "Invalid email" }
  ],
  "timestamp": "2026-02-12T08:00:00.000Z"
}
```

| 状态码 | 场景 |
|--------|------|
| 400 | 参数校验失败（Zod） |
| 401 | 未认证 / Token 无效 |
| 403 | 租户校验失败 |
| 404 | 资源不存在 |
| 409 | 邮箱已注册 |
| 500 | 服务器内部错误 |
