// netlify/functions/send-payout.js
//
// Sends money from the platform's Stripe balance to a tester's connected
// account (created via create-connected-account.js), for the bank-transfer
// reward method. A flat ¥500 transfer fee is borne by the tester and is
// deducted from the gross reward amount before sending — this fee does
// NOT apply to Amazon gift card rewards, which are handled separately.
//
// This is money-moving, so it requires a secret header that only you know
// — set ADMIN_SECRET as an environment variable and never share it or
// commit it to code.
//
// This function is meant to be called from admin.html, which you keep to
// yourself (don't link it from the public site or share the URL).

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const BANK_TRANSFER_FEE = 500; // yen, borne by the tester, per payout

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const providedSecret = event.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || providedSecret !== process.env.ADMIN_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: '認証に失敗しました。管理用シークレットを確認してください。' }) };
  }

  let accountId, amount, note;
  try {
    ({ accountId, amount, note } = JSON.parse(event.body || '{}'));
    amount = Number(amount); // gross reward amount, before the bank-transfer fee
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'リクエストの形式が正しくありません。' }) };
  }

  if (!accountId || typeof accountId !== 'string' || !accountId.startsWith('acct_')) {
    return { statusCode: 400, body: JSON.stringify({ error: '送金先アカウントID（acct_...）を正しく入力してください。' }) };
  }
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    return { statusCode: 400, body: JSON.stringify({ error: '金額は1〜100,000円の範囲で指定してください。' }) };
  }

  const netAmount = amount - BANK_TRANSFER_FEE;
  if (netAmount < 1) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `振込手数料(¥${BANK_TRANSFER_FEE})を差し引くと送金額が0円以下になります。入力額を¥${BANK_TRANSFER_FEE + 1}以上にしてください。` }),
    };
  }

  try {
    const transfer = await stripe.transfers.create({
      amount: netAmount,
      currency: 'jpy',
      destination: accountId,
      description: (note || 'テスパス テスター謝礼') + `（振込手数料¥${BANK_TRANSFER_FEE}差引後）`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        id: transfer.id,
        grossAmount: amount,
        fee: BANK_TRANSFER_FEE,
        netAmount: transfer.amount,
        destination: transfer.destination,
      }),
    };
  } catch (err) {
    console.error('Stripe error (send-payout):', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: '送金に失敗しました: ' + (err.message || '不明なエラー') }),
    };
  }
};
