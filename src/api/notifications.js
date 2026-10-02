const CONTENT_TYPE_JSON = 'application/json'
const CONTENT_TYPE_HEADER = 'Content-Type'
const API_KEY_HEADER = 'x-api-key'
const METHOD_POST = 'POST'
const METHOD_GET = 'GET'

class Notifications {
  #url
  #apiKey
  #enabled
  #appEnv
  #timeout
  #maxAttempts

  constructor(config) {
    this.#url = config.url
    this.#apiKey = config.apiKey
    this.#enabled = config.enabled
    this.#appEnv = config.appEnv
    this.#timeout = config.timeout || 5000
    this.#maxAttempts = config.maxAttempts || 3
  }

  async sendNotification(to, subject, message) {
    if (!this.#enabled) {
      return
    }

    let lastError
    for (let attempt = 0; attempt < this.#maxAttempts; attempt++) {
      try {
        const response = await fetch(`${this.#url}/send`, {
          method: METHOD_POST,
          headers: {
            [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON,
            [API_KEY_HEADER]: this.#apiKey
          },
          body: JSON.stringify({ to, subject, message }),
          signal: AbortSignal.timeout(this.#timeout)
        })

        if (response.status === 500) {
          lastError = new Error('Provider returned 500')
          continue
        }

        if (!response.ok) {
          console.error(`Failed to send notification: ${response.status}`)
          return
        }

        return
      } catch (error) {
        lastError = error
      }
    }

    console.error(`Failed to send notification after ${this.#maxAttempts} attempts:`, lastError)
  }

  async publishEvent(topic, payload) {
    if (!this.#enabled) {
      return
    }

    try {
      await fetch(`${this.#url}/topics/${topic}/publish`, {
        method: METHOD_POST,
        headers: {
          [CONTENT_TYPE_HEADER]: CONTENT_TYPE_JSON,
          [API_KEY_HEADER]: this.#apiKey
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.#timeout)
      })
    } catch (error) {
      console.error(`Failed to publish event to topic ${topic}:`, error)
      throw error
    }
  }

  async publishToUser(userId, payload) {
    await this.publishEvent(`user-${userId}`, payload)
  }

  isEnabled() {
    return this.#enabled
  }

  getAppEnv() {
    return this.#appEnv
  }

  hasApiKey() {
    return this.#apiKey != null
  }

  async getHealth() {
    try {
      const response = await fetch(`${this.#url}/health`, {
        method: METHOD_GET,
        headers: {
          [API_KEY_HEADER]: this.#apiKey
        },
        signal: AbortSignal.timeout(this.#timeout)
      })
      return response.ok
    } catch (error) {
      console.error('Failed to check notification provider health:', error)
      return false
    }
  }

  async getSentList() {
    try {
      const response = await fetch(`${this.#url}/sent`, {
        method: METHOD_GET,
        headers: {
          [API_KEY_HEADER]: this.#apiKey
        },
        signal: AbortSignal.timeout(this.#timeout)
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch sent notifications: ${response.status}`)
      }

      return response.json()
    } catch (error) {
      console.error('Failed to fetch sent notifications:', error)
      throw error
    }
  }
}

function buildNotificationsConfig(env) {
  const appEnv = env.APP_ENV || 'development'
  const url = env.NOTIFICATIONS_URL || 'http://localhost:4002'
  const enabled = env.NOTIFICATIONS_ENABLED !== 'false'

  let apiKey = null
  if (appEnv === 'staging' && env.STAGING_NOTIFY_API_KEY) {
    apiKey = env.STAGING_NOTIFY_API_KEY
  } else if (appEnv === 'production' && env.PROD_NOTIFY_API_KEY) {
    apiKey = env.PROD_NOTIFY_API_KEY
  } else if (env.NOTIFY_API_KEY) {
    apiKey = env.NOTIFY_API_KEY
  }

  return {
    url,
    apiKey,
    enabled,
    appEnv,
    timeout: parseInt(env.NOTIFICATIONS_TIMEOUT || '5000', 10),
    maxAttempts: parseInt(env.NOTIFICATIONS_MAX_ATTEMPTS || '3', 10)
  }
}

module.exports = {
  Notifications,
  buildNotificationsConfig
}
