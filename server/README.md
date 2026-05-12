# SocialGrow - PayPal API Server

Servidor backend para processar pagamentos via PayPal.

## 🚀 Quick Start

```bash
# 1. Entre na pasta do servidor
cd server

# 2. Instale as dependências
npm install

# 3. Configure as variáveis de ambiente
# Edite o arquivo .env com suas credenciais PayPal

# 4. Inicie o servidor
npm start
```

## 📋 Configuração do PayPal

### Passo 1: Acesse o Developer Dashboard
Vá para [developer.paypal.com](https://developer.paypal.com)

### Passo 2: Crie uma App
1. Vá em **Dashboard → My Apps & Credentials**
2. Clique em **Create App**
3. Dê um nome (ex: "SocialGrow Payments")
4. escolha **Sandbox** para testar

### Passo 3: Obtenha as Credenciais
Você verá:
- **Client ID** → Copie para `PAYPAL_SANDBOX_CLIENT_ID` ou `PAYPAL_LIVE_CLIENT_ID`
- **Client Secret** → Copie para `PAYPAL_SANDBOX_CLIENT_SECRET` ou `PAYPAL_LIVE_CLIENT_SECRET`

### Passo 4: Configure o .env
```env
PAYPAL_SANDBOX_CLIENT_ID=sua_chave_aqui
PAYPAL_SANDBOX_CLIENT_SECRET=sua_chave_secreta_aqui
PAYPAL_MODE=sandbox
```

### Passo 5: Teste
Abra [http://localhost:3000/api/health](http://localhost:3000/api/health)

## 🔌 Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/health` | Verifica se o servidor está online |
| GET | `/api/products` | Lista todos os produtos disponíveis |
| POST | `/api/create-order` | Cria uma ordem de pagamento |
| POST | `/api/capture-order` | Confirma o pagamento |
| POST | `/api/verify-webhook` | Recebe notificações do PayPal |

## 💳 Exemplo de Uso

### Criar Order de Pagamento

```javascript
const response = await fetch('/api/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        product: '1,000 Instagram Followers',
        price: 4.99,
        username: '@myuser',
        coupon: 'FLASH20' // opcional
    })
});

const data = await response.json();
// {
//   "success": true,
//   "orderId": "PAYID-XXX",
//   "approvalUrl": "https://www.sandbox.paypal.com/...",
//   "price": "3.99"
// }

window.location.href = data.approvalUrl;
```

## 🌍 Deploy

### Vercel
```bash
npm i -g vercel
vercel --prod
```

### Railway
```bash
railway init
railwall up
```

### Heroku
```bash
heroku create socialgrow-paypal
git push heroku main
```

## 📁 Estrutura

```
server/
├── .env              # Configurações (NÃO versionar)
├── .env.example      # Template de configurações
├── server.js         # Servidor principal
├── package.json      # Dependências
├── success.html      # Página de sucesso
└── cancel.html       # Página de cancelamento
```

## ⚠️ Importante

1. **Nunca** commite o arquivo `.env` com suas credenciais reais
2. Use **Sandbox** para testar tudo antes de usar **Production**
3. Configure o webhook no PayPal para receber notificações de pagamento
4. Em produção, use HTTPS

## 📞 Suporte

Em caso de dúvidas, entre em contato via WhatsApp: +258 83 459 2663