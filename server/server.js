const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ============ CONFIGURATION ============
const PAYPAL_MODE = process.env.PAYPAL_MODE || 'sandbox';

const configs = {
    sandbox: {
        baseUrl: 'https://api-m.sandbox.paypal.com',
        clientId: process.env.PAYPAL_SANDBOX_CLIENT_ID,
        clientSecret: process.env.PAYPAL_SANDBOX_CLIENT_SECRET
    },
    live: {
        baseUrl: 'https://api-m.paypal.com',
        clientId: process.env.PAYPAL_LIVE_CLIENT_ID,
        clientSecret: process.env.PAYPAL_LIVE_CLIENT_SECRET
    }
};

const config = configs[PAYPAL_MODE];

if (!config.clientId || !config.clientSecret) {
    console.error('❌ PayPal credentials not configured!');
    console.log('📝 Copie .env.example para .env e preencha as credenciais');
    process.exit(1);
}

// ============ HELPERS ============

// Get Access Token do PayPal
async function getAccessToken() {
    const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

    const response = await axios.post(
        `${config.baseUrl}/v1/oauth2/token`,
        'grant_type=client_credentials',
        {
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    return response.data.access_token;
}

// ============ ENDPOINTS ============

/**
 * GET /api/health
 * Health check do servidor
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        mode: PAYPAL_MODE,
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/create-order
 * Cria uma ordem de pagamento no PayPal
 *
 * Body esperado:
 * {
 *   "product": "1,000 Instagram Followers",
 *   "price": 4.99,
 *   "username": "@user123"
 * }
 */
app.post('/api/create-order', async (req, res) => {
    try {
        const { product, price, username, coupon } = req.body;

        if (!product || !price) {
            return res.status(400).json({
                error: 'Product and price are required'
            });
        }

        // Calcula desconto se houver cupom
        let finalPrice = price;
        const validCoupons = {
            'FLASH20': 0.20,
            'SOCIAL10': 0.10,
            'WELCOME15': 0.15,
            'GROW2026': 0.25
        };

        if (coupon && validCoupons[coupon.toUpperCase()]) {
            finalPrice = price * (1 - validCoupons[coupon.toUpperCase()]);
        }

        const accessToken = await getAccessToken();

        // Cria a ordem no PayPal
        const orderResponse = await axios.post(
            `${config.baseUrl}/v2/checkout/orders`,
            {
                intent: 'CAPTURE',
                purchase_units: [{
                    reference_id: `SG_${Date.now()}`,
                    description: product,
                    soft_descriptor: 'SOCIALGROW',
                    amount: {
                        currency_code: 'USD',
                        value: finalPrice.toFixed(2)
                    }
                }],
                application_context: {
                    brand_name: 'SocialGrow',
                    landing_page: 'NO_PREFERENCE',
                    user_action: 'PAY_NOW',
                    return_url: `${process.env.SITE_URL || 'http://localhost:3000'}/success.html`,
                    cancel_url: `${process.env.SITE_URL || 'http://localhost:3000'}/cancel.html`
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Retorna o link de aprovação
        const approvalUrl = orderResponse.data.links.find(link => link.rel === 'approve');

        res.json({
            success: true,
            orderId: orderResponse.data.id,
            approvalUrl: approvalUrl.href,
            price: finalPrice.toFixed(2),
            originalPrice: price.toFixed(2),
            product,
            username
        });

    } catch (error) {
        console.error('PayPal API Error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to create PayPal order',
            details: error.response?.data || error.message
        });
    }
});

/**
 * POST /api/capture-order
 * Confirma/captura um pagamento após aprovação
 *
 * Body esperado:
 * {
 *   "orderId": "PAYID-xxx"
 * }
 */
app.post('/api/capture-order', async (req, res) => {
    try {
        const { orderId } = req.body;

        if (!orderId) {
            return res.status(400).json({ error: 'Order ID is required' });
        }

        const accessToken = await getAccessToken();

        const captureResponse = await axios.post(
            `${config.baseUrl}/v2/checkout/orders/${orderId}/capture`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const capture = captureResponse.data;
        const status = capture.status;

        if (status === 'COMPLETED') {
            res.json({
                success: true,
                status: 'completed',
                orderId: capture.id,
                paymentId: capture.purchase_units[0].payments.captures[0].id,
                amount: capture.purchase_units[0].payments.captures[0].amount.value,
                email: capture.payer?.email_address
            });
        } else {
            res.json({
                success: true,
                status: status,
                orderId: capture.id
            });
        }

    } catch (error) {
        console.error('Capture Error:', error.response?.data || error.message);
        res.status(500).json({
            error: 'Failed to capture order',
            details: error.response?.data || error.message
        });
    }
});

/**
 * POST /api/verify-webhook
 * Verifica webhook do PayPal (para notificações de pagamento)
 */
app.post('/api/verify-webhook', async (req, res) => {
    try {
        const webhookEvent = req.body;

        // Aqui você pode processar o webhook
        // Ex: enviar confirmação, atualizar banco de dados, etc.

        console.log('📥 Webhook received:', webhookEvent.event_type);

        // Exemplo de resposta para diferentes tipos de eventos
        switch (webhookEvent.event_type) {
            case 'CHECKOUT.ORDER.APPROVED':
                console.log('✅ Order approved');
                break;
            case 'PAYMENT.CAPTURE.COMPLETED':
                console.log('💰 Payment completed');
                // Aqui você notificaria o cliente via WhatsApp
                break;
            default:
                console.log('ℹ️ Other event:', webhookEvent.event_type);
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

/**
 * GET /api/products
 * Retorna lista de produtos disponíveis
 */
app.get('/api/products', (req, res) => {
    res.json({
        products: [
            { id: 'ig-500', name: '500 Instagram Followers', price: 2.39, platform: 'instagram' },
            { id: 'ig-1k', name: '1,000 Instagram Followers', price: 4.99, platform: 'instagram' },
            { id: 'ig-5k', name: '5,000 Instagram Followers', price: 19.99, platform: 'instagram' },
            { id: 'ig-10k', name: '10,000 Instagram Followers', price: 34.99, platform: 'instagram' },
            { id: 'ig-likes-1k', name: '1,000 Instagram Likes', price: 2.80, platform: 'instagram' },
            { id: 'ig-views-10k', name: '10,000 Instagram Views', price: 3.99, platform: 'instagram' },
            { id: 'tt-1k', name: '1,000 TikTok Followers', price: 4.79, platform: 'tiktok' },
            { id: 'tt-10k', name: '10,000 TikTok Followers', price: 39.99, platform: 'tiktok' },
            { id: 'tt-5k-views', name: '5,000 TikTok Views', price: 1.59, platform: 'tiktok' },
            { id: 'tt-50k-views', name: '50,000 TikTok Views', price: 7.99, platform: 'tiktok' },
            { id: 'yt-500-subs', name: '500 YouTube Subscribers', price: 12.00, platform: 'youtube' },
            { id: 'yt-1k-subs', name: '1,000 YouTube Subscribers', price: 22.00, platform: 'youtube' },
            { id: 'yt-4k-hours', name: '4,000 Watch Hours', price: 36.00, platform: 'youtube' },
            { id: 'yt-10k-views', name: '10,000 YouTube Views', price: 9.99, platform: 'youtube' }
        ],
        coupons: {
            'FLASH20': 0.20,
            'SOCIAL10': 0.10,
            'WELCOME15': 0.15,
            'GROW2026': 0.25
        }
    });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 SocialGrow PayPal API Server                         ║
║                                                           ║
║   Mode: ${PAYPAL_MODE.toUpperCase().padEnd(42)}║
║   Port: ${PORT.toString().padEnd(47)}║
║                                                           ║
║   Endpoints:                                             ║
║   - GET  /api/health          → Health check              ║
║   - GET  /api/products        → Lista produtos            ║
║   - POST /api/create-order    → Criar pagamento           ║
║   - POST /api/capture-order   → Confirmar pagamento       ║
║   - POST /api/verify-webhook  → Webhook PayPal           ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
});