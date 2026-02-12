import { useState, useEffect, useRef } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { kbApi, KnowledgeBase } from "@/lib/api";
import { Plus, Trash2, Database, Search, Upload, FileJson, Loader2, FileText, CheckCircle2, XCircle } from "lucide-react";

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
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const resetDialog = () => {
    setDocContent("");
    setSelectedFile(null);
    setUploadMsg(null);
  };

  const handleUploadText = async () => {
    if (!docContent.trim()) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const res = await kbApi.addDocuments(kb.id, [{ content: docContent }]);
      setUploadMsg({ ok: true, text: `成功创建 ${res.chunksCreated} 个文档块` });
      setDocContent("");
    } catch (e: any) {
      setUploadMsg({ ok: false, text: e.message });
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
    e.target.value = "";
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const text = await selectedFile.text();
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
        throw new Error("不支持的 JSON 格式");
      }

      if (docs.length === 0) throw new Error("JSON 中没有文档内容");

      const res = await kbApi.addDocuments(kb.id, docs);
      setUploadMsg({ ok: true, text: `从 ${selectedFile.name} 导入 ${docs.length} 篇文档，创建 ${res.chunksCreated} 个文档块` });
      setSelectedFile(null);
    } catch (err: any) {
      setUploadMsg({ ok: false, text: err.message });
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
        {/* Upload Dialog */}
        <Dialog open={dialogOpen} onOpenChange={(v) => { setDialogOpen(v); if (!v) resetDialog(); }}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full gap-1.5">
              <Upload className="h-3.5 w-3.5" /> 添加文档
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>添加文档到「{kb.name}」</DialogTitle>
            </DialogHeader>

            <Tabs defaultValue="file" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="file" className="gap-1.5">
                  <FileJson className="h-3.5 w-3.5" /> JSON 文件
                </TabsTrigger>
                <TabsTrigger value="text" className="gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> 手动输入
                </TabsTrigger>
              </TabsList>

              {/* Tab: JSON file */}
              <TabsContent value="file" className="space-y-3 mt-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors hover:border-primary hover:bg-muted/50"
                >
                  <FileJson className="h-8 w-8 text-muted-foreground" />
                  {selectedFile ? (
                    <p className="text-sm font-medium">{selectedFile.name}</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium">点击选择 JSON 文件</p>
                      <p className="text-xs text-muted-foreground">
                        {"{ \"documents\": [{ \"content\": \"...\", \"metadata\": {} }] }"}
                      </p>
                    </>
                  )}
                </div>
                <Button
                  className="w-full"
                  onClick={handleFileUpload}
                  disabled={uploading || !selectedFile}
                >
                  {uploading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 上传中...</> : "上传文件"}
                </Button>
              </TabsContent>

              {/* Tab: manual text */}
              <TabsContent value="text" className="space-y-3 mt-3">
                <Textarea
                  rows={6}
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                  placeholder="粘贴文档内容..."
                />
                <Button
                  className="w-full"
                  onClick={handleUploadText}
                  disabled={uploading || !docContent.trim()}
                >
                  {uploading ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> 上传中...</> : "上传文本"}
                </Button>
              </TabsContent>
            </Tabs>

            {uploadMsg && (
              <div className={`flex items-start gap-2 rounded-md p-3 text-sm ${uploadMsg.ok ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}>
                {uploadMsg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>{uploadMsg.text}</span>
              </div>
            )}
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
