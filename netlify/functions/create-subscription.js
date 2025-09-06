// netlify/functions/create-subscription.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { amount, currency, name, email, paymentMethodId } = data;

  if (!amount || amount <= 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount' }) };
  }

  if (!paymentMethodId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Payment method ID required' }) };
  }

  try {
    // 1. Create Stripe Customer
    const customer = await stripe.customers.create({
      name,
      email,
    });

    // 2. Attach Payment Method
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customer.id,
    });

    // 3. Set default payment method
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // 4. Create product & price
    const product = await stripe.products.create({ name: 'Monthly Donation' });
    const price = await stripe.prices.create({
      unit_amount: amount,
      currency,
      recurring: { interval: 'month' },
      product: product.id,
    });

    // 5. Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      expand: ['latest_invoice.payment_intent'],
    });

    // 6. Return only necessary info
    return {
      statusCode: 200,
      body: JSON.stringify({
        subscriptionId: subscription.id,
        status: subscription.status,
        clientSecret: subscription.latest_invoice.payment_intent?.client_secret || null,
      }),
    };
  } catch (err) {
    console.error('Stripe error', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Payment failed' }),
    };
  }
};
