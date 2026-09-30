// Notifications module for sending notifications and publishing events

const NOTIFICATIONS_URL = process.env.NOTIFICATIONS_URL || 'http://localhost:4002';
const NOTIFICATIONS_ENABLED = process.env.NOTIFICATIONS_ENABLED !== 'false';
const APP_ENV = process.env.APP_ENV || 'development';

// Determine which API key to use (per-env override or fallback to NOTIFY_API_KEY)
function getNotifyApiKey() {
  if (APP_ENV === 'staging' && process.env.STAGING_NOTIFY_API_KEY) {
    return process.env.STAGING_NOTIFY_API_KEY;
  }
  if (APP_ENV === 'production' && process.env.PROD_NOTIFY_API_KEY) {
    return process.env.PROD_NOTIFY_API_KEY;
  }
  return process.env.NOTIFY_API_KEY || 'test-key-123';
}

// Send a notification with retry logic
async function sendNotification(to, subject, message) {
  if (!NOTIFICATIONS_ENABLED) {
    return;
  }

  let lastError;
  const apiKey = getNotifyApiKey();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${NOTIFICATIONS_URL}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
        },
        body: JSON.stringify({ to, subject, message })
      });

      if (response.status === 500) {
        lastError = new Error('Provider returned 500');
        // Retry on 500
        continue;
      }

      if (!response.ok) {
        console.error(`Failed to send notification: ${response.status}`);
        return;
      }

      // Success
      return;
    } catch (error) {
      lastError = error;
    }
  }

  // All retries failed, log and give up
  console.error('Failed to send notification after 3 attempts:', lastError);
}

// Publish an event to a topic
async function publishEvent(topic, payload) {
  if (!NOTIFICATIONS_ENABLED) {
    return;
  }

  try {
    const apiKey = getNotifyApiKey();
    await fetch(`${NOTIFICATIONS_URL}/topics/${topic}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error(`Failed to publish event to topic ${topic}:`, error);
  }
}

// Publish an event to a user topic
async function publishToUser(userId, payload) {
  await publishEvent(`user-${userId}`, payload);
}

module.exports = {
  sendNotification,
  publishEvent,
  publishToUser,
  NOTIFICATIONS_ENABLED,
  APP_ENV,
  getNotifyApiKey
};
