# AI Local App

本项目是一个本地优先的 AI 工作台（Next.js 16 + Ollama），支持：

- 聊天对话（可选 RAG）
- 图片生成（在对话流中直接展示）
- 长视频综合分析（画面 + 音频 + 时间线）
- 视频分析结果持久化与缓存复用

## 1. 环境要求

- Node.js 20+
- Yarn 1.22+
- [Ollama](https://ollama.com/)（本地模型服务）
- `ffmpeg` / `ffprobe`
- `whisper` CLI（`openai-whisper`）

macOS 推荐安装：

```bash
brew install ffmpeg
python3 -m pip install --user openai-whisper
```

如果 `whisper` 命令找不到，请把 Python user bin 加到 PATH（示例）：

```bash
export PATH="$HOME/Library/Python/3.*/bin:$PATH"
```

## 2. 模型准备（示例）

按你机器显存选择，至少保证有一个视觉模型 + 一个文本模型：

```bash
ollama pull llava
ollama pull qwen2.5
ollama pull x/flux2-klein:4b
```

> 图片生成模型建议优先 `x/flux2-klein:4b`，更省显存。

## 3. 启动

```bash
yarn install
yarn dev
```

默认端口：`3001`，访问 `http://localhost:3001`。

## 4. 常用指令（聊天输入框）

- `生成图片: 一只在雨夜霓虹街头散步的黑猫`
- `分析视频: 请完整分析人物动作、场景变化和音频内容`
- `查询视频记录: <jobId>`

## 5. 视频流水线说明

服务端端到端流程：

1. `video-preprocess`：抽帧 + 音轨提取
2. `video-transcribe`：Whisper 转写
3. `video-pipeline`：VLM 视觉理解 + 音视频融合
4. 结果中文归一化、拒答过滤、返回时间线

### 持久化与缓存

- 持久化目录：`~/.ai-local-app/video-pipeline-records`
- 记录文件：`<jobId>.json`
- 缓存索引：`cache-index.json`（同视频同参数命中后直接返回）

## 6. 质量验证

- 快速检查：`yarn lint`
- 视频验证报告：`yarn validate:video:report`

更多封版检查见：

- `docs/VIDEO_VALIDATION.md`
- `docs/RELEASE_V0.1.md`

## 7. 常见问题

- **ffmpeg/whisper 未安装**  
  报错 `spawn ffmpeg ENOENT` 或 `spawn whisper ENOENT`，请按上文安装。

- **图片生成 OOM**  
  报错 `model requires ... GiB`，请改用更小模型（如 `x/flux2-klein:4b`）。

- **视频无音轨导致失败**  
  当前已内置无音轨兼容分支，若仍异常请检查输入文件是否损坏。

## 8. 已知限制（v0.1）

- 视觉细节精度受本地模型能力和显存影响
- 超长视频首次分析耗时可能较高（缓存命中后会明显加速）
- 时间线是“模型推断结果”，不是逐帧像素级真值
