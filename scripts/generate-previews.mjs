import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const PREVIEWS_DIR = path.resolve('public/previews');
const SCENES_DIR = path.join(PREVIEWS_DIR, 'scenes');
const OUTFITS_DIR = path.join(PREVIEWS_DIR, 'outfits');

fs.mkdirSync(SCENES_DIR, { recursive: true });
fs.mkdirSync(OUTFITS_DIR, { recursive: true });

async function run() {
  console.log('🚀 Connecting to active Chrome on port 9222...');
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes('5185')) || (await browser.newPage());

  console.log('📄 Using page:', page.url());

  console.log('🔄 Reloading page to ensure latest code is active...');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.vrmEngine && window.vrmEngine.currentVRM), { timeout: 20000 });
  console.log('✨ VRM ready!');

  // Helper to get sceneManager
  const getSceneManagerCode = `
    async () => {
      if (window.sceneManager) return window.sceneManager;
      const mod = await import('/src/core/scene/sceneManager.ts');
      window.sceneManager = mod.sceneManager;
      return mod.sceneManager;
    }
  `;

  // Temporarily hide UI elements for clean captures
  await page.evaluate(() => {
    let el = document.getElementById('temp-screenshot-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'temp-screenshot-style';
      document.head.appendChild(el);
    }
    el.textContent = `
      #drop-zone, #height-ruler-svg, #height-ruler-badge, [role="dialog"], header, nav, footer,
      #head-bubble, [id*="bubble"], #app > div:not(:first-child), .fixed {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
      }
    `;
  });

  const captureThumbnail = async (outPath) => {
    const vp = page.viewport() || { width: 1755, height: 1137 };
    const w = 640;
    const h = 360;
    const clip = {
      x: Math.round((vp.width - w) / 2),
      y: Math.round((vp.height - h) / 2),
      width: w,
      height: h,
    };
    await page.screenshot({
      path: outPath,
      type: 'webp',
      quality: 85,
      clip,
    });
    const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`  ✓ Saved ${path.relative(process.cwd(), outPath)} (${sizeKB} KB)`);
  };

  try {
    console.log('\n📸 Capturing Scene Previews (Character hidden for pure world atmosphere)...');
    // Hide VRM character for pure scene shots
    await page.evaluate(() => {
      if (window.vrmEngine && window.vrmEngine.currentVRM) {
        window.vrmEngine.currentVRM.scene.visible = false;
        window.vrmEngine.renderSingleFrame();
      }
    });

    // 1. Beach 3D Scene
    console.log('  → Switching to beach3d...');
    await page.evaluate(async () => {
      const { sceneManager } = await import('/src/core/scene/sceneManager.ts');
      await sceneManager.setScene('beach3d', false);
      window.vrmEngine.renderSingleFrame();
    });
    await new Promise((r) => setTimeout(r, 1200));
    await captureThumbnail(path.join(SCENES_DIR, 'beach3d.webp'));

    // 2. Light Linework Scene
    console.log('  → Switching to light...');
    await page.evaluate(async () => {
      const { sceneManager } = await import('/src/core/scene/sceneManager.ts');
      await sceneManager.setScene('light', false);
      window.vrmEngine.renderSingleFrame();
    });
    await new Promise((r) => setTimeout(r, 800));
    await captureThumbnail(path.join(SCENES_DIR, 'light.webp'));

    // 3. Dark Linework Scene
    console.log('  → Switching to dark...');
    await page.evaluate(async () => {
      const { sceneManager } = await import('/src/core/scene/sceneManager.ts');
      await sceneManager.setScene('dark', false);
      window.vrmEngine.renderSingleFrame();
    });
    await new Promise((r) => setTimeout(r, 800));
    await captureThumbnail(path.join(SCENES_DIR, 'dark.webp'));

    // 4. Transparent Pet Scene
    console.log('  → Capturing transparent scene preview...');
    await captureThumbnail(path.join(SCENES_DIR, 'transparent.webp'));

    console.log('\n👗 Capturing Outfit Previews on Void Stage...');
    // Reveal character and set to void stage
    await page.evaluate(async () => {
      const { sceneManager } = await import('/src/core/scene/sceneManager.ts');
      if (window.vrmEngine && window.vrmEngine.currentVRM) {
        window.vrmEngine.currentVRM.scene.visible = true;
      }
      await sceneManager.setScene('void', false);
      if (window.vrmEngine.motionPipeline) {
        window.vrmEngine.motionPipeline.targetYawOffset = 0;
        window.vrmEngine.motionPipeline.currentYawOffset = 0;
      }
      if (window.vrmEngine.currentVRM) {
        window.vrmEngine.currentVRM.scene.rotation.y = 0;
      }
      const cam = window.vrmEngine.camera;
      cam.position.set(0, 1.25, 1.35);
      window.vrmEngine.controls.target.set(0, 1.10, 0);
      window.vrmEngine.controls.update();
      window.vrmEngine.renderSingleFrame();
    });
    await new Promise((r) => setTimeout(r, 1000));

    // Outfit 1: Default Evening Dress
    console.log('  → Capturing default evening dress...');
    await captureThumbnail(path.join(OUTFITS_DIR, 'keep_outfit.webp'));

    // Addons
    const addons = [
      { id: 'xiaochun_techwear', src: '/vrm/addons/xiaochun_techwear.vrmaddon', name: 'XiaoChun Techwear' },
      { id: 'xiaochun_cheongsam', src: '/vrm/addons/xiaochun_cheongsam.vrmaddon', name: 'XiaoChun Cheongsam' },
      { id: 'xiaochun_bikini', src: '/vrm/addons/xiaochun_bikini.vrmaddon', name: 'XiaoChun Bikini' },
      { id: 'xiaochun_maid', src: '/vrm/addons/xiaochun_maid.vrmaddon', name: 'XiaoChun Maid' },
      { id: 'xiaochun_swimsuit', src: '/vrm/addons/xiaochun_swimsuit.vrmaddon', name: 'XiaoChun Swimsuit' },
      { id: 'xiaochun_shroud', src: '/vrm/addons/xiaochun_shroud.vrmaddon', name: 'XiaoChun Shroud' },
    ];

    for (const addon of addons) {
      console.log(`  → Swapping to ${addon.id}...`);
      await page.evaluate(async (src, name) => {
        if (window.vrmEngine.motionPipeline) {
          window.vrmEngine.motionPipeline.targetYawOffset = 0;
          window.vrmEngine.motionPipeline.currentYawOffset = 0;
        }
        if (window.vrmEngine.currentVRM) {
          window.vrmEngine.currentVRM.scene.rotation.y = 0;
        }
        await window.vrmEngine.swapOutfit(src, name);
        window.vrmEngine.renderSingleFrame();
      }, addon.src, addon.name);
      await new Promise((r) => setTimeout(r, 1500));
      await captureThumbnail(path.join(OUTFITS_DIR, `${addon.id}.webp`));
    }

    // Restore style
    console.log('  → Cleaning up...');
    await page.evaluate(async () => {
      const style = document.getElementById('temp-screenshot-style');
      if (style) style.remove();
    });

    console.log('\n🎉 All scene and outfit preview thumbnails generated successfully!');
  } finally {
    browser.disconnect();
  }
}

run().catch((err) => {
  console.error('Fatal error during preview generation:', err);
  process.exit(1);
});
