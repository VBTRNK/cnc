/** Hands the player a file to keep, without leaving the page. */
export function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const saveFileName = (day: number | null): string =>
  day === null ? "crime-and-crown-save.json" : `crime-and-crown-day-${day}.json`;
