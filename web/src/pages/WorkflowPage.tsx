import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { workflowApi, Workflow, WorkflowNode, WorkflowEdge } from "@/lib/api";
import { Plus, Trash2, GitBranch, ArrowRight, Loader2 } from "lucide-react";

export default function WorkflowPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWorkflows = async () => {
    setLoading(true);
    try {
      const list = await workflowApi.list();
      setWorkflows(list);
    } catch (e) {
      console.error("加载工作流失败", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkflows();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await workflowApi.delete(id);
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
    } catch (e) {
      console.error("删除工作流失败", e);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">工作流管理</h1>
          <p className="text-sm text-muted-foreground">创建和管理 DAG 编排工作流</p>
        </div>
        <CreateWorkflowDialog onCreated={loadWorkflows} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <GitBranch className="mb-4 h-12 w-12" />
          <p className="text-lg font-medium">暂无工作流</p>
          <p className="text-sm">创建一个工作流来定义 Agent 执行顺序</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {workflows.map((wf) => (
            <Card key={wf.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base">{wf.name}</CardTitle>
                  {wf.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{wf.description}</p>
                  )}
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认删除</AlertDialogTitle>
                      <AlertDialogDescription>删除后无法恢复，确定吗？</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(wf.id)}>删除</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {wf.nodes?.map((node, i) => (
                    <span key={node.id} className="flex items-center gap-1">
                      <span className={`rounded px-1.5 py-0.5 ${getNodeColor(node.type)}`}>
                        {node.name}
                      </span>
                      {i < (wf.nodes?.length || 0) - 1 && <ArrowRight className="h-3 w-3" />}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {wf.nodes?.length || 0} 个节点 / {wf.edges?.length || 0} 条边
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function getNodeColor(type: string) {
  switch (type) {
    case "start": return "bg-blue-100 text-blue-700";
    case "end": return "bg-green-100 text-green-700";
    case "agent": return "bg-purple-100 text-purple-700";
    case "tool": return "bg-orange-100 text-orange-700";
    case "condition": return "bg-yellow-100 text-yellow-700";
    default: return "bg-gray-100 text-gray-700";
  }
}

function CreateWorkflowDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nodes, setNodes] = useState<WorkflowNode[]>([
    { id: "start", type: "start", name: "开始", config: {} },
    { id: "end", type: "end", name: "结束", config: {} },
  ]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([{ source: "start", target: "end" }]);
  const [saving, setSaving] = useState(false);

  const addNode = () => {
    const id = `node-${Date.now()}`;
    setNodes((prev) => [
      ...prev.slice(0, -1),
      { id, type: "agent", name: "", config: { prompt: "", tools: [] } },
      prev[prev.length - 1],
    ]);
    // rewire edges: last real node -> new node -> end
    const endNode = nodes[nodes.length - 1];
    const prevNode = nodes[nodes.length - 2];
    setEdges((prev) => [
      ...prev.filter((e) => !(e.source === prevNode.id && e.target === endNode.id)),
      { source: prevNode.id, target: id },
      { source: id, target: endNode.id },
    ]);
  };

  const removeNode = (index: number) => {
    const nodeId = nodes[index].id;
    setNodes((prev) => prev.filter((_, i) => i !== index));
    setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
  };

  const updateNode = (index: number, field: string, value: string) => {
    setNodes((prev) =>
      prev.map((n, i) => {
        if (i !== index) return n;
        if (field === "name") return { ...n, name: value };
        if (field === "type") return { ...n, type: value as WorkflowNode["type"] };
        if (field === "prompt") return { ...n, config: { ...n.config, prompt: value } };
        return n;
      }),
    );
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await workflowApi.create({ name, description, nodes, edges });
      setOpen(false);
      setName("");
      setDescription("");
      setNodes([
        { id: "start", type: "start", name: "开始", config: {} },
        { id: "end", type: "end", name: "结束", config: {} },
      ]);
      setEdges([{ source: "start", target: "end" }]);
      onCreated();
    } catch (e) {
      console.error("创建工作流失败", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          创建工作流
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>创建工作流</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="工作流名称" />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="可选描述" />
          </div>
          <Separator />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>节点</Label>
              <Button variant="outline" size="sm" onClick={addNode} className="gap-1">
                <Plus className="h-3 w-3" /> 添加节点
              </Button>
            </div>
            {nodes.map((node, i) => (
              <div key={node.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${getNodeColor(node.type)}`}>
                    {node.type}
                  </span>
                  {node.type !== "start" && node.type !== "end" && (
                    <>
                      <Select
                        value={node.type}
                        onValueChange={(v) => updateNode(i, "type", v)}
                      >
                        <SelectTrigger className="h-7 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="agent">agent</SelectItem>
                          <SelectItem value="tool">tool</SelectItem>
                          <SelectItem value="condition">condition</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        className="h-7 flex-1 text-xs"
                        value={node.name}
                        onChange={(e) => updateNode(i, "name", e.target.value)}
                        placeholder="节点名称"
                      />
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeNode(i)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                  {(node.type === "start" || node.type === "end") && (
                    <span className="text-xs text-muted-foreground">{node.name}</span>
                  )}
                </div>
                {node.type === "agent" && (
                  <Textarea
                    className="text-xs"
                    rows={2}
                    value={(node.config.prompt as string) || ""}
                    onChange={(e) => updateNode(i, "prompt", e.target.value)}
                    placeholder="Agent 系统提示词"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
