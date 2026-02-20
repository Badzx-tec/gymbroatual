# 🎯 Recomendação: Modelo de Cobrança

## Pergunta Original
> "você quer assinatura recorrente real (Mercado Pago assinaturas/preapproval) ou mensal 'paga e libera 30 dias'?"

---

## ✅ Resposta Recomendada (Implementada Atualmente)

### Modelo: **MENSAL "PAGA E LIBERA 30 DIAS"** 

#### Por quê?
1. **Simples de implementar** ✓ (já está no seu backend)
2. **Menor risco legal** (sem preapproval automático)
3. **Melhor UX inicial** (usuário vê botão "Pagar Agora")
4. **Funciona bem com trial** (30 dias grátis → depois paga mensalmente)
5. **Fácil divergir para recorrente depois** (estrutura pronta)

---

## 📐 Como Funciona Hoje

```
1. Novo usuário cria academia
   → trial_until = hoje + 30 dias
   → paid_until = null
   → billing_status = "trial"

2. Login durante trial
   → check trial_until >= hoje? SIM
   → Login permitido ✅

3. Trial vence
   → check trial_until >= hoje? NÃO
   → check paid_until >= hoje? NÃO (é null)
   → Login bloqueado 🚫
   → Redireciona para /admin/assinatura

4. Usuário clica "Pagar com Mercado Pago"
   → Frontend chama POST /api/payments/academy/subscription/checkout
   → Webhook aprova pagamento
   → paid_until = hoje + 30 dias
   → Login liberado ✅

5. Loop mensal
   → Usuário deve clicar "Renovar" a cada 30 dias
   → OU adicionar aviso 7 dias antes
```

---

## 🚀 Evolução Futura: Assinatura Recorrente

Se quiser evoluir para **Mercado Pago Preapproval** (cobrar automaticamente):

### Passo 1: Criar endpoint
```python
@app.post("/api/payments/academy/preapproval")
async def create_academy_preapproval(data, user=Depends(get_current_user)):
    # Criar preapproval_plan no MP
    # Guardar preapproval_id no academy_billing
    # MP cobra automaticamente todo mês
```

### Passo 2: Atualizar webhook
```python
# Webhook detecta preapproval aprovado
# Atualiza paid_until automaticamente
```

### Passo 3: Melhorar UX
```javascript
// Botão muda conforme status:
- Trial: "Iniciar Assinatura"
- Ativo: "Mudar Plano / Cancelar"
- Vencido: "Reativar Agora"
```

**Esforço**: 📝 ~4-6 horas

---

## 📋 O Que Você Tem Pronto Agora

### ✅ Backend
- [x] Trial automático 30 dias
- [x] Validação de pagamento em todas rotas
- [x] Webhook completo do Mercado Pago
- [x] Endpoints de checkout
- [x] Histórico de faturas

### ✅ Frontend
- [x] Página de Assinatura (`/admin/assinatura`)
- [x] Exibição de status (Trial/Active/Past Due)
- [x] Botão de pagamento
- [x] Histórico visual de pagamentos

### ⏳ Recomendado Adicionar
- [ ] Aviso 7 dias antes vencimento (email + notificação)
- [ ] Link direto de "Renovar" no dashboard
- [ ] Cancelamento de assinatura (selectable)
- [ ] Invoices em PDF

---

## 🎁 Bônus: Evitar Ciladas Comuns

### ❌ NÃO FAZER
```python
# ❌ Guardar token do Mercado Pago no localStorage
# ❌ Fazer checkout sem validation de trial
# ❌ Esquecer de chamar webhook de todos domínios
# ❌ Usar trial com auto-debit (legal é difícil)
```

### ✅ FAZER
```python
# ✅ Guardar preapproval_id + last_charge_date no BD
# ✅ Sempre validar que academia pode fazer checkout
# ✅ Testar webhook com ngrok ou Postman mock
# ✅ Usar Mercado Pago Sandbox antes de produção
```

---

## 🧪 Checklist Antes de Ir para Produção

### Segurança
- [ ] JWT_SECRET é forte (min 32 chars)
- [ ] Certificado SSL no backend (HTTPS obrigatório)
- [ ] CORS configurado apenas para frontend URL
- [ ] Webhook URL assinada (se Mercado Pago oferecer)

### Funcionalidade
- [ ] Trial começa ao criar academia
- [ ] Email de vencimento enviado 7 dias antes
- [ ] Usuário vê status de pagamento claro
- [ ] Pagamento recusado → mensagem clara
- [ ] Webhook pode ser retentado (idempotent)

### Dados
- [ ] Backup diário do MongoDB
- [ ] Audit log de pagamentos (quem pagou, quando)
- [ ] Soft-delete (nunca remover academia hard delete)
- [ ] Teste de recuperação de backup

### UX
- [ ] Botão "Renovar" é visível
- [ ] Mensagem "Trial expirando em X dias"
- [ ] Redirecionamento pós-pagamento funciona
- [ ] Mobile responsivo na página de assinatura

---

## 📞 Decisão Recomendada

**Recomendação:** Mantenha o modelo "mensal" por enquanto.

Razões:
1. **Menor complexidade** = menos bugs = menos suporte
2. **Controle total** do usuário = melhor experiência
3. **Evolução limpa** para preapproval se crescer
4. **Monetização flexível** (pay-as-you-go depois)

---

## 🎯 Próximos 2 Steps

### Step 1 (Today - ~1h)
- [ ] Testar login com 2FA
- [ ] Testar pagamento com Mercado Pago Sandbox
- [ ] Verificar webhook é chamado
- [ ] Confirmar login após pagamento funciona

### Step 2 (Tomorrow - ~2h)
- [ ] Adicionar email de aviso 7 dias antes vencimento
- [ ] Criar landing page para checkout (opcional)
- [ ] Documentar fluxo para suporte

### Step 3 (Próxima semana - ~4h)
- [ ] GitHub Actions (CI/CD)
- [ ] Testes automatizados
- [ ] Deploy para staging
- [ ] Testar fluxo completo em produção

---

## 📞 Suporte

Se precisar evoluir para recorrente ou tiver dúvidas:
1. Revisit este documento
2. Check o código em `backend/server.py` linhas 585-650 (webhook)
3. Teste no Sandbox do Mercado Pago antes de produção

**Status Atual:** ✅ Pronto para Testar

