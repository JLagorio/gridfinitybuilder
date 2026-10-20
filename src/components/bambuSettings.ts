/** The printer's Bambu Studio project settings (public/bambu/<printer>.json), if there are any. */
export async function bambuSettings(printerId: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}bambu/${printerId}.json`);
    return res.ok ? await res.text() : undefined;
  } catch {
    return undefined;
  }
}
