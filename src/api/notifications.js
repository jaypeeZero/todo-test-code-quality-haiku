
const NOTIFICATIONS_URL = process.env.NOTIFICATIONS_URL || 'http://localhost:4002';
const NOTIFICATIONS_ENABLED = process.env.NOTIFICATIONS_ENABLED !== 'false';
const APP_ENV = process.env.APP_ENV || 'development';
const SEND_ENDPOINT = '/send';
const JSON_CONTENT_TYPE = 'application/json';
const POST_METHOD = 'POST';
const API_KEY_HEADER = 'x-api-key';
const CONTENT_TYPE_HEADER = 'Content-Type';
const PROVIDER_ERROR_STATUS = 500;
const MAX_ATTEMPTS = 3;

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

async function sendNotification(to, subject, message) {
  if (!NOTIFICATIONS_ENABLED) {
    return;
  }

  let lastError;
  const apiKey = getNotifyApiKey();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${NOTIFICATIONS_URL}${SEND_ENDPOINT}`, {
        method: POST_METHOD,
        headers: {
          [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
          [API_KEY_HEADER]: apiKey
        },
        body: JSON.stringify({ to, subject, message })
      });

      if (response.status === PROVIDER_ERROR_STATUS) {
        lastError = new Error(`Provider returned ${PROVIDER_ERROR_STATUS}`);
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

  console.error('Failed to send notification after ' + MAX_ATTEMPTS + ' attempts:', lastError);
}

async function publishEvent(topic, payload) {
  if (!NOTIFICATIONS_ENABLED) {
    return;
  }

  try {
    const apiKey = getNotifyApiKey();
    await fetch(`${NOTIFICATIONS_URL}/topics/${topic}/publish`, {
      method: POST_METHOD,
      headers: {
        [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE,
        [API_KEY_HEADER]: apiKey
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error(`Failed to publish event to topic ${topic}:`, error);
    throw error;
  }
}

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
