import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  Sparkles,
  User,
  Wrench,
  CheckCircle2,
  ExternalLink,
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
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Messages */}
        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {streamState && <StreamingBubble state={streamState} />}
            {messages.length === 0 && !streamState && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Sparkles className="mb-4 h-12 w-12" />
                <p className="text-lg font-medium">开始一段对话</p>
                <p className="text-sm">发送消息与 AI Agent 交互</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input area */}
        <div className="border-t bg-background/80 backdrop-blur-sm p-4">
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

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-primary underline underline-offset-2 hover:text-primary/80 break-all"
          >
            {children}
            <ExternalLink className="inline h-3 w-3 shrink-0" />
          </a>
        ),
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-disc pl-5 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 space-y-1">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <pre className="my-2 overflow-x-auto rounded-md bg-zinc-900 p-3 text-xs text-zinc-100">
                <code className={className} {...props}>{children}</code>
              </pre>
            );
          }
          return (
            <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono" {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => <>{children}</>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        h1: ({ children }) => <h1 className="mb-2 text-lg font-bold">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-2 text-base font-bold">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 text-sm font-bold">{children}</h3>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-primary text-primary-foreground" : "bg-gradient-to-br from-violet-500 to-indigo-500 text-white"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>
      <div
        className={`min-w-0 rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "max-w-[75%] bg-primary text-primary-foreground"
            : "max-w-full bg-muted/60"
        }`}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <div className="prose-sm break-words overflow-hidden">
            <MarkdownContent content={message.content} />
          </div>
        )}
      </div>
    </div>
  );
}

function StreamingBubble({ state }: { state: StreamState }) {
  return (
    <div className="space-y-3">
      {/* Steps */}
      {state.steps.map((step) => (
        <div key={step.name} className="flex items-center gap-2 text-xs text-muted-foreground">
          {step.done ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          )}
          <span className="font-medium">Agent: {step.name}</span>
        </div>
      ))}

      {/* Tool calls */}
      {state.toolCalls.map((tc) => (
        <div key={tc.id} className="rounded-lg border border-border/50 bg-muted/30 p-3 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-foreground/80">
            <Wrench className="h-3.5 w-3.5 text-orange-500" />
            <span>{tc.name}</span>
            {!tc.done ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : (
              <CheckCircle2 className="h-3 w-3 text-green-500" />
            )}
          </div>
          {tc.args && (
            <pre className="mt-1.5 max-h-20 overflow-auto rounded bg-muted/50 p-1.5 text-muted-foreground whitespace-pre-wrap break-all">
              {tc.args}
            </pre>
          )}
          {tc.result && (
            <pre className="mt-1.5 max-h-20 overflow-auto rounded bg-muted/50 p-1.5 text-muted-foreground border-t border-border/30 whitespace-pre-wrap break-all">
              {tc.result.slice(0, 300)}
            </pre>
          )}
        </div>
      ))}

      {/* Streaming text */}
      {state.currentText && (
        <div className="flex gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-white">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 max-w-full rounded-2xl bg-muted/60 px-4 py-3 text-sm leading-relaxed">
            <div className="prose-sm break-words overflow-hidden">
              <MarkdownContent content={state.currentText} />
            </div>
            <span className="mt-1 inline-block h-4 w-0.5 animate-pulse rounded-full bg-foreground/60" />
          </div>
        </div>
      )}
    </div>
  );
}
