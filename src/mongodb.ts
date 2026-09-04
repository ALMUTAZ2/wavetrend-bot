import { MongoClient, Db } from "mongodb"
import dotenv from "dotenv"

dotenv.config()

const uri = process.env.MONGODB_URI || ""
let client: MongoClient | null = null
let db: Db | null = null

export async function connectDB() {
  if (db) return db
  if (!uri) {
    console.warn("MONGODB_URI is not defined. Database operations will be skipped.")
    return null
  }
  try {
    client = new MongoClient(uri)
    await client.connect()
    db = client.db("trading_bot_db")
    console.log("✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح")
    return db
  } catch (error) {
    console.error("❌ خطأ في الاتصال بقاعدة البيانات:", error)
    throw error
  }
}

export async function saveSignal(signalData: any) {
  try {
    const database = await connectDB()
    if (!database) return
    const collection = database.collection("signals")
    await collection.insertOne(signalData)
    console.log("💾 تم حفظ الإشارة في قاعدة البيانات بنجاح")
  } catch (error) {
    console.error("خطأ في حفظ الإشارة:", error)
  }
}
