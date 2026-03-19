/**
 * 将日期格式化为本地日期键（YYYY-MM-DD格式）
 * @param date - 要格式化的日期，默认为当前日期
 * @returns 格式化的日期字符串
 */
export function formatLocalDateKey(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
