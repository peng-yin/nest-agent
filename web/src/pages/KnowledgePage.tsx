import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { kbApi, KnowledgeBase } from "@/lib/api";
import { Plus, Trash2, Database, Search, Upload, FileJson, Loader2 } from "lucide-react";

export default function KnowledgePage() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);

  const loadKbs = async () => {
    setLoading(true);
    try {
      const list = await kbApi.list();
      setKbs(list);
    } catch (e) {
      console.error("加载知识库失败", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKbs();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await kbApi.delete(id);
      setKbs((prev) => prev.filter((k) => k.id !== id));
    } catch (e) {
      console.error("删除知识库失败", e);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">知识库</h1>
          <p className="text-sm text-muted-foreground">管理文档知识库，支持语义检索</p>
        </div>
        <CreateKBDialog onCreated={loadKbs} />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : kbs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Database className="mb-4 h-12 w-12" />
          <p className="text-lg font-medium">暂无知识库</p>
          <p className="text-sm">创建知识库并添加文档以启用 RAG 检索</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {kbs.map((kb) => (
            <KBCard key={kb.id} kb={kb} onDelete={() => handleDelete(kb.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function KBCard({ kb, onDelete }: { kb: KnowledgeBase; onDelete: () => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ text: string; score: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [docContent, setDocContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const fileInputRef = useState<HTMLInputElement | null>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await kbApi.search(kb.id, searchQuery);
      setSearchResults(results);
    } catch (e) {
      console.error("检索失败", e);
    } finally {
      setSearching(false);
    }
  };

  const handleUploadText = async () => {
    if (!docContent.trim()) return;
    setUploading(true);
    setUploadMsg("");
    try {
      const res = await kbApi.addDocuments(kb.id, [{ content: docContent }]);
      setUploadMsg(`成功创建 ${res.chunksCreated} 个文档块`);
      setDocContent("");
    } catch (e: any) {
      setUploadMsg(`上传失败: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setUploading(true);
    setUploadMsg("");
    try {
      const text = await file.text();
      const json = JSON.parse(text);

      let docs: { content: string; metadata?: Record<string, unknown> }[] = [];
      if (Array.isArray(json)) {
        docs = json.map((item: any) => ({
          content: typeof item === "string" ? item : item.content,
          ...(item.metadata ? { metadata: item.metadata } : {}),
        }));
      } else if (json.documents && Array.isArray(json.documents)) {
        docs = json.documents;
      } else if (json.content) {
        docs = [{ content: json.content, ...(json.metadata ? { metadata: json.metadata } : {}) }];
      } else {
        throw new Error("不支持的 JSON 格式，需要 { documents: [...] } 或数组格式");
      }

      if (docs.length === 0) throw new Error("JSON 中没有文档内容");

      const res = await kbApi.addDocuments(kb.id, docs);
      setUploadMsg(`从 ${file.name} 导入 ${docs.length} 篇文档，创建 ${res.chunksCreated} 个文档块`);
    } catch (err: any) {
      setUploadMsg(`上传失败: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">{kb.name}</CardTitle>
          {kb.description && (
            <p className="mt-1 text-sm text-muted-foreground">{kb.description}</p>
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
              <AlertDialogAction onClick={onDelete}>删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Upload */}
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full gap-1.5">
              <Upload className="h-3.5 w-3.5" /> 添加文档
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>添加文档到「{kb.name}」</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* JSON file upload */}
              <div>
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  id={`file-upload-${kb.id}`}
                  onChange={handleFileUpload}
                />
                <label htmlFor={`file-upload-${kb.id}`}>
                  <Button
                    variant="outline"
                    className="w-full gap-2 cursor-pointer"
                    asChild
                    disabled={uploading}
                  >
                    <span>
                      <FileJson className="h-4 w-4" />
                      上传 JSON 文件
                    </span>
                  </Button>
                </label>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  支持格式：{"{ \"documents\": [{ \"content\": \"...\", \"metadata\": {} }] }"}
                </p>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">或手动输入</span>
                </div>
              </div>

              {/* Manual text input */}
              <Textarea
                rows={6}
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                placeholder="粘贴文档内容..."
              />
            </div>

            {uploadMsg && (
              <p className={`text-sm ${uploadMsg.startsWith("上传失败") ? "text-destructive" : "text-green-600"}`}>
                {uploadMsg}
              </p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">取消</Button>
              </DialogClose>
              <Button onClick={handleUploadText} disabled={uploading || !docContent.trim()}>
                {uploading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 上传中...</> : "上传文本"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Search */}
        <div className="flex gap-2">
          <Input
            className="text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="语义检索..."
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={handleSearch} disabled={searching}>
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {searchResults.length > 0 && (
          <div className="space-y-2">
            {searchResults.map((r, i) => (
              <div key={i} className="rounded-md border p-2 text-xs">
                <div className="mb-1 text-muted-foreground">得分: {r.score.toFixed(3)}</div>
                <p className="line-clamp-3">{r.text}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreateKBDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await kbApi.create({ name, description });
      setOpen(false);
      setName("");
      setDescription("");
      onCreated();
    } catch (e) {
      console.error("创建知识库失败", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          创建知识库
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建知识库</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="知识库名称" />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="可选描述" />
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
