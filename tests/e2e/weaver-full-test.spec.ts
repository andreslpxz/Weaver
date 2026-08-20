import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// GROQ API key read from environment variable or fallback to process.env.GROQ_API_KEY
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

test.describe('Weaver E2E Suite - Groq Models, MCPs, Skills, Modes & Debug', () => {
  const screenshotDir = path.join(process.cwd(), 'test-results', 'screenshots');

  test.beforeAll(async () => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  test('Full E2E test workflow', async ({ page }) => {
    // 1. Open Application
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(screenshotDir, '01_app_loaded.png') });

    // 2. Open Model Picker / Settings to configure Groq API Key
    const modelPickerBtn = page.locator('.composer-model-picker');
    await expect(modelPickerBtn).toBeVisible();
    await modelPickerBtn.click();

    // Switch to API Keys tab
    const apiKeysTab = page.getByRole('button', { name: /API Keys/i });
    await expect(apiKeysTab).toBeVisible();
    await apiKeysTab.click();

    if (GROQ_API_KEY) {
      // Configure Groq if API Key is available in environment
      const groqConfigureBtn = page.locator('div').filter({ hasText: /^Groq/ }).getByRole('button', { name: /Configurar|Cambiar/i });
      await expect(groqConfigureBtn).toBeVisible();
      await groqConfigureBtn.click();

      const keyInput = page.getByPlaceholder('Pega tu API key aquí…');
      await keyInput.fill(GROQ_API_KEY);
      await page.screenshot({ path: path.join(screenshotDir, '02_groq_key_entered.png') });

      const saveBtn = page.getByRole('button', { name: /Guardar/i });
      await saveBtn.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: path.join(screenshotDir, '03_groq_key_saved.png') });
    }

    // Switch back to Model tab
    const modelsTab = page.getByRole('button', { name: /^Modelos$/i });
    await modelsTab.click();

    // Close Model Picker
    const closeBtn = page.locator('.fixed button').filter({ has: page.locator('svg') }).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }

    await page.screenshot({ path: path.join(screenshotDir, '04_model_picker_closed.png') });

    // 3. Test Modes (RLM, Plan, Perseguir) via Plus menu
    const plusBtn = page.locator('button[title*="Añadir"]').first();
    await plusBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, '05_plus_menu_modes.png') });

    // Toggle Mode RLM
    const modeRlm = page.getByRole('button', { name: /Modo RLM/i });
    if (await modeRlm.isVisible()) {
      await modeRlm.click();
    }
    await plusBtn.click();
    await page.waitForTimeout(300);

    const modePlan = page.getByRole('button', { name: /Modo plan/i });
    if (await modePlan.isVisible()) {
      await modePlan.click();
    }

    // Close menu by clicking textarea
    await page.locator('textarea').click();
    await page.screenshot({ path: path.join(screenshotDir, '06_modes_activated.png') });

    // 4. Test Skills and MCP Navigation via Sidebar
    const complementosBtn = page.getByRole('button', { name: /Complementos/i });
    if (await complementosBtn.isVisible()) {
      await complementosBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(screenshotDir, '07_complementos_view.png') });

      // Navigate to MCPs tab
      const mcpTab = page.getByRole('button', { name: /Servidores MCP/i });
      if (await mcpTab.isVisible()) {
        await mcpTab.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(screenshotDir, '08_mcp_presets_view.png') });
      }
    }

    // Return to Chat View
    const newChatBtn = page.getByRole('button', { name: /Nuevo chat|Chat/i }).first();
    await newChatBtn.click();
    await page.waitForTimeout(500);

    // 5. Test Chat Prompting
    const composerTextArea = page.locator('textarea');
    await composerTextArea.fill('Hola Weaver, confirma la interacción en el chat normal con modos activados.');
    await page.screenshot({ path: path.join(screenshotDir, '09_chat_prompt_entered.png') });

    // 6. Test Debug view / RLM Agent view / Metrics view
    const rlmNavBtn = page.getByRole('button', { name: /RLM Agent/i });
    if (await rlmNavBtn.isVisible()) {
      await rlmNavBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(screenshotDir, '11_rlm_debug_view.png') });
    }

    const metricasBtn = page.getByRole('button', { name: /Métricas/i });
    if (await metricasBtn.isVisible()) {
      await metricasBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(screenshotDir, '12_metrics_view.png') });
    }

    const memoriaBtn = page.getByRole('button', { name: /Memoria/i });
    if (await memoriaBtn.isVisible()) {
      await memoriaBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(screenshotDir, '13_memoria_view.png') });
    }
  });
});
