/**
 * synth_zh_turns.ts — Concurrent multi-voice Edge-TTS synthesizer for Mandarin Chinese
 * COMPLETE and INCOMPLETE speech clips across 5 non-holdout Chinese neural voices.
 *
 * Ensures WhisperTurnClassifier learns that clean Chinese TTS acoustics appear in
 * COMPLETE and INCOMPLETE queries/clauses (not only BACKCHANNEL / WAIT_INTERRUPT).
 *
 * Strictly disjoint from holdout speakers (`en-GB-SoniaNeural`, `zh-CN-XiaoxiaoNeural`,
 * `zh-CN-YunjianNeural`). Outputs 16 kHz mono WAVs + manifest.jsonl under:
 *   /tmp/xc-duplex-turn-cache/synth_zh_turns/
 */

import fs from 'node:fs';
import path from 'node:path';
import { MPEGDecoder } from 'mpg123-decoder';
import {
  EDGE_TTS_CONSTANTS,
  buildEdgeTTSPayloads,
  makeConnectionId,
  makeMuid,
  makeSecMsGec,
  parseBinaryFrame,
} from '../../src/lib/edge-tts-core.ts';

type TurnLabel = 'COMPLETE' | 'INCOMPLETE' | 'BACKCHANNEL';

interface Job {
  id: string;
  text: string;
  label: TurnLabel;
  voice: string;
  pitch: string;
  rate: string;
  volume: string;
  wavPath: string;
}

const OUT_DIR = '/tmp/xc-duplex-turn-cache/synth_zh_turns';
const WAV_DIR = path.join(OUT_DIR, 'wav16k');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.jsonl');
const TARGET_SR = 16000;
const CONCURRENCY = 10;

const EDGE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

const ZH_TURN_VOICES = [
  'zh-CN-XiaoyiNeural',
  'zh-CN-YunxiNeural',
  'zh-CN-YunyangNeural',
  'zh-TW-HsiaoChenNeural',
  'zh-TW-YunJheNeural',
];

const PROSODIES = [
  { pitch: '+0Hz', rate: '+0%', volume: '+0%' },
  { pitch: '+5Hz', rate: '+8%', volume: '+0%' },
  { pitch: '-5Hz', rate: '-8%', volume: '+0%' },
];

const COMPLETE_ZH_PHRASES = [
  '今天上海的天气怎么样？',
  '请帮我查一下明天的航班信息。',
  '请问我可以在哪里找到我的发票？',
  '我刚才看到一个优惠活动，可以帮我解答一下吗？',
  '你好，我想咨询一下我的订单状态。',
  '请描述一下太阳能发电的基本原理。',
  '请用简单的语言解释什么是机器学习。',
  '帮我推荐几道适合夏天吃的家常菜。',
  '这个软件支持离线导出PDF文件吗？',
  '从北京南站坐地铁到天安门大概要多久？',
  '能帮我把这段英文翻译成中文吗？',
  '下周三上午十点我有空，就约那个时间吧。',
  '我已经把修改后的设计稿发到你邮箱了。',
  '好的，我大概知道怎么处理这个问题了，谢谢。',
  '请告诉我如何提高日常工作的注意力。',
  '这个价格已经包含税费和运费了吗？',
  '如果方便的话，请帮我安排明天上午的回电。',
  '我需要重置账户密码，请问怎么操作？',
  '帮我总结一下今天会议的三个核心结论。',
  '其实我对这个新功能还挺满意的。',
  '晚饭我想吃番茄炒蛋配米饭。',
  '电脑突然连不上公司内网了，帮我看看原因。',
  '这里到机场打车大概要花多少钱？',
  '请介绍一下杭州西湖最值得去的几个景点。',
  '我觉得今天下午的阳光特别舒服。',
  '你能帮我检查一下这段代码的语法错误吗？',
  '请给我列一份周末露营需要带的物品清单。',
  '我已经收到确认短信了，不用再重复发送。',
  '周末我打算带家人去郊外爬山。',
  '这台笔记本电脑的续航时间表现怎么样？',
  '可以帮我查一下最近的图书馆几点关门吗？',
  '太好了，这正是我一直想找的资料。',
  '请帮我把明天的闹钟调到早上七点半。',
  '这本书主要讲述了怎样的历史背景？',
  '你上次推荐的那家咖啡馆味道确实不错。',
  '请给出提高睡眠质量的五个实用建议。',
  '我更喜欢安静一点的办公环境。',
  '这次测试的结果比我们预想的还要稳定。',
  '请问高铁票退票的手续费是怎么计算的？',
  '没关系，这个问题我们明天再接着讨论。',
];

const INCOMPLETE_ZH_PHRASES = [
  '你好，我想咨询',
  '我有点困惑关于这个产品的',
  '我刚才看到一个优惠活动，你能',
  '我本来想',
  '我觉得这个方案其实还有点',
  '其实我昨天就发现这个接口',
  '因为明天下雨，所以',
  '如果按照我们上周讨论的那个',
  '我想问一下关于最近这个订单的',
  '然后你帮我看看右边那个按钮',
  '就是说如果我先重启一下系统但是',
  '你能不能帮我查一下今天下午',
  '本来打算直接过去的，不过后来',
  '虽然这个模型体积很小，可是',
  '我记得那份合同里面好像写着',
  '关于你刚才提到的那个性能问题，我',
  '等我把这几个文件都整理完之后再',
  '主要是因为现在服务器这边的负载',
  '假如我们把默认超时时间改成五秒的话',
  '我的意思是说，除了这个选项之外',
  '比如你打开设置页面然后点进去',
  '怎么说呢，我觉得它用起来',
  '至于为什么会出现这种情况大概是因为',
  '你先把鼠标移到右上角，接着',
  '好像是上个月底才刚刚更新了',
  '如果今天晚上实在来不及的话那就',
  '哪怕只是先跑通最基础的流程也',
  '我想把背景颜色调得稍微柔和一点，而且',
  '除了刚才说的那两个步骤，另外还需要注意',
  '我刚才在手机上试了一下发现它',
  '那个快递单号我记得是放在桌子上但是',
  '既然大家都同意先用第一版方案那么',
  '不仅要保证响应速度够快，而且还得',
  '所以说如果我们要兼容老版本浏览器',
  '只要把这里的环境变量配置好就能',
  '我本来是想直接买票的，结果网页',
  '对了，你上次跟我说的那个文档地址',
  '关于明天上午的演示流程我还有个',
  '就是那个红色图标旁边的',
  '除非先把缓存彻底清理掉否则它',
];

const EXTRA_PROSODIES = [
  { pitch: '+0Hz', rate: '+0%', volume: '+0%' },
  { pitch: '+6Hz', rate: '+12%', volume: '+0%' },
  { pitch: '-6Hz', rate: '-10%', volume: '+0%' },
  { pitch: '+3Hz', rate: '-5%', volume: '+0%' },
  { pitch: '-4Hz', rate: '+6%', volume: '+0%' },
];

const COMPLETE_ZH_INSTRUCTION_PHRASES = [
  '请简述光合作用在植物生长过程中的主要作用。',
  '告诉我如何用三句话向小学生解释什么是黑洞。',
  '列出三种常见的面向对象的编程语言并说明各自特点。',
  '给定一组整数，找出其中出现次数最多的元素。',
  '请帮我写一段邀请同事参加周五下午茶的简短通知。',
  '解释一下为什么冬天的夜晚通常比白天更冷一些。',
  '提供五个适合在家完成的二十分钟有氧运动项目。',
  '回答以下问题，世界上面积最大的大洋是哪一个？',
  '请说明维生素C对人体免疫系统的日常帮助。',
  '帮我想三个适合科技类播客栏目的中文名称。',
  '把下面这句话改写得更礼貌一些，方便发给客户。',
  '请介绍中国古代四大发明分别是哪几项。',
  '总结一下早睡早起对提升白天工作效率的好处。',
  '说说看，为什么很多软件开发团队喜欢使用敏捷开发？',
  '请给我设计一份两天一夜的南京轻松自由行路线。',
  '如果手机电池电量掉得很快，通常可以检查哪些设置？',
  '描述一下从准备材料到完成番茄牛腩的基本烹饪步骤。',
  '对比一下机械键盘青轴和红轴在打字手感上的差异。',
  '请分析为什么高海拔地区的水沸点会低于一百度。',
  '帮我起草一条朋友乔迁新居时适合发送的祝福语。',
  '说明在编写单元测试时为什么要尽量避免外部网络依赖。',
  '请给出四个在面试中回答职业规划问题的小技巧。',
  '举例说明什么是边际效应，并用日常消费来解释。',
  '帮我计算一下每天存五十块钱，一年下来总共能攒多少。',
  '请列举几种有效缓解长期伏案工作引起的肩颈疲劳的方法。',
  '解释一下为什么飞机在起飞和降落时需要打开遮光板。',
  '用通俗易懂的话说明区块链技术里的去中心化是什么意思。',
  '推荐三本适合周末一口气读完的短篇小说集。',
  '请问在选购家用净水器时主要需要关注哪些参数？',
  '请帮我整理一份出差前必带的证件和数码配件清单。',
  '说一下北半球夏季和冬季昼夜长短变化的原因。',
  '提供几个在嘈杂咖啡馆里保持专注学习的小办法。',
  '如果数据库查询突然变慢，你会按照什么顺序去排查？',
  '请简单概括一下文艺复兴时期欧洲艺术的主要特点。',
  '给出三条帮助新手培养每天阅读十五分钟习惯的建议。',
  '解释为什么金属勺子放进热汤里很快就会变得烫手。',
  '请帮我润色一下这段项目周报，让重点更加清晰。',
  '回答下面这个问题，月球为什么总是同一面朝向地球？',
  '列出做一场高质量线上产品演示前需要确认的事项。',
  '请问绿茶和红茶在制作工艺上最核心的区别是什么？',
  '用简短的语言介绍一下人工智能中监督学习的基本概念。',
  '帮我安排一个下周每天晚上七点到八点的英语听力计划。',
  '请说明定期备份重要工作文件有哪些低成本的方案。',
  '谈一谈为什么城市绿化带能够缓解夏天的热岛效应。',
  '请给出一个用来判断某个年份是否为闰年的简单规则。',
  '告诉我如何在不丢失画质的前提下压缩图片文件大小。',
  '描述一下雨水从云层降落再到蒸发回大气的自然循环。',
  '请帮我比较一下高铁出行和短途飞机的优缺点。',
  '为什么刚烤好的面包放凉之后表皮会慢慢变软？',
  '请拟定四条团队内部代码评审时应当遵守的基本准则。',
  '解释一下浏览器缓存机制是怎么帮助网页加快加载速度的。',
  '帮我推荐几道既清淡又营养均衡的快手早餐搭配。',
  '如果家里突然跳闸断电，安全排查的正确步骤是什么？',
  '请简单说明一下声音在空气中和在水中传播速度的区别。',
  '写出五句适合放在演讲开场白里的幽默破冰台词。',
  '我想了解一下现代极简主义室内设计的核心理念是什么。',
  '请总结一下使用深色主题界面在夜间阅读时的优缺点。',
  '为什么在长时间跑步之后不要立刻原地站着不动？',
  '请给出两个判断二手笔记本电脑成色与电池健康度的办法。',
  '帮我把这五个关键词串联成一个三十秒左右的广告文案。',
];

const BACKCHANNEL_ZH_PHRASES = [
  '嗯嗯，对对对',
  '好呀好呀',
  '哦，原来是这样',
  '嗯，有道理',
  '行吧行吧',
  '对对对，没错',
  '嗯嗯，我知道了',
  '是这样的呀',
  '确实确实',
  '我也这么觉得',
  '没毛病没毛病',
  '哦这样啊',
  '我懂你的意思',
  '有道理有道理',
  '确实是这样',
  '嗯嗯，明白',
  '好嘞好嘞',
  '太真实了',
  '哎，对对',
  '哈哈，确实',
  '没错没错',
  '是吧是吧',
  '可不是嘛',
  '我能理解',
  '这样挺好的',
  '那可不嘛',
  '嗯好，行',
  '我也赞同',
  '挺有意思的',
  '了解了解',
  '怪不得呢',
  '听起来不错',
  '对啊，我也是',
  '行行行',
  '好的好的',
  '嗯嗯，收到',
  '哈哈，是啊',
  '对头对头',
  '嗯，挺好的',
  '说得太对了',
  '没错，就是这样',
  '嗯对，接着说',
  '哦哦，好吧',
  '是啊是啊',
  '好吧好吧',
];

const COMPLETE_ZH_FACT_NUMERIC_PHRASES = [
  '其中数值最大的一个结果是九十六。',
  '这道计算题的最终答案等于二十五。',
  '请把会议室空调的温度调到二十六度。',
  '判断结果已经出来，十九是一个质数。',
  '这组数据排序后的中位数正好是四十二。',
  '一共需要准备三样东西，身份证、车票和充电宝。',
  '最简单直接的做法就是重启一次路由器。',
  '这首诗的作者是唐代著名诗人李白。',
  '总结下来主要有三个原因，成本、时间和人力。',
  '推荐你晚上去看看外滩夜景和豫园老街。',
  '这趟列车的预计到达时间是下午四点二十。',
  '我们最后选定的配色方案是深蓝搭配浅灰。',
  '其实只要每天坚持练习二十分钟就足够了。',
  '这个单词在句子里主要用作及物动词。',
  '按照目前进度，本周五之前就能全部上线。',
  '我最常听的音乐风格主要是爵士和轻音乐。',
  '请帮我把这份表格导出成逗号分隔文件。',
  '关于这个问题，说明书第三页已经写得很清楚了。',
  '冰箱里还剩下两个西红柿和一把青菜。',
  '从长期来看，保持规律作息比熬夜加班更划算。',
  '最后一步，点击右下角的保存并退出按钮。',
  '今晚的月亮看起来又圆又亮。',
  '顺便帮我提醒一下小王明天早上交周报。',
  '这个接口返回的状态码是二百，代表请求成功。',
  '我觉得第一版的排版方式比第二版更清爽。',
  '如果预算有限，优先升级内存条性价比最高。',
  '今天出门记得带一把折叠伞，下午可能会下雨。',
  '他们公司今年新推出的旗舰手机主打轻薄续航。',
  '按照规定，每年年底前都可以申请一次调休。',
  '好了，今天的全部待办事项都已经核对完毕。',
];

function buildJobs(): Job[] {
  const jobs: Job[] = [];
  let idx = 0;

  const addBatch = (
    phrases: string[],
    label: TurnLabel,
    voicesPerPhrase = 3,
    prosodyPool = PROSODIES,
  ) => {
    for (let pIdx = 0; pIdx < phrases.length; pIdx++) {
      const text = phrases[pIdx]!;
      for (let vOff = 0; vOff < voicesPerPhrase; vOff++) {
        const voice = ZH_TURN_VOICES[(pIdx + vOff) % ZH_TURN_VOICES.length]!;
        const pr = prosodyPool[(pIdx + vOff) % prosodyPool.length]!;
        const id = `zh_turn_${String(idx++).padStart(4, '0')}`;
        jobs.push({
          id,
          text,
          label,
          voice,
          pitch: pr.pitch,
          rate: pr.rate,
          volume: pr.volume,
          wavPath: path.join(WAV_DIR, `${id}.wav`),
        });
      }
    }
  };

  addBatch(COMPLETE_ZH_PHRASES, 'COMPLETE');
  addBatch(INCOMPLETE_ZH_PHRASES, 'INCOMPLETE');
  addBatch(COMPLETE_ZH_INSTRUCTION_PHRASES, 'COMPLETE', 4, EXTRA_PROSODIES);
  addBatch(BACKCHANNEL_ZH_PHRASES, 'BACKCHANNEL', 4, EXTRA_PROSODIES);
  addBatch(COMPLETE_ZH_FACT_NUMERIC_PHRASES, 'COMPLETE', 4, EXTRA_PROSODIES);
  return jobs;
}

async function synthesizeEdgeMp3(job: Job): Promise<Uint8Array> {
  const secMsGec = await makeSecMsGec();
  const url = new URL(EDGE_TTS_CONSTANTS.SYNTHESIS_WSS_URL);
  url.searchParams.set('TrustedClientToken', EDGE_TTS_CONSTANTS.TRUSTED_CLIENT_TOKEN);
  url.searchParams.set('Sec-MS-GEC', secMsGec);
  url.searchParams.set('Sec-MS-GEC-Version', EDGE_TTS_CONSTANTS.SEC_MS_GEC_VERSION);
  url.searchParams.set('ConnectionId', makeConnectionId());

  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`Timeout on ${job.id}`));
      }
    }, 12000);

    const ws = new WebSocket(url.toString(), {
      headers: {
        'User-Agent': EDGE_UA,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        Cookie: `muid=${makeMuid()};`,
      },
    } as unknown as string[]);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      const { speechConfig, ssmlMessage } = buildEdgeTTSPayloads(
        job.text,
        job.voice,
        job.pitch,
        job.rate,
        job.volume,
      );
      ws.send(speechConfig);
      ws.send(ssmlMessage);
    };

    ws.onmessage = (ev) => {
      if (settled) return;
      if (typeof ev.data === 'string') {
        if (ev.data.includes('Path:turn.failed') || ev.data.includes('403 Forbidden') || ev.data.includes('Unauthorized')) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          reject(new Error(`Edge rejected: ${ev.data.slice(0, 100)}`));
        } else if (ev.data.includes('turn.end')) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          const totalLen = chunks.reduce((a, b) => a + b.length, 0);
          const merged = new Uint8Array(totalLen);
          let off = 0;
          for (const c of chunks) {
            merged.set(c, off);
            off += c.length;
          }
          if (merged.length < 256) reject(new Error(`Empty audio (${merged.length}B)`));
          else resolve(merged);
        }
      } else if (ev.data instanceof ArrayBuffer) {
        const { headers, body } = parseBinaryFrame(new Uint8Array(ev.data));
        if (headers.Path === 'audio' && body.length > 0) chunks.push(body);
      }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WebSocket error on ${job.id}`));
      }
    };
    ws.onclose = (ev) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Closed early (${ev.code}) on ${job.id}`));
      }
    };
  });
}

function resampleTo16kMono(channels: Float32Array[], sampleRate: number): Float32Array {
  const nChan = channels.length;
  const nIn = channels[0]?.length ?? 0;
  if (nIn === 0) return new Float32Array(0);
  const mono = new Float32Array(nIn);
  if (nChan === 1) mono.set(channels[0]!);
  else {
    const inv = 1 / nChan;
    for (let i = 0; i < nIn; i++) {
      let s = 0;
      for (let c = 0; c < nChan; c++) s += channels[c]![i]!;
      mono[i] = s * inv;
    }
  }
  if (sampleRate === TARGET_SR) return mono;

  const ratio = sampleRate / TARGET_SR;
  const filtered = new Float32Array(nIn);
  const fc = 0.45 * (TARGET_SR / sampleRate);
  const halfTap = 7;
  const kernel = new Float32Array(halfTap * 2 + 1);
  let kSum = 0;
  for (let k = -halfTap; k <= halfTap; k++) {
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const win = 0.54 - 0.46 * Math.cos((2 * Math.PI * (k + halfTap)) / (halfTap * 2));
    const v = sinc * win;
    kernel[k + halfTap] = v;
    kSum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= kSum;
  for (let i = 0; i < nIn; i++) {
    let acc = 0;
    for (let k = -halfTap; k <= halfTap; k++) {
      const idx = Math.max(0, Math.min(nIn - 1, i + k));
      acc += mono[idx]! * kernel[k + halfTap]!;
    }
    filtered[i] = acc;
  }
  const nOut = Math.max(1, Math.round(nIn / ratio));
  const out = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(nIn - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = filtered[i0]! * (1 - frac) + filtered[i1]! * frac;
  }
  return out;
}

function encodeWavPcm16(samples: Float32Array, sampleRate: number): Buffer {
  const dataLen = samples.length * 2;
  const buf = Buffer.allocUnsafe(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    const c = Math.max(-1, Math.min(1, samples[i]!));
    buf.writeInt16LE(Math.round(c * 32767), 44 + i * 2);
  }
  return buf;
}

function trimEdgeSilence(samples: Float32Array, sr: number): Float32Array {
  const thresh = 0.004;
  let start = 0;
  let end = samples.length;
  while (start < end && Math.abs(samples[start]!) < thresh) start++;
  while (end > start && Math.abs(samples[end - 1]!) < thresh) end--;
  const pad = Math.round(0.03 * sr);
  start = Math.max(0, start - pad);
  end = Math.min(samples.length, end + pad);
  return end > start ? samples.subarray(start, end) : samples;
}

async function runWithRetry(job: Job, decoder: MPEGDecoder): Promise<number> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const mp3 = await synthesizeEdgeMp3(job);
      const decoded = decoder.decode(mp3);
      await decoder.reset();
      const pcm16k = trimEdgeSilence(resampleTo16kMono(decoded.channelData, decoded.sampleRate), TARGET_SR);
      if (pcm16k.length < 1600) throw new Error(`Too short (${pcm16k.length})`);
      fs.writeFileSync(job.wavPath, encodeWavPcm16(pcm16k, TARGET_SR));
      return Number((pcm16k.length / TARGET_SR).toFixed(3));
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }
  throw lastErr;
}

async function main() {
  fs.mkdirSync(WAV_DIR, { recursive: true });
  const jobs = buildJobs();
  console.log(`[synth_zh_turns] Planned ${jobs.length} ZH COMPLETE/INCOMPLETE jobs across ${ZH_TURN_VOICES.length} voices.`);

  let nextIdx = 0;
  let completed = 0;
  let failed = 0;
  const manifestLines: string[] = new Array(jobs.length);

  const worker = async () => {
    const decoder = new MPEGDecoder();
    await decoder.ready;
    try {
      while (true) {
        const myIdx = nextIdx++;
        if (myIdx >= jobs.length) break;
        const job = jobs[myIdx]!;
        try {
          let dur = 0;
          if (fs.existsSync(job.wavPath) && fs.statSync(job.wavPath).size > 2000) {
            dur = Number(((fs.statSync(job.wavPath).size - 44) / (TARGET_SR * 2)).toFixed(3));
          } else {
            dur = await runWithRetry(job, decoder);
          }
          manifestLines[myIdx] = JSON.stringify({
            id: job.id,
            wav_path: job.wavPath,
            label: job.label,
            lang: 'ZH',
            split: 'train',
            voice: job.voice,
            text: job.text,
            duration_sec: dur,
          });
          completed++;
          if (completed % 60 === 0 || completed === jobs.length) {
            console.log(`  [progress] ${completed}/${jobs.length} (failed=${failed})`);
          }
        } catch (err) {
          failed++;
          console.error(`  [fail] ${job.id}:`, (err as Error).message);
        }
      }
    } finally {
      decoder.free();
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  fs.writeFileSync(MANIFEST_PATH, `${manifestLines.filter(Boolean).join('\n')}\n`);
  console.log(`[synth_zh_turns] Done! ok=${completed}, failed=${failed} -> ${MANIFEST_PATH}`);
  if (failed > 0) process.exitCode = 1;
}

main();
