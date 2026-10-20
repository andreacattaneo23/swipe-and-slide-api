/**
 * Sostituti di next/headers, next/navigation e next/cache per provare i gestori lato server fuori
 * da Next: cookie in memoria e redirect che lancia un errore riconoscibile.
 */
import { vi } from 'vitest';

export interface StoredCookie {
  value: string;
  options: Record<string, unknown>;
}

export const cookieJar = new Map<string, StoredCookie>();

export class RedirectError extends Error {
  constructor(readonly location: string) {
    super(`redirect:${location}`);
  }
}

export const cookieStore = {
  get: (name: string) =>
    cookieJar.has(name) ? { name, value: cookieJar.get(name)!.value } : undefined,
  set: (name: string, value: string, options: Record<string, unknown> = {}) => {
    cookieJar.set(name, { value, options });
  },
  delete: (input: string | { name: string }) => {
    cookieJar.delete(typeof input === 'string' ? input : input.name);
  },
};

vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/navigation', () => ({
  redirect: (location: string) => {
    throw new RedirectError(location);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/** Esegue un gestore e restituisce lo stato oppure la destinazione del redirect. */
export async function run<T>(action: () => Promise<T>): Promise<T | { redirect: string }> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof RedirectError) return { redirect: error.location };
    throw error;
  }
}

export function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
