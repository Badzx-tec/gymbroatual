/**
 * Visual regression baseline suite.
 * Run once with --update-snapshots to generate PNGs; CI fails if diff > 0.2%.
 *
 * Personas covered: owner (admin), student.
 * Auth and data APIs are mocked so the spec is fully offline.
 */

import { expect, test } from '@playwright/test';

// ── Shared mock data ──────────────────────────────────────────────────────────

const OWNER_TOKEN = 'mock-owner-token';
const STUDENT_TOKEN = 'mock-student-token';

const ownerUser = {
  token: OWNER_TOKEN,
  user_id: 'owner-1',
  email: 'owner@gymbro.test',
  name: 'Academia Teste',
  role: 'OWNER',
  owner_id: 'owner-1',
  gym_name: 'Academia Teste',
};

const studentUser = {
  token: STUDENT_TOKEN,
  user_id: 'student-1',
  email: 'aluno@gymbro.test',
  name: 'Aluno Teste',
  role: 'STUDENT',
  owner_id: 'owner-1',
};

// ── API mock helpers ──────────────────────────────────────────────────────────

function ok(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}
function empty(body = {}) {
  return ok(body);
}

async function mockBaseApi(page, user) {
  await page.route('**/api/auth/login', (r) => r.fulfill(ok(user)));
  await page.route('**/api/auth/me', (r) => r.fulfill(ok(user)));

  // Generic fallback: any unmatched API → empty 200
  await page.route('**/api/**', (r) => {
    const path = new URL(r.request().url()).pathname;

    // Lists → empty arrays
    if (path.includes('/students')) return r.fulfill(ok([]));
    if (path.includes('/plans')) return r.fulfill(ok([]));
    if (path.includes('/contracts')) return r.fulfill(ok({ items: [], total: 0 }));
    if (path.includes('/charges')) return r.fulfill(ok({ items: [], total: 0 }));
    if (path.includes('/staff')) return r.fulfill(ok([]));
    if (path.includes('/access-logs')) return r.fulfill(ok({ items: [], total: 0 }));
    if (path.includes('/notifications')) return r.fulfill(ok({ items: [], total: 0, unread_count: 0 }));
    if (path.includes('/gyms')) return r.fulfill(ok({ gym_id: 'gym-1', name: 'Academia Teste', timezone: 'America/Sao_Paulo' }));
    if (path.includes('/subscription')) return r.fulfill(ok({ status: 'active', plan: 'pro' }));
    if (path.includes('/metrics')) return r.fulfill(ok({ runtime: {} }));
    if (path.includes('/alerts')) return r.fulfill(ok({ alerts: [] }));
    if (path.includes('/dashboard')) return r.fulfill(ok({ students: 0, contracts: 0, revenue: 0 }));
    if (path.includes('/turnstile') || path.includes('/catraca')) return r.fulfill(ok({ devices: [], access_logs: [], total: 0 }));
    if (path.includes('/billing')) return r.fulfill(ok({ items: [], total: 0, summary: {} }));
    if (path.includes('/tolletus')) return r.fulfill(ok({ status: 'ok' }));

    return r.fulfill(empty());
  });
}

async function login(page, user) {
  await page.goto('/login');
  await page.waitForSelector('form', { timeout: 15_000 });
  await mockBaseApi(page, user);
  await page.fill('input[type="email"], input[name="email"]', user.email);
  await page.fill('input[type="password"], input[name="password"]', 'Senha123456');
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(admin|aluno|platform)/, { timeout: 20_000 });
}

async function stabilize(page) {
  // Wait for loaders to disappear and animations to settle
  await page.waitForTimeout(800);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function capture(page, testName) {
  await stabilize(page);
  await expect(page).toHaveScreenshot(`${testName}.png`, { fullPage: false });
}

// ── Owner persona ─────────────────────────────────────────────────────────────

test.describe('owner persona', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseApi(page, ownerUser);
  });

  test('dashboard', async ({ page }) => {
    await login(page, ownerUser);
    await capture(page, 'owner-dashboard');
  });

  test('students', async ({ page }) => {
    await login(page, ownerUser);
    await page.goto('/admin/alunos');
    await capture(page, 'owner-students');
  });

  test('contracts', async ({ page }) => {
    await login(page, ownerUser);
    await page.goto('/admin/contratos');
    await capture(page, 'owner-contracts');
  });

  test('plans', async ({ page }) => {
    await login(page, ownerUser);
    await page.goto('/admin/planos');
    await capture(page, 'owner-plans');
  });

  test('access-logs', async ({ page }) => {
    await login(page, ownerUser);
    await page.goto('/admin/acessos');
    await capture(page, 'owner-access-logs');
  });

  test('staff', async ({ page }) => {
    await login(page, ownerUser);
    await page.goto('/admin/funcionarios');
    await capture(page, 'owner-staff');
  });

  test('catraca', async ({ page }) => {
    await login(page, ownerUser);
    await page.goto('/admin/catraca');
    await capture(page, 'owner-catraca');
  });

  test('subscription', async ({ page }) => {
    await login(page, ownerUser);
    await page.goto('/admin/assinatura');
    await capture(page, 'owner-subscription');
  });

  test('billing-center', async ({ page }) => {
    await login(page, ownerUser);
    await page.goto('/admin/cobranca');
    await capture(page, 'owner-billing-center');
  });

  test('notifications', async ({ page }) => {
    await login(page, ownerUser);
    await page.goto('/admin/notificacoes');
    await capture(page, 'owner-notifications');
  });

  test('profile', async ({ page }) => {
    await login(page, ownerUser);
    await page.goto('/admin/perfil');
    await capture(page, 'owner-profile');
  });
});

// ── Student persona ───────────────────────────────────────────────────────────

test.describe('student persona', () => {
  test.beforeEach(async ({ page }) => {
    await mockBaseApi(page, studentUser);
  });

  test('student-dashboard', async ({ page }) => {
    await login(page, studentUser);
    await capture(page, 'student-dashboard');
  });

  test('student-billing', async ({ page }) => {
    await login(page, studentUser);
    await page.goto('/aluno/financeiro');
    await capture(page, 'student-billing');
  });

  test('student-profile', async ({ page }) => {
    await login(page, studentUser);
    await page.goto('/aluno/perfil');
    await capture(page, 'student-profile');
  });
});

// ── Public pages ──────────────────────────────────────────────────────────────

test.describe('public pages', () => {
  test('landing', async ({ page }) => {
    await mockBaseApi(page, ownerUser);
    await page.goto('/');
    await capture(page, 'landing');
  });

  test('login', async ({ page }) => {
    await mockBaseApi(page, ownerUser);
    await page.goto('/login');
    await capture(page, 'login');
  });
});
