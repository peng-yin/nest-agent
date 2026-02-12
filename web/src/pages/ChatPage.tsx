import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { chatApi, streamChat, Conversation, Message } from "@/lib/api";
import {
  Plus,
  Send,
  Trash2,
  MessageSquare,
  Loader2,
  Bot,
  User,
  Wrench,
  ChevronRight,
} from "lucide-react";

interface StreamState {
  steps: { name: string; done: boolean }[];
  toolCalls: { id: string; name: string; args: string; result?: string; done: boolean }[];
  currentText: string;
  messageId: string;
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const list = await chatApi.getConversations();
      setConversations(list);
    } catch (e) {
      console.error("加载会话列表失败", e);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const loadMessages = useCallback(async (convId: string) => {
    try {
      const msgs = await chatApi.getMessages(convId);
      setMessages(msgs);
    } catch (e) {
      console.error("加载消息失败", e);
    }
  }, []);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
    else setMessages([]);
  }, [activeId, loadMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamState]);

  const handleNewChat = async () => {
    try {
      const conv = await chatApi.createConversation();
      setConversations((prev) => [conv, ...prev]);
      setActiveId(conv.id);
    } catch (e) {
      console.error("创建会话失败", e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await chatApi.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    } catch (e) {
      console.error("删除会话失败", e);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || streaming) return;

    const userMsg = input.trim();
    setInput("");

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: userMsg,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    setStreaming(true);
    const state: StreamState = {
      steps: [],
      toolCalls: [],
      currentText: "",
      messageId: "",
    };
    setStreamState(state);

    abortRef.current = streamChat(
      { message: userMsg, conversationId: activeId || undefined },
      (eventType, data) => {
        setStreamState((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          switch (eventType) {
            case "RUN_STARTED":
              if (!activeId && data.threadId) {
                setActiveId(data.threadId as string);
                loadConversations();
              }
              break;
            case "STEP_STARTED":
              next.steps = [...prev.steps, { name: data.stepName as string, done: false }];
              break;
            case "STEP_FINISHED":
              next.steps = prev.steps.map((s) =>
                s.name === data.stepName ? { ...s, done: true } : s,
              );
              break;
            case "TOOL_CALL_START":
              next.toolCalls = [
                ...prev.toolCalls,
                { id: data.toolCallId as string, name: data.toolCallName as string, args: "", done: false },
              ];
              break;
            case "TOOL_CALL_ARGS":
              next.toolCalls = prev.toolCalls.map((t) =>
                t.id === data.toolCallId ? { ...t, args: t.args + (data.delta as string) } : t,
              );
              break;
            case "TOOL_CALL_END":
              next.toolCalls = prev.toolCalls.map((t) =>
                t.id === data.toolCallId ? { ...t, done: true } : t,
              );
              break;
            case "TOOL_CALL_RESULT":
              next.toolCalls = prev.toolCalls.map((t) =>
                t.id === data.toolCallId ? { ...t, result: data.content as string } : t,
              );
              break;
            case "TEXT_MESSAGE_START":
              next.messageId = data.messageId as string;
              next.currentText = "";
              break;
            case "TEXT_MESSAGE_CONTENT":
              next.currentText = prev.currentText + (data.delta as string);
              break;
            case "TEXT_MESSAGE_END":
              break;
          }
          return next;
        });
      },
      () => {
        setStreamState((prev) => {
          if (prev && prev.currentText) {
            setMessages((msgs) => [
              ...msgs,
              {
                id: prev.messageId || Date.now().toString(),
                role: "assistant",
                content: prev.currentText,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
          return null;
        });
        setStreaming(false);
        loadConversations();
      },
      (err) => {
        console.error("流式请求错误", err);
        setStreaming(false);
        setStreamState(null);
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r bg-muted/30">
        <div className="p-3">
          <Button variant="outline" className="w-full justify-start gap-2" onClick={handleNewChat}>
            <Plus className="h-4 w-4" />
            新建对话
          </Button>
        </div>
        <Separator />
        <ScrollArea className="flex-1">
          <div className="space-y-1 p-2">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent ${
                  activeId === conv.id ? "bg-accent" : ""
                }`}
                onClick={() => setActiveId(conv.id)}
              >
                <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{conv.title || "新对话"}</span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      className="hidden rounded p-1 hover:bg-destructive/10 group-hover:block"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认删除</AlertDialogTitle>
                      <AlertDialogDescription>删除后无法恢复，确定要删除这个会话吗？</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(conv.id)}>删除</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
            {conversations.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">暂无对话</p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* Messages */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {streamState && <StreamingBubble state={streamState} />}
            {messages.length === 0 && !streamState && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Bot className="mb-4 h-12 w-12" />
                <p className="text-lg font-medium">开始一段对话</p>
                <p className="text-sm">发送消息与 AI Agent 交互</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input area */}
        <div className="border-t p-4">
          <div className="mx-auto flex max-w-3xl gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
              className="min-h-[44px] max-h-[160px] resize-none"
              rows={1}
            />
            <Button onClick={handleSend} disabled={!input.trim() || streaming} size="icon" className="shrink-0">
              {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
        isUser ? "bg-primary text-primary-foreground" : "bg-muted"
      }`}>
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
        isUser ? "bg-primary text-primary-foreground" : "bg-muted"
      }`}>
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}

function StreamingBubble({ state }: { state: StreamState }) {
  return (
    <div className="space-y-2">
      {/* Steps & tools */}
      {state.steps.map((step) => (
        <div key={step.name} className="flex items-center gap-2 text-xs text-muted-foreground">
          {step.done ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin" />
          )}
          <span>Agent: {step.name}</span>
        </div>
      ))}
      {state.toolCalls.map((tc) => (
        <div key={tc.id} className="rounded-md border bg-muted/50 p-2 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
            <Wrench className="h-3 w-3" />
            {tc.name}
            {!tc.done && <Loader2 className="h-3 w-3 animate-spin" />}
          </div>
          {tc.args && (
            <pre className="mt-1 max-h-20 overflow-auto text-muted-foreground">{tc.args}</pre>
          )}
          {tc.result && (
            <pre className="mt-1 max-h-20 overflow-auto border-t pt-1 text-muted-foreground">{tc.result.slice(0, 200)}</pre>
          )}
        </div>
      ))}
      {/* Streaming text */}
      {state.currentText && (
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
            <Bot className="h-4 w-4" />
          </div>
          <div className="max-w-[80%] rounded-lg bg-muted px-4 py-2.5 text-sm leading-relaxed">
            <div className="whitespace-pre-wrap">{state.currentText}</div>
            <span className="inline-block h-4 w-1 animate-pulse bg-foreground" />
          </div>
        </div>
      )}
    </div>
  );
}
