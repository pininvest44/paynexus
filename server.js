import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Helper function to create a delay (in milliseconds)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Format local Kenyan numbers (07... / 01...) to 254...
function formatPhoneNumber(phone) {
  let cleaned = phone.trim().replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.slice(1);
  }
  return cleaned;
}

// API endpoint for processing bulk STK Push
app.post('/api/send-bulk', async (req, res) => {
  const { numbers, amount, description } = req.body;

  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one phone number.' });
  }

  // Set SSE (Server-Sent Events) headers for real-time progress updates
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const apiKey = process.env.PAYNEXUS_API_KEY;

  for (let i = 0; i < numbers.length; i++) {
    const rawPhone = numbers[i];
    const phone = formatPhoneNumber(rawPhone);

    try {
      const apiResponse = await fetch('https://paynexus.co.ke/api/mpesa/payment/initiate', {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: Number(amount) || 100,
          phone,
          description: description || 'Order #12345'
        })
      });

      const payment = await apiResponse.json();

      if (apiResponse.ok && payment?.data?.reference) {
        res.write(`data: ${JSON.stringify({ status: 'success', phone, reference: payment.data.reference })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ status: 'failed', phone, message: payment.message || 'Payment initiation failed' })}\n\n`);
      }
    } catch (error) {
      res.write(`data: ${JSON.stringify({ status: 'failed', phone, message: error.message })}\n\n`);
    }

    // Apply 5-second delay before the next request (except for the last one)
    if (i < numbers.length - 1) {
      res.write(`data: ${JSON.stringify({ status: 'waiting', message: 'Waiting 5 seconds before next request...' })}\n\n`);
      await sleep(5000);
    }
  }

  res.write(`data: ${JSON.stringify({ status: 'complete' })}\n\n`);
  res.end();
});

// Serve frontend web page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bulk STK Push</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; line-height: 1.5; }
        label { font-weight: bold; display: block; margin-top: 15px; }
        textarea, input, button { width: 100%; padding: 10px; margin-top: 5px; box-sizing: border-box; }
        textarea { height: 120px; font-family: monospace; }
        button { background-color: #04AA6D; color: white; border: none; font-size: 16px; cursor: pointer; margin-top: 20px; }
        button:disabled { background-color: #cccccc; cursor: not-allowed; }
        #logs { margin-top: 20px; background: #f4f4f4; padding: 15px; border-radius: 5px; height: 200px; overflow-y: auto; font-family: monospace; }
        .success { color: green; }
        .failed { color: red; }
        .info { color: #555; }
      </style>
    </head>
    <body>
      <h2>Bulk STK Push Sender</h2>
      
      <label for="numbers">Phone Numbers (One per line or comma-separated):</label>
      <textarea id="numbers" placeholder="0746990866&#10;0712345678"></textarea>
      
      <label for="amount">Amount (KES):</label>
      <input type="number" id="amount" value="100" />
      
      <label for="description">Description:</label>
      <input type="text" id="description" value="Order #12345" />
      
      <button id="sendBtn" onclick="startBulkPush()">Send STK Pushes</button>
      
      <h3>Execution Logs:</h3>
      <div id="logs">Ready...</div>

      <script>
        async function startBulkPush() {
          const numbersText = document.getElementById('numbers').value;
          const amount = document.getElementById('amount').value;
          const description = document.getElementById('description').value;
          const sendBtn = document.getElementById('sendBtn');
          const logs = document.getElementById('logs');

          const numbers = numbersText.split(/[,\n]/).map(n => n.trim()).filter(n => n.length > 0);

          if (numbers.length === 0) {
            alert('Please enter at least one phone number.');
            return;
          }

          sendBtn.disabled = true;
          logs.innerHTML = '<div class="info">Starting batch...</div>';

          try {
            const response = await fetch('/api/send-bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ numbers, amount, description })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
              const { value, done } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split('\\n\\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = JSON.parse(line.replace('data: ', ''));
                  
                  if (data.status === 'success') {
                    logs.innerHTML += \`<div class="success">✓ \${data.phone} - Ref: \${data.reference}</div>\`;
                  } else if (data.status === 'failed') {
                    logs.innerHTML += \`<div class="failed">✗ \${data.phone} - \${data.message}</div>\`;
                  } else if (data.status === 'waiting') {
                    logs.innerHTML += \`<div class="info">⏳ \${data.message}</div>\`;
                  } else if (data.status === 'complete') {
                    logs.innerHTML += '<div class="info"><strong>Batch processing complete!</strong></div>';
                  }
                  logs.scrollTop = logs.scrollHeight;
                }
              }
            }
          } catch (err) {
            logs.innerHTML += \`<div class="failed">Error: \${err.message}</div>\`;
          } finally {
            sendBtn.disabled = false;
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
