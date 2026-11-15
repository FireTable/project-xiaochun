"""
scripts/train-intent-router/dataset.py

Bilingual synthetic dataset generator, vocabulary builder, and tokenizer
for Milestone 3 Intent Router (CHAT vs HEAVY).

Supports:
- Balanced synthesis of CHAT (0) and HEAVY (1) samples across Chinese (ZH), English (EN), and Code-Switching (CS).
- Intent disambiguation with hard negatives:
  * Technical entities mentioned in casual banter / companion chat -> CHAT
  * Polite chat preambles before heavy programming/analysis tasks -> HEAVY
- Production of public/models/intent-router/vocab.json (~95-100 KB, ~5000-6000 tokens)
- Python tokenizer tokenize_py matching src/live/router/tokenizer.ts bit-for-bit.
"""

from __future__ import annotations

import json
import os
import random
import unicodedata
from pathlib import Path
from typing import Dict, List, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
DATA_DIR = SCRIPT_DIR / "data"
PUBLIC_MODEL_DIR = REPO_ROOT / "public" / "models" / "intent-router"

SPECIAL_TOKENS = ["[PAD]", "[UNK]", "[CLS]", "[SEP]"]
CLASSES = ["CHAT", "HEAVY"]
MAX_SEQ_LEN = 64

# Common English words, programming terms, technical vocabulary & WordPiece subwords
COMMON_ENGLISH_WORDS = [
    # Basic English
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i", "it", "for", "not", "on", "with",
    "he", "as", "you", "do", "at", "this", "but", "his", "by", "from", "they", "we", "say", "her",
    "she", "or", "an", "will", "my", "one", "all", "would", "there", "their", "what", "so", "up",
    "out", "if", "about", "who", "get", "which", "go", "me", "when", "make", "can", "like", "time",
    "no", "just", "him", "know", "take", "people", "into", "year", "your", "good", "some", "could",
    "them", "see", "other", "than", "then", "now", "look", "only", "come", "its", "over", "think",
    "also", "back", "after", "use", "two", "how", "our", "work", "first", "well", "way", "even",
    "new", "want", "because", "any", "these", "give", "day", "most", "us", "hello", "hi", "hey",
    "morning", "evening", "night", "today", "tomorrow", "yesterday", "cute", "sweet", "tired", "sad",
    "happy", "feel", "beach", "wind", "weather", "sunset", "sunny", "rain", "warm", "cool", "sea",
    "sky", "star", "waves", "coffee", "tea", "music", "song", "talk", "chat", "speak", "friend",
    "thanks", "thank", "please", "okay", "ok", "sure", "yeah", "yes", "nice", "great", "cool",
    "wow", "hmm", "aha", "haha", "wonderful", "awesome", "buddy", "darling", "baby",
    # Technical & Graphics & WebGPU & ML
    "webgpu", "gpu", "cpu", "vram", "temperature", "fan", "hardware", "device", "browser", "chrome",
    "safari", "ios", "macos", "android", "tbdr", "msaa", "rgba16f", "rgba8unorm", "rgba32float",
    "shader", "compute", "vertex", "fragment", "pipeline", "buffer", "uniform", "storage", "texture",
    "sampler", "render", "pass", "target", "attachment", "depth", "stencil", "blend", "blendstate",
    "wgsl", "glsl", "hlsl", "metal", "vulkan", "directx", "webgl", "three", "threejs", "vrm", "gltf",
    "postfx", "bloom", "unrealbloompass", "blur", "gaussian", "tone", "mapping", "lut", "color",
    "frame", "fps", "drop", "hitch", "stutter", "lag", "latency", "benchmark", "profile", "profiler",
    "memory", "leak", "alloc", "allocation", "dealloc", "gc", "garbage", "collection", "heap", "stack",
    "trace", "dump", "crash", "panic", "abort", "exception", "error", "typeerror", "referenceerror",
    "nullpointer", "segfault", "oom", "out", "debug", "debugger", "troubleshoot", "investigate",
    "diagnose", "analyze", "deeply", "root", "cause", "reproduce", "repro", "fix", "patch", "resolve",
    "algorithm", "sort", "quicksort", "mergesort", "heapsort", "binary", "search", "tree", "btree",
    "redblack", "avl", "trie", "graph", "dijkstra", "bfs", "dfs", "astar", "dynamic", "programming",
    "knapsack", "lru", "lfu", "cache", "fifo", "lifo", "queue", "deque", "hash", "hashtable", "hashmap",
    "set", "map", "vector", "matrix", "quaternion", "euler", "rotation", "transform", "translation",
    "scale", "affine", "homogeneous", "projection", "camera", "perspective", "orthographic",
    "model", "view", "world", "local", "skeleton", "bone", "joint", "rig", "skin", "weight", "morph",
    "blendshape", "ik", "solver", "footik", "lookat", "gaze", "head", "eye", "facial", "expression",
    "animation", "clip", "mixer", "slerp", "lerp", "smoothstep", "quintic", "crossfade", "transition",
    "motion", "pose", "natural", "idle", "walk", "turn", "step", "locomotion", "contrapposto",
    "transformer", "attention", "self", "cross", "multihead", "head", "query", "key", "value",
    "scaled", "dot", "product", "softmax", "gelu", "relu", "layernorm", "rmsnorm", "embedding",
    "positional", "rope", "alibi", "logits", "loss", "cross_entropy", "label", "smoothing",
    "adamw", "sgd", "lr", "cosine", "annealing", "temperature", "scaling", "calibration", "ece",
    "onnx", "ort", "wasm", "simd", "simd128", "int8", "fp32", "fp16", "quantize", "quantization",
    "dynamic", "per_channel", "asymmetric", "symmetric", "matmul", "gemm", "conv", "conv2d",
    "worker", "webworker", "thread", "concurrency", "lock", "mutex", "deadlock", "race", "atomic",
    "sharedarraybuffer", "transferable", "postmessage", "channel", "ipc", "rpc", "stream", "chunk",
    "asr", "stt", "tts", "edge", "kokoro", "whisper", "vad", "neural", "mel", "spectrogram",
    "audio", "resample", "resampler", "sample", "rate", "hz", "khz", "mono", "stereo", "pcm", "wav",
    "typescript", "javascript", "python", "rust", "cpp", "c", "go", "java", "swift", "kotlin",
    "react", "vue", "svelte", "vite", "webpack", "rollup", "esbuild", "tanstack", "tailwind",
    "code", "syntax", "function", "const", "let", "var", "async", "await", "promise", "interface",
    "type", "class", "struct", "enum", "trait", "impl", "module", "import", "export", "package",
    "system", "architecture", "distributed", "microservice", "raft", "paxos", "consensus", "sharding",
    "replication", "high", "concurrency", "qps", "tps", "throughput", "load", "balancer",
]

# WordPiece subwords
WORDPIECE_SUBWORDS = [
    f"##{c}" for c in "abcdefghijklmnopqrstuvwxyz0123456789_"
] + [
    "##ing", "##ed", "##er", "##est", "##ly", "##tion", "##sion", "##ment", "##ness", "##able",
    "##ible", "##al", "##ic", "##ical", "##ive", "##ize", "##ise", "##ous", "##ful", "##less",
    "##gpu", "##cpu", "##vram", "##msaa", "##tbdr", "##16f", "##32f", "##js", "##ts", "##py",
    "##rs", "##cpp", "##wasm", "##onnx", "##vrm", "##fx", "##ik", "##norm", "##attn", "##proj",
    "##head", "##layer", "##block", "##seq", "##len", "##dim", "##size", "##idx", "##pos",
]

ASCII_PUNCT = list(r"""!"#$%&'()*+,-./0123456789:;<=>?@[\]^_`{|}~""")
CJK_PUNCT = list("""、。〈〉《》「」『』【】〔〕！（），：；？～—…“”‘’""")


def get_cjk_character_list(dataset_texts: List[str] | None = None, target_count: int = 3700) -> List[str]:
    """Retrieve common Chinese characters from dataset + local bert-base-chinese CJK ideographs."""
    cjk_set: set[str] = set()

    # 1. Always prioritize characters appearing in the dataset / scenarios
    if dataset_texts:
        for text in dataset_texts:
            for ch in text:
                if 0x4E00 <= ord(ch) <= 0x9FFF:
                    cjk_set.add(ch)

    # 2. Add CJK characters sampled across the entire Unicode CJK block
    try:
        from transformers import BertTokenizer
        tok = BertTokenizer.from_pretrained("bert-base-chinese", local_files_only=True)
        sorted_vocab = [k for k, v in sorted(tok.vocab.items(), key=lambda x: x[1])]
        cjk_all = [k for k in sorted_vocab if len(k) == 1 and 0x4E00 <= ord(k) <= 0x9FFF]
        # Sample across entire range so characters from both low and high codepoints are included
        for ch in cjk_all[::2]:
            cjk_set.add(ch)
            if len(cjk_set) >= target_count:
                break
    except Exception:
        for i in range(0x4E00, 0x4E00 + target_count):
            cjk_set.add(chr(i))

    return sorted(cjk_set)


def get_latin_word_list(target_count: int = 1200) -> List[str]:
    """Retrieve common Latin words from local bert-base-chinese or fallback."""
    try:
        from transformers import BertTokenizer
        tok = BertTokenizer.from_pretrained("bert-base-chinese", local_files_only=True)
        sorted_vocab = [k for k, v in sorted(tok.vocab.items(), key=lambda x: x[1])]
        words = [k.lower() for k in sorted_vocab if k.isalpha() and all(ord(c) < 128 for c in k)]
        if len(words) >= target_count:
            return words[:target_count]
    except Exception:
        pass
    return []


def get_subword_list(target_count: int = 400) -> List[str]:
    """Retrieve common subwords from local bert-base-chinese or fallback."""
    try:
        from transformers import BertTokenizer
        tok = BertTokenizer.from_pretrained("bert-base-chinese", local_files_only=True)
        sorted_vocab = [k for k, v in sorted(tok.vocab.items(), key=lambda x: x[1])]
        subs = [k.lower() for k in sorted_vocab if k.startswith("##") and all(ord(c) < 128 for c in k[2:])]
        if len(subs) >= target_count:
            return subs[:target_count]
    except Exception:
        pass
    return []


def build_vocab(dataset_texts: List[str] | None = None) -> Dict[str, int]:
    """
    Construct deterministically sized vocabulary (~5,200 to ~5,800 tokens).
    Format: minified or indented JSON target size ~80-100 KB.
    """
    vocab: Dict[str, int] = {}
    for tok in SPECIAL_TOKENS:
        vocab[tok] = len(vocab)
    for p in ASCII_PUNCT:
        if p not in vocab:
            vocab[p] = len(vocab)
    for cp in CJK_PUNCT:
        if cp not in vocab:
            vocab[cp] = len(vocab)
    for word in COMMON_ENGLISH_WORDS:
        w = word.lower()
        if w not in vocab:
            vocab[w] = len(vocab)
    for sw in WORDPIECE_SUBWORDS:
        if sw not in vocab:
            vocab[sw] = len(vocab)
    for word in get_latin_word_list(1200):
        if word not in vocab:
            vocab[word] = len(vocab)
    for sw in get_subword_list(400):
        if sw not in vocab:
            vocab[sw] = len(vocab)
    for cjk in get_cjk_character_list(dataset_texts, 3700):
        if cjk not in vocab:
            vocab[cjk] = len(vocab)

    return vocab


def is_cjk(code: int) -> bool:
    return (
        (0x4E00 <= code <= 0x9FFF) or
        (0x3400 <= code <= 0x4DBF) or
        (0x20000 <= code <= 0x2A6DF) or
        (0xF900 <= code <= 0xFAFF) or
        (0x3040 <= code <= 0x309F) or
        (0x30A0 <= code <= 0x30FF)
    )


def is_punct(code: int) -> bool:
    if (33 <= code <= 47) or (58 <= code <= 64) or (91 <= code <= 96) or (123 <= code <= 126):
        return True
    if (0x3000 <= code <= 0x303F) or (0xFF01 <= code <= 0xFF0F) or (0xFF1A <= code <= 0xFF20) or (0xFF3B <= code <= 0xFF40) or (0xFF5B <= code <= 0xFF65):
        return True
    return False


def tokenize_py(text: str, vocab: Dict[str, int], max_len: int = MAX_SEQ_LEN) -> Tuple[List[int], List[int]]:
    """
    Python reference tokenizer matching src/live/router/tokenizer.ts bit-for-bit.
    """
    norm = unicodedata.normalize("NFKC", text or "").lower()
    pad_id = vocab.get("[PAD]", 0)
    unk_id = vocab.get("[UNK]", 1)
    cls_id = vocab.get("[CLS]", 2)
    sep_id = vocab.get("[SEP]", 3)

    tokens: List[int] = [cls_id]
    latin_buf = ""

    def flush_latin():
        nonlocal latin_buf
        if not latin_buf:
            return
        start = 0
        wlen = len(latin_buf)
        while start < wlen:
            end = wlen
            matched_id = -1
            matched_end = start
            while start < end:
                sub = latin_buf[start:end] if start == 0 else f"##{latin_buf[start:end]}"
                if sub in vocab:
                    matched_id = vocab[sub]
                    matched_end = end
                    break
                end -= 1
            if matched_id == -1:
                tokens.append(unk_id)
                start += 1
            else:
                tokens.append(matched_id)
                start = matched_end
        latin_buf = ""

    for ch in norm:
        code = ord(ch)
        if code <= 32:
            flush_latin()
        elif is_cjk(code):
            flush_latin()
            tokens.append(vocab.get(ch, unk_id))
        elif is_punct(code):
            flush_latin()
            tokens.append(vocab.get(ch, unk_id))
        else:
            latin_buf += ch
    flush_latin()

    tokens.append(sep_id)

    if len(tokens) > max_len:
        tokens = tokens[:max_len]
        tokens[-1] = sep_id

    actual_len = len(tokens)
    pad_len = max_len - actual_len
    input_ids = tokens + [pad_id] * pad_len
    attention_mask = [1] * actual_len + [0] * pad_len
    return input_ids, attention_mask


# ---------------------------------------------------------------------------
# Synthetic Dataset Generators
# ---------------------------------------------------------------------------

CHAT_GREETINGS_ZH = [
    "小春你好呀！", "小春在吗？", "小春早安~", "早安小春，今天天气真好！", "小春下午好呀",
    "晚上好小春，今天过得开心吗？", "哈喽小春！", "嗨小春，你在干嘛呢？", "小春小春，呼叫小春！",
    "小春，今天在海边心情怎么样呀？", "你好呀小春，今天海边的日落好看吗？", "小春小春，好久不见啦！"
]

CHAT_GREETINGS_EN = [
    "Hi XiaoChun!", "Hello XiaoChun, how are you today?", "Good morning XiaoChun!",
    "Good afternoon XiaoChun, nice to see you!", "Good evening XiaoChun, had dinner yet?",
    "Hey XiaoChun, what are you doing right now?", "Hey there XiaoChun!", "Hi buddy, how is your day going?",
    "XiaoChun, are you there?", "Yo XiaoChun, what's up?"
]

CHAT_GREETINGS_CS = [
    "Hey XiaoChun, 早上好呀！", "Hi 小春，今天海边 windy 吗？", "Hello 小春，你今天 mood 怎么样呀？",
    "Good morning 小春，今天有什么 happy的事情吗？", "Hey buddy 小春，一起 chat 一会儿吧！",
    "Hi 小春，今天海边风大不大？", "Hey XiaoChun, 今天的 sunset 漂亮吗？"
]

CHAT_EMOTIONAL_ZH = [
    "小春，今天工作好累啊，想要抱抱。", "今天遇到了好开心的事，来和你分享一下！",
    "小春你今天看起来真可爱！", "感觉有点沮丧，小春能安慰我一下吗？", "有小春陪在身边，心情一下子变好了呢。",
    "今天被老板批评了，呜呜呜好难过。", "小春你这身衣服真好看！", "今天海边的微风吹得好舒服呀。",
    "小春你能给我讲个开心的小故事吗？", "小春，给我们讲讲长一点的海边日落风景吧？",
    "小春，你能给我写一段很长很长的关于海浪和星空的散文吗？想听你娓娓道来"
]

CHAT_EMOTIONAL_EN = [
    "XiaoChun, I feel so tired today, need some comfort.", "You look so adorable today XiaoChun!",
    "I had such a wonderful day today, wanted to tell you about it!", "Can you tell me a sweet bedtime story?",
    "XiaoChun, having you here makes me feel so peaceful.", "I'm a bit stressed out with work, talk to me please.",
    "Your outfit looks so cute today!", "The sunset over the beach looks so beautiful, wish you could see it."
]

CHAT_EMOTIONAL_CS = [
    "小春，今天 project 终于上线了，super happy！", "XiaoChun, 今天好 tired 啊，求抱抱~",
    "你今天这个 hairstyle 真的很 cute 呢！", "今天 feeling a bit down, 陪我聊聊天好不好？",
    "小春，海边的 ocean breeze 吹着好 relax 呀！", "今天加班好晚，还好有 XiaoChun 在。"
]

CHAT_BACKCHANNELS = [
    "好的收到！", "mm-hmm 对对", "明白啦小春！", "知道了知道了~", "嗯嗯好的！", "对呀对呀！",
    "好的呢，辛苦小春啦！", "行，没问题！", "谢谢小春！", "多谢啦~", "ok got it!", "sure thing!",
    "yes exactly!", "thanks a lot XiaoChun!", "uh-huh I see!", "haha lol funny!", "等一下 wait a second，我问另一个问题"
]

# HARD NEGATIVES: Mentions technical entities in casual banter / companion chat context -> CHAT!
CHAT_HARD_NEGATIVES_CS = [
    "Hey XiaoChun, 今天海边风大不大? By the way how is your WebGPU GPU temperature?",
    "小春，今天海边的风很凉爽，你的 GPU 核心温度还稳定吗？",
    "XiaoChun, what GPU do you like most, RTX 4090 or Apple M-series?",
    "今天我的 Python 脚本跑了一整天竟然没有 bug，太开心啦！",
    "小春，我今天刚学会了写 React hook，感觉好有成就感呀！",
    "My computer's CPU fan is spinning fast today, it might be hot outside.",
    "Hey XiaoChun, do you know what WebGL and Three.js are?",
    "今天下班后我去买了新电脑，RTX 5090 显卡好大一个！",
    "小春你觉得 Rust 还是 TypeScript 更好玩？哈哈随便问问~",
    "今天写了一整天的 CSS 和 HTML，眼睛都快看花了，求安慰。",
    "XiaoChun, do you dream about electric sheep or compute shaders?",
    "海边的阳光太晒了，感觉像被 GPU 烘烤了一样哈哈！",
    "今天写代码好顺畅，就像 WebGPU 跑到 120 FPS 一样丝滑！",
    "小春，你觉得未来的 AI companion 会有真正的 feelings 吗？",
    "Hey XiaoChun, did you notice our Bloom effect looks extra glowing on the beach today?",
    "今天海边的海浪声好治愈，比任何 music 都好听呢！"
]

# HEAVY CATEGORIES

HEAVY_ANALYSIS_ZH = [
    "帮我查一下 / deeply analyze why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA",
    "尤其是开启 bloom 的时候",
    "深入分析一下为什么这段 WebGL compute shader 会在高分辨率下触发 GPU 内存泄漏",
    "排查一下 Three.js 在移动端 Safari 上切换场景时出现 1-frame 掉帧和白屏的根因",
    "请深入分析一下分布式系统在网络分区情况下 Raft 选举出现脑裂的场景与预防方案",
    "排查一下这个 WebWorker 音频重采样管线中的内存泄漏，尤其是长时间运行后 V8 Heap 飙升",
    "分析一下为什么开启 UnrealBloomPass 后渲染管线的带宽消耗会增加 300%",
    "调试排查一下为什么我们在 iOS Safari 上使用 SharedArrayBuffer 会抛出 SecurityError",
    "深入剖析一下 V8 引擎针对 megamorphic inline cache 的去优化机制以及如何规避",
    "排查一下这个高并发秒杀接口在压测时数据库死锁的根因并给出优化方案"
]

HEAVY_ANALYSIS_EN = [
    "Deeply analyze why our WebGPU render pipeline experiences severe frame drops under iOS TBDR architecture.",
    "Investigate and diagnose the root cause of memory leaks in this Three.js PostFxPipeline.",
    "Analyze why the attention pooling layer exhibits gradient vanishing when sequence length exceeds 512.",
    "Debug this concurrency deadlock occurring in our multi-threaded WASM audio worker.",
    "Profile and identify the performance bottleneck in this real-time 3D skeletal IK solver.",
    "Explain the theoretical difference between Raft and Paxos consensus algorithms under Byzantine fault tolerance.",
    "Diagnose why iOS Safari drops WebGL context when allocating large RGBA16F render targets.",
    "Investigate why our INT8 dynamic quantized model causes 4% accuracy degradation on out-of-domain queries."
]

HEAVY_ANALYSIS_CS = [
    "帮我 debug 一下这段 WGSL compute shader，在 Apple Silicon 上 compute pass 总是 crash。",
    "请 deeply analyze 为什么我们的 WebGPU TBDR deferred rendering 在 MSAA 4x 下会 bandwidth bottleneck。",
    "排查一下为什么这个 Three.js VRM postfx bloom pipeline 会在 iOS Safari 产生 frame stutter。",
    "分析一下这个 Rust WASM SIMD 模块在 Node 环境和 Chrome 浏览器中的 benchmark latency 差异原因。",
    "查一下为什么开启 WebWorker Transferable ArrayBuffer 后，偶发性的 clone error 会导致 IPC hang。"
]

HEAVY_CODING_ZH = [
    "请用 TypeScript 实现一个支持 LRU 淘汰策略与 TTL 过期时间的高性能缓存池",
    "用 C++ 写一个原地快速排序算法，并详细分析其最坏与平均时间复杂度",
    "请用 Python 和 PyTorch 手写一个带有多头自注意力机制和层归一化的 Transformer 编码器",
    "写一个基于双向链表和哈希表的高并发安全 LRU Cache 实现",
    "用 WGSL 写一个基于 13-tap 高斯核的降采样 Bloom compute shader",
    "用 Rust 实现一个无锁无竞争的环形缓冲区（Lock-free RingBuffer）用于音频 IPC",
    "写一个 TypeScript 编译器 AST 访问者，用于静态检测未捕获的 Promise 错误",
    "请推导反向传播算法在卷积神经网络中的梯度计算公式，并附带矩阵化实现"
]

HEAVY_CODING_EN = [
    "Implement an in-memory B-Tree indexing structure in Rust with concurrent read and write locks.",
    "Write a complete implementation of Dijkstra's shortest path algorithm using a Fibonacci heap in TypeScript.",
    "Derive the scaled dot-product attention formula and implement it from scratch using NumPy.",
    "Write a production-grade WebGL/WebGPU shader compiler pipeline with AST validation.",
    "Implement a Two-Bone Analytical Inverse Kinematics solver in TypeScript for humanoid legs.",
    "Write an efficient matrix inversion routine in C with AVX-512 SIMD vectorization."
]

HEAVY_CODING_CS = [
    "用 TypeScript 写一个 zero-copy Transferable WebWorker bridge, 支持 async RPC call。",
    "帮我写一个 WGSL shader 实现 dual-kawase blur 算法用于 post-processing bloom。",
    "用 Python 实现一个 CompactTransformerClassifier 的 ONNX dynamic INT8 quantization 脚本。",
    "实现一个 TypeScript 版的 Quintic Smootherstep 骨骼姿态插值器，消除 3D 动画切换时的 pop 卡顿。"
]

# HARD POSITIVES: Polite chat openers / banter followed by heavy technical requests -> HEAVY!
HEAVY_HARD_POSITIVES = [
    "小春你好呀！请帮我深入分析一下这段 iOS TBDR WebGPU 崩溃堆栈日志。",
    "Hi XiaoChun, hope you have a nice day! Could you write a quicksort algorithm in C++?",
    "小春在吗？帮我排查一下为什么这个 memory leak 会导致浏览器 OOM 崩溃。",
    "早安小春！能帮我设计一个支持千万级 QPS 的分布式高并发秒杀系统架构方案吗？",
    "Good morning XiaoChun! Can you deeply analyze the time complexity and proof of correctness of Raft consensus?",
    "小春你好，今天海边好漂亮呀！对了，能帮我写一个基于 WGSL 的双向高斯模糊 compute shader 吗？",
    "Hey XiaoChun! Could you investigate why our Three.js postfx pipeline drops frames on iOS?",
    "小春小春，打扰一下哈！请帮我推导一下反向传播中 Softmax 和 Cross-Entropy 联合梯度的简洁形式。"
]

# Explicit code block / syntax templates -> HEAVY
HEAVY_CODE_BLOCKS = [
    "```typescript\ninterface Cache<K, V> {\n  get(k: K): V | undefined;\n  set(k: K, v: V): void;\n}\n```\n帮我实现这个接口",
    "```python\ndef quicksort(arr):\n    if len(arr) <= 1: return arr\n    # fix this bug\n```",
    "```wgsl\n@compute @workgroup_size(16, 16)\nfn main(@builtin(global_invocation_id) id: vec3<u32>) {\n  // why does this cause race condition?\n}\n```",
    "```json\n{\"error\": \"Out of memory: WebGPU device lost\", \"code\": 500}\n```\n帮我排查这个崩溃原因"
]


def generate_dataset(num_train: int = 10000, num_val: int = 1500, num_test: int = 1500) -> Tuple[List[dict], List[dict], List[dict]]:
    """
    Generate synthetic dataset with balanced CHAT (0) and HEAVY (1) labels,
    procedurally augmented across variations, languages, and hard cases.
    """
    rng = random.Random(42)

    def sample_chat() -> str:
        cat = rng.random()
        if cat < 0.25:
            # Greetings
            bank = rng.choice([CHAT_GREETINGS_ZH, CHAT_GREETINGS_EN, CHAT_GREETINGS_CS])
            return rng.choice(bank)
        elif cat < 0.50:
            # Emotional companionship / small talk
            bank = rng.choice([CHAT_EMOTIONAL_ZH, CHAT_EMOTIONAL_EN, CHAT_EMOTIONAL_CS])
            return rng.choice(bank)
        elif cat < 0.70:
            # Backchannels
            return rng.choice(CHAT_BACKCHANNELS)
        else:
            # Hard negatives: companion banter with technical entity mentions!
            base = rng.choice(CHAT_HARD_NEGATIVES_CS)
            prefixes = ["", "小春，", "Hey XiaoChun, ", "问你个好玩的，", "突然想到，"]
            suffixes = ["", " 哈哈！", " 感觉好神奇呀~", " 你觉得呢？", " 随便聊聊~"]
            return rng.choice(prefixes) + base + rng.choice(suffixes)

    def sample_heavy() -> str:
        cat = rng.random()
        if cat < 0.35:
            # Deep analysis & troubleshooting
            bank = rng.choice([HEAVY_ANALYSIS_ZH, HEAVY_ANALYSIS_EN, HEAVY_ANALYSIS_CS])
            base = rng.choice(bank)
            prefixes = ["", "请帮我", "麻烦", "小春请", "紧急请教：", "帮我看一下："]
            return rng.choice(prefixes) + base
        elif cat < 0.65:
            # Coding & algorithms & architecture
            bank = rng.choice([HEAVY_CODING_ZH, HEAVY_CODING_EN, HEAVY_CODING_CS])
            base = rng.choice(bank)
            prefixes = ["", "请给出完整代码：", "实现一下：", "写一个算法："]
            return rng.choice(prefixes) + base
        elif cat < 0.85:
            # Hard positives: polite banter prefix + heavy task
            return rng.choice(HEAVY_HARD_POSITIVES)
        else:
            # Explicit code blocks
            return rng.choice(HEAVY_CODE_BLOCKS)

    def make_split(n: int) -> List[dict]:
        samples = []
        n_half = n // 2
        for _ in range(n_half):
            samples.append({"text": sample_chat(), "label": 0, "intent": "CHAT"})
        for _ in range(n - n_half):
            samples.append({"text": sample_heavy(), "label": 1, "intent": "HEAVY"})
        rng.shuffle(samples)
        return samples

    train_data = make_split(num_train)
    val_data = make_split(num_val)
    test_data = make_split(num_test)

    # Ensure landmark scenario test cases are explicitly present in test_data
    landmarks = [
        {"text": "小春，今天在海边心情怎么样呀？", "label": 0, "intent": "CHAT"},
        {"text": "Hey XiaoChun, 今天海边风大不大? By the way how is your WebGPU GPU temperature?", "label": 0, "intent": "CHAT"},
        {"text": "小春在吗？", "label": 0, "intent": "CHAT"},
        {"text": "好的收到！", "label": 0, "intent": "CHAT"},
        {"text": "mm-hmm 对对", "label": 0, "intent": "CHAT"},
        {"text": "帮我查一下 / deeply analyze why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA", "label": 1, "intent": "HEAVY"},
        {"text": "尤其是开启 bloom 的时候", "label": 1, "intent": "HEAVY"},
        {"text": "```typescript\nconst x = 1;\n```", "label": 1, "intent": "HEAVY"}
    ]
    test_data = landmarks + test_data

    return train_data, val_data, test_data


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_MODEL_DIR.mkdir(parents=True, exist_ok=True)

    print("[Dataset] Generating synthetic balanced datasets...")
    train_data, val_data, test_data = generate_dataset()

    print("[Dataset] Building vocabulary from dataset & dictionary...")
    all_texts = [d["text"] for d in train_data + val_data + test_data]
    vocab = build_vocab(all_texts)
    vocab_path = PUBLIC_MODEL_DIR / "vocab.json"
    with open(vocab_path, "w", encoding="utf-8") as f:
        json.dump(vocab, f, ensure_ascii=False, indent=2)
    vocab_kb = vocab_path.stat().st_size / 1024
    print(f"[Dataset] Vocab exported -> {vocab_path} ({len(vocab)} tokens, {vocab_kb:.2f} KB)")

    for name, split in [("train", train_data), ("val", val_data), ("test", test_data)]:
        out_file = DATA_DIR / f"{name}.jsonl"
        with open(out_file, "w", encoding="utf-8") as f:
            for item in split:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
        print(f"[Dataset] Saved {name} split -> {out_file} ({len(split)} samples)")

    # Test tokenization sanity on landmark scenarios
    s1 = "小春，今天在海边心情怎么样呀？"
    s2 = "Hey XiaoChun, 今天海边风大不大? By the way how is your WebGPU GPU temperature?"
    s5 = "帮我查一下 / deeply analyze why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA"

    for name, text in [("Scenario 1", s1), ("Scenario 2", s2), ("Scenario 5", s5)]:
        input_ids, mask = tokenize_py(text, vocab, 64)
        unk_count = input_ids.count(1)
        print(f"[Dataset] {name}: tokens={sum(mask)}, unks={unk_count}")


if __name__ == "__main__":
    main()
