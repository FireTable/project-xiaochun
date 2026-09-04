import { Feather, WandSparkles } from 'lucide-react';
import qwen from '@/assets/llm-providers/qwen.svg?raw';
import deepseek from '@/assets/llm-providers/deepseek.svg?raw';
import meta from '@/assets/llm-providers/meta.svg?raw';
import gemma from '@/assets/llm-providers/gemma.svg?raw';
import microsoft from '@/assets/llm-providers/microsoft.svg?raw';
import mistral from '@/assets/llm-providers/mistral.svg?raw';
import huggingface from '@/assets/llm-providers/huggingface.svg?raw';
import stability from '@/assets/llm-providers/stability.svg?raw';
import together from '@/assets/llm-providers/together.svg?raw';
import ai2 from '@/assets/llm-providers/ai2.svg?raw';

const SVG: Record<string, string> = {
  Qwen: qwen,
  DeepSeek: deepseek,
  Llama: meta,
  TinyLlama: meta,
  Gemma: gemma,
  Phi: microsoft,
  Mistral: mistral,
  Ministral: mistral,
  SmolLM: huggingface,
  StableLM: stability,
  RedPajama: together,
  OLMo: ai2,
};

const LucideByProvider: Record<string, typeof Feather> = {
  Hermes: Feather,
  OpenHermes: Feather,
  NeuralHermes: Feather,
  WizardMath: WandSparkles,
};

function stripTitle(svg: string): string {
  return svg.replace(/<title>[^<]*<\/title>/, '');
}

export function LlmProviderIcon({ name }: { name: string }) {
  const svg = SVG[name];
  if (svg) {
    return (
      <span
        aria-hidden
        className="inline-flex h-4 w-4 shrink-0 text-white [&_svg]:h-4 [&_svg]:w-4"
        dangerouslySetInnerHTML={{ __html: stripTitle(svg) }}
      />
    );
  }
  const Icon = LucideByProvider[name];
  if (Icon) return <Icon aria-hidden className="h-4 w-4 shrink-0" />;
  return (
    <span
      aria-hidden
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-white/15 text-[9px] font-bold"
    >
      {name.slice(0, 1)}
    </span>
  );
}
