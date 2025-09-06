const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  // Set CORS headers for security
  const headers = {
    'Access-Control-Allow-Origin': 'https://your-domain.netlify.app',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // Validate content type
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    if (!contentType || !contentType.includes('application/json')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Content-Type must be application/json' })
      };
    }

    const { 
      amount, 
      currency = 'eur', 
      donation_by, 
      name, 
      email, 
      phone, 
      address, 
      paymentMethodId 
    } = JSON.parse(event.body);

    // Validate required fields
    if (!amount || amount <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid amount is required' })
      };
    }

    if (!paymentMethodId || !paymentMethodId.startsWith('pm_')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid payment method ID is required' })
      };
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid email is required' })
      };
    }

    if (!name || name.trim().length < 2) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid name is required' })
      };
    }

    // Create customer
    const customer = await stripe.customers.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone ? phone.trim() : undefined,
      address: address ? {
        line1: address.line1?.trim() || '',
        line2: address.line2?.trim() || '',
        city: address.city?.trim() || '',
        state: address.state?.trim() || '',
        postal_code: address.postal_code?.trim() || '',
        country: address.country?.trim() || 'IE',
      } : undefined,
    });

    // Attach payment method
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customer.id,
    });

    // Set as default payment method
    await stripe.customers.update(customer.id, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // Create product and price
    const product = await stripe.products.create({
      name: 'Monthly Donation',
      description: donation_by ? `Recurring donation: ${donation_by.trim()}` : 'Recurring donation',
    });

    const price = await stripe.prices.create({
      unit_amount: Math.round(amount),
      currency: currency.toLowerCase(),
      recurring: { interval: 'month' },
      product: product.id,
    });

    // Create subscription
    try {
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
        payment_settings: {
          payment_method_types: ['card'],
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: subscription.status,
          subscriptionId: subscription.id,
          customerId: customer.id,
          clientSecret: subscription.latest_invoice.payment_intent?.client_secret || null,
        })
      };
    } catch (subscriptionError) {
      if (subscriptionError.type === 'StripeCardError') {
        return {
          statusCode: 402,
          headers,
          body: JSON.stringify({ error: subscriptionError.message })
        };
      }
      throw subscriptionError;
    }

  } catch (err) {
    console.error('Stripe error:', err);
    
    // Don't expose internal error details to client
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
