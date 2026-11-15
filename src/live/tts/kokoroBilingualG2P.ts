/**
 * kokoroBilingualG2P.ts — Exact browser/Node TypeScript G2P matching Kokoro-82M-v1.1-zh-ONNX.
 *
 * Implements:
 *  1. Exact 172-token `KOKORO_ZH_VOCAB` from `public/models/kokoro-zh/tokenizer.json`.
 *  2. Exact `hexgrad/misaki` v1.1 `ZHFrontend` + `ToneSandhi`:
 *     - Word segmentation + `preMergeForModify` (`不`, `一`, reduplication, continuous 3rd tones, `儿`).
 *     - Mandarin Tone Sandhi (`3+3 -> 2+3`, `[2,1]` / `[1,2]` 3rd-tone chains, `一` yi rules,
 *       `不` bu rules, neutral tone sandhi, erhua `R`).
 *     - Pinyin-pro tone numbers (`1..5`) -> `ZH_MAP` (Bopomofo + 19 Misaki Chinese vowel tokens).
 *  3. English phonemization via `phonemizer` (`en-us` eSpeak-NG WASM) + Misaki `E2M` IPA normalization
 *     + fast core fallback lexicon for synchronous or edge-case reliability.
 *  4. Mixed ZH/EN/CS token assembly `[0, ...ids, 0]` strictly clamped to `<= 510` tokens.
 */

import { pinyin, segment, OutputFormat } from 'pinyin-pro';
import { phonemize } from 'phonemizer';

export const KOKORO_MAX_TOTAL_TOKENS = 510;
export const KOKORO_MAX_PHONEME_TOKENS = KOKORO_MAX_TOTAL_TOKENS - 2; // 508 + [0, ..., 0] = 510

/**
 * Exact 172-token vocab from `onnx-community/Kokoro-82M-v1.1-zh-ONNX/tokenizer.json`.
 */
export const KOKORO_ZH_VOCAB: Readonly<Record<string, number>> = {
  $: 0,
  ';': 1,
  ':': 2,
  ',': 3,
  '.': 4,
  '!': 5,
  '?': 6,
  '/': 7,
  '\u2014': 9,
  '\u2026': 10,
  '"': 11,
  '(': 12,
  ')': 13,
  '\u201c': 14,
  '\u201d': 15,
  ' ': 16,
  '\u0303': 17,
  '\u02a3': 18,
  '\u02a5': 19,
  '\u02a6': 20,
  '\u02a8': 21,
  '\u1d5d': 22,
  '\u3113': 23,
  A: 24,
  I: 25,
  '\u3105': 30,
  O: 31,
  '\u3106': 32,
  Q: 33,
  R: 34,
  S: 35,
  T: 36,
  '\u3107': 37,
  '\u3108': 38,
  W: 39,
  '\u3109': 40,
  Y: 41,
  '\u1d4a': 42,
  a: 43,
  b: 44,
  c: 45,
  d: 46,
  e: 47,
  f: 48,
  '\u310a': 49,
  h: 50,
  i: 51,
  j: 52,
  k: 53,
  l: 54,
  m: 55,
  n: 56,
  o: 57,
  p: 58,
  q: 59,
  r: 60,
  s: 61,
  t: 62,
  u: 63,
  v: 64,
  w: 65,
  x: 66,
  y: 67,
  z: 68,
  '\u0251': 69,
  '\u0250': 70,
  '\u0252': 71,
  '\u00e6': 72,
  '\u310b': 73,
  '\u310c': 74,
  '\u03b2': 75,
  '\u0254': 76,
  '\u0255': 77,
  '\u00e7': 78,
  '\u310d': 79,
  '\u0256': 80,
  '\u00f0': 81,
  '\u02a4': 82,
  '\u0259': 83,
  '\u310e': 84,
  '\u3126': 85,
  '\u025b': 86,
  '\u025c': 87,
  '\u310f': 88,
  '\u3110': 89,
  '\u025f': 90,
  '\u3111': 91,
  '\u0261': 92,
  '\u3112': 93,
  '\u3114': 94,
  '\u3115': 95,
  '\u3117': 96,
  '\u3118': 97,
  '\u3119': 98,
  '\u6708': 99,
  '\u311a': 100,
  '\u0268': 101,
  '\u026a': 102,
  '\u029d': 103,
  '\u311b': 104,
  '\u311d': 105,
  '\u311e': 106,
  '\u311f': 107,
  '\u3120': 108,
  '\u3121': 109,
  '\u026f': 110,
  '\u0270': 111,
  '\u014b': 112,
  '\u0273': 113,
  '\u0272': 114,
  '\u0274': 115,
  '\u00f8': 116,
  '\u3122': 117,
  '\u0278': 118,
  '\u03b8': 119,
  '\u0153': 120,
  '\u3123': 121,
  '\u3124': 122,
  '\u0279': 123,
  '\u3125': 124,
  '\u027e': 125,
  '\u3116': 126,
  '\u3127': 127,
  '\u0281': 128,
  '\u027d': 129,
  '\u0282': 130,
  '\u0283': 131,
  '\u0288': 132,
  '\u02a7': 133,
  '\u3128': 134,
  '\u028a': 135,
  '\u028b': 136,
  '\u3129': 137,
  '\u028c': 138,
  '\u0263': 139,
  '\u311c': 140,
  '\u312d': 141,
  '\u03c7': 142,
  '\u028e': 143,
  '\u5341': 144,
  '\u538b': 145,
  '\u8a00': 146,
  '\u0292': 147,
  '\u0294': 148,
  '\u9633': 149,
  '\u8981': 150,
  '\u9634': 151,
  '\u5e94': 152,
  '\u7528': 153,
  '\u53c8': 154,
  '\u4e2d': 155,
  '\u02c8': 156,
  '\u02cc': 157,
  '\u02d0': 158,
  '\u7a75': 159,
  '\u5916': 160,
  '\u4e07': 161,
  '\u02b0': 162,
  '\u738b': 163,
  '\u02b2': 164,
  '\u4e3a': 165,
  '\u6587': 166,
  '\u74ee': 167,
  '\u6211': 168,
  '3': 169,
  '5': 170,
  '1': 171,
  '2': 172,
  '4': 173,
  '\u5143': 175,
  '\u4e91': 176,
  '\u1d7b': 177,
};

/**
 * Exact `hexgrad/misaki` v1.1 `ZHFrontend.ZH_MAP`.
 */
export const ZH_MAP: Readonly<Record<string, string>> = {
  b: 'ㄅ',
  p: 'ㄆ',
  m: 'ㄇ',
  f: 'ㄈ',
  d: 'ㄉ',
  t: 'ㄊ',
  n: 'ㄋ',
  l: 'ㄌ',
  g: 'ㄍ',
  k: 'ㄎ',
  h: 'ㄏ',
  j: 'ㄐ',
  q: 'ㄑ',
  x: 'ㄒ',
  zh: 'ㄓ',
  ch: 'ㄔ',
  sh: 'ㄕ',
  r: 'ㄖ',
  z: 'ㄗ',
  c: 'ㄘ',
  s: 'ㄙ',
  a: 'ㄚ',
  o: 'ㄛ',
  e: 'ㄜ',
  ie: 'ㄝ',
  ai: 'ㄞ',
  ei: 'ㄟ',
  ao: 'ㄠ',
  ou: 'ㄡ',
  an: 'ㄢ',
  en: 'ㄣ',
  ang: 'ㄤ',
  eng: 'ㄥ',
  er: 'ㄦ',
  i: 'ㄧ',
  u: 'ㄨ',
  v: 'ㄩ',
  ii: 'ㄭ',
  iii: '十',
  ve: '月',
  ia: '压',
  ian: '言',
  iang: '阳',
  iao: '要',
  in: '阴',
  ing: '应',
  iong: '用',
  iou: '又',
  ong: '中',
  ua: '穵',
  uai: '外',
  uan: '万',
  uang: '王',
  uei: '为',
  uen: '文',
  ueng: '瓮',
  uo: '我',
  van: '元',
  vn: '云',
  ';': ';',
  ':': ':',
  ',': ',',
  '.': '.',
  '!': '!',
  '?': '?',
  '/': '/',
  '—': '—',
  '…': '…',
  '"': '"',
  '(': '(',
  ')': ')',
  '“': '“',
  '”': '”',
  ' ': ' ',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  R: 'R',
};

const PHRASES_DICT: Readonly<Record<string, Array<[string, string]>>> = {
  开户行: [['k', 'ai1'], ['h', 'u4'], ['h', 'ang2']],
  发卡行: [['f', 'a4'], ['k', 'a3'], ['h', 'ang2']],
  放款行: [['f', 'ang4'], ['k', 'uan3'], ['h', 'ang2']],
  茧行: [['j', 'ian3'], ['h', 'ang2']],
  行号: [['h', 'ang2'], ['h', 'ao4']],
  各地: [['g', 'e4'], ['d', 'i4']],
  借还款: [['j', 'ie4'], ['h', 'uan2'], ['k', 'uan3']],
  时间为: [['sh', 'i2'], ['j', 'ian1'], ['w', 'ei2']],
  为准: [['w', 'ei2'], ['zh', 'un3']],
  色差: [['s', 'e4'], ['ch', 'a1']],
  嗲: [['d', 'ia3']],
  呗: [['b', 'ei5']],
  咗: [['z', 'uo5']],
  嘞: [['l', 'ei5']],
  掺和: [['ch', 'an1'], ['h', 'uo5']],
};

const MUST_ERHUA = new Set([
  '小院儿',
  '胡同儿',
  '范儿',
  '老汉儿',
  '撒欢儿',
  '寻老礼儿',
  '妥妥儿',
  '媳妇儿',
]);

const NOT_ERHUA = new Set([
  '虐儿', '为儿', '护儿', '瞒儿', '救儿', '替儿', '有儿', '一儿', '我儿', '俺儿', '妻儿',
  '拐儿', '聋儿', '乞儿', '患儿', '幼儿', '孤儿', '婴儿', '婴幼儿', '连体儿', '脑瘫儿',
  '流浪儿', '体弱儿', '混血儿', '蜜雪儿', '舫儿', '祖儿', '美儿', '应采儿', '可儿', '侄儿',
  '孙儿', '侄孙儿', '女儿', '男儿', '红孩儿', '花儿', '虫儿', '马儿', '鸟儿', '猪儿', '猫儿',
  '狗儿', '少儿',
]);

const MUST_NEURAL_TONE_WORDS = new Set([
  '麻烦', '麻利', '鸳鸯', '高粱', '骨头', '骆驼', '马虎', '首饰', '馒头', '馄饨', '风筝',
  '难为', '队伍', '阔气', '闺女', '门道', '锄头', '铺盖', '铃铛', '铁匠', '钥匙', '里脊',
  '里头', '部分', '那么', '道士', '造化', '迷糊', '连累', '这么', '这个', '运气', '过去',
  '软和', '转悠', '踏实', '跳蚤', '跟头', '趔趄', '财主', '豆腐', '讲究', '记性', '记号',
  '认识', '规矩', '见识', '裁缝', '补丁', '衣裳', '衣服', '衙门', '街坊', '行李', '行当',
  '蛤蟆', '蘑菇', '薄荷', '葫芦', '葡萄', '萝卜', '荸荠', '苗条', '苗头', '苍蝇', '芝麻',
  '舒服', '舒坦', '舌头', '自在', '膏药', '脾气', '脑袋', '脊梁', '能耐', '胳膊', '胭脂',
  '胡萝', '胡琴', '胡同', '聪明', '耽误', '耽搁', '耷拉', '耳朵', '老爷', '老实', '老婆',
  '戏弄', '将军', '翻腾', '罗嗦', '罐头', '编辑', '结实', '红火', '累赘', '糨糊', '糊涂',
  '精神', '粮食', '簸箕', '篱笆', '算计', '算盘', '答应', '笤帚', '笑语', '笑话', '窟窿',
  '窝囊', '窗户', '稳当', '稀罕', '称呼', '秧歌', '秀气', '秀才', '福气', '祖宗', '砚台',
  '码头', '石榴', '石头', '石匠', '知识', '眼睛', '眯缝', '眨巴', '眉毛', '相声', '盘算',
  '白净', '痢疾', '痛快', '疟疾', '疙瘩', '疏忽', '畜生', '生意', '甘蔗', '琵琶', '琢磨',
  '琉璃', '玻璃', '玫瑰', '玄乎', '狐狸', '状元', '特务', '牲口', '牙碜', '牌楼', '爽快',
  '爱人', '热闹', '烧饼', '烟筒', '烂糊', '点心', '炊帚', '灯笼', '火候', '漂亮', '滑溜',
  '溜达', '温和', '清楚', '消息', '浪头', '活泼', '比方', '正经', '欺负', '模糊', '槟榔',
  '棺材', '棒槌', '棉花', '核桃', '栅栏', '柴火', '架势', '枕头', '枇杷', '机灵', '本事',
  '木头', '木匠', '朋友', '月饼', '月亮', '暖和', '明白', '时候', '新鲜', '故事', '收拾',
  '收成', '提防', '挖苦', '挑剔', '指甲', '指头', '拾掇', '拳头', '拨弄', '招牌', '招呼',
  '抬举', '护士', '折腾', '扫帚', '打量', '打算', '打扮', '打听', '打发', '扎实', '扁担',
  '戒指', '懒得', '意识', '意思', '悟性', '怪物', '思量', '怎么', '念头', '念叨', '别人',
  '快活', '忙活', '志气', '心思', '得罪', '张罗', '弟兄', '开通', '应酬', '庄稼', '干事',
  '帮手', '帐篷', '希罕', '师父', '师傅', '巴结', '巴掌', '差事', '工夫', '岁数', '屁股',
  '尾巴', '少爷', '小气', '小伙', '将就', '对头', '对付', '寡妇', '家伙', '客气', '实在',
  '官司', '学问', '字号', '嫁妆', '媳妇', '媒人', '婆家', '娘家', '委屈', '姑娘', '姐夫',
  '妯娌', '妥当', '妖精', '奴才', '女婿', '头发', '太阳', '大爷', '大方', '大意', '大夫',
  '多少', '多么', '外甥', '壮实', '地道', '地方', '在乎', '困难', '嘴巴', '嘱咐', '嘟囔',
  '嘀咕', '喜欢', '喇嘛', '喇叭', '商量', '唾沫', '哑巴', '哈欠', '哆嗦', '咳嗽', '和尚',
  '告诉', '告示', '含糊', '吓唬', '后头', '名字', '名堂', '合同', '吆喝', '叫唤', '口袋',
  '厚道', '厉害', '千斤', '包袱', '包涵', '匀称', '勤快', '动静', '动弹', '功夫', '力气',
  '前头', '刺猬', '刺激', '别扭', '利落', '利索', '利害', '分析', '出息', '凑合', '凉快',
  '冷战', '冤枉', '冒失', '养活', '关系', '先生', '兄弟', '便宜', '使唤', '佩服', '作坊',
  '体面', '位置', '似的', '伙计', '休息', '什么', '人家', '亲戚', '亲家', '交情', '云彩',
  '事情', '买卖', '主意', '丫头', '丧气', '两口', '东西', '东家', '世故', '不由', '下水',
  '下巴', '上头', '上司', '丈夫', '丈人', '一辈', '那个', '菩萨', '父亲', '母亲', '咕噜',
  '邋遢', '费用', '冤家', '甜头', '介绍', '荒唐', '大人', '泥鳅', '幸福', '熟悉', '计划',
  '扑腾', '蜡烛', '姥爷', '照顾', '喉咙', '吉他', '弄堂', '蚂蚱', '凤凰', '拖沓', '寒碜',
  '糟蹋', '倒腾', '报复', '逻辑', '盘缠', '喽啰', '牢骚', '咖喱', '扫把', '惦记', '谢谢',
]);

const MUST_NOT_NEURAL_TONE_WORDS = new Set([
  '男子', '女子', '分子', '原子', '量子', '莲子', '石子', '瓜子', '电子', '人人', '虎虎',
  '幺幺', '干嘛', '学子', '哈哈', '数数', '袅袅', '局地', '以下', '娃哈哈', '花花草草', '留得',
  '耕地', '想想', '熙熙', '攘攘', '卵子', '死死', '冉冉', '恳恳', '佼佼', '吵吵', '打打',
  '考考', '整整', '莘莘', '落地', '算子', '家家户户', '青青',
]);

/** Common 2-char lexical words to assist 3-char 3rd-tone [2,1] vs [1,2] split & segmentation. */
const ZH_TWO_CHAR_LEXICON = new Set([
  '你好', '我们', '你们', '他们', '这里', '那里', '哪里', '什么', '怎么', '为什么', '可以',
  '喜欢', '所以', '如果', '但是', '不过', '因为', '现在', '今天', '明天', '昨天', '时候',
  '海边', '朋友', '问题', '一直', '一起', '一样', '一下', '一点', '一个', '第一', '一段',
  '一天', '不怕', '不错', '不对', '不要', '不好', '不能', '不会', '不是', '老虎', '纸张',
  '蒙古', '展览', '总统', '管理', '理解', '产品', '水果', '手机', '老板', '小狗', '小姐',
  '小鸟', '小院', '领导', '演讲', '选举', '了解', '体会', '所有', '大家', '感觉', '觉得',
  '应该', '可能', '已经', '还是', '或者', '非常', '特别', '真的', '很多', '很好', '好吧',
  '等等', '谢谢', '加油', '海风', '散步', '小春', '小蠢', '测试', '温度', '语音', '对话',
]);

const ZH_THREE_CHAR_LEXICON = new Set([
  '看不懂', '听不懂', '说不清', '找不到', '买不到', '来不及', '对不起', '看一看', '听一听',
  '想一想', '试一试', '笑一笑', '小院儿', '胡同儿', '蒙古包', '纸老虎', '展览馆', '我可以',
  '好喜欢', '所有人', '总统府', '没关系', '为什么', '怎么样',
]);

const ZH_FOUR_CHAR_LEXICON = new Set([
  '不可一世', '一举两得', '一心一意', '七上八下', '不知所措',
]);

const ZH_SANDHI_PUNC = new Set([
  '、', '：', '，', '；', '。', '？', '！', '“', '”', '‘', '’', "'", ':', ',', ';', '.', '?', '!',
]);

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_UNITS = ['', '十', '百', '千'];

function intToChinese(numStr: string): string {
  const n = Number(numStr);
  if (!Number.isFinite(n) || n < 0 || numStr.length > 8) {
    return Array.from(numStr)
      .map((d) => CN_DIGITS[Number(d)] ?? d)
      .join('');
  }
  const intVal = Math.floor(n);
  if (intVal === 0) return '零';
  if (intVal < 10) return CN_DIGITS[intVal]!;
  if (intVal < 20) return `十${intVal % 10 === 0 ? '' : CN_DIGITS[intVal % 10]!}`;
  if (intVal < 10000) {
    const digits = String(intVal).split('').map(Number);
    let out = '';
    let zeroPending = false;
    for (let i = 0; i < digits.length; i++) {
      const d = digits[i]!;
      const unitIdx = digits.length - 1 - i;
      if (d === 0) {
        zeroPending = true;
      } else {
        if (zeroPending) {
          out += '零';
          zeroPending = false;
        }
        out += `${CN_DIGITS[d]!}${CN_UNITS[unitIdx]!}`;
      }
    }
    return out;
  }
  const wan = Math.floor(intVal / 10000);
  const rem = intVal % 10000;
  const head = `${intToChinese(String(wan))}万`;
  if (rem === 0) return head;
  if (rem < 1000) return `${head}零${intToChinese(String(rem))}`;
  return `${head}${intToChinese(String(rem))}`;
}

export function normalizeMixedNumbers(text: string): string {
  // Replace numbers adjacent to Chinese characters (e.g. 2025年, 3.5倍, 100%)
  return text
    .replace(/(\d+(?:\.\d+)?)%(?=[\u4E00-\u9FFF\s，。！？,.!?]|$)/g, (_, num: string) => {
      const parts = num.split('.');
      const spoken =
        parts.length === 2
          ? `${intToChinese(parts[0]!)}点${Array.from(parts[1]!).map((c) => CN_DIGITS[Number(c)] ?? c).join('')}`
          : intToChinese(parts[0]!);
      return `百分之${spoken}`;
    })
    .replace(/(\d+)(?=[\u4E00-\u9FFF])/g, (_, num: string) => {
      if (num.length === 4 && (num.startsWith('19') || num.startsWith('20'))) {
        return Array.from(num)
          .map((d) => CN_DIGITS[Number(d)] ?? d)
          .join('');
      }
      return intToChinese(num);
    })
    .replace(/(?<=[\u4E00-\u9FFF])(\d+(?:\.\d+)?)/g, (_, num: string) => {
      const parts = num.split('.');
      if (parts.length === 2) {
        return `${intToChinese(parts[0]!)}点${Array.from(parts[1]!).map((c) => CN_DIGITS[Number(c)] ?? c).join('')}`;
      }
      return intToChinese(parts[0]!);
    });
}

export function mapKokoroPunctuation(text: string): string {
  return text
    .replace(/、/g, ', ')
    .replace(/，/g, ', ')
    .replace(/。/g, '. ')
    .replace(/．/g, '. ')
    .replace(/！/g, '! ')
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/？/g, '? ')
    .replace(/[«《「【]/g, ' “')
    .replace(/[»》」】]/g, '” ')
    .replace(/（/g, ' (')
    .replace(/）/g, ') ')
    .replace(/[～~]/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface SegToken {
  word: string;
  tag: 'zh' | 'punc' | 'eng';
}

function isZhChar(ch: string): boolean {
  return ch >= '\u4E00' && ch <= '\u9FFF';
}

function isNumericZhSeq(word: string): boolean {
  for (const ch of word) {
    if (!/[一二三四五六七八九零十百千万亿两0-9]/.test(ch)) return false;
  }
  return true;
}

/**
 * Segments a Chinese-punctuation string into words using `pinyin-pro` segmenter +
 * lexicon max-match + `ToneSandhi.pre_merge_for_modify`.
 */
function segmentChineseText(text: string): SegToken[] {
  const segs = segment(text, {
    format: OutputFormat.AllSegment,
    toneType: 'num',
    segmentit: 2,
  });

  // First pass: merge adjacent single chars that form known 2/3/4-char lexicon entries
  const rawWords: SegToken[] = [];
  for (const s of segs) {
    const w = s.origin;
    if (!w) continue;
    if (isZhChar(w[0]!)) {
      rawWords.push({ word: w, tag: 'zh' });
    } else if (ZH_MAP[w] || ZH_SANDHI_PUNC.has(w)) {
      rawWords.push({ word: w, tag: 'punc' });
    } else if (!/^\s+$/.test(w)) {
      rawWords.push({ word: w, tag: 'punc' });
    }
  }

  // Dictionary max-match coalesce across consecutive 'zh' tokens
  const mergedLex: SegToken[] = [];
  let i = 0;
  while (i < rawWords.length) {
    const cur = rawWords[i]!;
    if (cur.tag !== 'zh') {
      mergedLex.push(cur);
      i++;
      continue;
    }
    if (cur.word.length === 1) {
      if (i + 3 < rawWords.length && rawWords[i + 1]!.tag === 'zh' && rawWords[i + 2]!.tag === 'zh' && rawWords[i + 3]!.tag === 'zh') {
        const w4 = cur.word + rawWords[i + 1]!.word + rawWords[i + 2]!.word + rawWords[i + 3]!.word;
        if (ZH_FOUR_CHAR_LEXICON.has(w4)) {
          mergedLex.push({ word: w4, tag: 'zh' });
          i += 4;
          continue;
        }
      }
      if (i + 2 < rawWords.length && rawWords[i + 1]!.tag === 'zh' && rawWords[i + 2]!.tag === 'zh') {
        const w3 = cur.word + rawWords[i + 1]!.word + rawWords[i + 2]!.word;
        if (ZH_THREE_CHAR_LEXICON.has(w3) || MUST_NEURAL_TONE_WORDS.has(w3) || PHRASES_DICT[w3]) {
          mergedLex.push({ word: w3, tag: 'zh' });
          i += 3;
          continue;
        }
      }
      if (i + 1 < rawWords.length && rawWords[i + 1]!.tag === 'zh' && rawWords[i + 1]!.word.length === 1) {
        const w2 = cur.word + rawWords[i + 1]!.word;
        if (ZH_TWO_CHAR_LEXICON.has(w2) || MUST_NEURAL_TONE_WORDS.has(w2) || MUST_NOT_NEURAL_TONE_WORDS.has(w2) || PHRASES_DICT[w2]) {
          mergedLex.push({ word: w2, tag: 'zh' });
          i += 2;
          continue;
        }
      }
    }
    mergedLex.push(cur);
    i++;
  }

  return preMergeForSandhi(mergedLex);
}

function getRawInitialsFinals(word: string): { initials: string[]; finals: string[] } {
  const phraseOverride = PHRASES_DICT[word];
  if (phraseOverride && phraseOverride.length === word.length) {
    return {
      initials: phraseOverride.map((p) => p[0]),
      finals: phraseOverride.map((p) => p[1]),
    };
  }

  const all = pinyin(word, { type: 'all', toneType: 'num' });
  const initials: string[] = [];
  const finals: string[] = [];

  for (let idx = 0; idx < word.length; idx++) {
    const ch = word[idx]!;
    if (ch === '嗯') {
      initials.push('');
      finals.push('n2');
      continue;
    }
    const item = all[idx];
    if (!item || !item.isZh) {
      initials.push('');
      finals.push('5');
      continue;
    }

    let init = item.initial || '';
    let fin = item.final || '';
    let tone = item.num === 0 ? '5' : String(item.num || 5);
    if (!['1', '2', '3', '4', '5'].includes(tone)) tone = '5';
    let finBase = fin.replace(/[0-5]$/, '');

    // Normalize pinyin-pro initials/finals into Misaki/pypinyin Style.FINALS_TONE3 canonical keys
    if (init === 'y') {
      init = '';
      if (finBase === 'u') finBase = 'v';
      else if (finBase === 'ue' || finBase === 'üe') finBase = 've';
      else if (finBase === 'uan') finBase = 'van';
      else if (finBase === 'un') finBase = 'vn';
      else if (finBase === 'a') finBase = 'ia';
      else if (finBase === 'e') finBase = 'ie';
      else if (finBase === 'ao') finBase = 'iao';
      else if (finBase === 'ou') finBase = 'iou';
      else if (finBase === 'an') finBase = 'ian';
      else if (finBase === 'ang') finBase = 'iang';
      else if (finBase === 'ong') finBase = 'iong';
      else if (finBase === 'o') finBase = 'o';
      // yi / yin / ying remain i / in / ing
    } else if (init === 'w') {
      init = '';
      if (finBase === 'u') finBase = 'u';
      else if (finBase === 'a') finBase = 'ua';
      else if (finBase === 'ai') finBase = 'uai';
      else if (finBase === 'an') finBase = 'uan';
      else if (finBase === 'ang') finBase = 'uang';
      else if (finBase === 'ei') finBase = 'uei';
      else if (finBase === 'en') finBase = 'uen';
      else if (finBase === 'eng') finBase = 'ueng';
      else if (finBase === 'o') finBase = 'uo';
    } else {
      // Consonant initials
      if (init === 'j' || init === 'q' || init === 'x') {
        if (finBase === 'u') finBase = 'v';
        else if (finBase === 'ue' || finBase === 'üe') finBase = 've';
        else if (finBase === 'uan') finBase = 'van';
        else if (finBase === 'un') finBase = 'vn';
      }
      finBase = finBase.replace(/ü/g, 'v');
      if (finBase === 'iu') finBase = 'iou';
      else if (finBase === 'ui') finBase = 'uei';
      else if (finBase === 'un') finBase = 'uen';

      if (finBase === 'i') {
        if (init === 'z' || init === 'c' || init === 's') {
          finBase = 'ii';
        } else if (init === 'zh' || init === 'ch' || init === 'sh' || init === 'r') {
          finBase = 'iii';
        }
      }
    }

    // Special standalone syllable overrides ('地' defaults to de5 unless di4 context, '的/得' -> 5)
    if (ch === '地' && word.length === 1) {
      finBase = 'e';
      tone = '5';
    }
    if ((ch === '的' || ch === '得') && word.length === 1) {
      tone = '5';
    }
    if (ch === '不' && word.length === 1) {
      init = 'b';
      finBase = 'u';
      tone = '4';
    }

    if (!(finBase in ZH_MAP)) {
      if (finBase === 'ng') {
        init = '';
        finBase = 'n';
      } else if (finBase === 'io') {
        finBase = 'o';
      } else {
        finBase = 'e';
      }
    }

    initials.push(init);
    finals.push(`${finBase}${tone}`);
  }

  return { initials, finals };
}

function allToneThree(finals: string[]): boolean {
  return finals.length > 0 && finals.every((f) => f.endsWith('3'));
}

function isReduplication(word: string): boolean {
  return word.length === 2 && word[0] === word[1];
}

function preMergeForSandhi(seg: SegToken[]): SegToken[] {
  // 1. Merge "不" with following zh token, and X+不+Y potential complements
  const afterBu: SegToken[] = [];
  for (let i = 0; i < seg.length; i++) {
    const cur = seg[i]!;
    if (
      cur.tag === 'zh' &&
      cur.word === '不' &&
      i + 1 < seg.length &&
      seg[i + 1]!.tag === 'zh'
    ) {
      const next = seg[i + 1]!;
      if (
        afterBu.length > 0 &&
        afterBu[afterBu.length - 1]!.tag === 'zh' &&
        afterBu[afterBu.length - 1]!.word.length === 1 &&
        next.word.length === 1
      ) {
        // Potential complement e.g. 看 + 不 + 懂 -> 看不懂
        afterBu[afterBu.length - 1] = {
          word: afterBu[afterBu.length - 1]!.word + '不' + next.word,
          tag: 'zh',
        };
      } else {
        afterBu.push({ word: '不' + next.word, tag: 'zh' });
      }
      i++;
      continue;
    }
    afterBu.push(cur);
  }

  // 2. Merge "一" reduplications (V + 一 + V -> V一V) and "一" + next word
  const afterYiRedup: SegToken[] = [];
  for (let i = 0; i < afterBu.length; i++) {
    const cur = afterBu[i]!;
    if (
      cur.tag === 'zh' &&
      cur.word === '一' &&
      afterYiRedup.length > 0 &&
      i + 1 < afterBu.length &&
      afterYiRedup[afterYiRedup.length - 1]!.tag === 'zh' &&
      afterBu[i + 1]!.tag === 'zh' &&
      afterYiRedup[afterYiRedup.length - 1]!.word === afterBu[i + 1]!.word &&
      cur.word !== afterBu[i + 1]!.word
    ) {
      const base = afterYiRedup[afterYiRedup.length - 1]!.word;
      afterYiRedup[afterYiRedup.length - 1] = { word: `${base}一${base}`, tag: 'zh' };
      i++;
      continue;
    }
    afterYiRedup.push(cur);
  }

  const afterYi: SegToken[] = [];
  for (let i = 0; i < afterYiRedup.length; i++) {
    const cur = afterYiRedup[i]!;
    if (
      afterYi.length > 0 &&
      afterYi[afterYi.length - 1]!.word === '一' &&
      cur.tag === 'zh' &&
      !isNumericZhSeq(cur.word)
    ) {
      afterYi[afterYi.length - 1] = { word: '一' + cur.word, tag: 'zh' };
    } else {
      afterYi.push(cur);
    }
  }

  // 3. Merge reduplication (e.g., 看 + 看 -> 看看)
  const afterRedup: SegToken[] = [];
  for (const cur of afterYi) {
    if (
      afterRedup.length > 0 &&
      cur.tag === 'zh' &&
      afterRedup[afterRedup.length - 1]!.word === cur.word
    ) {
      afterRedup[afterRedup.length - 1] = { word: cur.word + cur.word, tag: 'zh' };
    } else {
      afterRedup.push(cur);
    }
  }

  // 4. Merge continuous all-3rd-tone words (len <= 3)
  const merge3All = (input: SegToken[]): SegToken[] => {
    const finalsPerTok = input.map((t) => (t.tag === 'zh' ? getRawInitialsFinals(t.word).finals : ['0']));
    const out: SegToken[] = [];
    const mergedPrev = new Array(input.length).fill(false);
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      if (
        cur.tag === 'zh' &&
        out.length > 0 &&
        out[out.length - 1]!.tag === 'zh' &&
        !mergedPrev[i - 1] &&
        !isReduplication(out[out.length - 1]!.word) &&
        allToneThree(finalsPerTok[i - 1]!) &&
        allToneThree(finalsPerTok[i]!) &&
        out[out.length - 1]!.word.length + cur.word.length <= 3
      ) {
        out[out.length - 1] = { word: out[out.length - 1]!.word + cur.word, tag: 'zh' };
        mergedPrev[i] = true;
      } else {
        out.push(cur);
      }
    }
    return out;
  };

  // 5. Merge boundary 3rd-tone words (last char of prev == 3 and first char of cur == 3)
  const merge3Boundary = (input: SegToken[]): SegToken[] => {
    const finalsPerTok = input.map((t) => (t.tag === 'zh' ? getRawInitialsFinals(t.word).finals : ['0']));
    const out: SegToken[] = [];
    const mergedPrev = new Array(input.length).fill(false);
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      if (
        cur.tag === 'zh' &&
        out.length > 0 &&
        out[out.length - 1]!.tag === 'zh' &&
        !mergedPrev[i - 1] &&
        !isReduplication(out[out.length - 1]!.word) &&
        finalsPerTok[i - 1]![finalsPerTok[i - 1]!.length - 1]!.endsWith('3') &&
        finalsPerTok[i]![0]!.endsWith('3') &&
        out[out.length - 1]!.word.length + cur.word.length <= 3
      ) {
        out[out.length - 1] = { word: out[out.length - 1]!.word + cur.word, tag: 'zh' };
        mergedPrev[i] = true;
      } else {
        out.push(cur);
      }
    }
    return out;
  };

  const after3 = merge3Boundary(merge3All(afterRedup));

  // 6. Merge trailing "儿" onto previous zh word
  const afterEr: SegToken[] = [];
  for (const cur of after3) {
    if (
      cur.tag === 'zh' &&
      cur.word === '儿' &&
      afterEr.length > 0 &&
      afterEr[afterEr.length - 1]!.tag === 'zh'
    ) {
      afterEr[afterEr.length - 1] = { word: afterEr[afterEr.length - 1]!.word + '儿', tag: 'zh' };
    } else {
      afterEr.push(cur);
    }
  }

  return afterEr;
}

function setFinalTone(finalWithTone: string, tone: string): string {
  return `${finalWithTone.slice(0, -1)}${tone}`;
}

function splitWordForThreeSandhi(word: string): [string, string] {
  if (word.length === 3) {
    const first2 = word.slice(0, 2);
    const last2 = word.slice(1, 3);
    if (ZH_TWO_CHAR_LEXICON.has(first2) && !ZH_TWO_CHAR_LEXICON.has(last2)) {
      return [first2, word.slice(2)];
    }
    if (ZH_TWO_CHAR_LEXICON.has(last2) && !ZH_TWO_CHAR_LEXICON.has(first2)) {
      return [word.slice(0, 1), last2];
    }
    // Fallback to pinyin-pro segmenter if it splits cleanly
    const subSeg = segment(word, { format: OutputFormat.AllSegment, segmentit: 2 });
    if (subSeg.length === 2 && subSeg[0]!.origin.length >= 1) {
      return [subSeg[0]!.origin, subSeg[1]!.origin];
    }
    return [first2, word.slice(2)];
  }
  const mid = Math.floor(word.length / 2);
  return [word.slice(0, mid), word.slice(mid)];
}

export function applyMandarinToneSandhi(word: string, rawFinals: string[]): string[] {
  const finals = [...rawFinals];

  // 1. "不" sandhi
  if (word.length === 3 && word[1] === '不') {
    finals[1] = setFinalTone(finals[1]!, '5');
  } else {
    for (let i = 0; i < word.length; i++) {
      if (word[i] === '不' && i + 1 < word.length && finals[i + 1]!.endsWith('4')) {
        finals[i] = setFinalTone(finals[i]!, '2');
      }
    }
  }

  // 2. "一" sandhi
  if (word.includes('一') && isNumericZhSeq(word)) {
    for (let i = 0; i < word.length; i++) {
      if (word[i] === '一') finals[i] = setFinalTone(finals[i]!, '1');
    }
  } else if (word.length === 3 && word[1] === '一' && word[0] === word[2]) {
    finals[1] = setFinalTone(finals[1]!, '5');
  } else if (word.startsWith('第一')) {
    finals[1] = setFinalTone(finals[1]!, '1');
  } else {
    for (let i = 0; i < word.length; i++) {
      if (word[i] === '一' && i + 1 < word.length) {
        const nextTone = finals[i + 1]!.slice(-1);
        if (nextTone === '4' || nextTone === '5') {
          finals[i] = setFinalTone(finals[i]!, '2');
        } else if (!ZH_SANDHI_PUNC.has(word[i + 1]!)) {
          finals[i] = setFinalTone(finals[i]!, '4');
        }
      }
    }
  }

  // 3. Neutral tone sandhi
  if (!MUST_NOT_NEURAL_TONE_WORDS.has(word)) {
    for (let j = 1; j < word.length; j++) {
      if (word[j] === word[j - 1]) {
        finals[j] = setFinalTone(finals[j]!, '5');
      }
    }
    const lastChar = word[word.length - 1]!;
    const geIdx = word.indexOf('个');
    if ('吧呢啊呐噻嘛吖嗨哦哒滴哩哟喽啰耶喔诶'.includes(lastChar)) {
      finals[finals.length - 1] = setFinalTone(finals[finals.length - 1]!, '5');
    } else if ('的地得'.includes(lastChar)) {
      finals[finals.length - 1] = setFinalTone(finals[finals.length - 1]!, '5');
    } else if (word.length === 1 && '了着过'.includes(word)) {
      finals[0] = setFinalTone(finals[0]!, '5');
    } else if (word.length > 1 && '们子'.includes(lastChar)) {
      finals[finals.length - 1] = setFinalTone(finals[finals.length - 1]!, '5');
    } else if (word.length > 1 && '上下'.includes(lastChar) && !['一下', '上下'].includes(word)) {
      finals[finals.length - 1] = setFinalTone(finals[finals.length - 1]!, '5');
    } else if (word.length > 1 && '来去'.includes(lastChar) && '上下进出回过起开'.includes(word[word.length - 2]!)) {
      finals[finals.length - 1] = setFinalTone(finals[finals.length - 1]!, '5');
    } else if (
      word === '个' ||
      (geIdx >= 1 && (/[0-9一二三四五六七八九两几有多各整每做是]/.test(word[geIdx - 1]!)))
    ) {
      finals[geIdx] = setFinalTone(finals[geIdx]!, '5');
    } else if (MUST_NEURAL_TONE_WORDS.has(word) || MUST_NEURAL_TONE_WORDS.has(word.slice(-2))) {
      finals[finals.length - 1] = setFinalTone(finals[finals.length - 1]!, '5');
    }
  }

  // 4. Third-tone sandhi (`3+3 -> 2+3` & continuous 3rd-tone runs)
  if (word.length === 2 && allToneThree(finals)) {
    finals[0] = setFinalTone(finals[0]!, '2');
  } else if (word.length === 3) {
    const [sub1, sub2] = splitWordForThreeSandhi(word);
    if (allToneThree(finals)) {
      if (sub1.length === 2) {
        finals[0] = setFinalTone(finals[0]!, '2');
        finals[1] = setFinalTone(finals[1]!, '2');
      } else {
        finals[1] = setFinalTone(finals[1]!, '2');
      }
    } else {
      const f1 = finals.slice(0, sub1.length);
      const f2 = finals.slice(sub1.length);
      if (f1.length === 2 && allToneThree(f1)) {
        f1[0] = setFinalTone(f1[0]!, '2');
      }
      if (f2.length === 2 && allToneThree(f2)) {
        f2[0] = setFinalTone(f2[0]!, '2');
      }
      if (f1.length > 0 && f2.length > 0 && f1[f1.length - 1]!.endsWith('3') && f2[0]!.endsWith('3')) {
        f1[f1.length - 1] = setFinalTone(f1[f1.length - 1]!, '2');
      }
      void sub2;
      return [...f1, ...f2];
    }
  } else if (word.length === 4) {
    const f1 = finals.slice(0, 2);
    const f2 = finals.slice(2, 4);
    if (allToneThree(f1)) f1[0] = setFinalTone(f1[0]!, '2');
    if (allToneThree(f2)) f2[0] = setFinalTone(f2[0]!, '2');
    if (f1[1]!.endsWith('3') && f2[0]!.endsWith('3')) {
      f1[1] = setFinalTone(f1[1]!, '2');
    }
    return [...f1, ...f2];
  } else if (word.length > 4) {
    for (let i = 0; i < finals.length - 1; i++) {
      if (finals[i]!.endsWith('3') && finals[i + 1]!.endsWith('3')) {
        finals[i] = setFinalTone(finals[i]!, '2');
      }
    }
  }

  return finals;
}

function mergeErhua(
  initials: string[],
  finals: string[],
  word: string,
): { initials: string[]; finals: string[] } {
  const fixedFinals = finals.map((phn, idx) =>
    idx === finals.length - 1 && word[idx] === '儿' && phn === 'er1' ? 'er2' : phn,
  );
  if (
    !MUST_ERHUA.has(word) &&
    (NOT_ERHUA.has(word) || fixedFinals.length !== word.length || word.length <= 1)
  ) {
    return { initials, finals: fixedFinals };
  }

  const outInitials: string[] = [];
  const outFinals: string[] = [];
  for (let i = 0; i < fixedFinals.length; i++) {
    const phn = fixedFinals[i]!;
    if (
      i === fixedFinals.length - 1 &&
      word[i] === '儿' &&
      (phn === 'er2' || phn === 'er5') &&
      !NOT_ERHUA.has(word.slice(-2)) &&
      outFinals.length > 0
    ) {
      const prev = outFinals[outFinals.length - 1]!;
      outFinals[outFinals.length - 1] = `${prev.slice(0, -1)}R${prev.slice(-1)}`;
    } else {
      outInitials.push(initials[i]!);
      outFinals.push(phn);
    }
  }
  return { initials: outInitials, finals: outFinals };
}

export function zhSegmentToMisakiPhones(zhText: string): string {
  const tokens = segmentChineseText(zhText);
  const parts: string[] = [];
  let prevWasZh = false;

  for (const tk of tokens) {
    if (tk.tag !== 'zh') {
      if (tk.word in ZH_MAP) {
        parts.push(ZH_MAP[tk.word]!);
      }
      prevWasZh = false;
      continue;
    }

    if (prevWasZh) {
      parts.push('/');
    }

    const { initials: rawInit, finals: rawFin } = getRawInitialsFinals(tk.word);
    const sandhiFinals = applyMandarinToneSandhi(tk.word, rawFin);
    const { initials, finals } = mergeErhua(rawInit, sandhiFinals, tk.word);

    const phones: string[] = [];
    for (let i = 0; i < finals.length; i++) {
      const c = initials[i];
      const v = finals[i];
      if (c) phones.push(c);
      if (v) phones.push(v);
    }
    const joined = phones
      .join('_')
      .replace(/_eR/g, '_er')
      .replace(/R/g, '_R')
      .replace(/(?=\d)/g, '_');

    const wordPhones = joined
      .split('_')
      .filter(Boolean)
      .map((p) => ZH_MAP[p] ?? '')
      .join('');

    parts.push(wordPhones);
    prevWasZh = true;
  }

  return parts.join('');
}

/**
 * Lightweight core fallback lexicon in Misaki v1.1 IPA notation for fast/offline English
 * code-switching and XiaoChun domain terms.
 */
const CORE_EN_LEXICON: Readonly<Record<string, string>> = {
  a: 'ɐ',
  an: 'æn',
  the: 'ðə',
  i: 'ˈI',
  you: 'ju',
  we: 'wi',
  it: 'ˈɪt',
  is: 'ˈɪz',
  are: 'ˈɑɹ',
  was: 'wˈʌz',
  to: 'tu',
  of: 'ʌv',
  in: 'ˈɪn',
  on: 'ˈɑn',
  and: 'ænd',
  or: 'ˈɔɹ',
  for: 'fˈɔɹ',
  with: 'wˈɪð',
  by: 'bˈI',
  theway: 'wˈA',
  way: 'wˈA',
  hi: 'hˈI',
  hey: 'hˈA',
  hello: 'həlˈO',
  bye: 'bˈI',
  ok: 'ˈOkˈA',
  okay: 'ˌOkˈA',
  yes: 'jˈɛs',
  yeah: 'jˈæ',
  no: 'nˈO',
  wait: 'wˈAt',
  hold: 'hˈOld',
  second: 'sˈɛkənd',
  stop: 'stˈɑp',
  sorry: 'sˈɑɹi',
  right: 'ɹˈIt',
  sure: 'ʃˈʊɹ',
  thanks: 'θˈæŋks',
  thank: 'θˈæŋk',
  today: 'tədˈA',
  great: 'ɡɹˈAt',
  good: 'ɡˈʊd',
  nice: 'nˈIs',
  cool: 'kˈul',
  test: 'tˈɛst',
  lets: 'lˈɛts',
  "let's": 'lˈɛts',
  how: 'hˈW',
  what: 'wˈʌt',
  why: 'wˈI',
  when: 'wˈɛn',
  where: 'wˈɛɹ',
  who: 'hˈu',
  your: 'jʊɹ',
  my: 'mˈI',
  this: 'ðˈɪs',
  that: 'ðˈæt',
  check: 'tʃˈɛk',
  xiaochun: 'ʃˈW ʧˈʊn',
  webgpu: 'wˈɛb ʤˌipˌijˈu',
  gpu: 'ʤˌipˌijˈu',
  ai: 'ˌAˈI',
  api: 'ˌApˌiˈI',
  tts: 'tˌitˌiˈɛs',
  asr: 'ˌAˌɛsˈɑɹ',
  stt: 'ˌɛstˌitˈi',
  llm: 'ˌɛlˌɛlˈɛm',
  onnx: 'ˈɑnɪks',
  wasm: 'wˈæzəm',
  temperature: 'tˈɛmpɹɪtʃɚ',
  web: 'wˈɛb',
  audio: 'ˈɔdiO',
  voice: 'vˈYs',
  beach: 'bˈitʃ',
  bloom: 'blˈum',
  frame: 'fɹˈAm',
  frames: 'fɹˈAmz',
  mode: 'mˈOd',
  local: 'lˈOkəl',
};

const ESPEAK_TO_MISAKI: Array<[RegExp, string]> = [
  [/ʔˌn\u0329/g, 'ʔn'],
  [/ʔn\u0329/g, 'ʔn'],
  [/aɪ/g, 'I'],
  [/aʊ/g, 'W'],
  [/dʒ/g, 'ʤ'],
  [/eɪ/g, 'A'],
  [/tʃ/g, 'ʧ'],
  [/ɔɪ/g, 'Y'],
  [/oʊ/g, 'O'],
  [/əʊ/g, 'Q'],
  [/əl/g, 'ᵊl'],
  [/(\S)\u0329/g, 'ᵊ$1'],
  [/\u0329/g, ''],
  [/ʲo/g, 'jo'],
  [/ʲə/g, 'jə'],
  [/ʲ/g, ''],
  [/ɚ/g, 'əɹ'],
  [/ɜːɹ/g, 'ɜɹ'],
  [/ɜː/g, 'ɜɹ'],
  [/ɪə/g, 'iə'],
  [/ː/g, ''],
  [/r/g, 'ɹ'],
  [/x/g, 'k'],
  [/ç/g, 'k'],
  [/ɐ/g, 'ə'],
  [/ɬ/g, 'l'],
  [/\u0303/g, ''],
  [/e/g, 'A'],
  [/o/g, 'ɔ'],
  [/ɾ/g, 'T'],
  [/ʔ/g, 't'],
  [/\^/g, ''],
];

/**
 * Normalizes eSpeak-NG IPA (`en-us`) output into Kokoro Misaki US phonemes.
 */
export function normalizeEspeakEnToMisaki(espeakIpa: string): string {
  let ps = espeakIpa.trim();
  for (const [pattern, replacement] of ESPEAK_TO_MISAKI) {
    ps = ps.replace(pattern, replacement);
  }
  // Filter down strictly to characters present in KOKORO_ZH_VOCAB
  let filtered = '';
  for (const ch of ps) {
    if (ch in KOKORO_ZH_VOCAB) {
      filtered += ch;
    }
  }
  return filtered;
}

function fallbackEnglishWordToPhones(word: string): string {
  const lower = word.toLowerCase();
  if (CORE_EN_LEXICON[lower]) {
    return CORE_EN_LEXICON[lower]!;
  }
  // Simple letter-level grapheme fallback for unknown acronyms/words if espeak is unavailable
  const mapChar: Record<string, string> = {
    a: 'æ', b: 'b', c: 'k', d: 'd', e: 'ɛ', f: 'f', g: 'ɡ', h: 'h',
    i: 'ɪ', j: 'ʤ', k: 'k', l: 'l', m: 'm', n: 'n', o: 'ɑ', p: 'p',
    q: 'k', r: 'ɹ', s: 's', t: 't', u: 'ʌ', v: 'v', w: 'w', x: 'ks',
    y: 'j', z: 'z',
  };
  let out = '';
  for (const ch of lower) {
    out += mapChar[ch] ?? '';
  }
  return out;
}

function fallbackEnglishSpanToMisaki(span: string): string {
  const tokens = span.trim().split(/\s+/).filter(Boolean);
  return tokens
    .map((tok) => {
      const clean = tok.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
      if (!clean) return '';
      return fallbackEnglishWordToPhones(clean);
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * Converts an English text span into Misaki IPA using `phonemizer` (`en-us`) with
 * fallback lexicon safety.
 */
export async function phonemizeEnglishSpan(
  span: string,
  options: { usePhonemizer?: boolean } = {},
): Promise<string> {
  const trimmed = span.trim();
  if (!trimmed) return '';
  if (options.usePhonemizer === false) {
    return fallbackEnglishSpanToMisaki(trimmed);
  }

  // Split camelCase brand tokens like "WebGPU" -> "Web GPU", "XiaoChun" -> "Xiao Chun"
  const prepped = trimmed.replace(/([a-z])([A-Z])/g, '$1 $2');
  try {
    const lines = await phonemize(prepped, 'en-us');
    const joined = lines.map((l) => normalizeEspeakEnToMisaki(l)).filter(Boolean).join(' ');
    if (joined.length > 0) return joined;
  } catch {
    // Fallback cleanly if WASM espeak fails in constrained environment
  }
  return fallbackEnglishSpanToMisaki(prepped);
}

export interface KokoroTokenizeOptions {
  /** Override vocab (defaults to exact 172-token `KOKORO_ZH_VOCAB`). */
  vocab?: Readonly<Record<string, number>>;
  /** Set false in pure-sync / offline tests to test fallback lexicon path. */
  usePhonemizer?: boolean;
}

export interface KokoroTokenizedResult {
  phonemes: string;
  tokenIds: number[];
  inputIds: BigInt64Array;
}

/**
 * Converts arbitrary mixed Chinese / English / Code-Switched text to Kokoro phoneme string
 * and `[0, ...ids, 0]` `BigInt64Array` input IDs clamped to `<= 510`.
 */
export async function textToKokoroTokens(
  rawText: string,
  options: KokoroTokenizeOptions = {},
): Promise<KokoroTokenizedResult> {
  const vocab = options.vocab ?? KOKORO_ZH_VOCAB;
  const normalized = mapKokoroPunctuation(normalizeMixedNumbers(rawText));
  if (!normalized) {
    return {
      phonemes: '',
      tokenIds: [0, 0],
      inputIds: BigInt64Array.from([0n, 0n]),
    };
  }

  // Match Misaki `ZHG2P.__call__` splitting of English/numeric vs Chinese/punctuation spans
  const spanRegex = /([A-Za-z0-9][A-Za-z0-9 '\-]*[A-Za-z0-9]|[A-Za-z0-9])|([^A-Za-z0-9]+)/g;
  const segments: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = spanRegex.exec(normalized)) !== null) {
    const enPart = match[1]?.trim() ?? '';
    const zhPart = match[2]?.trim() ?? '';
    if (enPart) {
      const enPhones = await phonemizeEnglishSpan(enPart, {
        usePhonemizer: options.usePhonemizer,
      });
      if (enPhones) segments.push(enPhones);
    } else if (zhPart) {
      const zhPhones = zhSegmentToMisakiPhones(zhPart);
      if (zhPhones) segments.push(zhPhones);
    }
  }

  // Join spans smoothly without leaving stray spaces before punctuation
  let phonemeString = segments.join(' ').replace(/\s+([,;:.!?…])/g, '$1').trim();

  // Map every character to valid vocab IDs, clamping phoneme tokens to <= 508 (total <= 510)
  const bodyIds: number[] = [];
  let clampedPhonemes = '';
  for (const ch of phonemeString) {
    const id = vocab[ch];
    if (id === undefined || id === 0) continue;
    if (bodyIds.length >= KOKORO_MAX_PHONEME_TOKENS) break;
    bodyIds.push(id);
    clampedPhonemes += ch;
  }

  const tokenIds = [0, ...bodyIds, 0];
  const inputIds = BigInt64Array.from(tokenIds, (n) => BigInt(n));

  return {
    phonemes: clampedPhonemes,
    tokenIds,
    inputIds,
  };
}
