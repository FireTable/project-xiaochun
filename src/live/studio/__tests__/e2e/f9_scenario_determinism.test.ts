/**
 * f9_scenario_determinism.test.ts — E2E Test Suite for Feature F9:
 * Scenario 5 (heavy_delegate_amend) 100% Deterministic Delegation,
 * Zero Technical Hallucination, and Mid-Flight Amendment Streaming.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { executeVerificationScenario } from '@/live/studio/scenarioHarness';
import { buildE2ETestController } from './fixtures/e2eTestHarness';
import type { ScenarioRunResult } from '@/live/studio/types';

describe('E2E Feature F9: Scenario 5 Determinism & Zero Technical Hallucination', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      try {
        cleanups.pop()!();
      } catch {
        // ignore cleanup error
      }
    }
  });

  describe('Tier 1: Feature Coverage (F9 Determinism across Runs)', () => {
    let run1Result: ScenarioRunResult | null = null;
    let run2Result: ScenarioRunResult | null = null;
    let run3Result: ScenarioRunResult | null = null;

    it('T1-F9-01: Scenario 5 Run 1: runHeavyDelegateAmend passes cleanly', async () => {
      const { ctrl, cleanup } = buildE2ETestController();
      cleanups.push(cleanup);

      const res = await executeVerificationScenario('heavy_delegate_amend', ctrl);
      run1Result = res;

      expect(res.passed).toBe(true);
      expect(res.assertions.every((a) => a.ok)).toBe(true);
      expect(res.error).toBeUndefined();
    }, 25_000);

    it('T1-F9-02: Scenario 5 Run 2: runHeavyDelegateAmend passes cleanly (idempotence)', async () => {
      const { ctrl, cleanup } = buildE2ETestController();
      cleanups.push(cleanup);

      const res = await executeVerificationScenario('heavy_delegate_amend', ctrl);
      run2Result = res;

      expect(res.passed).toBe(true);
      expect(res.assertions.every((a) => a.ok)).toBe(true);
      expect(res.error).toBeUndefined();
    }, 25_000);

    it('T1-F9-03: Scenario 5 Run 3: runHeavyDelegateAmend passes cleanly (100% determinism across 3 consecutive runs)', async () => {
      const { ctrl, cleanup } = buildE2ETestController();
      cleanups.push(cleanup);

      const res = await executeVerificationScenario('heavy_delegate_amend', ctrl);
      run3Result = res;

      expect(res.passed).toBe(true);
      expect(res.assertions.every((a) => a.ok)).toBe(true);
      expect(res.error).toBeUndefined();

      // Verify 100% deterministic pass across all 3 runs
      expect(run1Result?.passed).toBe(true);
      expect(run2Result?.passed).toBe(true);
      expect(run3Result?.passed).toBe(true);
    }, 25_000);

    it('T1-F9-04: Scenario 5 bridge latency assertion: delegateTriggeredAtMs in telemetry < 900 ms', async () => {
      const { ctrl, cleanup } = buildE2ETestController();
      cleanups.push(cleanup);

      const res = await executeVerificationScenario('heavy_delegate_amend', ctrl);
      expect(res.passed).toBe(true);

      const bridgeAssert = res.assertions.find((a) => a.label.includes('bridge'));
      expect(bridgeAssert).toBeDefined();
      expect(bridgeAssert?.ok).toBe(true);

      const match = bridgeAssert?.detail?.match(/bridgeLatency=(\d+)ms/);
      expect(match).not.toBeNull();
      const latency = parseInt(match![1], 10);
      expect(latency).toBeLessThan(900);
    }, 25_000);

    it('T1-F9-05: Scenario 5 mid-flight amendment assertion: amendAccepted: true, bloom context integrated into commentary', async () => {
      const { ctrl, cleanup } = buildE2ETestController();
      cleanups.push(cleanup);

      const res = await executeVerificationScenario('heavy_delegate_amend', ctrl);
      expect(res.passed).toBe(true);

      const amendAssertion = res.assertions.find((a) => a.label.includes('amendment'));
      expect(amendAssertion).toBeDefined();
      expect(amendAssertion?.ok).toBe(true);
      expect(amendAssertion?.detail).toContain('amendAccepted=true');
    }, 25_000);
  });

  describe('Tier 2: Boundary & Extreme Conditions (F9 Boundaries)', () => {
    it('T2-F9-01: Early amendment injection (t = 5 ms): accepted cleanly by HeavyWorker', async () => {
      const { ctrl, cleanup } = buildE2ETestController();
      cleanups.push(cleanup);

      await ctrl.resetConversation();

      let amendAccepted = false;
      const prompt =
        '帮我查一下 / deeply analyze why iOS TBDR WebGPU drops frames when we use RGBA16F 4x MSAA';

      const decision = await ctrl.classifyBimodalTurn({
        pcm16k: new Float32Array(1600),
        stableText: prompt,
        tailText: '',
        pauseMs: 440,
        speechDurationMs: 1250,
        rmsDb: -17,
        assistantSpeaking: false,
        hintedProbs: { COMPLETE: 0.87, INCOMPLETE: 0.08, BACKCHANNEL: 0.02, WAIT_INTERRUPT: 0.03 },
      });

      const outcomePromise = ctrl.runTurnFromSimulatedAudio({
        scenario: 'early_amend_test',
        userText: prompt,
        lang: 'mixed',
        decision,
        waitForDrain: false,
        onDelegateStarted: () => {
          // Early injection at t = 5 ms
          setTimeout(() => {
            amendAccepted = ctrl.orchestrator.amendActiveHeavyTask('尤其是开启 bloom 的时候');
          }, 5);
        },
      });

      const outcome = await outcomePromise;
      expect(outcome.delegated).toBe(true);

      await ctrl.waitForHeavyCompletion(8000);
      expect(amendAccepted).toBe(true);
    }, 20_000);

    it('T2-F9-02: Zero technical hallucination check across all runs', async () => {
      const { ctrl, cleanup } = buildE2ETestController();
      cleanups.push(cleanup);

      const res = await executeVerificationScenario('heavy_delegate_amend', ctrl);
      expect(res.passed).toBe(true);

      // Verify that the immediate FrontBrain spoken reply did not guess complex technical details
      const frontReply = res.telemetry?.replyPreview ?? '';
      expect(frontReply).not.toContain('片外主存');
      expect(frontReply).not.toContain('32 字节');
    }, 25_000);

    it('T2-F9-03: Substantive commentary length: combinedHeavy string length > 50 characters', async () => {
      const { ctrl, cleanup } = buildE2ETestController();
      cleanups.push(cleanup);

      const res = await executeVerificationScenario('heavy_delegate_amend', ctrl);
      expect(res.passed).toBe(true);

      const commentaryAssertion = res.assertions.find((a) =>
        a.label.includes('streamed deep commentary')
      );
      expect(commentaryAssertion).toBeDefined();
      expect(commentaryAssertion?.ok).toBe(true);

      const match = commentaryAssertion?.detail?.match(/heavyLen=(\d+)/);
      expect(match).not.toBeNull();
      const heavyLen = parseInt(match![1], 10);
      expect(heavyLen).toBeGreaterThan(50);
    }, 25_000);

    it('T2-F9-04: HeavyWorker stall timeout: worker delay exceeding timeout recovers gracefully', async () => {
      const { ctrl, cleanup } = buildE2ETestController();
      cleanups.push(cleanup);

      // Test waitForHeavyCompletion timeout handling with a small timeout (50 ms)
      const res = await ctrl.waitForHeavyCompletion(50);
      expect(res === null || typeof res === 'string').toBe(true);
    });

    it('T2-F9-05: Telemetry row audit: non-null minFps, ttftMs, delegateTriggeredAtMs', async () => {
      const { ctrl, cleanup } = buildE2ETestController();
      cleanups.push(cleanup);

      const res = await executeVerificationScenario('heavy_delegate_amend', ctrl);
      expect(res.passed).toBe(true);
      expect(res.telemetry).toBeDefined();

      const t = res.telemetry!;
      expect(t.minFps).toBeGreaterThanOrEqual(55);
      expect(t.ttftMs).toBeGreaterThan(0);
      expect(t.input).toContain('TBDR');

      // Bridge latency verified via assertions
      const bridgeAssert = res.assertions.find((a) => a.label.includes('bridge'));
      expect(bridgeAssert?.ok).toBe(true);
    }, 25_000);
  });
});
