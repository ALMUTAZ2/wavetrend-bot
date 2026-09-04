import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * دمج فئات Tailwind CSS بشكل آمن
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * تنسيق أرقام الأسعار مع تحديد عدد الخانات العشرية
 */
export function formatPrice(price: number, decimals: number = 2): string {
  return price.toFixed(decimals)
}

/**
 * تحويل الطابع الزمنية (Timestamp) إلى تاريخ ووقت مقروء باللغة العربية
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
