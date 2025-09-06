// netlify/functions/create-subscription.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Method Not Allowed' }),
      };
    }

    const { 
      amount, 
      currency, 
      donation_by, 
      name, 
      email, 
      phone, 
      address, 
      paymentMethodId 
    } = JSON.parse(event.body);

    if (!amount || amount <= 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid amount' }),
      };
    }

    if (!paymentMethodId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Payment method ID is required' }),
      };
    }

    // 1. Create product
    const product = await stripe.products.create({
      name: 'Monthly Donation',
      description: donation_by || 'Recurring donation',
    });

    // 2. Create price
    const price = await stripe.prices.create({
      unit_amount: amount,
      currency: currency,
      recurring: { interval: 'month' },
      product: product.id,
    });

    // 3. Create customer
    const customer = await stripe.customers.create({
      name,
      email,
      phone,
      address: {
        line1: address.line1,
        line2: address.line2 || '',
        city: address.city,
        state: address.state || '',
        postal_code: address.postal_code,
        country: address.country,
      },
    });

    // 4. Attach payment method
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customer.id,
    });

    // 5. Set as default
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // 6. Create subscription
    try {
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
        expand: ['latest_invoice.payment_intent'],
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: subscription.status,
          subscriptionId: subscription.id,
          clientSecret: subscription.latest_invoice.payment_intent?.client_secret || null,
        }),
      };
    } catch (subscriptionError) {
      if (subscriptionError.code === 'invoice_payment_intent_requires_action') {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'requires_action',
            subscriptionId: subscriptionError.subscription.id,
            clientSecret: subscriptionError.payment_intent.client_secret,
          }),
        };
      } else {
        throw subscriptionError;
      }
    }
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
