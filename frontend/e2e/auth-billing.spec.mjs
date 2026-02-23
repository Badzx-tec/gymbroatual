import { expect, test } from '@playwright/test';

test('register + verify + payment gate + successful login', async ({ page }) => {
  let loginCount = 0;

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (path === '/api/auth/register' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Cadastro criado. Verifique seu email para continuar.' }),
      });
    }
    if (path === '/api/auth/verify/start' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Codigo enviado', dev_code: '123456' }),
      });
    }
    if (path === '/api/auth/verify/confirm' && method === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Email verificado com sucesso' }),
      });
    }
    if (path === '/api/auth/login' && method === 'POST') {
      loginCount += 1;
      if (loginCount === 1) {
        return route.fulfill({
          status: 402,
          contentType: 'application/json',
          headers: {
            'X-Error-Code': 'PAYMENT_REQUIRED',
            'X-Checkout-Url': 'https://checkout.example.test/owner_1',
          },
          body: JSON.stringify({ detail: 'Assinatura inativa. Realize o pagamento para entrar.' }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'test-token',
          user: {
            owner_id: 'own_1',
            name: 'Dono',
            email: 'owner@example.com',
            email_verified: true,
            gym_id: 'gym_1',
            role: 'OWNER',
          },
        }),
      });
    }
    if (path === '/api/dashboard' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total_alunos: 0,
          alunos_ativos: 0,
          alunos_inativos: 0,
          acessos_hoje: 0,
          alunos_sem_treino: 0,
        }),
      });
    }
    if (path === '/api/dashboard/charts' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          receita_por_plano: [],
          acessos_por_hora: [],
          receita_mensal: [],
        }),
      });
    }
    if (path.startsWith('/api/notifications') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  await page.goto('/login');

  await page.getByRole('button', { name: /Criar conta/i }).click();
  await page.locator('form input').nth(0).fill('Academia XPTO');
  await page.locator('form input').nth(1).fill('Academia XPTO');
  await page.locator('form input').nth(2).fill('owner@example.com');
  await page.locator('form input').nth(3).fill('Senha123456');
  await page.getByRole('button', { name: /Criar Conta/i }).click();

  await expect(page.getByText('Informe o codigo de 6 digitos')).toBeVisible();
  await page.locator('input[maxlength="6"]').fill('123456');
  await page.getByRole('button', { name: /Validar Codigo/i }).click();

  await expect(page.getByText('Acessar Painel')).toBeVisible();
  await page.getByRole('button', { name: /Entrar/i }).click();
  await expect(page.getByText('Assinatura necessaria')).toBeVisible();
  await expect(page.getByRole('button', { name: /Assinar agora/i })).toBeVisible();

  await page.getByRole('button', { name: /Entrar/i }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByText('Painel Administrativo')).toBeVisible();
});
