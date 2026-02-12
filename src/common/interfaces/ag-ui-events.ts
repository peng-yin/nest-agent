import { randomUUID } from 'crypto';

/**
 * AG-UI (Agent User Interaction Protocol) 事件类型
 * @see https://docs.ag-ui.com/concepts/events
 */
export enum EventType {
  // 生命周期事件
  RUN_STARTED = 'RUN_STARTED',
  RUN_FINISHED = 'RUN_FINISHED',
  RUN_ERROR = 'RUN_ERROR',
  STEP_STARTED = 'STEP_STARTED',
  STEP_FINISHED = 'STEP_FINISHED',

  // 文本消息事件（Start-Content-End 三段式）
  TEXT_MESSAGE_START = 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT = 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END = 'TEXT_MESSAGE_END',

  // 工具调用事件
  TOOL_CALL_START = 'TOOL_CALL_START',
  TOOL_CALL_ARGS = 'TOOL_CALL_ARGS',
  TOOL_CALL_END = 'TOOL_CALL_END',
  TOOL_CALL_RESULT = 'TOOL_CALL_RESULT',

  // 状态管理事件
  STATE_SNAPSHOT = 'STATE_SNAPSHOT',
  STATE_DELTA = 'STATE_DELTA',
  MESSAGES_SNAPSHOT = 'MESSAGES_SNAPSHOT',

  // 自定义事件
  CUSTOM = 'CUSTOM',
}

/** AG-UI 基础事件 */
export interface BaseEvent {
  type: EventType;
  timestamp?: number;
}

/** 生命周期: RunStarted */
export interface RunStartedEvent extends BaseEvent {
  type: EventType.RUN_STARTED;
  threadId: string;
  runId: string;
}

/** 生命周期: RunFinished */
export interface RunFinishedEvent extends BaseEvent {
  type: EventType.RUN_FINISHED;
  threadId: string;
  runId: string;
}

/** 生命周期: RunError */
export interface RunErrorEvent extends BaseEvent {
  type: EventType.RUN_ERROR;
  message: string;
  code?: string;
}

/** 生命周期: StepStarted */
export interface StepStartedEvent extends BaseEvent {
  type: EventType.STEP_STARTED;
  stepName: string;
}

/** 生命周期: StepFinished */
export interface StepFinishedEvent extends BaseEvent {
  type: EventType.STEP_FINISHED;
  stepName: string;
}

/** 文本消息: Start */
export interface TextMessageStartEvent extends BaseEvent {
  type: EventType.TEXT_MESSAGE_START;
  messageId: string;
  role: string;
}

/** 文本消息: Content (增量 delta) */
export interface TextMessageContentEvent extends BaseEvent {
  type: EventType.TEXT_MESSAGE_CONTENT;
  messageId: string;
  delta: string;
}

/** 文本消息: End */
export interface TextMessageEndEvent extends BaseEvent {
  type: EventType.TEXT_MESSAGE_END;
  messageId: string;
}

/** 工具调用: Start */
export interface ToolCallStartEvent extends BaseEvent {
  type: EventType.TOOL_CALL_START;
  toolCallId: string;
  toolCallName: string;
  parentMessageId?: string;
}

/** 工具调用: Args (增量传参) */
export interface ToolCallArgsEvent extends BaseEvent {
  type: EventType.TOOL_CALL_ARGS;
  toolCallId: string;
  delta: string;
}

/** 工具调用: End */
export interface ToolCallEndEvent extends BaseEvent {
  type: EventType.TOOL_CALL_END;
  toolCallId: string;
}

/** 工具调用: Result */
export interface ToolCallResultEvent extends BaseEvent {
  type: EventType.TOOL_CALL_RESULT;
  messageId: string;
  toolCallId: string;
  role: string;
  content: string;
}

/** 自定义事件 */
export interface CustomEvent extends BaseEvent {
  type: EventType.CUSTOM;
  name: string;
  value: any;
}

/** 所有 AG-UI 事件的联合类型 */
export type AGUIEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | CustomEvent;

/** 序列化为标准 SSE 格式 */
export function serializeEvent(event: AGUIEvent): string {
  const payload = { ...event, timestamp: event.timestamp ?? Date.now() };
  return `event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** 生成唯一 ID */
export function genId(): string {
  return randomUUID();
}
