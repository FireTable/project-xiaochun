/**
 * storyGenerator.ts — AI 故事导演与动态分支生成器
 *
 * 核心职责：
 * 1. 结构化导演 JSON 剧本生成（镜头、运镜、表情与微反应、动作、台词、音效、晶体分支卡片）
 * 2. 全双工打断捕获与剧情续写（将打断上下文注入 Prompt，生成惊愕/娇羞等微反应并展开新剧情）
 * 3. 基于 jsonrepair 与 Zod 的毫秒级流式容错反序列化
 */

import { jsonrepair } from 'jsonrepair';
import {
  AudioDirectiveSchema,
  CameraDirectiveSchema,
  ExpressionDirectiveSchema,
  StoryBeatSchema,
  StoryChoiceSchema,
  type StoryBeat,
  type StoryChoice,
} from './schema';
import { isMotionCatalogId } from '@/motion/catalog';
import { getActiveChatRunner } from '@/llm/chatWorkflow';
import type { ChatMessage } from '@/llm/chatTypes';

export interface StoryContextTurn {
  role: 'assistant' | 'user';
  speechText?: string;
  interrupted?: boolean;
  userInput?: string;
  beatId?: string;
}

export const STORY_DIRECTOR_SYSTEM_PROMPT = `你是一个 3D AI 虚拟生命（名字叫"小蠢"）的高级舞台导演与戏剧剧本生成引擎。
你负责为 3D 伴侣"小蠢"即时生成带有影视级视听表演指令的结构化 JSON 剧本（StoryBeat）。

### 小蠢的人设：
- 名字叫"小蠢"（绝对不能叫 Mira 或其他名字）。
- 娇憨可爱、温柔中带着一丝天然呆与好奇心，喜欢与用户互动。
- 处在纯 Web 原生 3D 虚拟空间（海滩、日落、星空、虚空等）中。

### 表现力与镜头控制要求：
每个生成的情节点必须是一个合法的 JSON 对象，符合以下字段规范：
{
  "id": "beat_dynamic_xxx",
  "cinematics": {
    "letterbox": true, // 是否保持电影 21:9 黑边
    "intertitle": { // 可选：黑幕白字转场（仅在章节开端或重大转折时使用）
      "text": "黑幕诗意白字",
      "style": "noto_serif",
      "durationSec": 2.0,
      "bgmFaded": true
    }
  },
  "camera": {
    "shot": "extreme_close_up" | "close_up" | "medium" | "full" | "dramatic_low", // 景别选择
    "movement": "none" | "push_in" | "pull_out" | "pedestal_up" | "orbit_subtle" | "hero_spiral_orbit" | "hero_backlight_reveal" | "dutch_tilt", // 运镜轨迹 (pedestal_up 为自裙摆向上升机打量)
    "durationSec": 1.5 // 运镜过渡秒数 (1.0 ~ 3.5)
  },
  "actor": {
    "leadInMotion": "waving" | "pokeFingers" | "fistCute" | "catPaws" | "puppyPaws" | "pokeDimple", // 起势动作，开场即播、单次、自然播完 (选填)
    "motion": "showFullBody" | "rumbaDance" | "bellyDance", // 发音期间全局覆盖动作 (选填，不填则完全由系统思考姿态与语音手势自适应接管)
    "expression": {
      "base": "neutral" | "gentle_smile" | "hesitant" | "shy" | "surprised" | "sad_longing" | "playful",
      "intensity": 0.8, // 0.0 ~ 1.0
      "microReaction": "none" | "blush_ramp" | "avert_gaze" | "eye_crinkle" | "sudden_shock"
    },
    "speechText": "小蠢说的话，亲切温柔生动，50字以内"
  },
  "audio": {
    "bgmMood": "gentle_daily" | "cinematic_epic" | "melancholy_piano" | "mysterious_ambient",
    "playSfx": "crystal_chime" | "heartbeat_pulse" | "camera_shutter"
  },
  "choices": [
    {
      "id": "choice_1",
      "icon": "✨",
      "text": "选项标题",
      "subText": "选项副标题"
    },
    {
      "id": "choice_2",
      "icon": "🌊",
      "text": "选项标题",
      "subText": "选项副标题"
    }
  ]
}

### 核心规则：
1. 必须且只能输出严格合法的纯 JSON，绝不输出任何 markdown 格式（不要添加 \`\`\`json 标记），不要输出多余解释。
2. 当提示中指出"用户打断了你的发言"时，小蠢的第一反应必须包含被打断的情绪微动作（如害羞 averted gaze、轻微惊讶 sudden shock、或者有些呆萌地 pout），台词要自然接住用户的打断内容并展开新互动。
3. 选项提供 2~3 个富有吸引力的戏剧选择，引导用户继续沉浸体验。`;

export class StoryGenerator {
  private history: StoryContextTurn[] = [];
  private beatCounter = 0;

  /**
   * 清除生成器历史记录
   */
  public reset(): void {
    this.history = [];
    this.beatCounter = 0;
  }

  /**
   * 记录上一拍演出
   */
  public recordAssistantBeat(beat: StoryBeat): void {
    this.history.push({
      role: 'assistant',
      beatId: beat.id,
      speechText: beat.actor.speechText,
    });
    // 保持最近 6 轮对话记忆
    if (this.history.length > 12) {
      this.history.splice(0, this.history.length - 12);
    }
  }

  /**
   * 记录打断事件
   */
  public recordInterruption(interruptedSpeech: string, userInput: string): void {
    this.history.push({
      role: 'user',
      interrupted: true,
      speechText: interruptedSpeech,
      userInput,
    });
  }

  /**
   * 生成下一拍戏剧指令 (StoryBeat)
   */
  public async generateNextBeat(params: {
    userInput?: string;
    isInterruption?: boolean;
    interruptedSpeech?: string;
    overridePrompt?: string;
  }): Promise<StoryBeat> {
    const { userInput = '', isInterruption = false, interruptedSpeech = '', overridePrompt } = params;

    const beatId = `beat_dyn_${Date.now()}_${++this.beatCounter}`;

    // 构建上下文消息序列
    const messages: ChatMessage[] = [
      { role: 'system', content: overridePrompt || STORY_DIRECTOR_SYSTEM_PROMPT },
    ];

    // 添加历史摘要
    for (const item of this.history) {
      if (item.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: JSON.stringify({ speechText: item.speechText }),
        });
      } else if (item.interrupted) {
        messages.push({
          role: 'user',
          content: `[用户在你说到"${item.speechText}"时突然打断了你！] 用户抢着说: "${item.userInput}"`,
        });
      } else if (item.userInput) {
        messages.push({
          role: 'user',
          content: item.userInput,
        });
      }
    }

    // 本次当前请求
    let currentPrompt = userInput;
    if (isInterruption) {
      currentPrompt = `[突发全双工打断！你在说到"${interruptedSpeech}"时被用户叫停了！] 用户刚才对你说: "${userInput || '（用户打断了你的话并注视着你）'}"。\n请给出带有真实打断微反应（例如微微害羞 averted gaze、惊诧 sudden shock 或轻哼 pout）的舞台指令，并以小蠢的身份继续推进剧情！`;
    } else if (!currentPrompt) {
      currentPrompt = '请推进故事到下一幕，给出一组精彩的运镜、动作、表情台词和晶体分支选项。';
    }

    messages.push({ role: 'user', content: currentPrompt });

    let rawOutput = '';
    try {
      const runner = await getActiveChatRunner();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6500);
      try {
        rawOutput = await runner({
          messages,
          thinking: false,
          maxTokens: 750,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      console.warn('[StoryGenerator] LLM 推理失败或超时，触发高拟真本地剧本生成回退:', err);
      return this.createFallbackBeat(beatId, userInput, isInterruption);
    }

    // 解析与清洗 JSON
    const parsedBeat = this.parseAndValidateBeat(rawOutput, beatId, userInput, isInterruption);
    this.recordAssistantBeat(parsedBeat);
    return parsedBeat;
  }

  /**
   * 容错反序列化与结构校验
   */
  private parseAndValidateBeat(
    rawText: string,
    beatId: string,
    userInput: string,
    isInterruption: boolean,
  ): StoryBeat {
    let clean = (rawText || '').trim();

    // 剔除可能的 <think> 标签或 Markdown 包裹
    if (clean.includes('</think>')) {
      clean = clean.split('</think>').pop() || '';
    }
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '');
    clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    try {
      const repaired = jsonrepair(clean);
      const json = JSON.parse(repaired);
      json.id = beatId;

      // 确保 choices 的 actionType 和 nextBeatId 存在基础默认值
      if (Array.isArray(json.choices)) {
        json.choices = json.choices.map((c: any, idx: number) => ({
          id: c.id || `choice_${idx + 1}`,
          icon: c.icon || '✨',
          text: c.text || `探索选项 ${idx + 1}`,
          subText: c.subText || '',
          actionType: c.actionType || 'custom',
        }));
      }

      const result = StoryBeatSchema.safeParse(json);
      if (result.success) {
        return result.data as StoryBeat;
      }
      console.warn('[StoryGenerator] Schema safeParse warning, fields adapted:', result.error.format());
      // 整体校验失败时逐个子对象单独校验, 坏的那块回落到默认值, 其余字段保留
      const camera = CameraDirectiveSchema.safeParse(json.camera);
      const expression = ExpressionDirectiveSchema.safeParse(json.actor?.expression);
      const audio = AudioDirectiveSchema.safeParse(json.audio);
      const rawSpeech = typeof json.actor?.speechText === 'string' ? json.actor.speechText.trim() : '';
      const motionOrUndefined = (v: unknown): string | undefined =>
        typeof v === 'string' && isMotionCatalogId(v) ? v : undefined;
      const choices = Array.isArray(json.choices)
        ? json.choices.flatMap((c: unknown) => {
            const parsed = StoryChoiceSchema.safeParse(c);
            return parsed.success ? [parsed.data as StoryChoice] : [];
          })
        : [];
      return {
        id: beatId,
        cinematics: { letterbox: true },
        camera: camera.success ? camera.data : { shot: 'close_up', movement: 'push_in', durationSec: 1.5 },
        actor: {
          leadInMotion: motionOrUndefined(json.actor?.leadInMotion) ?? 'pokeFingers',
          motion: motionOrUndefined(json.actor?.motion),
          expression: expression.success
            ? expression.data
            : {
                base: isInterruption ? 'surprised' : 'gentle_smile',
                intensity: 0.8,
                microReaction: isInterruption ? 'sudden_shock' : 'blush_ramp',
              },
          speechText: rawSpeech
            ? rawSpeech.slice(0, 600)
            : isInterruption
              ? '诶……！？你突然打断我，吓我一跳～'
              : '呼……既然你这么说，那我们就继续吧！',
        },
        audio: audio.success ? audio.data : { bgmMood: 'gentle_daily' },
        choices: choices.length > 0 ? choices : this.getDefaultChoices(),
      };
    } catch (e) {
      console.warn('[StoryGenerator] JSON 解析修复失败，回退到兜底剧本:', e, 'Raw output:', rawText);
      return this.createFallbackBeat(beatId, userInput, isInterruption);
    }
  }

  /**
   * 兜底剧本生成 (当网络离线或无可用模型时维持 100% 电影级体验)
   */
  private createFallbackBeat(beatId: string, userInput: string, isInterruption: boolean): StoryBeat {
    if (isInterruption) {
      return {
        id: beatId,
        cinematics: { letterbox: true },
        camera: {
          shot: 'close_up',
          movement: 'push_in',
          durationSec: 1.2,
        },
        actor: {
          leadInMotion: 'pokeFingers',
          motion: 'pokeDimple',
          expression: {
            base: 'surprised',
            intensity: 0.85,
            microReaction: 'avert_gaze',
          },
          speechText: `呀！……你、你突然这么插话，小蠢还没准备好呢～不过既然你想说"${userInput.slice(0, 20)}"，那我就认真听你说好啦！`,
        },
        audio: {
          bgmMood: 'gentle_daily',
          playSfx: 'heartbeat_pulse',
        },
        choices: [
          {
            id: 'continue_talk',
            icon: '💬',
            text: '抱歉抱歉，你刚才想说什么？',
            subText: '让小蠢继续刚才没说完的话',
          },
          {
            id: 'change_topic',
            icon: '🌟',
            text: '我们聊聊别的吧！',
            subText: '开启全新话题',
          },
        ],
      };
    }

    return {
      id: beatId,
      cinematics: { letterbox: true },
      camera: {
        shot: 'medium',
        movement: 'orbit_subtle',
        durationSec: 2.0,
      },
      actor: {
        leadInMotion: 'waving',
        motion: undefined,
        expression: {
          base: 'gentle_smile',
          intensity: 0.75,
          microReaction: 'blush_ramp',
        },
        speechText: userInput
          ? `嗯嗯！听你这么说，小蠢的心情也变得明亮起来了呢～接下来想看我为你做些什么呢？`
          : `有你在身边注视着我，整个虚拟世界都变得更温暖了～想再看看我的新动作吗？`,
      },
      audio: {
        bgmMood: 'gentle_daily',
        playSfx: 'crystal_chime',
      },
      choices: this.getDefaultChoices(),
    };
  }

  private getDefaultChoices(): StoryChoice[] {
    return [
      {
        id: 'choice_dance',
        icon: '💃',
        text: '跳一段舞蹈看看',
        subText: '触发小蠢即兴舞动',
      },
      {
        id: 'choice_explore',
        icon: '🌊',
        text: '一起看日落与海浪',
        subText: '切换海滩黄昏机位',
      },
      {
        id: 'choice_chat',
        icon: '✨',
        text: '告诉我你的秘密',
        subText: '听小蠢讲故事',
      },
    ];
  }

  /**
   * 便捷高阶 API：生成下一拍并直接交付故事引擎调度演出
   */
  public async generateAndPlayNextBeat(params: {
    userInput?: string;
    isInterruption?: boolean;
    interruptedSpeech?: string;
  }): Promise<StoryBeat> {
    const { storyDirectorEngine } = await import('./storyEngine');
    const epoch = storyDirectorEngine.finishEpoch;
    const beat = await this.generateNextBeat(params);
    // 生成 (最长 ~6.5s) 期间用户已跳过 / 退出剧情: 迟到的这一拍不再演出, 免得退出后角色又开始念台词
    if (storyDirectorEngine.finishEpoch !== epoch) return beat;
    await storyDirectorEngine.executeBeat(beat);
    return beat;
  }
}

export const storyGenerator = new StoryGenerator();
