import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function short(addr: string, n = 4) {
  return `${addr.slice(0, 2 + n)}…${addr.slice(-n)}`;
}
