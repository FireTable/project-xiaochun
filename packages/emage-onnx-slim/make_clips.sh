#!/usr/bin/env bash
# Build several 16 kHz mono test clips (different speakers/content) into out/clips/.
# Sources are optional; every missing source is skipped. Needs ffmpeg; macOS `say` is used for TTS clips.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/out/clips}"
EXPORT_DIR="${EMAGE_EXPORT_DIR:-$HERE/../../../emage-onnx-export}"
mkdir -p "$OUT"
cut() { # src start dur name
  [ -f "$1" ] || { echo "skip $4 (missing $1)"; return; }
  ffmpeg -v error -y -ss "$2" -t "$3" -i "$1" -ac 1 -ar 16000 -c:a pcm_s16le "$OUT/$4.wav" && echo "ok $4"
}
cut "$EXPORT_DIR/demo.wav" 0 32 demo
cut "$HERE/../../bench/baseline.wav" 0 32 xiaochun_bench_baseline
for extra in ${EMAGE_EXTRA_CLIPS:-}; do
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$extra" 2>/dev/null | cut -d. -f1)
  start=30; [ "${dur:-0}" -lt 62 ] && start=0   # short file: start at 0
  cut "$extra" "$start" 32 "extra_$(basename "${extra%.*}")"
done
if command -v say >/dev/null 2>&1; then
  say -v Tingting -o "$OUT/zh.aiff" "今天天气特别好，我想和你聊聊最近发生的一些有趣的事情。首先，周末我去了一趟山里，空气非常清新，沿途的风景让人心情舒畅。然后我们一起吃了当地的特色美食，大家都说味道不错。最后，我想问问你，下个周末有没有时间一起出去走走呢？如果你有空的话，我们可以去海边看看日出。" 2>/dev/null \
    && ffmpeg -v error -y -i "$OUT/zh.aiff" -ac 1 -ar 16000 -c:a pcm_s16le "$OUT/say_zh.wav" && rm -f "$OUT/zh.aiff" && echo "ok say_zh"
  say -v Samantha -o "$OUT/en.aiff" "Hello there. I wanted to tell you about my weekend. First, we drove up into the mountains, and the air was incredibly fresh. Then we found a small restaurant and tried some local dishes. Everyone agreed the food was fantastic. Finally, I would love to hear what you have been up to. Do you have time next weekend to go out together and watch the sunrise by the sea?" 2>/dev/null \
    && ffmpeg -v error -y -i "$OUT/en.aiff" -ac 1 -ar 16000 -c:a pcm_s16le "$OUT/say_en.wav" && rm -f "$OUT/en.aiff" && echo "ok say_en"
fi
ls -la "$OUT"
