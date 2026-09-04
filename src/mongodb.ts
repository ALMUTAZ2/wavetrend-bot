import "server-only"

import { MongoClient, type Db } from "mongodb"

const dbName = () =>
  process.env.MONGODB_DB?.trim() || process.env.DB_NAME?.trim() || undefined

declare global {
  var __mongodbClientPromise: Promise<MongoClient> | undefined
}

async function createClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI

  if (!uri) {
    throw new Error("Missing MONGODB_URI environment variable")
  }

  const client = new MongoClient(uri, {
    appName: "etlaq-nextjs-sandbox",
    maxPoolSize: 5,
    minPoolSize: 0,
    maxIdleTimeMS: 60_000,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    waitQueueTimeoutMS: 10_000,
  })

  return client.connect()
}

export function getMongoClient(): Promise<MongoClient> {
  if (!globalThis.__mongodbClientPromise) {
    globalThis.__mongodbClientPromise = createClientPromise().catch((error) => {
      globalThis.__mongodbClientPromise = undefined
      throw error
    })
  }

  return globalThis.__mongodbClientPromise
}

export async function getMongoDb(): Promise<Db> {
  const client = await getMongoClient()

  const name = dbName()
  return name ? client.db(name) : client.db()
}
