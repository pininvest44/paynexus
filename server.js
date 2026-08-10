const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Pause execution for ms
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Normalize Kenyan phone numbers to 254XXXXXXXXX
function normalizePhoneNumber(phone) {
  let cleaned = phone.replace(/\D/g, ''); // strip non-digits

  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('7') || cleaned.startsWith('1')) {
    cleaned = '254' + cleaned;
  }

  return cleaned;
}

app.post('/api/batch-stk', async (req, res) => {
  const { numbers, amount, description } = req.body;

  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'A non-empty list of numbers is required.' });
  }

  const apiKey = process.env.PAYNEXUS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'PAYNEXUS_API_KEY is not configured on the server.' });
  }

  // Set headers for SSE (Server-Sent Events) to stream live progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent({ type: 'start', total: numbers.length });

  for (let i = 0; i < numbers.length; i++) {
    const rawNumber = numbers[i].trim();
    if (!rawNumber) continue;

    const formattedPhone = normalizePhoneNumber(rawNumber);

    try {
      const response = await axios.post(
        'https://paynexus.co.ke/api/mpesa/payment/initiate',
        {
          amount: Number(amount) || 100,
          phone: formattedPhone,
          description: description || 'Bulk Order'
        },
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      sendEvent({
        type: 'progress',
        index: i + 1,
        total: numbers.length,
        phone: formattedPhone,
        status: 'SUCCESS',
        details: response.data
      });
    } catch (error) {
      sendEvent({
        type: 'progress',
        index: i + 1,
        total: numbers.length,
        phone: formattedPhone,
        status: 'FAILED',
        error: error.response?.data || error.message
      });
    }

    // Enforce 5-second delay between requests (skip delay after last item)
    if (i < numbers.length - 1) {
      sendEvent({ type: 'waiting', seconds: 3 });
      await sleep(3000);
    }
  }

  sendEvent({ type: 'complete' });
  res.end();
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
