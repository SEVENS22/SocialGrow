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

const paypalConfigured = !!(config.clientId && config.clientSecret);

if (!paypalConfigured) {
    console.warn('⚠️ PayPal credentials not configured - payments will show error');
}

// ============ HELPERS ============

// Enviar notificação para o Telegram
async function sendTelegramNotification(message) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!token || !chatId) return;

    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
        });
        console.log('✅ Telegram notification sent');
    } catch (error) {
        console.error('❌ Telegram error:', error.response?.data || error.message);
    }
}

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

        if (!paypalConfigured) {
            return res.status(503).json({
                error: 'PayPal not configured',
                message: 'Contact support to enable payments'
            });
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
                    },
                    custom_id: JSON.stringify({ product, username, price: finalPrice.toFixed(2) })
                }],
                application_context: {
                    brand_name: 'SocialGrow',
                    landing_page: 'NO_PREFERENCE',
                    user_action: 'PAY_NOW',
                    return_url: `${process.env.SITE_URL || 'http://localhost:3000'}/success`,
                    cancel_url: `${process.env.SITE_URL || 'http://localhost:3000'}/cancel`
                }
            },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json({
            success: true,
            orderId: orderResponse.data.id,
            approvalUrl: orderResponse.data.links.find(link => link.rel === 'approve')?.href,
            price: finalPrice.toFixed(2)
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
 */
app.post('/api/capture-order', async (req, res) => {
    try {
        const orderId = req.body.orderId || req.body.token;
        
        if (!orderId) {
            return res.status(400).json({ error: 'Order ID or Token is required' });
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
        
        if (capture.status === 'COMPLETED') {
            const unit = capture.purchase_units[0];
            const meta = JSON.parse(unit.payments.captures[0].custom_id || '{}');

            // Notificar Telegram
            const message = `💰 *NOVO PAGAMENTO RECEBIDO!*\n\n` +
                          `👤 *Usuário:* ${meta.username || 'Não informado'}\n` +
                          `📦 *Produto:* ${meta.product || 'Serviço'}\n` +
                          `💵 *Valor:* $${meta.price || '0.00'}\n` +
                          `🆔 *ID:* ${capture.id}\n\n` +
                          `🚀 Já pode adicionar os seguidores!`;

            await sendTelegramNotification(message);

            res.json({
                success: true,
                status: 'completed',
                orderId: capture.id
            });
        } else {
            res.json({ success: true, status: capture.status });
        }

    } catch (error) {
        // Se já foi capturado anteriormente, retorna sucesso
        if (error.response?.data?.name === 'ORDER_ALREADY_CAPTURED') {
            return res.json({ success: true, status: 'completed' });
        }
        
        console.error('Capture Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to capture order' });
    }
});

/**
 * POST /api/verify-webhook
 * Recebe notificações automáticas do PayPal
 */
app.post('/api/verify-webhook', async (req, res) => {
    try {
        const event = req.body;
        console.log('📥 Webhook received:', event.event_type);

        if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
            const orderId = event.resource.id;
            console.log(`🚀 Automating capture for order: ${orderId}`);
            
            // Tenta capturar automaticamente
            const accessToken = await getAccessToken();
            await axios.post(
                `${config.baseUrl}/v2/checkout/orders/${orderId}/capture`,
                {},
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log(`✅ Order ${orderId} captured via Webhook`);
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Webhook Error:', error.response?.data || error.message);
        res.json({ received: true }); // Sempre responde 200 para o PayPal
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
        ]
    });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 SocialGrow Server running on port ${PORT}`);
});