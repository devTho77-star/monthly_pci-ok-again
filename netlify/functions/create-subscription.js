const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    const { amount, currency, donation_by, name, email, phone, address, paymentMethodId } = JSON.parse(event.body);

    if (!amount || amount <= 0) return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount' }) };
    if (!paymentMethodId) return { statusCode: 400, body: JSON.stringify({ error: 'Payment method ID required' }) };

    const product = await stripe.products.create({ name: 'Monthly Donation', description: donation_by || 'Recurring donation' });
    const price = await stripe.prices.create({ unit_amount: amount, currency, recurring: { interval: 'month' }, product: product.id });

    const customer = await stripe.customers.create({ 
      name, email, phone,
      address: {
        line1: address.line1,
        line2: address.line2 || '',
        city: address.city,
        state: address.state || '',
        postal_code: address.postal_code,
        country: address.country
      }
    });

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethodId } });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: price.id }],
      expand: ['latest_invoice.payment_intent']
    });

    const paymentIntent = subscription.latest_invoice.payment_intent;

    if (paymentIntent && paymentIntent.status === 'requires_action') {
      return { statusCode: 200, body: JSON.stringify({
        status: 'requires_action',
        subscriptionId: subscription.id,
        clientSecret: paymentIntent.client_secret
      })};
    }

    return { statusCode: 200, body: JSON.stringify({ status: subscription.status, subscriptionId: subscription.id }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
