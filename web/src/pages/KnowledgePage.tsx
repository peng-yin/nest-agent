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
import {
  Plus,
  Trash2,
  Database,
  Search,
  Upload,
  FileJson,
  Loader2,
  FileText,
  CheckCircle2,
  XCircle,
  Globe,
  File,
} from "lucide-react";

const ACCEPT_FILE_TYPES = ".pdf,.txt,.md,.csv,.html,.htm,.json";

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
          <p className="text-sm text-muted-foreground">
            管理文档知识库，支持 PDF、TXT、网页等多种格式
          </p>
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

function KBCard({
  kb,
  onDelete,
}: {
  kb: KnowledgeBase;
  onDelete: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { text: string; score: number }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

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

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">{kb.name}</CardTitle>
          {kb.description && (
            <p className="mt-1 text-sm text-muted-foreground">
              {kb.description}
            </p>
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
              <AlertDialogDescription>
                删除后无法恢复，确定吗？
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
      <CardContent className="space-y-3">
        <AddDocDialog kbId={kb.id} kbName={kb.name} open={dialogOpen} onOpenChange={setDialogOpen} />

        {/* Search */}
        <div className="flex gap-2">
          <Input
            className="text-xs"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="语义检索..."
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleSearch}
            disabled={searching}
          >
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {searchResults.length > 0 && (
          <div className="space-y-2">
            {searchResults.map((r, i) => (
              <div key={i} className="rounded-md border p-2 text-xs">
                <div className="mb-1 text-muted-foreground">
                  得分: {r.score.toFixed(3)}
                </div>
                <p className="line-clamp-3">{r.text}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* =================== 添加文档对话框 =================== */
function AddDocDialog({
  kbId,
  kbName,
  open,
  onOpenChange,
}: {
  kbId: string;
  kbName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // 文件上传 tab
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL tab
  const [url, setUrl] = useState("");

  // JSON tab
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  // 手动输入 tab
  const [docContent, setDocContent] = useState("");

  const resetAll = () => {
    setSelectedFiles([]);
    setJsonFile(null);
    setUrl("");
    setDocContent("");
    setUploadMsg(null);
  };

  // ---- 文件上传（PDF/TXT/MD/CSV/HTML） ----
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) setSelectedFiles(files);
    e.target.value = "";
  };

  const handleFileUpload = async () => {
    if (selectedFiles.length === 0) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      if (selectedFiles.length === 1) {
        const res = await kbApi.uploadFile(kbId, selectedFiles[0]);
        setUploadMsg({
          ok: true,
          text: `「${res.fileName}」上传成功，加载 ${res.documentsLoaded} 篇文档，创建 ${res.chunksCreated} 个文档块`,
        });
      } else {
        const res = await kbApi.uploadFiles(kbId, selectedFiles);
        const success = res.results.filter((r) => !r.error);
        const failed = res.results.filter((r) => r.error);
        const totalChunks = success.reduce((s, r) => s + r.chunksCreated, 0);
        let msg = `${success.length} 个文件上传成功，共 ${totalChunks} 个文档块`;
        if (failed.length > 0) {
          msg += `；${failed.length} 个失败: ${failed.map((f) => f.fileName).join(", ")}`;
        }
        setUploadMsg({ ok: failed.length === 0, text: msg });
      }
      setSelectedFiles([]);
    } catch (err: any) {
      setUploadMsg({ ok: false, text: err.message });
    } finally {
      setUploading(false);
    }
  };

  // ---- URL 加载 ----
  const handleLoadUrl = async () => {
    if (!url.trim()) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const res = await kbApi.loadUrl(kbId, url.trim());
      setUploadMsg({
        ok: true,
        text: `网页加载成功，创建 ${res.chunksCreated} 个文档块`,
      });
      setUrl("");
    } catch (err: any) {
      setUploadMsg({ ok: false, text: err.message });
    } finally {
      setUploading(false);
    }
  };

  // ---- JSON 文件 ----
  const handleJsonSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setJsonFile(file);
    e.target.value = "";
  };

  const handleJsonUpload = async () => {
    if (!jsonFile) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const text = await jsonFile.text();
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
        docs = [
          {
            content: json.content,
            ...(json.metadata ? { metadata: json.metadata } : {}),
          },
        ];
      } else {
        throw new Error("不支持的 JSON 格式");
      }

      if (docs.length === 0) throw new Error("JSON 中没有文档内容");

      const res = await kbApi.addDocuments(kbId, docs);
      setUploadMsg({
        ok: true,
        text: `从 ${jsonFile.name} 导入 ${docs.length} 篇文档，创建 ${res.chunksCreated} 个文档块`,
      });
      setJsonFile(null);
    } catch (err: any) {
      setUploadMsg({ ok: false, text: err.message });
    } finally {
      setUploading(false);
    }
  };

  // ---- 手动输入 ----
  const handleUploadText = async () => {
    if (!docContent.trim()) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const res = await kbApi.addDocuments(kbId, [{ content: docContent }]);
      setUploadMsg({
        ok: true,
        text: `成功创建 ${res.chunksCreated} 个文档块`,
      });
      setDocContent("");
    } catch (e: any) {
      setUploadMsg({ ok: false, text: e.message });
    } finally {
      setUploading(false);
    }
  };

  const fileTypeLabel = (file: File) => {
    const ext = file.name.split(".").pop()?.toUpperCase() || "FILE";
    const size =
      file.size > 1024 * 1024
        ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
        : `${(file.size / 1024).toFixed(0)} KB`;
    return `${ext} · ${size}`;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) resetAll();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full gap-1.5">
          <Upload className="h-3.5 w-3.5" /> 添加文档
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>添加文档到「{kbName}」</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="file" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="file" className="gap-1 text-xs">
              <File className="h-3.5 w-3.5" /> 文件
            </TabsTrigger>
            <TabsTrigger value="url" className="gap-1 text-xs">
              <Globe className="h-3.5 w-3.5" /> 网页
            </TabsTrigger>
            <TabsTrigger value="json" className="gap-1 text-xs">
              <FileJson className="h-3.5 w-3.5" /> JSON
            </TabsTrigger>
            <TabsTrigger value="text" className="gap-1 text-xs">
              <FileText className="h-3.5 w-3.5" /> 文本
            </TabsTrigger>
          </TabsList>

          {/* Tab: 文件上传 (PDF/TXT/MD/CSV/HTML) */}
          <TabsContent value="file" className="mt-3 space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_FILE_TYPES}
              className="hidden"
              multiple
              onChange={handleFileSelect}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors hover:border-primary hover:bg-muted/50"
            >
              <File className="h-8 w-8 text-muted-foreground" />
              {selectedFiles.length > 0 ? (
                <div className="space-y-1 text-center">
                  {selectedFiles.map((f, i) => (
                    <p key={i} className="text-sm font-medium">
                      {f.name}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({fileTypeLabel(f)})
                      </span>
                    </p>
                  ))}
                </div>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    点击选择文件（支持多选）
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PDF、TXT、Markdown、CSV、HTML（最大 20MB）
                  </p>
                </>
              )}
            </div>
            <Button
              className="w-full"
              onClick={handleFileUpload}
              disabled={uploading || selectedFiles.length === 0}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{" "}
                  上传中...
                </>
              ) : (
                `上传${selectedFiles.length > 0 ? ` (${selectedFiles.length} 个文件)` : ""}`
              )}
            </Button>
          </TabsContent>

          {/* Tab: URL */}
          <TabsContent value="url" className="mt-3 space-y-3">
            <div className="space-y-2">
              <Label>网页地址</Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                onKeyDown={(e) => e.key === "Enter" && handleLoadUrl()}
              />
              <p className="text-xs text-muted-foreground">
                输入网页 URL，系统将自动抓取并提取文本内容
              </p>
            </div>
            <Button
              className="w-full"
              onClick={handleLoadUrl}
              disabled={uploading || !url.trim()}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{" "}
                  加载中...
                </>
              ) : (
                "加载网页"
              )}
            </Button>
          </TabsContent>

          {/* Tab: JSON file */}
          <TabsContent value="json" className="mt-3 space-y-3">
            <input
              ref={jsonInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleJsonSelect}
            />
            <div
              onClick={() => jsonInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors hover:border-primary hover:bg-muted/50"
            >
              <FileJson className="h-8 w-8 text-muted-foreground" />
              {jsonFile ? (
                <p className="text-sm font-medium">{jsonFile.name}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">点击选择 JSON 文件</p>
                  <p className="text-xs text-muted-foreground">
                    {'{ "documents": [{ "content": "...", "metadata": {} }] }'}
                  </p>
                </>
              )}
            </div>
            <Button
              className="w-full"
              onClick={handleJsonUpload}
              disabled={uploading || !jsonFile}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{" "}
                  上传中...
                </>
              ) : (
                "上传文件"
              )}
            </Button>
          </TabsContent>

          {/* Tab: 手动输入 */}
          <TabsContent value="text" className="mt-3 space-y-3">
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
              {uploading ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{" "}
                  上传中...
                </>
              ) : (
                "上传文本"
              )}
            </Button>
          </TabsContent>
        </Tabs>

        {uploadMsg && (
          <div
            className={`flex items-start gap-2 rounded-md p-3 text-sm ${
              uploadMsg.ok
                ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
            }`}
          >
            {uploadMsg.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{uploadMsg.text}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="知识库名称"
            />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="可选描述"
            />
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
