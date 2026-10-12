import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const TMP_DIR = path.resolve('tmp/onboarding-e2e');
fs.mkdirSync(TMP_DIR, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runE2ETests() {
  console.log('🚀 Starting Onboarding E2E Test Suite...');
  console.log('📁 Screenshots will be saved to:', TMP_DIR);

  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes('5185')) || (await browser.newPage());

  const logStep = (stepName) => console.log(`\n👉 [E2E] ${stepName}`);

  // Helper to bypass speech wait and show choices immediately
  const fastForwardSpeech = async () => {
    await page.evaluate(() => {
      if (typeof window.__onboardingQuickReveal === 'function') {
        window.__onboardingQuickReveal();
      } else {
        window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      }
    });
    await sleep(200);
  };

  // Helper to wait for choices to be rendered
  const waitForChoices = async (expectedCount = 1, timeout = 12000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await fastForwardSpeech();
      const count = await page.evaluate(() => {
        return document.querySelectorAll('.onboarding-card-enter').length;
      });
      if (count >= expectedCount) {
        return count;
      }
      await sleep(250);
    }
    throw new Error(`Timeout waiting for at least ${expectedCount} choices to render`);
  };

  // Helper to take screenshot
  const takeScreenshot = async (name) => {
    const filePath = path.join(TMP_DIR, `${name}.webp`);
    await page.screenshot({ path: filePath, type: 'webp', quality: 85 });
    console.log(`  📸 Saved screenshot: ${name}.webp`);
    return filePath;
  };

  // Helper to click a choice by partial text or id
  const clickChoiceByText = async (textSnippet) => {
    const clicked = await page.evaluate((text) => {
      const buttons = Array.from(document.querySelectorAll('.onboarding-card-enter'));
      for (const btn of buttons) {
        if (btn.textContent && btn.textContent.includes(text)) {
          btn.click();
          return true;
        }
      }
      return false;
    }, textSnippet);

    if (!clicked) {
      throw new Error(`Failed to find choice matching: "${textSnippet}"`);
    }
    // Wait for exit transition (260ms + delay)
    await sleep(600);
  };

  // ==========================================
  // TEST BRANCH A: Full Immersion Walkthrough
  // ==========================================
  logStep('--- TEST BRANCH A: Full Immersion Walkthrough ---');

  // 1. Load onboarding and reset state
  await page.goto('https://localhost:5185/?onboarding=1', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try {
      localStorage.removeItem('xc_onboarding_completed_v1');
    } catch {}
  });
  await page.waitForFunction(() => Boolean(window.vrmEngine && window.vrmEngine.currentVRM), { timeout: 25000 });
  await sleep(1000);

  // Verify Void Scene is active initially
  const initialTheme = await page.evaluate(() => {
    return window.sceneManager ? window.sceneManager.currentSceneId : null;
  });
  console.log(`  Initial scene theme during onboarding: ${initialTheme}`);
  if (initialTheme !== 'void') {
    console.warn(`  ⚠️ Expected void theme, got: ${initialTheme}`);
  }

  // Step 1: Language selection
  logStep('Branch A - Step 1: Language Selection');
  await waitForChoices(3);
  await takeScreenshot('branch_a_01_language_selection');
  await clickChoiceByText('中文');

  // Step 2: Tutorial Ask
  logStep('Branch A - Step 2: Tutorial Ask');
  await waitForChoices(2);
  await takeScreenshot('branch_a_02_tutorial_ask');
  await clickChoiceByText('带我逛逛这个世界');

  // Step 3: Camera Drag Guidance
  logStep('Branch A - Step 3: Camera Orbit Interaction');
  // Wait for camera guidance HUD to appear
  await page.waitForSelector('kbd', { timeout: 8000 });
  await takeScreenshot('branch_a_03_camera_hud_initial');

  // Simulate camera rotation interaction
  await page.evaluate(() => {
    if (typeof window.__onboardingSetRotated === 'function') {
      window.__onboardingSetRotated(true);
    }
  });
  await sleep(400);
  await takeScreenshot('branch_a_03_camera_hud_rotated_success');
  await waitForChoices(1);
  await clickChoiceByText('转动好啦');

  // Step 4: Scene Selection (Media cards with 16:9 previews)
  logStep('Branch A - Step 4: Scene World Selection (Media Previews)');
  await waitForChoices(3);
  await takeScreenshot('branch_a_04_scene_selection_media');
  await clickChoiceByText('阳光海滩');
  await sleep(1200); // Allow scene switch

  const selectedScene = await page.evaluate(() => window.sceneManager?.currentSceneId);
  console.log(`  Current active scene after selection: ${selectedScene}`);
  if (selectedScene !== 'beach3d') {
    throw new Error(`Scene selection failed: expected beach3d, got ${selectedScene}`);
  }

  // Step 5: Outfit Selection (Media cards with 16:9 previews)
  logStep('Branch A - Step 5: Outfit Selection (Media Previews)');
  await waitForChoices(3);
  await takeScreenshot('branch_a_05_outfit_selection_media');
  await clickChoiceByText('Techwear');
  await sleep(1000);

  // Step 6: AI Brain Connection Choice
  logStep('Branch A - Step 6: AI Brain Core Selection');
  await waitForChoices(2);
  await takeScreenshot('branch_a_06_brain_selection');
  await clickChoiceByText('端侧轻量');

  // Step 7: Finale & Embark
  logStep('Branch A - Step 7: Finale & Embark');
  await waitForChoices(1);
  await takeScreenshot('branch_a_07_finale');
  await clickChoiceByText('启程');
  await sleep(1000);

  // Verify Tour Completed and localStorage flag is set
  const completedFlagA = await page.evaluate(() => {
    return localStorage.getItem('xc_onboarding_completed_v1');
  });
  console.log(`  Branch A completion flag in localStorage: ${completedFlagA}`);
  if (completedFlagA !== '1') {
    throw new Error('Branch A did not set xc_onboarding_completed_v1 to 1');
  }
  await takeScreenshot('branch_a_08_post_completion_main_ui');
  console.log('✅ Branch A PASSED!');

  // ==========================================
  // TEST BRANCH B: Fast Tutorial Skip at Step 2
  // ==========================================
  logStep('--- TEST BRANCH B: Skip Tutorial Option ---');

  await page.goto('https://localhost:5185/?onboarding=1', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try {
      localStorage.removeItem('xc_onboarding_completed_v1');
    } catch {}
  });
  await page.waitForFunction(() => Boolean(window.vrmEngine && window.vrmEngine.currentVRM), { timeout: 25000 });
  await sleep(1000);

  // Step 1: Language
  await waitForChoices(3);
  await clickChoiceByText('中文');

  // Step 2: Click "不用啦，已经迫不及待想跟你聊天了！"
  logStep('Branch B - Step 2: Choosing Skip Tutorial');
  await waitForChoices(2);
  await takeScreenshot('branch_b_01_tutorial_skip_choice');
  await clickChoiceByText('不用啦');
  await sleep(1000);

  // Directly finishes and enters main interface
  logStep('Branch B - Verifying completion flag');
  const completedFlagB = await page.evaluate(() => {
    return localStorage.getItem('xc_onboarding_completed_v1');
  });
  console.log(`  Branch B completion flag in localStorage: ${completedFlagB}`);
  if (completedFlagB !== '1') {
    throw new Error('Branch B did not set xc_onboarding_completed_v1 to 1');
  }
  await takeScreenshot('branch_b_02_post_skip_main_ui');
  console.log('✅ Branch B PASSED!');

  // ==========================================
  // TEST BRANCH C: Top-Right Global Skip Button
  // ==========================================
  logStep('--- TEST BRANCH C: Top-Right Global Skip Button ---');

  await page.goto('https://localhost:5185/?onboarding=1', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    try {
      localStorage.removeItem('xc_onboarding_completed_v1');
    } catch {}
  });
  await page.waitForFunction(() => Boolean(window.vrmEngine && window.vrmEngine.currentVRM), { timeout: 25000 });
  await sleep(1000);

  await takeScreenshot('branch_c_01_top_right_skip_ready');
  // Click the top right skip button
  const skipClicked = await page.evaluate(() => {
    const skipBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('跳过') || b.textContent?.includes('Skip')
    );
    if (skipBtn) {
      skipBtn.click();
      return true;
    }
    return false;
  });

  if (!skipClicked) {
    throw new Error('Failed to find top-right Skip button');
  }
  await sleep(800);

  const completedFlagC = await page.evaluate(() => {
    return localStorage.getItem('xc_onboarding_completed_v1');
  });
  console.log(`  Branch C completion flag in localStorage: ${completedFlagC}`);
  if (completedFlagC !== '1') {
    throw new Error('Branch C did not set xc_onboarding_completed_v1 to 1');
  }
  await takeScreenshot('branch_c_02_after_global_skip');
  console.log('✅ Branch C PASSED!');

  console.log('\n🎉 ALL ONBOARDING E2E TEST BRANCHES PASSED SUCCESSFULLY! 🎉\n');
}

runE2ETests().catch((err) => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
