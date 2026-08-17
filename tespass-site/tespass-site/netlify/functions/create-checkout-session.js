// netlify/functions/create-checkout-session.js
//
// Receives { reward, testers } from the price simulator on the page,
// re-validates and re-calculates the total on the server (never trust a
// client-sent total), then asks Stripe to create a Checkout Session for
// that exact amount and returns the URL to redirect the browser to.
//
// STRIPE_SECRET_KEY must be set as an environment variable in the
// Netlify dashboard (Site settings > Environment variables). Never put
// the secret key in this file or in any file you commit to Git.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const REWARD_MIN = 100;
const REWARD_MAX = 5000;
const TESTERS_MIN = 12;
const TESTERS_MAX = 20;
const SERVICE_FEE_RATE = 0.10;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let reward, testers;
  try {
    ({ reward, testers } = JSON.parse(event.body || '{}'));
    reward = Number(reward);
    testers = Number(testers);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'リクエストの形式が正しくありません。' }) };
  }

  if (!Number.isFinite(reward) || reward < REWARD_MIN || reward > REWARD_MAX) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `謝礼は${REWARD_MIN}〜${REWARD_MAX}円の範囲で指定してください。` }),
    };
  }
  if (!Number.isInteger(testers) || testers < TESTERS_MIN || testers > TESTERS_MAX) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `募集人数は${TESTERS_MIN}〜${TESTERS_MAX}人の範囲で指定してください。` }),
    };
  }

  const rewardTotal = reward * testers;
  const fee = Math.round(rewardTotal * SERVICE_FEE_RATE);
  const grandTotal = rewardTotal + fee;

  const siteUrl = process.env.URL || 'https://tespass.netlify.app';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            product_data: {
              name: 'テスパス テスター謝礼・利用料',
              description: `1人あたり¥${reward} × ${testers}人 + サービス利用料10%`,
            },
            unit_amount: grandTotal, // JPY has no decimal subunits — this is the yen amount itself
          },
          quantity: 1,
        },
      ],
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=cancel`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: '決済セッションの作成に失敗しました。時間をおいて再度お試しください。' }),
    };
  }
};
