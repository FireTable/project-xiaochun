/**
 * webmcp.ts — WebMCP (Web Model Context Protocol) & In-Page Agent Tools Bridge.
 *
 * Allows autonomous web agents (Chrome Built-in AI, Page Controller, browser automation extensions,
 * or iframe hosts) to discover and invoke XiaoChun companion controls directly via:
 * 1. `document.modelContext.tools`
 * 2. `window.modelContext.tools` / `window.__modelContext`
 * 3. `window.xiaochun.tools`
 */

import { runProtocolAction } from './handler';

export interface WebMCPTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  execute: (args?: any) => Promise<any>;
}

export const XIAOCHUN_WEBMCP_TOOLS: WebMCPTool[] = [
  {
    name: 'xiaochun_speak',
    description: 'Command XiaoChun to vocalize text with Edge-TTS, facial expressions, and full-body co-speech motion.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text dialogue for XiaoChun to speak.' },
        audioUrl: { type: 'string', description: 'Optional direct audio URL to stream instead of TTS.' },
      },
      required: ['text'],
    },
    execute: async (args: { text?: string; audioUrl?: string } = {}) => {
      if (!args || typeof args.text !== 'string' || !args.text.trim()) {
        throw new Error('xiaochun_speak: text is required and must be a non-empty string');
      }
      await runProtocolAction({ action: 'speak', payload: args });
      return { status: 'success', spoken: args.text };
    },
  },
  {
    name: 'xiaochun_play_motion',
    description: 'Play a 3D animation clip or random motion group (e.g. wave, bow, cheer, dance, stretch, thinking, listening).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Motion name or group ID (e.g. wave, bow, cheer, dancePerformance, greeting).' },
        loop: { type: 'boolean', description: 'Whether the animation should loop continuously.' },
        mask: { type: 'string', enum: ['all', 'upperBody'], description: 'Full-body motion or upper-body gesture only.' },
      },
      required: ['name'],
    },
    execute: async (args: { name?: string; loop?: boolean; mask?: string } = {}) => {
      if (!args || typeof args.name !== 'string' || !args.name.trim()) {
        throw new Error('xiaochun_play_motion: name is required and must be a non-empty string');
      }
      await runProtocolAction({ action: 'motion', payload: args });
      return { status: 'success', motion: args.name };
    },
  },
  {
    name: 'xiaochun_expression',
    description: 'Set XiaoChun facial emotion preset (happy, relaxed, surprised, neutral, angry, sad).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: ['happy', 'relaxed', 'surprised', 'neutral', 'angry', 'sad'], description: 'Expression name.' },
        intensity: { type: 'number', minimum: 0, maximum: 1, description: 'Intensity from 0.0 to 1.0.' },
      },
      required: ['name'],
    },
    execute: async (args: { name?: string; intensity?: number } = {}) => {
      if (!args || typeof args.name !== 'string' || !args.name.trim()) {
        throw new Error('xiaochun_expression: name is required and must be a non-empty string');
      }
      await runProtocolAction({ action: 'expression', payload: args });
      return { status: 'success', expression: args.name };
    },
  },
  {
    name: 'xiaochun_camera',
    description: 'Control cinematic camera angle, framing shot, or dynamic trajectory.',
    parameters: {
      type: 'object',
      properties: {
        shot: { type: 'string', enum: ['extreme_close_up', 'close_up', 'medium', 'full', 'dramatic_low'], description: 'Framing shot distance.' },
        movement: { type: 'string', enum: ['none', 'push_in', 'pull_out', 'hero_spiral_orbit', 'hero_backlight_reveal', 'dutch_tilt'], description: 'Cinematic trajectory.' },
        panUp: { type: 'boolean', description: 'Perform dramatic pan-up reveal camera motion.' },
      },
    },
    execute: async (args: any = {}) => {
      await runProtocolAction({ action: 'camera', payload: args || {} });
      return { status: 'success', camera: args };
    },
  },
  {
    name: 'xiaochun_scene',
    description: 'Switch the 3D environment backdrop (beach3d, light, dark, transparent).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: ['beach3d', 'light', 'dark', 'transparent'], description: 'Scene identifier or alias.' },
      },
      required: ['name'],
    },
    execute: async (args: { name?: string } = {}) => {
      if (!args || typeof args.name !== 'string' || !args.name.trim()) {
        throw new Error('xiaochun_scene: name is required and must be a non-empty string');
      }
      await runProtocolAction({ action: 'scene', payload: args });
      return { status: 'success', scene: args.name };
    },
  },
  {
    name: 'xiaochun_outfit',
    description: 'Atomically swap XiaoChun 3D outfit with 0-frame T-pose pop-in.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: ['uniform', 'maid', 'techwear', 'cheongsam', 'bikini', 'swimsuit'], description: 'Outfit identifier.' },
      },
      required: ['name'],
    },
    execute: async (args: { name?: string } = {}) => {
      if (!args || typeof args.name !== 'string' || !args.name.trim()) {
        throw new Error('xiaochun_outfit: name is required and must be a non-empty string');
      }
      await runProtocolAction({ action: 'outfit', payload: args });
      return { status: 'success', outfit: args.name };
    },
  },
  {
    name: 'xiaochun_stop',
    description: 'Immediately stop active speech and fade out playing motion back to natural idle.',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      await runProtocolAction({ action: 'stop' });
      return { status: 'success', stopped: true };
    },
  },
];

/**
 * Register WebMCP tools on document and window targets.
 */
export function registerWebMCPTools(): void {
  if (typeof window === 'undefined') return;

  const modelContext = {
    version: '1.0.0',
    provider: 'Project XiaoChun',
    description: 'Interactive 3D Anime Companion & Desktop Pet Avatar',
    tools: XIAOCHUN_WEBMCP_TOOLS,
    callTool: async (name: string, args: any) => {
      const tool = XIAOCHUN_WEBMCP_TOOLS.find((t) => t.name === name);
      if (!tool) throw new Error(`Tool not found: ${name}`);
      return tool.execute(args);
    },
  };

  try {
    // 1. 标准 document.modelContext
    if (typeof document !== 'undefined') {
      const doc = document as any;
      if (!doc.modelContext) {
        doc.modelContext = modelContext;
      } else if (Array.isArray(doc.modelContext.tools)) {
        for (const tool of XIAOCHUN_WEBMCP_TOOLS) {
          if (!doc.modelContext.tools.some((t: any) => t.name === tool.name)) {
            doc.modelContext.tools.push(tool);
          }
        }
      }
    }

    // 2. window.__modelContext & window.modelContext 挂载
    const win = window as any;
    win.modelContext = modelContext;
    win.__modelContext = modelContext;

    // 3. 挂载到 window.xiaochun.tools
    if (win.xiaochun) {
      win.xiaochun.tools = XIAOCHUN_WEBMCP_TOOLS;
      win.xiaochun.modelContext = modelContext;
    }
  } catch (err) {
    console.warn('[WebMCP] 注入 modelContext 失败:', err);
  }
}
